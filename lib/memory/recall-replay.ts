/**
 * Recall replay harness (episodic recall overhaul, §3 — built as step 0 of
 * the retrieval workstream so the new multipliers/boosts can be tuned against
 * real chats instead of blind).
 *
 * Given a chat (and optionally a turn index), reconstruct the per-turn recall
 * distillation (retrospective / timeRange / entities / paraphrase) and run the
 * memory search TWICE — once with the episodic signals inert (the pre-overhaul
 * path) and once with them live — returning the full candidate table for each:
 * cosine, rawWeight, blendedBefore, every multiplier that fired,
 * blendedAfter, and whether the entry made the head. Nothing is persisted;
 * the recall-history ring buffer is read but never written.
 *
 * Consumed by POST /api/v1/chats/[id]?action=recall-replay, which the
 * `quilltap recall-replay` CLI wraps.
 *
 * @module memory/recall-replay
 */

import { getRepositories } from '@/lib/repositories/factory'
import { extractMemorySearchKeywords, stripToolArtifacts, type MemorySearchExtraction } from './cheap-llm-tasks'
import { searchMemoriesSemantic, type SemanticSearchResult } from './memory-service'
import { recentlyWhisperedIdSet } from './recall-history'
import { getMemoryRecallSettings } from '@/lib/instance-settings'
import { partitionMessagesIntoTurns } from '@/lib/chat/context-summary'
import { DYNAMIC_HEAD_DEFAULT_SIZE, RETRO_HEAD_SIZE } from '@/lib/chat/context/memory-injector'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { RecallContext } from './recall-tags'
import type { MessageEvent } from '@/lib/schemas/types'
import { createServiceLogger } from '@/lib/logging/create-logger'

const logger = createServiceLogger('RecallReplay')

/** One candidate row of the replay table. */
export interface RecallReplayRow {
  memoryId: string
  summary: string
  kind: string
  occurredAt: string | null
  narrativeTime: string | null
  createdAt: string
  keywords: string[]
  cosine: number
  rawWeight: number | null
  blendedBefore: number | null
  multiplier: number | null
  fired: string[]
  blendedAfter: number | null
  /** True when the row would make the dynamic head at this path's head size. */
  selected: boolean
}

export interface RecallReplayResult {
  chatId: string
  characterId: string
  characterName: string
  turnIndex: number
  totalTurns: number
  /** The distilled turn signals driving the new path. */
  signals: MemorySearchExtraction | null
  /** The query both paths embedded. */
  query: string
  /** Clock the distillation resolved against (the replayed turn's timestamp). */
  clockIso: string
  /** Pre-overhaul path: episodic signals inert. */
  oldPath: RecallReplayRow[]
  /** Overhaul path: retrospective flip, window, entity anchors, multi-probe. */
  newPath: RecallReplayRow[]
}

export interface RunRecallReplayInput {
  chatId: string
  userId: string
  cheapLLM: CheapLLMSelection
  /** 1-based interchange index to replay AT (context = messages through that turn). Defaults to the last turn. */
  turnIndex?: number
  /** Character whose memories are searched. Defaults to the first present LLM character. */
  characterId?: string
  /** Candidate table size per path. */
  limit?: number
}

function toRows(results: SemanticSearchResult[], headSize: number): RecallReplayRow[] {
  return results.map((r, index) => ({
    memoryId: r.memory.id,
    summary: r.memory.summary,
    kind: r.memory.kind ?? 'semantic',
    occurredAt: r.memory.occurredAt ?? null,
    narrativeTime: r.memory.narrativeTime ?? null,
    createdAt: r.memory.createdAt,
    keywords: r.memory.keywords ?? [],
    cosine: r.score,
    rawWeight: r.rawWeight ?? null,
    blendedBefore: r.recallAdjustment?.blendedBefore ?? null,
    multiplier: r.recallAdjustment?.multiplier ?? null,
    fired: r.recallAdjustment?.fired ?? [],
    blendedAfter: r.recallAdjustment?.blendedAfter ?? null,
    selected: index < headSize,
  }))
}

/**
 * Run the replay. Read-only against the chat and memory corpus (the one side
 * effect is `lastAccessedAt` bumps from the search path, which are harmless).
 */
