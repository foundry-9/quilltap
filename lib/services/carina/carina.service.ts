/**
 * Carina (inline LLM queries) — core service.
 *
 * `runCarinaQuery` resolves a designated answerer character and produces a
 * minimal, ISOLATED reference answer. A Carina line opens when EITHER side is
 * `canBeCarina`: a Carina answerer can be reached by anyone, and a Carina-enabled
 * asker can reach anyone (even a non-answerer). The answer is built from:
 *   - system prompt = the answerer's identity stack (NOT the per-turn
 *     `buildSystemPrompt`, which layers in roleplay template / tool
 *     reinforcement) plus their default scenario and a surface-level identity
 *     card for whoever is asking (name/title/pronouns/aliases/identity — the
 *     public view, never the asker's private personality),
 *   - the answerer's OWN relevant memories, recalled against the question and
 *     whispered in by the Commonplace Book (recall only — still NO general
 *     chat history, NO project or core whispers, NO live conversation),
 *   - prior Carina exchanges for THIS answerer in THIS chat (for follow-up
 *     continuity),
 *   - the question as a user-role message.
 *
 * It has access to the chat's enabled tools (minus `ask_carina`, a recursion
 * guard) and runs the standard detect→execute→re-stream tool loop. If that loop
 * runs its iteration budget dry while the model is still only emitting tool calls
 * (empty prose buffer), one final "forced-text" turn is streamed with NO tools
 * offered, so the answerer must compose a reply from what it already gathered
 * rather than failing with a misleading empty response.
 *
 * v1 runs entirely server-side (no live token streaming): the answer is
 * accumulated, posted as a `systemSender: 'carina'` message, and surfaced to the
 * client by the existing post-turn `fetchChat()` refresh. The `systemSender`
 * tag keeps the answer out of the NORMAL per-turn extraction (see
 * `buildTurnTranscript`); the answerer's memories of the exchange are instead
 * formed through the dedicated `CARINA_MEMORY_EXTRACTION` job enqueued after the
 * answer posts. Failures are RETURNED (never thrown) so the caller can route
 * them through Prospero.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { buildIdentityStack, buildPublicIdentityCard } from '@/lib/chat/context/system-prompt-builder';
import { resolveStandingInstructionsSection } from '@/lib/chat/context/standing-instructions';
import { processTemplate } from '@/lib/templates/processor';
import {
  buildTools,
  streamMessage,
  type StreamOptions,
} from '@/lib/services/chat-message/streaming.service';
import {
  processToolCalls,
  detectToolCallsInResponse,
  createToolContext,
  type StreamController,
} from '@/lib/services/chat-message/tool-execution.service';
import { supportsCapability } from '@/lib/plugins/provider-registry';
import { searchMemoriesSemantic } from '@/lib/memory/memory-service';
import { findCharactersByName } from '@/lib/services/character-resolver';
import { formatMemoriesForContext } from '@/lib/chat/context/memory-injector';
import { buildMemorySubjectContext } from '@/lib/memory/memory-subject';
import { buildCommonplaceLLMContext } from '@/lib/services/commonplace-notifications/writer';
import { enqueueCarinaMemoryExtraction } from '@/lib/background-jobs/queue-service';
import { postCarinaResponse } from './writer';
import { BRAHMA_CARINA_ANSWERER_ID, isBrahmaName } from './brahma-answerer';
import type { CarinaResult } from './carina.types';
import type { Character, ChatParticipantBase, ConnectionProfile, MessageEvent } from '@/lib/schemas/types';

/** Maximum detect→execute→re-stream iterations within a single Carina answer. */
const MAX_TOOL_ITERATIONS = 5;

/** Token budget for the answerer's recalled memories injected into the call. */
const CARINA_MEMORY_TOKEN_BUDGET = 1200;
/** Upper bound on how many recalled memories to consider for the budget. */
const CARINA_MEMORY_LIMIT = 12;
/** Floor on memory importance for Carina recall (mirrors the per-turn head). */
const CARINA_MEMORY_MIN_IMPORTANCE = 0.3;

