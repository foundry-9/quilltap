/**
 * Text Replacement Rules API v1 - Item Endpoint
 *
 * PATCH  /api/v1/settings/text-replacements/[id] - Update a rule
 * DELETE /api/v1/settings/text-replacements/[id] - Delete a rule
 */

import { NextRequest } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import {
  successResponse,
  badRequest,
  notFound,
  serverError,
  conflict,
  noContent,
} from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/database/repositories';
import { TextReplacementRulePatchSchema } from '@/lib/schemas/text-replacement.types';
import { TextReplacementRuleConflictError } from '@/lib/database/repositories/text-replacement-rules.repository';

export const PATCH = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, _ctx, { id }) => {
    try {
      const body = await req.json();
      const parsed = TextReplacementRulePatchSchema.safeParse(body);
      if (!parsed.success) {
        const message = parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        return badRequest(`Invalid patch: ${message}`);
      }

      const repos = getRepositories();
      const updated = await repos.textReplacementRules.update(id, parsed.data);
      if (!updated) {
        return notFound(`Text replacement rule ${id} not found`);
      }

      logger.info('[Text Replacements v1] Rule updated', {
        ruleId: id,
        fields: Object.keys(parsed.data),
      });
      return successResponse({ rule: updated });
    } catch (error) {
      if (error instanceof TextReplacementRuleConflictError) {
        return conflict(error.message);
      }
      logger.error(
        '[Text Replacements v1] Error updating rule',
        { ruleId: id },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to update text replacement rule');
    }
  },
);

export const DELETE = createContextParamsHandler<{ id: string }>(
  async (_req: NextRequest, _ctx, { id }) => {
    try {
      const repos = getRepositories();
      const deleted = await repos.textReplacementRules.delete(id);
      if (!deleted) {
        return notFound(`Text replacement rule ${id} not found`);
      }

      logger.info('[Text Replacements v1] Rule deleted', { ruleId: id });
      return noContent();
    } catch (error) {
      logger.error(
        '[Text Replacements v1] Error deleting rule',
        { ruleId: id },
        error instanceof Error ? error : undefined,
      );
      return serverError('Failed to delete text replacement rule');
    }
  },
);
