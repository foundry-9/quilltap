/**
 * Character Rename / Replace service.
 *
 * Powers the Aurora "Rename/Replace" tab: a bulk search-and-replace that sweeps
 * a character's own data — the managed character fields (name, the vantage-point
 * fields, manifesto, scenarios, system prompts, example dialogues), the physical
 * description and its prompt variants, the character's memories, and the titles
 * and message bodies of every chat the character appears in.
 *
 * It runs in two modes off the same code path:
 *   - `dryRun: true`  → a preview: counts and per-occurrence detail, no writes.
 *   - `dryRun: false` → the same scan, then the writes are committed.
 *
 * Character-field writes route through `repos.characters.update`, which projects
 * the vault-managed fields (identity/description/manifesto/personality/title/
 * firstMessage/exampleDialogues/aliases/physicalDescription/systemPrompts/
 * scenarios) into the character's document-store vault; only `name` lands on the
 * row. After an executed rename that touched chat messages, each affected
 * conversation is re-rendered and re-embedded so the searchable archive reflects
 * the new text (the same path the "Refresh Archive" action uses). Memory rows are
 * updated in place; their embeddings are left to refresh on next touch.
 *
 * History note: this replaces the legacy `POST /api/characters/[id]/rename`
 * route removed in the v1 cleanup. The shape that the Rename/Replace tab expects
 * (the `RenamePreviewResponse` below) is preserved verbatim.
 */

import { logger } from '@/lib/logger';
import { enqueueConversationRender } from '@/lib/background-jobs/queue-service';
import type { RequestContext } from '@/lib/api/middleware';
import type { Character, CharacterScenario, CharacterSystemPrompt, PhysicalDescription } from '@/lib/schemas/character.types';

type Repos = RequestContext['repos'];

export interface ReplacementPair {
  oldValue: string;
  newValue: string;
  caseSensitive: boolean;
}

export interface RenameRequest {
  /** Primary character-name replacement (oldValue is the current name). */
  primaryRename?: ReplacementPair;
  /** Additional replacements for nicknames, aliases, or arbitrary terms. */
  additionalReplacements: ReplacementPair[];
  /** When true, scan and report without committing any writes. */
  dryRun: boolean;
}

export interface ReplacementResult {
  field: string;
  location: string;
  oldText: string;
  newText: string;
  context?: string;
}

export interface RenameSummary {
  characterFields: number;
  physicalDescriptions: number;
  memories: number;
  chatTitles: number;
  chatMessages: number;
  total: number;
}

export interface RenamePreviewResponse {
  characterId: string;
  characterName: string;
  dryRun: boolean;
  replacements: ReplacementResult[];
  summary: RenameSummary;
}

/** Escapes regex metacharacters so a literal term matches literally. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Search-and-replace one term in a string. Returns the rewritten text, whether
 * anything changed, and how many occurrences were swapped.
 */
function performReplacement(
  text: string | null | undefined,
  pair: ReplacementPair
): { result: string | null; changed: boolean; matches: number } {
  if (!text) {
    return { result: null, changed: false, matches: 0 };
  }

  const flags = pair.caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegex(pair.oldValue), flags);
  const matches = (text.match(regex) || []).length;

  if (matches === 0) {
    return { result: text, changed: false, matches: 0 };
  }

  return { result: text.replace(regex, pair.newValue), changed: true, matches };
}

/** A short snippet of surrounding text for the preview table. */
function getContext(text: string, searchTerm: string): string {
  const MAX_LENGTH = 100;
  const index = text.toLowerCase().indexOf(searchTerm.toLowerCase());
  if (index === -1) return text.slice(0, MAX_LENGTH);

  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + searchTerm.length + 30);

  let context = text.slice(start, end);
  if (start > 0) context = '...' + context;
  if (end < text.length) context = context + '...';
  return context;
}

/**
 * Apply every replacement pair to a single string field in sequence, recording a
 * preview row per matched pair. Returns the rewritten value and total matches.
 */
function rewriteField(
  value: string | null | undefined,
  replacements: ReplacementPair[],
  field: string,
  location: string,
  out: ReplacementResult[]
): { value: string | null | undefined; matches: number } {
  if (typeof value !== 'string') return { value, matches: 0 };

  let current = value;
  let total = 0;
  for (const pair of replacements) {
    const { result, changed, matches } = performReplacement(current, pair);
    if (changed && result !== null) {
      out.push({
        field,
        location,
        oldText: pair.oldValue,
        newText: pair.newValue,
        context: getContext(current, pair.oldValue),
      });
      current = result;
      total += matches;
    }
  }
  return { value: current, matches: total };
}

/**
 * Run a character rename / bulk replace. Always scans; only writes when
 * `request.dryRun` is false. The returned shape matches what the Rename/Replace
 * tab renders.
 *
 * @param character The overlay-resolved character (vault fields rehydrated).
 */