export interface RunCarinaQueryOptions {
  userId: string;
  chatId: string;
  /** Answerer name as written in the markup / tool call. */
  characterName: string;
  /** The question to answer. */
  question: string;
  /** `?` separator / `whisper: true` → answer is whispered to the asker only. */
  whisper: boolean;
  /**
   * Participant id of the asker — the user's participant for `@Name?` markup, or
   * the calling character's participant for `ask_carina`. Used as the whisper
   * target. null when no participant context is available (answer goes public).
   */
  askerParticipantId: string | null;
  /**
   * The human operator initiated this query (the user-message `@Name:` / `@Name?`
   * markup path). The operator can always reach any character, regardless of
   * whether their persona is itself a `canBeCarina` answerer — being the
   * proprietor carries the privilege. Defaults to false; only the orchestrator's
   * user-message path sets it. Character markup and `ask_carina` (both
   * character-initiated) leave it unset.
   */
  operatorInitiated?: boolean;
  /**
   * Called the instant the answer is persisted, with the posted message. Lets a
   * caller holding a live SSE stream surface the answer to the Salon immediately
   * (rather than waiting for the post-turn `fetchChat()` refresh). Optional and
   * absent in the autonomous-room/forked-child path, where there is no client
   * stream — there the existing refresh keeps surfacing answers. Must never
   * throw; the wrapper below swallows and logs any error so a posted answer is
   * never undone by a failed emit.
   */
  onPosted?: (message: MessageEvent) => void;
}

/** Resolve the answerer's default scenario content, if any. */
function resolveDefaultScenario(character: Character): string | null {
  const scenarios = character.scenarios ?? [];
  if (!scenarios.length) return null;
  if (character.defaultScenarioId) {
    const found = scenarios.find((s) => s.id === character.defaultScenarioId);
    if (found?.content) return found.content;
  }
  return scenarios[0]?.content ?? null;
}

/**
 * Replay prior Carina exchanges for this answerer in this chat as alternating
 * user(question)/assistant(answer) pairs — gives "And what about…?" follow-ups
 * continuity without pulling in the full conversation.
 */
async function loadPriorCarinaExchanges(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  answererId: string,
): Promise<StreamOptions['messages']> {
  const pairs: StreamOptions['messages'] = [];
  try {
    const all = await repos.chats.getMessages(chatId);
    for (const m of all) {
      if (m.type !== 'message') continue;
      if (m.systemSender !== 'carina') continue;
      if (m.systemKind !== 'carina-response') continue;
      const meta = m.carinaMeta;
      if (!meta || meta.answererId !== answererId) continue;
      pairs.push({ role: 'user', content: meta.question });
      pairs.push({ role: 'assistant', content: m.content });
    }
  } catch (error) {
    logger.warn('[Carina] Failed to load prior exchanges; proceeding without continuity', {
      context: 'carina',
      chatId,
      answererId,
      error: getErrorMessage(error),
    });
  }
  return pairs;
}

/**
 * Build a surface-level identity card for the asker so the answerer knows who is
 * addressing them — name, title, pronouns, aliases, and the public `identity`
 * view (never personality; see {@link buildPublicIdentityCard}). All three Carina
 * entry points hand us the asker's participant id — the user's persona for
 * `@Name?` markup, the calling character for `ask_carina` / character markup —
 * and every one resolves to a CHARACTER participant here.
 *
 * Returns null (and never throws) when the asker can't be resolved: no
 * participant context (answer was going public anyway), an unknown participant,
 * or a broken character vault. The call then proceeds without attribution, as it
 * did before this was added.
 */
