/**
 * Text Replacement Rules API v1 - Collection Endpoint
 *
 * GET  /api/v1/settings/text-replacements                    - List all rules
 * POST /api/v1/settings/text-replacements                    - Create a new rule
 * POST /api/v1/settings/text-replacements?action=bulk-replace - Replace the full list
 *
 * Rules are global (no userId scoping). Pure literal-string, word-boundary
 * replacements applied by the Lexical TextReplacementPlugin on typed input.
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { successResponse, badRequest, serverError, conflict, created } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/database/repositories';
import {
  TextReplacementRuleInputSchema,
  type TextReplacementRuleInput,
} from '@/lib/schemas/text-replacement.types';
import { TextReplacementRuleConflictError } from '@/lib/database/repositories/text-replacement-rules.repository';

const POST_ACTIONS = ['bulk-replace'] as const;
type PostAction = (typeof POST_ACTIONS)[number];

/**
 * GET /api/v1/settings/text-replacements
 * Returns all text replacement rules ordered by sortOrder then createdAt.
 */
export const GET = createContextHandler(async () => {
  try {
    const repos = getRepositories();
    const rules = await repos.textReplacementRules.list();
    return successResponse({ rules, count: rules.length });
  } catch (error) {
    logger.error(
      '[Text Replacements v1] Error listing rules',
      {},
      error instanceof Error ? error : undefined,
    );
    return serverError('Failed to list text replacement rules');
  }
});

/**
 * POST /api/v1/settings/text-replacements
 * Action-dispatched. Default is create one rule.
 */
export const POST = createContextHandler(async (req: NextRequest) => {
  const action = getActionParam(req);

  if (action && isValidAction(action, POST_ACTIONS)) {
    if ((action as PostAction) === 'bulk-replace') {
      return handleBulkReplace(req);
    }
  }

  return handleCreate(req);
});

async function handleCreate(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = TextReplacementRuleInputSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return badRequest(`Invalid rule: ${message}`);
    }

    const repos = getRepositories();
    const rule = await repos.textReplacementRules.create(parsed.data);
    logger.info('[Text Replacements v1] Rule created', {
      ruleId: rule.id,
      fromText: rule.fromText,
      caseSensitive: rule.caseSensitive,
    });
    return created({ rule });
  } catch (error) {
    if (error instanceof TextReplacementRuleConflictError) {
      return conflict(error.message);
    }
    logger.error(
      '[Text Replacements v1] Error creating rule',
      {},
      error instanceof Error ? error : undefined,
    );
    return serverError('Failed to create text replacement rule');
  }
}

async function handleBulkReplace(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || !Array.isArray(body.rules)) {
      return badRequest('Body must include a `rules` array');
    }

    const parsed: TextReplacementRuleInput[] = [];
    for (let i = 0; i < body.rules.length; i++) {
      const result = TextReplacementRuleInputSchema.safeParse(body.rules[i]);
      if (!result.success) {
        const message = result.error.issues
          .map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`)
          .join('; ');
        return badRequest(`Invalid rule at index ${i}: ${message}`);
      }
      parsed.push(result.data);
    }

    const repos = getRepositories();
    const rules = await repos.textReplacementRules.bulkReplace(parsed);
    logger.info('[Text Replacements v1] Bulk replace completed', { count: rules.length });
    return successResponse({ rules, count: rules.length });
  } catch (error) {
    if (error instanceof TextReplacementRuleConflictError) {
      return conflict(error.message);
    }
    logger.error(
      '[Text Replacements v1] Error bulk-replacing rules',
      {},
      error instanceof Error ? error : undefined,
    );
    return serverError('Failed to replace text replacement rules');
  }
}