export async function runCharacterRename(
  character: Character,
  request: RenameRequest,
  userId: string,
  repos: Repos
): Promise<RenamePreviewResponse> {
  const startTime = Date.now();
  const characterId = character.id;

  // Order matters: the primary rename runs before aliases/nicknames.
  const allReplacements: ReplacementPair[] = [];
  if (request.primaryRename) allReplacements.push(request.primaryRename);
  allReplacements.push(...request.additionalReplacements);

  const { dryRun } = request;

  const replacements: ReplacementResult[] = [];
  const summary: RenameSummary = {
    characterFields: 0,
    physicalDescriptions: 0,
    memories: 0,
    chatTitles: 0,
    chatMessages: 0,
    total: 0,
  };

  const characterUpdates: Partial<Character> = {};
  const location = `Character: ${character.name}`;

  // ── 1. Scalar character fields ──────────────────────────────────────────
  // `name` lands on the DB row; the rest are vault-managed (the repo routes
  // them there on update).
  const scalarFields: (keyof Character)[] = [
    'name', 'title', 'identity', 'description', 'manifesto',
    'personality', 'firstMessage', 'exampleDialogues',
  ];
  for (const field of scalarFields) {
    const { value, matches } = rewriteField(
      character[field] as string | null | undefined,
      allReplacements,
      field,
      location,
      replacements
    );
    if (matches > 0) {
      (characterUpdates as Record<string, unknown>)[field] = value;
      summary.characterFields += matches;
    }
  }

  // ── 2. Aliases (array of name-like strings) ─────────────────────────────
  if (character.aliases && character.aliases.length > 0) {
    let aliasesChanged = false;
    const updatedAliases = character.aliases.map((alias) => {
      const { value, matches } = rewriteField(alias, allReplacements, 'alias', location, replacements);
      if (matches > 0) {
        aliasesChanged = true;
        summary.characterFields += matches;
      }
      return typeof value === 'string' ? value : alias;
    });
    if (aliasesChanged) characterUpdates.aliases = updatedAliases;
  }

  // ── 3. Scenarios (title / content / description) ────────────────────────
  const scenarios = character.scenarios ?? [];
  if (scenarios.length > 0) {
    let scenariosChanged = false;
    const updatedScenarios: CharacterScenario[] = scenarios.map((scenario) => {
      const next = { ...scenario };
      const scLocation = `Scenario: ${scenario.title}`;
      const scFields: (keyof CharacterScenario)[] = ['title', 'content', 'description'];
      let touched = false;
      for (const field of scFields) {
        const { value, matches } = rewriteField(
          scenario[field] as string | null | undefined,
          allReplacements,
          `scenario.${field}`,
          scLocation,
          replacements
        );
        if (matches > 0) {
          (next as Record<string, unknown>)[field] = value;
          summary.characterFields += matches;
          touched = true;
        }
      }
      if (touched) {
        next.updatedAt = new Date().toISOString();
        scenariosChanged = true;
      }
      return next;
    });
    if (scenariosChanged) characterUpdates.scenarios = updatedScenarios;
  }

  // ── 4. System prompts (name / content) ──────────────────────────────────
  const systemPrompts = character.systemPrompts ?? [];
  if (systemPrompts.length > 0) {
    let promptsChanged = false;
    const updatedPrompts: CharacterSystemPrompt[] = systemPrompts.map((prompt) => {
      const next = { ...prompt };
      const spLocation = `System Prompt: ${prompt.name}`;
      const spFields: (keyof CharacterSystemPrompt)[] = ['name', 'content'];
      let touched = false;
      for (const field of spFields) {
        const { value, matches } = rewriteField(
          prompt[field] as string | null | undefined,
          allReplacements,
          `systemPrompt.${field}`,
          spLocation,
          replacements
        );
        if (matches > 0) {
          (next as Record<string, unknown>)[field] = value;
          summary.characterFields += matches;
          touched = true;
        }
      }
      if (touched) {
        next.updatedAt = new Date().toISOString();
        promptsChanged = true;
      }
      return next;
    });
    if (promptsChanged) characterUpdates.systemPrompts = updatedPrompts;
  }

  // ── 5. Physical description (single object + prompt variants) ───────────
  const physical = character.physicalDescription;
  if (physical) {
    const next: PhysicalDescription = { ...physical };
    const pdLocation = `Description: ${physical.name}`;
    const pdFields: (keyof PhysicalDescription)[] = [
      'name', 'usageContext', 'headAndShouldersPrompt', 'shortPrompt',
      'mediumPrompt', 'longPrompt', 'completePrompt', 'fullDescription',
    ];
    let touched = false;
    for (const field of pdFields) {
      const { value, matches } = rewriteField(
        physical[field] as string | null | undefined,
        allReplacements,
        `physicalDescription.${field}`,
        pdLocation,
        replacements
      );
      if (matches > 0) {
        (next as Record<string, unknown>)[field] = value;
        summary.physicalDescriptions += matches;
        touched = true;
      }
    }
    if (touched) {
      next.updatedAt = new Date().toISOString();
      characterUpdates.physicalDescription = next;
    }
  }

  // ── 6. Memories (content / summary / keywords) ──────────────────────────
  const memories = await repos.memories.findByCharacterId(characterId);
  const memoryUpdates: Array<{ id: string; updates: Partial<{ content: string; summary: string; keywords: string[] }> }> = [];
  for (const memory of memories) {
    const updates: Partial<{ content: string; summary: string; keywords: string[] }> = {};
    const memLocation = `Memory: ${memory.id.slice(0, 8)}...`;

    const contentRes = rewriteField(memory.content, allReplacements, 'memory.content', memLocation, replacements);
    if (contentRes.matches > 0) {
      updates.content = contentRes.value as string;
      summary.memories += contentRes.matches;
    }

    const summaryRes = rewriteField(memory.summary, allReplacements, 'memory.summary', memLocation, replacements);
    if (summaryRes.matches > 0) {
      updates.summary = summaryRes.value as string;
      summary.memories += summaryRes.matches;
    }

    if (memory.keywords && memory.keywords.length > 0) {
      let keywordsChanged = false;
      const updatedKeywords = memory.keywords.map((keyword) => {
        let current = keyword;
        for (const pair of allReplacements) {
          const { result, changed } = performReplacement(current, pair);
          if (changed && result !== null) {
            current = result;
            keywordsChanged = true;
          }
        }
        return current;
      });
      if (keywordsChanged) updates.keywords = updatedKeywords;
    }

    if (Object.keys(updates).length > 0) {
      memoryUpdates.push({ id: memory.id, updates });
    }
  }

  // ── 7. Chats (title + message bodies) ───────────────────────────────────
  const chats = await repos.chats.findByCharacterId(characterId);
  const chatUpdates: Array<{ chatId: string; titleUpdate?: string; messageUpdates: Array<{ messageId: string; content: string }> }> = [];
  for (const chat of chats) {
    const chatLocation = `Chat: ${chat.title}`;
    const titleRes = rewriteField(chat.title, allReplacements, 'chat.title', chatLocation, replacements);
    const titleUpdate = titleRes.matches > 0 ? (titleRes.value as string) : undefined;
    if (titleRes.matches > 0) summary.chatTitles += titleRes.matches;

    const messageUpdates: Array<{ messageId: string; content: string }> = [];
    const messages = await repos.chats.getMessages(chat.id);
    for (const message of messages) {
      // Only genuine user/character prose. Skip non-message events and Staff /
      // personified-feature messages (systemSender != null) — those carry
      // structured payloads and opaque rewrites that a blind replace would corrupt.
      if (message.type !== 'message' || message.systemSender) continue;

      const res = rewriteField(message.content, allReplacements, 'chat.message', chatLocation, replacements);
      if (res.matches > 0) {
        messageUpdates.push({ messageId: message.id, content: res.value as string });
        summary.chatMessages += res.matches;
      }
    }

    if (titleUpdate || messageUpdates.length > 0) {
      chatUpdates.push({ chatId: chat.id, titleUpdate, messageUpdates });
    }
  }

  summary.total =
    summary.characterFields + summary.physicalDescriptions +
    summary.memories + summary.chatTitles + summary.chatMessages;

  // ── 8. Commit (execute mode only) ───────────────────────────────────────
  if (!dryRun && summary.total > 0) {
    logger.info('[CharacterRename] Executing', {
      characterId,
      characterName: character.name,
      totalChanges: summary.total,
      characterFieldsChanged: Object.keys(characterUpdates),
      memoriesChanged: memoryUpdates.length,
      chatsChanged: chatUpdates.length,
    });

    if (Object.keys(characterUpdates).length > 0) {
      await repos.characters.update(characterId, characterUpdates);
    }

    for (const { id, updates } of memoryUpdates) {
      await repos.memories.update(id, updates);
    }

    for (const { chatId, titleUpdate, messageUpdates } of chatUpdates) {
      if (titleUpdate) {
        await repos.chats.update(chatId, { title: titleUpdate });
      }
      for (const { messageId, content } of messageUpdates) {
        await repos.chats.updateMessage(chatId, messageId, { content });
      }

      // Re-render + re-embed any chat whose message bodies changed so the
      // searchable conversation archive reflects the new text (best-effort;
      // a pending render job for the chat is reused rather than duplicated).
      if (messageUpdates.length > 0) {
        try {
          await enqueueConversationRender(userId, { chatId, fullReembed: true });
        } catch (err) {
          logger.warn('[CharacterRename] Failed to enqueue archive re-render', {
            characterId,
            chatId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    logger.info('[CharacterRename] Completed', {
      characterId,
      durationMs: Date.now() - startTime,
      summary,
    });
  }

  return {
    characterId,
    characterName: character.name,
    dryRun,
    replacements,
    summary,
  };
}