async function loadAskerIdentity(
  repos: ReturnType<typeof getRepositories>,
  participants: ChatParticipantBase[],
  askerParticipantId: string | null,
  chatId: string,
): Promise<string | null> {
  if (!askerParticipantId) return null;
  const participant = participants.find((p) => p.id === askerParticipantId);
  if (!participant?.characterId) return null;
  try {
    const asker = await repos.characters.findById(participant.characterId);
    if (!asker) return null;
    // When the asker IS the user-controlled persona, `{{user}}` in their own
    // identity text means themselves; otherwise leave it to the generic default.
    const userName = participant.controlledBy === 'user' ? asker.name : null;
    const card = buildPublicIdentityCard(asker, userName);
    return card;
  } catch (error) {
    logger.warn('[Carina] Failed to resolve asker identity; answering without attribution', {
      context: 'carina',
      chatId,
      askerParticipantId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/**
 * Recall the answerer's own memories that bear on the question and render them
 * as a plain "you remember…" context block — the Commonplace Book whispering
 * into the isolated call. The semantic search runs over the answerer's whole
 * memory store, so it naturally surfaces what they know about anyone the
 * question touches, without pulling in the live conversation.
 *
 * Returns null (and never throws) when there is nothing to recall or the lookup
 * fails — a memory miss must never block a reference answer.
 */
async function loadCarinaMemoryRecall(
  characterId: string,
  question: string,
  userId: string,
  provider: ConnectionProfile['provider'],
  chatId: string,
): Promise<string | null> {
  const trimmed = question.trim();
  if (!trimmed) return null;
  try {
    const results = await searchMemoriesSemantic(characterId, trimmed, {
      userId,
      // Always the default embedding profile, as the per-turn recall does.
      embeddingProfileId: undefined,
      limit: CARINA_MEMORY_LIMIT,
      minImportance: CARINA_MEMORY_MIN_IMPORTANCE,
    });
    if (results.length === 0) return null;

    // The search runs over the answerer's whole store, so it surfaces what they
    // know about other people too — those lines must name their subject or the
    // answerer reads them as their own life (bug 122).
    const subject = await buildMemorySubjectContext(
      characterId,
      results.map(r => r.memory),
    );
    const formatted = formatMemoriesForContext(
      results,
      CARINA_MEMORY_TOKEN_BUDGET,
      provider,
      subject,
    );
    if (!formatted.content || formatted.memoriesUsed === 0) return null;

    return buildCommonplaceLLMContext({ relevant: formatted.content });
  } catch (error) {
    logger.warn('[Carina] Memory recall failed; answering without it', {
      context: 'carina',
      chatId,
      characterId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/**
 * Whether the ASKER side opens the Carina line.
 *
 * Carina opens a communication line when EITHER side is enabled: a `canBeCarina`
 * answerer can be reached by anyone, and the asker side opens the line when —
 *  - the query is `operatorInitiated` (the human operator typed it). The operator
 *    can always reach anyone, regardless of their persona's flag; OR
 *  - the asking participant is the operator's user-controlled persona; OR
 *  - the asking character is itself a `canBeCarina` answerer.
 *
 * We only consult this in the fallback case (no Carina-enabled answerer matched
 * the requested name), so the common path never pays for it.
 *
 * `canBeCarina` is a DB column, not a vault field, so we read it via the
 * overlay-free raw read (`findByIdRaw`) — a broken asker vault must not sink the
 * check. Returns false (line stays answerer-gated) when the asker is a plain LLM
 * character that isn't an answerer, or can't be resolved at all (no participant
 * context, an unknown/non-character participant, or any lookup error).
 */
async function askerOpensCarinaLine(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  askerParticipantId: string | null,
  operatorInitiated: boolean,
): Promise<boolean> {
  // The human operator can always reach anyone, even when no persona participant
  // is present to resolve (`askerParticipantId` may be null in that case).
  if (operatorInitiated) {
    return true;
  }
  if (!askerParticipantId) return false;
  try {
    const chat = await repos.chats.findById(chatId);
    const participant = (chat?.participants ?? []).find((p) => p.id === askerParticipantId);
    if (!participant?.characterId) return false;
    // A user-controlled asker is the operator's persona — always opens the line.
    if (participant.controlledBy === 'user') {
      return true;
    }
    const asker = await repos.characters.findByIdRaw(participant.characterId);
    const enabled = asker?.canBeCarina === true;
    return enabled;
  } catch (error) {
    logger.warn('[Carina] Failed to resolve asker Carina flag; treating line as answerer-gated', {
      context: 'carina',
      chatId,
      askerParticipantId,
      error: getErrorMessage(error),
    });
    return false;
  }
}

/**
 * Whether the asker may reach the Brahma Console pseudocharacter.
 *
 * Brahma runs at full operator privilege (read-only SQL, all-store document
 * access), so reachability is deliberately narrower than the ordinary Carina
 * line: the human operator (`operatorInitiated`), the operator's user-controlled
 * persona, and characters explicitly granted `systemTransparency` only. A plain
 * roleplay character cannot reach Brahma even by writing `@Brahma:` — it gets the
 * same "no answerer by that name" outcome as if Brahma did not exist, so the
 * Console stays invisible to characters not in the know.
 *
 * `systemTransparency` is a DB column (not a vault field), read via the
 * overlay-free `findByIdRaw` so a broken asker vault can't sink the check.
 * Returns false (Brahma unreachable) on any resolution failure.
 */
async function brahmaIsReachable(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  askerParticipantId: string | null,
  operatorInitiated: boolean,
): Promise<boolean> {
  if (operatorInitiated) return true;
  if (!askerParticipantId) return false;
  try {
    const chat = await repos.chats.findById(chatId);
    const participant = (chat?.participants ?? []).find((p) => p.id === askerParticipantId);
    if (!participant?.characterId) return false;
    if (participant.controlledBy === 'user') return true;
    const asker = await repos.characters.findByIdRaw(participant.characterId);
    return asker?.systemTransparency === true;
  } catch (error) {
    logger.warn('[Carina] Failed to resolve asker transparency for Brahma; treating as unreachable', {
      context: 'carina',
      chatId,
      askerParticipantId,
      error: getErrorMessage(error),
    });
    return false;
  }
}

/**
 * Answer a query as the Brahma Console pseudocharacter: run the isolated one-shot
 * console engine and post the result as an ordinary `systemSender: 'carina'`
 * message tagged with the reserved Brahma `answererId`. Brahma is memory-free, so
 * — unlike the normal answerer path — NO memory recall is injected and NO
 * `CARINA_MEMORY_EXTRACTION` job is enqueued. Failures are returned (never thrown)
 * for the caller to route through Prospero.
 */
async function answerAsBrahma(opts: RunCarinaQueryOptions): Promise<CarinaResult> {
  const { userId, chatId, question, whisper, askerParticipantId } = opts;
  const repos = getRepositories();
  try {
    // Dynamic import keeps the Brahma console's import graph off Carina's static
    // module load (mirrors the ask_carina handler's dynamic import of this file).
    const { runBrahmaQuery } = await import('@/lib/services/brahma-console/one-shot.service');
    const result = await runBrahmaQuery({ repos, userId, chatId, question });

    if (!result.ok) {
      if (result.detail === 'no-profile') {
        return { ok: false, error: { kind: 'no-profile', characterName: 'Brahma' } };
      }
      return { ok: false, error: { kind: 'llm-failed', detail: result.detail, characterName: 'Brahma' } };
    }

    const posted = await postCarinaResponse({
      chatId,
      answer: result.answer,
      answererId: BRAHMA_CARINA_ANSWERER_ID,
      question,
      participantId: null,
      whisper,
      askerParticipantId,
    });
    if (!posted) {
      return { ok: false, error: { kind: 'llm-failed', detail: 'failed to persist answer', characterName: 'Brahma' } };
    }

    // Surface live over the caller's SSE stream, exactly as the normal path. A
    // failed emit must never undo a posted answer.
    if (opts.onPosted) {
      try {
        opts.onPosted(posted);
      } catch (emitError) {
        logger.warn('[Carina] Live Brahma answer emit failed; answer stands', {
          context: 'carina',
          chatId,
          error: getErrorMessage(emitError),
        });
      }
    }

    logger.info('[Carina] Brahma Console answered', {
      context: 'carina',
      chatId,
      whisper,
      answerLength: result.answer.length,
    });

    return {
      ok: true,
      answer: result.answer,
      messageId: posted.id,
      message: posted,
      answererId: BRAHMA_CARINA_ANSWERER_ID,
      answererName: 'Brahma',
    };
  } catch (error) {
    logger.error(
      '[Carina] Brahma query failed',
      { context: 'carina', chatId, error: getErrorMessage(error) },
      error as Error,
    );
    return { ok: false, error: { kind: 'llm-failed', detail: getErrorMessage(error), characterName: 'Brahma' } };
  }
}

/**
 * Resolve the answerer's connection profile via Carina's own chain (NOT the
 * participant-scoped `resolveConnectionProfile`):
 *   1. the answerer's default profile,
 *   2. the instance default profile,
 *   3. the first profile whose provider supports native web search,
 *   4. null (→ no-profile error).
 */
async function resolveCarinaProfile(
  repos: ReturnType<typeof getRepositories>,
  userId: string,
  character: Character,
): Promise<ConnectionProfile | null> {
  if (character.defaultConnectionProfileId) {
    const byChar = await repos.connections.findById(character.defaultConnectionProfileId);
    if (byChar) return byChar;
  }
  const instanceDefault = await repos.connections.findDefault(userId);
  if (instanceDefault) return instanceDefault;
  const all = await repos.connections.findByUserId(userId);
  return all.find((p) => supportsCapability(p.provider, 'webSearch')) ?? null;
}

export async function runCarinaQuery(opts: RunCarinaQueryOptions): Promise<CarinaResult> {
  const { userId, chatId, characterName, question, whisper, askerParticipantId } = opts;
  const repos = getRepositories();

  // 1. Resolve the answerer by name (case-insensitive). Carina opens a line when
  //    EITHER side is `canBeCarina`: a Carina answerer is reachable by anyone,
  //    AND a Carina-enabled ASKER can reach anyone — even a character that is not
  //    itself an answerer. So match the name first (all matches, oldest first),
  //    then decide reachability from both sides. The name match is the shared
  //    resolver; Carina layers its reachability gate on top.
  const nameMatches = await findCharactersByName(userId, characterName);

  // Prefer a Carina-enabled answerer (reachable by anyone). Only when none of the
  // name matches is itself an answerer do we consult the asker side: the human
  // operator always opens the line, as does a `canBeCarina` character asker. An
  // open line reaches the oldest plain name match.
  let answerer = nameMatches.find((c) => c.canBeCarina === true) ?? null;
  if (!answerer && nameMatches.length > 0) {
    const askerOpens = await askerOpensCarinaLine(
      repos,
      chatId,
      askerParticipantId,
      opts.operatorInitiated === true,
    );
    if (askerOpens) {
      answerer = nameMatches[0];
    }
  }

  // The Brahma Console pseudocharacter. Only when NO real character carries the
  // name "Brahma" (a real character always wins, so user data is never shadowed)
  // do we treat the name as the Console. Reachability is gated to the operator,
  // user-controlled personas, and `systemTransparency` characters — an
  // unauthorized asker falls through to the same not-found outcome below, so
  // Brahma never reveals itself.
  if (nameMatches.length === 0 && isBrahmaName(characterName)) {
    const reachable = await brahmaIsReachable(
      repos,
      chatId,
      askerParticipantId,
      opts.operatorInitiated === true,
    );
    if (reachable) {
      return answerAsBrahma(opts);
    }
    logger.info('[Carina] Brahma requested by an unauthorized asker; treating as not-found', {
      context: 'carina',
      chatId,
    });
  }

  if (!answerer) {
    logger.info('[Carina] No reachable answerer found', { context: 'carina', chatId, characterName });
    return { ok: false, error: { kind: 'not-found', characterName } };
  }

  try {
    // 2. Resolve connection profile (custom chain) + API key.
    const connectionProfile = await resolveCarinaProfile(repos, userId, answerer);
    if (!connectionProfile) {
      logger.info('[Carina] No connection profile resolvable', {
        context: 'carina',
        chatId,
        answererId: answerer.id,
      });
      return { ok: false, error: { kind: 'no-profile', characterName: answerer.name } };
    }

    let apiKey = '';
    if (connectionProfile.apiKeyId) {
      const apiKeyData = await repos.connections.findApiKeyById(connectionProfile.apiKeyId);
      if (apiKeyData) apiKey = apiKeyData.key_value;
    }

    // 3. Load the chat for its tool slate + image profile.
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return { ok: false, error: { kind: 'llm-failed', detail: 'chat not found', characterName: answerer.name } };
    }

    // 4. Build the minimal, isolated context.
    const scenarioText = resolveDefaultScenario(answerer);
    let systemPrompt = buildIdentityStack({
      character: answerer,
      userCharacter: null,
      selectedSystemPromptId: answerer.defaultSystemPromptId ?? null,
      scenarioText,
    });
    if (scenarioText) {
      systemPrompt += `\n\n## Scenario\n${scenarioText}`;
    }
    // Standing instructions — the chat's project `instructions` plus the
    // `instructions` of every group the answerer belongs to. Mirrors the
    // Salon insertion (identity → world → who's asking → what you remember);
    // template-processed like the Salon path so `{{char}}` resolves to the
    // answerer. The resolver fails soft internally (never throws): a broken
    // store never loses the query.
    const standingInstructions = await resolveStandingInstructionsSection({
      projectId: chat.projectId ?? null,
      characterId: answerer.id,
    });
    if (standingInstructions) {
      systemPrompt += `\n\n${processTemplate(standingInstructions, { char: answerer.name, user: 'User' })}`;
    }
    // Tell the answerer who is consulting them — the surface-level view any
    // character would have of someone addressing them (name/title/pronouns/
    // aliases/identity), never their private personality. Falls back to the
    // anonymous framing when the asker can't be resolved.
    const askerCard = await loadAskerIdentity(repos, chat.participants ?? [], askerParticipantId, chatId);
    if (askerCard) {
      systemPrompt +=
        '\n\n## Reference Query\nYou are being consulted for a quick, standalone question by the ' +
        'individual described below. Use this to know who is addressing you, then answer them ' +
        'directly and concisely from your own knowledge and the tools available to you. You do not ' +
        'have the surrounding conversation in view.' +
        `\n\n### Who Is Asking\n${askerCard}`;
    } else {
      systemPrompt +=
        '\n\n## Reference Query\nYou are being consulted for a quick, standalone question. ' +
        'Answer it directly and concisely from your own knowledge and the tools available to you. ' +
        'You do not have the surrounding conversation in view.';
    }

    // The Commonplace Book whispers the answerer's own relevant memories into
    // the call (recall only — still no live conversation context).
    const memoryRecall = await loadCarinaMemoryRecall(
      answerer.id,
      question,
      userId,
      connectionProfile.provider,
      chatId,
    );
    if (memoryRecall) {
      systemPrompt += `\n\n${memoryRecall}`;
    }

    const priorExchanges = await loadPriorCarinaExchanges(repos, chatId, answerer.id);
    let currentMessages: StreamOptions['messages'] = [
      { role: 'system', content: systemPrompt },
      ...priorExchanges,
      { role: 'user', content: question },
    ];

    // 5. Build the chat's tool slate, minus `ask_carina` (recursion guard).
    const imageProfileId = chat.imageProfileId ?? null;
    let imageProfile = null;
    if (imageProfileId) {
      try {
        imageProfile = await repos.imageProfiles.findById(imageProfileId);
      } catch {
        imageProfile = null;
      }
    }
    const charParticipants = (chat.participants ?? []).filter((p) => p.type === 'CHARACTER');
    const isMultiCharacter = charParticipants.length > 1;
    let documentEditingEnabled = false;
    if (chat.projectId) {
      try {
        const mountLinks = await repos.projectDocMountLinks.findByProjectId(chat.projectId);
        documentEditingEnabled = mountLinks.length > 0;
      } catch {
        /* leave disabled on lookup failure */
      }
    }

    const built = await buildTools(
      connectionProfile,
      imageProfileId,
      imageProfile,
      userId,
      chat.projectId ?? undefined,
      false, // requestFullContext
      chat.disabledTools ?? [],
      chat.disabledToolGroups ?? [],
      false, // agentModeEnabled
      isMultiCharacter,
      answerer.defaultHelpToolsEnabled === true, // helpToolsEnabled
      false, // canDressThemselves — Carina does not dress the answerer
      false, // canCreateOutfits
      documentEditingEnabled,
    );
    const tools = built.tools.filter((t) => {
      const name =
        (t as { function?: { name?: string }; name?: string }).function?.name ??
        (t as { name?: string }).name;
      return name !== 'ask_carina';
    });
    const useNativeWebSearch = built.useNativeWebSearch;
    const modelParams = (connectionProfile.parameters ?? {}) as Record<string, unknown>;

    // 6. Run the LLM call + tool loop server-side (no live client streaming).
    const sink: StreamController = { enqueue: () => {} };
    const encoder = new TextEncoder();
    const answererParticipantId = charParticipants.find((p) => p.characterId === answerer.id)?.id ?? null;
    const toolContext = createToolContext(
      chatId,
      userId,
      answerer.id,
      answererParticipantId ?? '',
      imageProfileId,
      undefined,
      chat.projectId ?? null,
    );

    // Accumulate one streamed LLM call into { answer, rawResponse }. The base
    // call shape is fixed for this query; only the offered tool slate and the
    // native web-search flag vary across the initial call, each tool-loop turn,
    // and the forced-text final turn.
    const runStream = async (
      streamMessages: typeof currentMessages,
      streamTools: typeof tools,
      streamUseNativeWebSearch: boolean,
    ): Promise<{ answer: string; rawResponse: unknown }> => {
      let streamAnswer = '';
      let streamRaw: unknown = null;
      for await (const chunk of streamMessage({
        messages: streamMessages,
        connectionProfile,
        apiKey,
        modelParams,
        tools: streamTools,
        useNativeWebSearch: streamUseNativeWebSearch,
        userId,
        chatId,
        characterId: answerer.id,
      })) {
        if (chunk.content) streamAnswer += chunk.content;
        if (chunk.done) streamRaw = chunk.rawResponse;
      }
      return { answer: streamAnswer, rawResponse: streamRaw };
    };

    let { answer, rawResponse } = await runStream(currentMessages, tools, useNativeWebSearch);

    let iterations = 0;
    while (rawResponse && iterations < MAX_TOOL_ITERATIONS) {
      const toolCalls = detectToolCallsInResponse(rawResponse, connectionProfile.provider);
      if (toolCalls.length === 0) break;
      iterations++;

      const results = await processToolCalls(toolCalls, toolContext, sink, encoder, {
        characterName: answerer.name,
        characterId: answerer.id,
      });

      const hasCallIds = toolCalls.some((tc) => tc.callId);
      const assistantToolCalls = hasCallIds
        ? toolCalls
            .filter((tc) => tc.callId)
            .map((tc) => ({
              id: tc.callId!,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            }))
        : undefined;

      currentMessages = [
        ...currentMessages,
        {
          role: 'assistant',
          content: answer && answer.trim().length ? answer : '',
          toolCalls: assistantToolCalls,
        },
      ];
      for (const tm of results.toolMessages) {
        if (tm.callId) {
          currentMessages.push({ role: 'tool', content: tm.content, toolCallId: tm.callId, name: tm.toolName });
        } else {
          currentMessages.push({ role: 'user', content: `[Tool Result: ${tm.toolName}]\n${tm.content}` });
        }
      }

      ({ answer, rawResponse } = await runStream(currentMessages, tools, useNativeWebSearch));
    }

    // Forced-text final turn. If we ran the tool budget dry while the model was
    // STILL trying to call tools — answer buffer empty, last response carrying
    // unprocessed tool calls — it never composed a prose reply, and reporting
    // that as an "empty response" is misleading (it gathered plenty, it just
    // never stopped). Give it one last stream with NO tools offered (an empty
    // slate resolves to `undefined` downstream, so the model is handed no tools
    // and must answer in text) from the context it has already assembled. A
    // genuinely empty/no-tool response skips this and falls through to the
    // empty-response error below, as before.
    if (!answer.trim() && rawResponse) {
      const pendingToolCalls = detectToolCallsInResponse(rawResponse, connectionProfile.provider);
      if (pendingToolCalls.length > 0) {
        logger.debug('[Carina] Tool-iteration budget exhausted; forcing a final text answer', {
          context: 'carina',
          chatId,
          answererId: answerer.id,
          iterations,
        });
        ({ answer, rawResponse } = await runStream(currentMessages, [], false));
      }
    }

    const finalAnswer = answer.trim();
    if (!finalAnswer) {
      return { ok: false, error: { kind: 'llm-failed', detail: 'empty response', characterName: answerer.name } };
    }

    // 7. Post the answer. The systemSender:'carina' tag keeps it out of the
    // NORMAL per-turn extraction; the answerer's own memories are formed
    // instead via the dedicated CARINA_MEMORY_EXTRACTION job below.
    const posted = await postCarinaResponse({
      chatId,
      answer: finalAnswer,
      answererId: answerer.id,
      question,
      participantId: answererParticipantId,
      whisper,
      askerParticipantId,
    });
    if (!posted) {
      return {
        ok: false,
        error: { kind: 'llm-failed', detail: 'failed to persist answer', characterName: answerer.name },
      };
    }

    // 7a. Surface the answer to the operator immediately. A caller holding a live
    // SSE stream (the orchestrator / finalizer / ask_carina tool path) emits a
    // `carinaAnswer` event so the Salon renders the reference card the instant it
    // returns, instead of waiting for the post-turn fetchChat(). A failed emit
    // must never undo a posted answer.
    if (opts.onPosted) {
      try {
        opts.onPosted(posted);
      } catch (emitError) {
        logger.warn('[Carina] Live answer emit failed; answer stands', {
          context: 'carina',
          chatId,
          answererId: answerer.id,
          error: getErrorMessage(emitError),
        });
      }
    }

    // 8. Form the answerer's SELF memories from this exchange, off the hot
    // path. Whispered and public answers alike are remembered — the exchange
    // happened to the answerer regardless of who could see it. A failure to
    // enqueue must never undo a posted answer.
    try {
      await enqueueCarinaMemoryExtraction(userId, {
        chatId,
        carinaMessageId: posted.id,
        answererId: answerer.id,
        connectionProfileId: connectionProfile.id,
      });
    } catch (error) {
      logger.warn('[Carina] Failed to enqueue memory extraction; answer stands', {
        context: 'carina',
        chatId,
        answererId: answerer.id,
        error: getErrorMessage(error),
      });
    }

    logger.info('[Carina] Query answered', {
      context: 'carina',
      chatId,
      answererId: answerer.id,
      whisper,
      toolIterations: iterations,
      answerLength: finalAnswer.length,
    });

    return {
      ok: true,
      answer: finalAnswer,
      messageId: posted.id,
      message: posted,
      answererId: answerer.id,
      answererName: answerer.name,
    };
  } catch (error) {
    logger.error(
      '[Carina] Query failed',
      { context: 'carina', chatId, characterName, error: getErrorMessage(error) },
      error as Error,
    );
    return { ok: false, error: { kind: 'llm-failed', detail: getErrorMessage(error), characterName: answerer.name } };
  }
}
