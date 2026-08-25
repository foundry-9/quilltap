/**
 * Chats API v1 — Scenario Action
 *
 * `POST /api/v1/chats/[id]?action=scenario` — change the scene mid-conversation.
 *
 * The payload mirrors the New Chat dialog's scenario fields exactly and runs
 * through the same `resolveScenarioSelection` chain, so a preset picked from
 * the sidebar lands as the same text it would have at chat creation.
 *
 * Three things have to happen together, or the change is only half-made:
 *   1. `chat.scenarioText` is rewritten — it feeds `{{scenario}}` in the
 *      identity stack.
 *   2. Every participant's precompiled identity stack is rebuilt, because that
 *      template variable is baked into the compiled copy.
 *   3. The Host announces the revision, so the change is visible to the company
 *      rather than silently rewriting the world between turns.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, serverError, successResponse } from '@/lib/api/responses';
import { resolveScenarioSelection } from '@/lib/chat/scenario-selection';
import { postHostScenarioRevisionAnnouncement } from '@/lib/services/host-notifications/writer';
import { compileAllIdentityStacks } from '@/lib/services/system-prompt-compiler/compiler';
import { setScenarioSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ChatMetadata } from '@/lib/schemas/chat.types';

/**
 * Find which of the room's characters owns a given character-scenario id.
 *
 * At creation there is one "primary character" to look the id up on; an
 * established chat may hold several, and the picker only offers character
 * scenarios when exactly one LLM character is present. Searching the whole
 * active cast keeps the lookup honest either way. A character whose vault is
 * unavailable is skipped rather than allowed to fail the whole change.
 */
async function findCharacterOwningScenario(
  chat: ChatMetadata,
  scenarioId: string,
  repos: RepositoryContainer,
): Promise<{ id: string; scenarios?: Array<{ id: string; content: string }> | null } | null> {
  for (const participant of chat.participants) {
    if (participant.type !== 'CHARACTER' || !participant.characterId) continue;
    if (participant.status === 'removed') continue;
    try {
      const character = await repos.characters.findById(participant.characterId);
      if (character?.scenarios?.some((s) => s.id === scenarioId)) {
        return character;
      }
    } catch (error) {
      logger.debug('[Chats v1] Skipping character while resolving scenarioId', {
        chatId: chat.id,
        characterId: participant.characterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return null;
}

/**
 * Change (or clear) the chat's scenario.
 */
export async function handleSetScenario(
  req: NextRequest,
  chatId: string,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const validatedData = setScenarioSchema.parse(body);

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  const character = validatedData.scenarioId
    ? await findCharacterOwningScenario(chat, validatedData.scenarioId, repos)
    : null;

  const resolved = await resolveScenarioSelection(validatedData, {
    repos,
    projectId: chat.projectId,
    character,
    logTag: '[Chats v1]',
  });

  const nextScenarioText = resolved ?? null;
  const previousScenarioText = chat.scenarioText ?? null;

  // A no-op change earns no announcement and no recompile — re-picking the
  // scene you already have shouldn't post a bubble saying it changed.
  if (nextScenarioText === previousScenarioText) {
    logger.debug('[Chats v1] Scenario unchanged; nothing to do', { chatId });
    return successResponse({
      scenarioText: nextScenarioText,
      changed: false,
      message: 'Scenario unchanged',
    });
  }

  const updatedChat = await repos.chats.update(chatId, {
    scenarioText: nextScenarioText,
  });
  if (!updatedChat) {
    return serverError('Failed to update chat');
  }

  // `chat.scenarioText` feeds the {{scenario}} template variable, which is
  // baked into every participant's precompiled identity stack — a changed
  // scene means every stack is stale. Non-fatal: the compiler has a
  // read-through fallback, so a failure here costs speed, not correctness.
  try {
    await compileAllIdentityStacks(updatedChat);
  } catch (error) {
    logger.warn('[Chats v1] Failed to recompile identity stacks after scenario change', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await postHostScenarioRevisionAnnouncement({
    chatId,
    scenarioText: nextScenarioText,
  });

  logger.info('[Chats v1] Scenario changed', {
    chatId,
    hadScenario: previousScenarioText !== null,
    hasScenario: nextScenarioText !== null,
    scenarioLength: nextScenarioText?.length ?? 0,
    source: validatedData.scenarioId
      ? 'character'
      : validatedData.projectScenarioPath
        ? 'project'
        : validatedData.groupScenarioPath
          ? 'group'
          : validatedData.generalScenarioPath
            ? 'general'
            : 'custom',
  });

  return successResponse({
    scenarioText: nextScenarioText,
    changed: true,
    message: nextScenarioText ? 'Scenario updated' : 'Scenario cleared',
  });
}
