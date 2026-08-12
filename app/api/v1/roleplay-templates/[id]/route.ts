/**
 * Roleplay Template Management Routes v1 - Individual Template Endpoint
 *
 * GET    /api/v1/roleplay-templates/[id]   - Get a specific roleplay template
 * PUT    /api/v1/roleplay-templates/[id]   - Update a roleplay template
 * DELETE /api/v1/roleplay-templates/[id]   - Delete a roleplay template
 *
 * Roleplay templates provide formatting instructions that are prepended to character system prompts.
 */

import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { successResponse, errorResponse, notFound, forbidden } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { generateRenderingPatterns } from '@/lib/chat/annotations';
import { TemplateDelimiterSchema } from '@/lib/schemas/template.types';

// ============================================================================
// Schemas
// ============================================================================

const updateRoleplayTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  systemPrompt: z.string().min(1).optional(),
  tags: z.array(z.uuid()).optional(),
  delimiters: z.array(TemplateDelimiterSchema).optional(),
  renderingPatterns: z.array(z.any()).optional(),
  dialogueDetection: z.any().optional().nullable(),
  narrationDelimiters: z.union([
    z.string().min(1),
    z.tuple([z.string().min(1), z.string().min(1)]),
  ]).optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

/**
 * GET /api/v1/roleplay-templates/[id]
 * Get a specific roleplay template by ID
 * Returns 404 if template not found or user doesn't own it (for user-created templates)
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const template = await repos.roleplayTemplates.findById(id);

    if (!template) {
      return notFound('Roleplay template');
    }

    // Auto-generate rendering patterns for templates that have delimiters but no patterns
    if ((!template.renderingPatterns || template.renderingPatterns.length === 0) &&
        ((template.delimiters && template.delimiters.length > 0) || template.narrationDelimiters)) {
      template.renderingPatterns = generateRenderingPatterns(
        template.delimiters || [],
        template.narrationDelimiters
      );
    }

    return successResponse(template);
  }
);

// ============================================================================
// PUT Handler
// ============================================================================

/**
 * PUT /api/v1/roleplay-templates/[id]
 * Update a roleplay template
 *
 * Body: {
 *   name?: string,
 *   description?: string | null,
 *   systemPrompt?: string,
 *   tags?: string[],
 *   annotationButtons?: any[],
 *   renderingPatterns?: any[],
 *   dialogueDetection?: any | null
 * }
 */
export const PUT = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const existingTemplate = await repos.roleplayTemplates.findById(id);

    if (!existingTemplate) {
      return notFound('Roleplay template');
    }

    // Prevent editing built-in templates
    if (existingTemplate.isBuiltIn) {
      logger.warn('Attempted to edit built-in roleplay template', {
        templateId: id,
        userId: user.id,
      });
      return forbidden('Cannot edit built-in roleplay templates');
    }

    const body = await req.json();
    const validatedData = updateRoleplayTemplateSchema.parse(body);

    // If name is being updated, check for duplicates
    if (validatedData.name && validatedData.name !== existingTemplate.name) {
      const existingByName = await repos.roleplayTemplates.findByName(user.id, validatedData.name);
      if (existingByName) {
        logger.warn('Duplicate roleplay template name', {
          templateId: id,
          userId: user.id,
          newName: validatedData.name,
        });
        return errorResponse('A roleplay template with this name already exists', 409);
      }
    }

    // Trim string values
    const updateData: Record<string, unknown> = {
      ...validatedData,
      name: validatedData.name?.trim(),
      description: validatedData.description?.trim(),
      systemPrompt: validatedData.systemPrompt?.trim(),
    };

    // Auto-generate rendering patterns from delimiters if delimiters changed but no explicit patterns
    if (validatedData.delimiters && !validatedData.renderingPatterns) {
      const narDelim = validatedData.narrationDelimiters || existingTemplate.narrationDelimiters;
      updateData.renderingPatterns = generateRenderingPatterns(validatedData.delimiters, narDelim);
    } else if (validatedData.narrationDelimiters && !validatedData.renderingPatterns && !validatedData.delimiters) {
      // Narration delimiters changed but no delimiters or patterns provided — regenerate
      const delims = existingTemplate.delimiters || [];
      updateData.renderingPatterns = generateRenderingPatterns(delims, validatedData.narrationDelimiters);
    }

    const updatedTemplate = await repos.roleplayTemplates.update(id, updateData);

    logger.info('Roleplay template updated successfully', {
      templateId: id,
      templateName: updatedTemplate?.name,
      userId: user.id,
    });

    return successResponse(updatedTemplate);
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

/**
 * DELETE /api/v1/roleplay-templates/[id]
 * Delete a roleplay template
 * Returns 404 if template not found or user doesn't own it
 * Returns 403 if trying to delete a built-in template
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const existingTemplate = await repos.roleplayTemplates.findById(id);

    if (!existingTemplate) {
      return notFound('Roleplay template');
    }

    // Prevent deleting built-in templates
    if (existingTemplate.isBuiltIn) {
      logger.warn('Attempted to delete built-in roleplay template', {
        templateId: id,
        userId: user.id,
      });
      return forbidden('Cannot delete built-in roleplay templates');
    }

    const deleted = await repos.roleplayTemplates.delete(id);

    if (!deleted) {
      logger.warn('Failed to delete roleplay template', {
        templateId: id,
        userId: user.id,
      });
      return errorResponse('Failed to delete roleplay template', 500);
    }

    logger.info('Roleplay template deleted successfully', {
      templateId: id,
      templateName: existingTemplate.name,
      userId: user.id,
    });

    return successResponse({
      success: true,
      deletedId: id,
    });
  }
);
