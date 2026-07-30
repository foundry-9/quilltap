/**
 * Prompt Templates API v1 - Individual Template Endpoint
 *
 * GET /api/v1/prompt-templates/[id] - Get a specific template
 * PUT /api/v1/prompt-templates/[id] - Update a user template (built-in templates cannot be updated)
 * DELETE /api/v1/prompt-templates/[id] - Delete a user template (built-in templates cannot be deleted)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, forbidden, serverError } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  description: z.string().max(500).optional(),
  category: z.string().optional(),
  modelHint: z.string().optional(),
});

type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    const template = await repos.promptTemplates.findById(id);

    if (!template) {
      logger.warn('[Prompt Templates v1] Template not found', {
        templateId: id,
        userId: user.id,
      });
      return notFound('Template');
    }

    return NextResponse.json({ template });
  }
);

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    const body = await req.json();
    const validatedData = updateTemplateSchema.parse(body);

    const existingTemplate = await repos.promptTemplates.findById(id);

    if (!existingTemplate) {
      logger.warn('[Prompt Templates v1] Template not found for update', {
        templateId: id,
        userId: user.id,
      });
      return notFound('Template');
    }

    // Cannot update built-in templates
    if (existingTemplate.isBuiltIn) {
      logger.warn('[Prompt Templates v1] Attempted to update built-in template', {
        templateId: id,
        userId: user.id,
      });
      return forbidden('Cannot update built-in templates');
    }

    const updates: any = {};
    if (validatedData.name !== undefined) updates.name = validatedData.name;
    if (validatedData.content !== undefined) updates.content = validatedData.content;
    if (validatedData.description !== undefined)
      updates.description = validatedData.description || null;
    if (validatedData.category !== undefined) updates.category = validatedData.category || null;
    if (validatedData.modelHint !== undefined)
      updates.modelHint = validatedData.modelHint || null;
    updates.updatedAt = new Date();

    const template = await repos.promptTemplates.update(id, updates);

    if (!template) {
      logger.error('[Prompt Templates v1] Failed to update template', {
        templateId: id,
        userId: user.id,
      });
      return serverError('Failed to update template');
    }

    logger.info('[Prompt Templates v1] Template updated', {
      templateId: id,
      userId: user.id,
      updatedFields: Object.keys(updates),
    });

    return NextResponse.json({ template });
  }
);

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    const existingTemplate = await repos.promptTemplates.findById(id);

    if (!existingTemplate) {
      logger.warn('[Prompt Templates v1] Template not found for deletion', {
        templateId: id,
        userId: user.id,
      });
      return notFound('Template');
    }

    // Cannot delete built-in templates
    if (existingTemplate.isBuiltIn) {
      logger.warn('[Prompt Templates v1] Attempted to delete built-in template', {
        templateId: id,
        userId: user.id,
      });
      return forbidden('Cannot delete built-in templates');
    }

    const deleted = await repos.promptTemplates.delete(id);

    if (!deleted) {
      logger.error('[Prompt Templates v1] Failed to delete template', {
        templateId: id,
        userId: user.id,
      });
      return serverError('Failed to delete template');
    }

    logger.info('[Prompt Templates v1] Template deleted', { templateId: id, userId: user.id });

    return NextResponse.json({ success: true });
  }
);
