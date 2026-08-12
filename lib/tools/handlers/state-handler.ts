/**
 * State Tool Handler
 *
 * Executes state operations for fetching, setting, and deleting persistent
 * state across the four-tier cascade: chat → project → group → general.
 *
 * Supports path-based access with dot notation and array indexing. On a merged
 * fetch narrower tiers win (chat over project over group over general). The
 * merge and group resolution live in `@/lib/state/state-cascade`.
 */

import {
  StateToolInput,
  StateToolOutput,
  StateOperation,
  StateContext,
  validateStateInput,
} from '../state-tool';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  parsePath,
  getAtPath,
  setAtPath as setAtPathPure,
  deleteAtPath,
} from '@/lib/state/state-paths';
import {
  resolveStateCascade,
  resolveGroupCandidates,
  resolveGroupForContext,
  StateGroupResolutionError,
  type GroupScope,
} from '@/lib/state/state-cascade';
import { readGeneralState, writeGeneralState } from '@/lib/mount-index/general-state';
import type { Group } from '@/lib/schemas/group.types';

// Re-export the pure path helpers so existing imports (lib/tools/index.ts,
// tests) keep resolving through the handler. New code should import them
// directly from '@/lib/state/state-paths'.
export { parsePath, getAtPath, deleteAtPath } from '@/lib/state/state-paths';

/**
 * Context required for state tool execution
 */
export interface StateToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID for state operations */
  chatId: string;
  /** Project ID (optional, for project state access) */
  projectId?: string;
  /**
   * Responding character ID (optional). Scopes the group tier to this
   * character's own memberships (Knowledge's rule). Absent → no group tier.
   */
  characterId?: string;
}

/**
 * Error thrown during state execution
 */
export class StateError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NOT_FOUND' | 'PERMISSION_DENIED'
  ) {
    super(message);
    this.name = 'StateError';
  }
}

/**
 * Set a value at a path, re-wrapping the pure helper's root-set error as a
 * typed `StateError` for callers in this handler. Otherwise identical to
 * {@link setAtPathPure}.
 */
export function setAtPath(
  obj: Record<string, unknown>,
  path: (string | number)[],
  value: unknown
): Record<string, unknown> {
  try {
    return setAtPathPure(obj, path, value);
  } catch (error) {
    throw new StateError(
      error instanceof Error ? error.message : 'Cannot set root state to non-object value',
      'VALIDATION_ERROR'
    );
  }
}

/**
 * Execute the state tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID, chat ID, and optional project ID
 * @returns Tool output with operation result
 */
