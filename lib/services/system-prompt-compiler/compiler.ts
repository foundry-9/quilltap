/**
 * System Prompt Compiler (Phase H)
 *
 * Builds and caches the per-participant character-identity stack on
 * `chats.compiledIdentityStacks`. The cached artifact is the bulk of the
 * per-turn system prompt — preamble, base prompt, manifesto, personality,
 * aliases, pronouns, physical descriptions, example dialogues — with the chat-level
 * `{{user}}`, `{{scenario}}`, and `{{persona}}` template variables resolved.
 *
 * The per-turn `buildSystemPrompt` consumes the cached stack and wraps it
 * with the chat-level roleplay template, tool instructions, and tool
 * reinforcement. The cache lets the LLM provider see a stable
 * cache-friendly prefix across turns, and lets us skip the rebuild work.
 *
 * Invalidation hooks:
 *   - Chat creation (compile every LLM-controlled CHARACTER participant).
 *   - Participant added or reactivated (compile that participant alone).
 *   - Participant `selectedSystemPromptId` changed (recompile that one).
 *   - Chat `scenarioText` changed (recompile every LLM character).
 *
 * Edits to the underlying character record (name, manifesto, personality,
 * aliases, pronouns, physical descriptions, example dialogues, systemPrompts) are NOT
 * auto-invalidated — that fan-out across chats is its own design pass.
 * Read-through fallback in `buildSystemPrompt` ensures correctness when the
 * cache is missing or stale: the stack is rebuilt from current data and used
 * for that turn (without persisting).
 *
 * Edits to the BUILDER (the wording `buildIdentityStack` emits) ARE
 * invalidated, via `IDENTITY_STACK_BUILDER_VERSION`: every write is stamped
 * with the version, reads require strict equality, and a mismatch reads as
 * "nothing cached" so the read-through path rebuilds with current wording.
 *
 * Errors never propagate — chat operations must never fail because the
 * cache write couldn't complete; the read-through fallback covers it.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import {
  buildIdentityStack,
  IDENTITY_STACK_BUILDER_VERSION,
} from '@/lib/chat/context/system-prompt-builder';
import type { ChatMetadataBase, ChatParticipantBase } from '@/lib/schemas/types';

/**
 * Persisted form of `chats.compiledIdentityStacks`.
 *
 * The legacy shape (rows written before the version stamp) is a bare
 * `Record<participantId, stack>` with no `version` key — participant ids are
 * UUIDs, so `version` can never collide with a real entry. Legacy rows are
 * detected by the absent/non-numeric `version` and read as stale; the
 * read-through fallback in `buildSystemPrompt` then rebuilds with current
 * wording. The Zod schema for the column stays a permissive `JsonSchema`
 * precisely so the legacy shape remains readable.
 */
interface CompiledIdentityStacks {
  /** `IDENTITY_STACK_BUILDER_VERSION` at write time. */
  version: number;
  /** participantId → compiled stack. */
  stacks: Record<string, string>;
}

/**
 * Parse the stored `compiledIdentityStacks` value, returning the stack map
 * only when its version stamp STRICTLY equals the current builder version.
 * Absent, legacy (bare map), older, or newer all return null — newer matters
 * on a downgrade, where a rolled-back build must not consume stacks a later
 * build wrote.
 */
function readCurrentStacks(chat: ChatMetadataBase): Record<string, string> | null {
  const raw = chat.compiledIdentityStacks as Partial<CompiledIdentityStacks> | null | undefined;
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.version !== 'number' || raw.version !== IDENTITY_STACK_BUILDER_VERSION) {
    return null;
  }
  const stacks = raw.stacks;
  if (!stacks || typeof stacks !== 'object') return null;
  return stacks as Record<string, string>;
}

/**
 * Read the cached stack for a participant from a chat. Returns null when
 * absent or version-stale (caller should fall back to fresh build).
 */