export async function runRecallReplay(input: RunRecallReplayInput): Promise<RecallReplayResult> {
  const repos = getRepositories()
  const limit = input.limit ?? 25

  const chat = await repos.chats.findById(input.chatId)
  if (!chat) {
    throw new Error('Chat not found')
  }

  // Resolve the responding character.
  const participant = input.characterId
    ? chat.participants.find(p => p.characterId === input.characterId)
    : chat.participants.find(p => p.controlledBy !== 'user' && p.status !== 'removed' && p.characterId)
  if (!participant) {
    throw new Error('No LLM-controlled character participant found on this chat')
  }
  const character = await repos.characters.findByIdRaw(participant.characterId)
  if (!character) {
    throw new Error('Character record not found')
  }

  // Slice history through the requested turn.
  const allMessages = await repos.chats.getMessages(input.chatId)
  const turns = partitionMessagesIntoTurns(allMessages, chat.chatType)
  if (turns.length === 0) {
    throw new Error('Chat has no turns to replay')
  }
  const turnIndex = Math.min(Math.max(input.turnIndex ?? turns.length, 1), turns.length)
  const lastTurnMessageId = turns[turnIndex - 1].ids[turns[turnIndex - 1].ids.length - 1]
  const cutoff = allMessages.findIndex(m => m.id === lastTurnMessageId)
  const window = (cutoff >= 0 ? allMessages.slice(0, cutoff + 1) : allMessages)
    .filter((m): m is MessageEvent => m.type === 'message')
    .filter(m => !m.systemSender && (m.role === 'USER' || m.role === 'ASSISTANT'))

  // Historical clock: the replayed turn resolves "last week" against ITS OWN
  // date, not today's — that is the whole point of replaying old turns.
  const clockIso =
    [...window].reverse().find(m => m.createdAt)?.createdAt ?? new Date().toISOString()

  // Distill the turn signals (same call, same inputs the live path uses).
  const recentForDistill = window.slice(-12).map(m => ({
    role: m.role.toLowerCase() as 'user' | 'assistant',
    content: (m.role === 'ASSISTANT' ? stripToolArtifacts(m.content || '') : m.content) || '',
  })).filter(m => m.content.length > 0)

  const distill = await extractMemorySearchKeywords(
    recentForDistill,
    character.name,
    input.cheapLLM,
    input.userId,
    input.chatId,
    character.id,
    { nowIso: clockIso, timelineMode: chat.timelineMode ?? 'realtime' },
  )
  const signals = distill.success ? distill.result ?? null : null

  const query =
    signals?.paraphrase ||
    (signals?.keywords?.length ? signals.keywords.join(' ') : '') ||
    window[window.length - 1]?.content ||
    ''
  if (!query.trim()) {
    throw new Error('Could not derive a recall query for this turn')
  }

  const recallSettings = await getMemoryRecallSettings()
  const presentAboutCharacterIds = chat.participants
    .filter(p => p.status !== 'removed' && p.characterId)
    .map(p => p.characterId)

  const baseCtx: RecallContext = {
    currentProjectId: chat.projectId ?? null,
    scopePolicy: recallSettings.scopePolicy,
    turnContext: signals?.context ?? null,
    turnTemporal: signals?.temporal ?? null,
    presentAboutCharacterIds,
    expandRelated: recallSettings.expandRelated,
    recentlyWhisperedIds: recentlyWhisperedIdSet(chat.commonplaceRecallHistory),
    // Fresh-event boost against the REPLAYED TURN's clock, not wall-clock now —
    // replaying an old turn must reproduce what recall would have done then.
    currentChatId: input.chatId,
    nowMs: Date.parse(clockIso),
  }

  // OLD path — episodic signals inert (byte-identical to pre-overhaul recall).
  const oldResults = await searchMemoriesSemantic(character.id, query, {
    userId: input.userId,
    limit,
    minImportance: 0.3,
    recallContext: baseCtx,
  })

  // NEW path — retrospective flip + window + entity anchors + multi-probe.
  const retrospective = signals?.retrospective === true
  const extraProbes: string[] = []
  if (retrospective && signals) {
    const entityProbe = (signals.entities ?? []).join(' ').trim()
    if (entityProbe) extraProbes.push(entityProbe)
    if (signals.paraphrase && signals.timeRange) {
      extraProbes.push(
        `${signals.paraphrase} (around ${signals.timeRange.from.slice(0, 10)} to ${signals.timeRange.to.slice(0, 10)})`,
      )
    }
  }
  const newResults = await searchMemoriesSemantic(character.id, query, {
    userId: input.userId,
    limit,
    minImportance: 0.3,
    recallContext: { ...baseCtx, turnRetrospective: retrospective },
    entityAnchors: signals?.entities,
    // Ungated from the retrospective flag, exactly as the two live consumers
    // are — the replay is only useful while it mirrors production.
    occurredWithin: signals?.timeRange ?? null,
    extraProbes: extraProbes.length > 0 ? extraProbes : undefined,
  })

  logger.info('Recall replay complete', {
    chatId: input.chatId,
    characterId: character.id,
    turnIndex,
    retrospective,
    oldCandidates: oldResults.length,
    newCandidates: newResults.length,
  })

  return {
    chatId: input.chatId,
    characterId: character.id,
    characterName: character.name,
    turnIndex,
    totalTurns: turns.length,
    signals,
    query,
    clockIso,
    oldPath: toRows(oldResults, DYNAMIC_HEAD_DEFAULT_SIZE),
    newPath: toRows(newResults, retrospective ? RETRO_HEAD_SIZE : DYNAMIC_HEAD_DEFAULT_SIZE),
  }
}