export async function executeStateTool(
  input: unknown,
  context: StateToolContext
): Promise<StateToolOutput> {
  const repos = getRepositories();

  try {
    // Validate input
    const parsed = validateStateInput(input);
    if (!parsed) {
      logger.warn('State tool validation failed', {
        context: 'state-handler',
        userId: context.userId,
        input,
      });
      return {
        success: false,
        operation: typeof input === 'object' && input !== null && 'operation' in input
          ? (input as Record<string, unknown>).operation as StateOperation
          : 'fetch',
        error: 'Invalid input: operation is required and must be "fetch", "set", or "delete"',
      };
    }

    const { operation, context: stateContext, group: groupRef, path, value } = parsed;
    const parsedPath = parsePath(path);

    // Fetch chat
    const chat = await repos.chats.findById(context.chatId);
    if (!chat || chat.userId !== context.userId) {
      logger.warn('State tool: chat not found or permission denied', {
        context: 'state-handler',
        chatId: context.chatId,
        userId: context.userId,
      });
      return {
        success: false,
        operation,
        error: 'Chat not found or permission denied',
      };
    }

    // Get project if available
    const projectId = context.projectId || chat.projectId;
    let project = null;
    if (projectId) {
      // Projects are global to the instance now — no per-user ownership.
      project = await repos.projects.findById(projectId);
    }

    // Get current states
    const chatState = (chat.state || {}) as Record<string, unknown>;
    const projectState = project ? (project.state || {}) as Record<string, unknown> : {};

    // The group tier follows the responding character's own memberships
    // (Knowledge's rule). Absent characterId → no group tier at all.
    const groupScope: GroupScope = context.characterId
      ? { kind: 'character', characterId: context.characterId }
      : { kind: 'none' };

    // Resolve one group for an explicit group-context op, returning a typed
    // tool error (never throwing) when it can't be pinned down.
    const resolveGroupOrError = async (): Promise<
      { ok: true; group: Group } | { ok: false; error: string }
    > => {
      const candidates = await resolveGroupCandidates(chat, groupScope);
      try {
        return { ok: true, group: resolveGroupForContext({ groupRef, candidates }) };
      } catch (error) {
        if (error instanceof StateGroupResolutionError) {
          return { ok: false, error: error.message };
        }
        throw error;
      }
    };

    const underscoreDenied = (verb: 'modified' | 'deleted'): StateToolOutput | null => {
      if (parsedPath.length > 0 && typeof parsedPath[0] === 'string' && parsedPath[0].startsWith('_')) {
        logger.warn(`State tool: attempted to ${verb === 'modified' ? 'modify' : 'delete'} user-only key`, {
          context: 'state-handler',
          userId: context.userId,
          chatId: context.chatId,
          characterId: context.characterId,
          path,
        });
        return {
          success: false,
          operation,
          context: stateContext,
          path,
          error: `Keys starting with underscore are user-only and cannot be ${verb} by AI`,
        };
      }
      return null;
    };

    // Handle operations
    switch (operation) {
      case 'fetch': {
        let resultValue: unknown;
        let groupIdForLog: string | undefined;

        if (stateContext === 'chat') {
          resultValue = getAtPath(chatState, parsedPath);
        } else if (stateContext === 'project') {
          if (!project) {
            return {
              success: false,
              operation,
              context: stateContext,
              path,
              error: 'Chat is not part of a project',
            };
          }
          resultValue = getAtPath(projectState, parsedPath);
        } else if (stateContext === 'group') {
          const resolved = await resolveGroupOrError();
          if (!resolved.ok) {
            return { success: false, operation, context: stateContext, path, error: resolved.error };
          }
          groupIdForLog = resolved.group.id;
          resultValue = getAtPath((resolved.group.state || {}) as Record<string, unknown>, parsedPath);
        } else if (stateContext === 'general') {
          const generalState = await readGeneralState();
          resultValue = getAtPath(generalState, parsedPath);
        } else {
          // Merged cascade (chat over project over group over general).
          const cascade = await resolveStateCascade({ chat, groupScope });
          groupIdForLog = cascade.groupTier.appliedGroupId;
          resultValue = getAtPath(cascade.merged, parsedPath);
        }

        logger.info('State fetch completed', {
          context: 'state-handler',
          userId: context.userId,
          chatId: context.chatId,
          characterId: context.characterId,
          stateContext,
          groupId: groupIdForLog,
          path,
          hasValue: resultValue !== undefined,
        });

        return {
          success: true,
          operation,
          context: stateContext,
          path,
          value: resultValue,
        };
      }

      case 'set': {
        const denied = underscoreDenied('modified');
        if (denied) return denied;

        const targetContext = stateContext || 'chat';
        let previousValue: unknown;
        let newState: Record<string, unknown>;
        let groupIdForLog: string | undefined;

        if (targetContext === 'project') {
          if (!project) {
            return {
              success: false,
              operation,
              context: targetContext,
              path,
              error: 'Chat is not part of a project',
            };
          }
          previousValue = getAtPath(projectState, parsedPath);
          newState = setAtPath({ ...projectState }, parsedPath, value);
          await repos.projects.update(project.id, { state: newState });
        } else if (targetContext === 'group') {
          const resolved = await resolveGroupOrError();
          if (!resolved.ok) {
            return { success: false, operation, context: targetContext, path, error: resolved.error };
          }
          const groupState = (resolved.group.state || {}) as Record<string, unknown>;
          previousValue = getAtPath(groupState, parsedPath);
          newState = setAtPath({ ...groupState }, parsedPath, value);
          await repos.groups.update(resolved.group.id, { state: newState });
          groupIdForLog = resolved.group.id;
        } else if (targetContext === 'general') {
          const generalState = await readGeneralState();
          previousValue = getAtPath(generalState, parsedPath);
          newState = setAtPath({ ...generalState }, parsedPath, value);
          await writeGeneralState(newState);
        } else {
          previousValue = getAtPath(chatState, parsedPath);
          newState = setAtPath({ ...chatState }, parsedPath, value);
          await repos.chats.update(chat.id, { state: newState });
        }

        logger.info('State set completed', {
          context: 'state-handler',
          userId: context.userId,
          chatId: context.chatId,
          characterId: context.characterId,
          targetContext,
          groupId: groupIdForLog,
          path,
          hadPreviousValue: previousValue !== undefined,
        });

        return {
          success: true,
          operation,
          context: targetContext,
          path,
          value,
          previousValue,
        };
      }

      case 'delete': {
        const denied = underscoreDenied('deleted');
        if (denied) return denied;

        const targetContext = stateContext || 'chat';
        let previousValue: unknown;
        let deleted: boolean;
        let groupIdForLog: string | undefined;

        if (targetContext === 'project') {
          if (!project) {
            return {
              success: false,
              operation,
              context: targetContext,
              path,
              error: 'Chat is not part of a project',
            };
          }
          previousValue = getAtPath(projectState, parsedPath);
          const newState = { ...projectState };
          deleted = deleteAtPath(newState, parsedPath);
          if (deleted) {
            await repos.projects.update(project.id, { state: newState });
          }
        } else if (targetContext === 'group') {
          const resolved = await resolveGroupOrError();
          if (!resolved.ok) {
            return { success: false, operation, context: targetContext, path, error: resolved.error };
          }
          const groupState = (resolved.group.state || {}) as Record<string, unknown>;
          previousValue = getAtPath(groupState, parsedPath);
          const newState = { ...groupState };
          deleted = deleteAtPath(newState, parsedPath);
          if (deleted) {
            await repos.groups.update(resolved.group.id, { state: newState });
          }
          groupIdForLog = resolved.group.id;
        } else if (targetContext === 'general') {
          const generalState = await readGeneralState();
          previousValue = getAtPath(generalState, parsedPath);
          const newState = { ...generalState };
          deleted = deleteAtPath(newState, parsedPath);
          if (deleted) {
            await writeGeneralState(newState);
          }
        } else {
          previousValue = getAtPath(chatState, parsedPath);
          const newState = { ...chatState };
          deleted = deleteAtPath(newState, parsedPath);
          if (deleted) {
            await repos.chats.update(chat.id, { state: newState });
          }
        }

        logger.info('State delete completed', {
          context: 'state-handler',
          userId: context.userId,
          chatId: context.chatId,
          characterId: context.characterId,
          targetContext,
          groupId: groupIdForLog,
          path,
          deleted,
        });

        return {
          success: true,
          operation,
          context: targetContext,
          path,
          previousValue,
        };
      }

      default:
        return {
          success: false,
          operation,
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    logger.error('State tool execution failed', {
      context: 'state-handler',
      userId: context.userId,
      chatId: context.chatId,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      operation: typeof input === 'object' && input !== null && 'operation' in input
        ? (input as Record<string, unknown>).operation as StateOperation
        : 'fetch',
      error: error instanceof Error ? error.message : 'Unknown error during state operation',
    };
  }
}

/**
 * Format state results for inclusion in conversation context
 *
 * @param output - State tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatStateResults(output: StateToolOutput): string {
  if (!output.success) {
    return `State Error: ${output.error || 'Unknown error'}`;
  }

  const { operation, context, path, value, previousValue } = output;
  const pathDisplay = path || '(root)';
  const contextDisplay = context ? ` [${context}]` : '';

  switch (operation) {
    case 'fetch':
      if (value === undefined) {
        return `State${contextDisplay} at "${pathDisplay}": (not set)`;
      }
      return `State${contextDisplay} at "${pathDisplay}": ${JSON.stringify(value, null, 2)}`;

    case 'set':
      if (previousValue === undefined) {
        return `State${contextDisplay} set "${pathDisplay}" to: ${JSON.stringify(value)}`;
      }
      return `State${contextDisplay} updated "${pathDisplay}": ${JSON.stringify(previousValue)} → ${JSON.stringify(value)}`;

    case 'delete':
      if (previousValue === undefined) {
        return `State${contextDisplay} delete "${pathDisplay}": (was not set)`;
      }
      return `State${contextDisplay} deleted "${pathDisplay}" (was: ${JSON.stringify(previousValue)})`;

    default:
      return `State operation completed`;
  }
}