export function getCompiledIdentityStack(
  chat: ChatMetadataBase,
  participantId: string,
): string | null {
  const map = readCurrentStacks(chat);
  if (!map) return null;
  const value = map[participantId];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Find the user-controlled character (impersonating participant) on a chat,
 * if any. Used to populate the `{{user}}` and `{{persona}}` template
 * variables in the identity stack. The first user-controlled CHARACTER
 * participant wins — matches `buildOtherParticipantsInfo` semantics.
 */
async function resolveUserCharacter(
  chat: ChatMetadataBase,
): Promise<{ name: string; description: string } | null> {
  const repos = getRepositories();
  const userParticipant = chat.participants.find(
    (p) => p.type === 'CHARACTER' && p.controlledBy === 'user' && p.characterId,
  );
  if (!userParticipant?.characterId) return null;
  try {
    const character = await repos.characters.findById(userParticipant.characterId);
    if (!character) return null;
    return {
      name: character.name,
      description: character.description ?? '',
    };
  } catch (error) {
    return null;
  }
}

interface CompileForParticipantParams {
  chat: ChatMetadataBase;
  participant: ChatParticipantBase;
}

/**
 * Build the identity stack for a single LLM-controlled participant. Returns
 * null when the participant isn't eligible (user-controlled, no characterId,
 * removed, or character lookup failed).
 */
async function buildStackFor(
  params: CompileForParticipantParams,
): Promise<string | null> {
  const { chat, participant } = params;

  if (
    participant.type !== 'CHARACTER' ||
    participant.controlledBy === 'user' ||
    !participant.characterId ||
    participant.status === 'removed'
  ) {
    return null;
  }

  const repos = getRepositories();
  const character = await repos.characters.findById(participant.characterId);
  if (!character) {
    return null;
  }

  const userCharacter = await resolveUserCharacter(chat);

  const stack = buildIdentityStack({
    character,
    userCharacter,
    selectedSystemPromptId: participant.selectedSystemPromptId ?? null,
    scenarioText: chat.scenarioText ?? null,
  });

  return stack.length > 0 ? stack : null;
}

/**
 * Persist a new `compiledIdentityStacks` map onto the chat row, stamped with
 * the current builder version. An empty map still writes `null` — the null
 * column is the "nothing cached" state and needs no version. Failure logs
 * but does not throw — read-through fallback in `buildSystemPrompt` covers
 * any miss.
 */
async function writeStacks(
  chatId: string,
  stacks: Record<string, string>,
): Promise<void> {
  try {
    const repos = getRepositories();
    const envelope: CompiledIdentityStacks = {
      version: IDENTITY_STACK_BUILDER_VERSION,
      stacks,
    };
    await repos.chats.update(chatId, {
      compiledIdentityStacks:
        Object.keys(stacks).length > 0 ? (envelope as unknown as Record<string, unknown>) : null,
    });
  } catch (error) {
    logger.error('[SystemPromptCompiler] Failed to persist identity stacks', {
      context: 'system-prompt-compiler',
      chatId,
      error: getErrorMessage(error),
    }, error as Error);
  }
}

/**
 * Compile the identity stack for every LLM-controlled CHARACTER participant
 * on a chat and persist the result. Used at chat creation and on chat-level
 * changes that affect every character (e.g., scenario edit).
 */
export async function compileAllIdentityStacks(chat: ChatMetadataBase): Promise<void> {
  const stacks: Record<string, string> = {};
  for (const participant of chat.participants) {
    const stack = await buildStackFor({ chat, participant });
    if (stack) {
      stacks[participant.id] = stack;
    }
  }
  logger.info('[SystemPromptCompiler] Compiled identity stacks', {
    context: 'system-prompt-compiler',
    chatId: chat.id,
    participantCount: Object.keys(stacks).length,
  });
  await writeStacks(chat.id, stacks);
}

/**
 * Compile (or recompile) the identity stack for a single participant.
 * Merges into any existing map. Used on participant add and on
 * `selectedSystemPromptId` changes.
 */
export async function compileIdentityStackForParticipant(
  chat: ChatMetadataBase,
  participantId: string,
): Promise<void> {
  const participant = chat.participants.find((p) => p.id === participantId);
  if (!participant) {
    return;
  }

  const stack = await buildStackFor({ chat, participant });
  if (!stack) {
    // Drop a stale entry if there is one (e.g., participant became
    // user-controlled or removed). On a version mismatch there is nothing
    // meaningful to drop — write the cleared value rather than rewriting the
    // stale map back.
    const existing = readCurrentStacks(chat);
    if (existing) {
      if (participantId in existing) {
        const { [participantId]: _drop, ...rest } = existing;
        void _drop;
        await writeStacks(chat.id, rest);
      }
    } else if (chat.compiledIdentityStacks) {
      await writeStacks(chat.id, {});
    }
    return;
  }

  // Merge only into a version-current map. A stale or legacy map must be
  // DISCARDED entirely, never merged into: blending a fresh stack into stale
  // siblings and then stamping the result current would make the stamp lie,
  // silently defeating the whole mechanism.
  const existing = readCurrentStacks(chat) ?? {};
  const next = { ...existing, [participantId]: stack };
  logger.info('[SystemPromptCompiler] Compiled identity stack for participant', {
    context: 'system-prompt-compiler',
    chatId: chat.id,
    participantId,
    characterId: participant.characterId,
  });
  await writeStacks(chat.id, next);
}
