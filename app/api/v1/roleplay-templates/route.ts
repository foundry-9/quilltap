/**
 * Roleplay Template Management Routes v1
 *
 * GET    /api/v1/roleplay-templates   - List all roleplay templates for current user (built-in + user's)
 * POST   /api/v1/roleplay-templates   - Create a new roleplay template
 *
 * Roleplay templates provide formatting instructions that are prepended to character system prompts.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { generateRenderingPatterns } from '@/lib/chat/annotations';
import { TemplateDelimiterSchema } from '@/lib/schemas/template.types';

/**
 * GET /api/v1/roleplay-templates
 * List all roleplay templates available to the authenticated user
 * Returns both built-in templates and user-created templates
 */
export const GET = createContextHandler(async (req, { user, repos }) => {
  try {// Get all templates available to user (built-in + user's own)
    const templates = await repos.roleplayTemplates.findAllForUser(user.id);// Sort: built-in first, then by name
    templates.sort((a, b) => {
      // Built-in templates first
      if (a.isBuiltIn !== b.isBuiltIn) {
        return a.isBuiltIn ? -1 : 1;
      }
      // Then alphabetically by name
      return a.name.localeCompare(b.name);
    });

    return successResponse(templates);
  } catch (error) {
    logger.error(
      'Failed to fetch roleplay templates',
      {
        endpoint: '/api/v1/roleplay-templates',
        method: 'GET',
      },
      error instanceof Error ? error : undefined
    );
    return errorResponse('Failed to fetch roleplay templates', 500);
  }
});

/**
 * POST /api/v1/roleplay-templates
 * Create a new roleplay template
 *
 * Body: {
 *   name: string,
 *   description?: string,
 *   systemPrompt: string
 * }
 */
export const POST = createContextHandler(async (req, { user, repos }) => {
  try {const body = await req.json();
    const { name, description, systemPrompt, narrationDelimiters } = body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return errorResponse('Name is required', 400);
    }

    if (name.trim().length > 100) {
      return errorResponse('Name must be 100 characters or less', 400);
    }

    if (!systemPrompt || typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) {
      return errorResponse('System prompt is required', 400);
    }

    if (description && typeof description === 'string' && description.length > 500) {
      return errorResponse('Description must be 500 characters or less', 400);
    }

    // Validate narrationDelimiters (required)
    if (!narrationDelimiters) {
      return errorResponse('Narration delimiters are required', 400);
    }
    if (typeof narrationDelimiters === 'string') {
      if (narrationDelimiters.length === 0) {
        return errorResponse('Narration delimiters string must not be empty', 400);
      }
    } else if (Array.isArray(narrationDelimiters)) {
      if (narrationDelimiters.length !== 2 || !narrationDelimiters[0] || !narrationDelimiters[1]) {
        return errorResponse('Narration delimiters array must have exactly 2 non-empty elements [open, close]', 400);
      }
    } else {
      return errorResponse('Narration delimiters must be a string or [string, string] array', 400);
    }

    // Check for duplicate name among user's own templates
    const existingTemplate = await repos.roleplayTemplates.findByName(user.id, name.trim());
    if (existingTemplate) {
      return errorResponse('A roleplay template with this name already exists', 409);
    }

    // Validate delimiters against the discriminated-union schema (gives a 400
    // with a useful message instead of a 500 at repo-write time).
    const delimitersResult = z.array(TemplateDelimiterSchema).optional().safeParse(body.delimiters);
    if (!delimitersResult.success) {
      return errorResponse(`Invalid delimiters: ${delimitersResult.error.issues[0]?.message ?? 'malformed'}`, 400);
    }

    // Auto-generate rendering patterns from delimiters if not explicitly provided
    const templateDelimiters = delimitersResult.data || [];
    let renderingPatterns = body.renderingPatterns || [];
    if ((!renderingPatterns || renderingPatterns.length === 0) && (templateDelimiters.length > 0 || narrationDelimiters)) {
      renderingPatterns = generateRenderingPatterns(templateDelimiters, narrationDelimiters as string | [string, string]);
    }

    // Create template
    const template = await repos.roleplayTemplates.create({
      userId: user.id,
      name: name.trim(),
      description: description?.trim() || null,
      systemPrompt: systemPrompt.trim(),
      isBuiltIn: false,
      tags: [],
      delimiters: templateDelimiters,
      renderingPatterns,
      dialogueDetection: body.dialogueDetection || null,
      narrationDelimiters: narrationDelimiters as string | [string, string],
    });

    logger.info('Roleplay template created', {
      userId: user.id,
      templateId: template.id,
      templateName: template.name,
    });

    return successResponse(template, 201);
  } catch (error) {
    logger.error(
      'Failed to create roleplay template',
      {
        endpoint: '/api/v1/roleplay-templates',
        method: 'POST',
      },
      error instanceof Error ? error : undefined
    );
    return errorResponse('Failed to create roleplay template', 500);
  }
});