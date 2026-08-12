/**
 * Memory Processor — Per-Turn Extraction
 *
 * Runs once per chat turn (not once per assistant message). The orchestrator
 * defers extraction until the turn closes, builds a TurnTranscript covering
 * the user opener plus every character contribution, and feeds the whole
 * transcript through two extraction passes:
 *
 *   1. SELF — one call per allowed character, with that character's identity
 *      preloaded into the prompt as an ALREADY ESTABLISHED canon block so the
 *      extractor can skip facts already on file.
 *   2. OTHER — one call per (observer, subject) pair where subject ranges over
 *      every other allowed character plus the user-controlled character (if
 *      any). The subject canon block is loaded from the observer's vault at
 *      `Others/<subject>.md`, falling back to the subject's identity property.
 *
 * The user is no longer special-cased — they are a participant with
 * `controlledBy: 'user'` and a real character record, so they route through
 * the OTHER pass like any other subject.
 *
 * Rate-limiting is per-character-per-turn (existing per-hour cap continues
 * to apply). The chat flow never blocks on memory extraction.
 */

import { getRepositories } from '@/lib/repositories/factory'
import {
  extractSelfMemoriesFromTurn,
  extractOtherMemoriesFromTurn,
  loadCanonForSelf,
  loadCanonForObserverAboutSubject,
  renderSelfCanonBlock,
  renderOtherCanonBlock,
  MemoryCandidate,
  UncensoredFallbackOptions,
  type OrientingContext,
  type ExtractionClock,
} from './cheap-llm-tasks'
import type { OtherSubjectInput } from './cheap-llm-tasks'
import { getCheapLLMProvider, CheapLLMConfig, CheapLLMSelection, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { resolveMaxTokens } from '@/lib/llm/model-context-data'
import { ConnectionProfile, CheapLLMSettings, Character } from '@/lib/schemas/types'
import type { Pronouns } from '@/lib/schemas/character.types'
import type { DangerousContentSettings, MemoryExtractionLimits } from '@/lib/schemas/settings.types'
import type { TurnTranscript, TurnCharacterSlice } from '@/lib/services/chat-message/turn-transcript'
import { createMemoryWithGate } from './memory-service'
import { resolveWhenPhrase } from './episodic'
import type { MemoryGateOutcome } from './memory-gate'
import { logger } from '@/lib/logger'

type RateLimitDecision =
  | { mode: 'allow' }
  | { mode: 'throttle'; floor: number; recentCount: number; cap: number }
  | { mode: 'skip'; recentCount: number; cap: number }

async function resolveExtractionRateLimit(
  characterId: string,
  limits: MemoryExtractionLimits | undefined
): Promise<RateLimitDecision> {
  if (!limits?.enabled) {
    return { mode: 'allow' }
  }

  try {
    const repos = getRepositories()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const recentCount = await repos.memories.countCreatedSince(characterId, oneHourAgo)

    if (recentCount >= limits.maxPerHour) {
      return { mode: 'skip', recentCount, cap: limits.maxPerHour }
    }

    const softStart = Math.floor(limits.maxPerHour * limits.softStartFraction)
    if (recentCount >= softStart) {
      return {
        mode: 'throttle',
        floor: limits.softFloor,
        recentCount,
        cap: limits.maxPerHour,
      }
    }
  } catch (error) {
    logger.warn('[Memory] Rate-limit lookup failed; allowing extraction', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return { mode: 'allow' }
}

function applyImportanceFloor(candidates: MemoryCandidate[], floor: number): MemoryCandidate[] {
  return candidates.filter(c => (c.importance ?? 0.5) >= floor)
}

/**
 * Per-turn memory extraction context. The transcript carries everything the
 * extraction passes need; the rest is environment (cheap LLM selection,
 * danger settings, rate limits).
 */
export interface TurnMemoryExtractionContext {
  transcript: TurnTranscript
  /**
   * Hydrated character records keyed by characterId, covering every CHARACTER
   * participant in the chat (including the user-controlled one when present).
   * Used by the canon loader to read `identity` and `characterDocumentMountPointId`
   * without making fresh DB calls per extraction pass.
   */
  participantCharacters: Map<string, Character>
  chatId: string
  /**
   * Project the chat belongs to, when any. Stamped onto every derived memory's
   * `projectId` so scope (`scope: narrow`) comparisons at recall time have a
   * rename-proof, collision-proof key to compare against. Null for chats with
   * no project.
   */
  projectId?: string | null
  /**
   * Non-canonical orienting context fed into the extraction footer (never the
   * cached body prefix). `projectDescription` lets the model judge a memory's
   * scope; `chatContextSummary` (the rolling Librarian summary) frames its
   * temporal hinge. Both are background only — never a source of memories.
   */
  projectDescription?: string | null
  chatContextSummary?: string | null
  userId: string
  connectionProfile: ConnectionProfile
  cheapLLMSettings: CheapLLMSettings
  availableProfiles?: ConnectionProfile[]
  dangerSettings?: DangerousContentSettings
  isDangerousChat?: boolean
  memoryExtractionLimits?: MemoryExtractionLimits
  /** Override the source-message timestamp on derived memories — used by batch re-extraction to backfill historical timing. */
  sourceMessageTimestamp?: string
  /**
   * Which clock the chat's story runs on (chat.timelineMode; defaults to
   * 'realtime'). Feeds the extraction CLOCK block and decides whether an
   * unresolved / in-story `when` phrase is preserved as `narrativeTime`.
   */
  timelineMode?: 'realtime' | 'narrative' | null
  /** When true, run all extraction passes but skip persistence — candidates are returned on the result instead. */
  dryRun?: boolean
  /**
   * Autonomous-room provenance (4.6 Private Character Rooms). When true,
   * the extraction prompts prepend a user-absence clause, and resulting
   * memory records are written with witnessedContext = 'autonomous_room'.
   * Chats with chatType = 'autonomous' set this; ordinary chats leave it
   * false and the extractor falls back to 'user_present' attribution.
   */
  inAutonomousRoom?: boolean
}

/**
 * Candidate memory captured during a dry-run extraction. Mirrors the input to
 * `createMemoryWithGate` plus the metadata a caller needs to attribute it
 * (which character, observing whom, from which pass, sourced from which message).
 */
export interface ExtractedCandidate {
  pass: 'SELF' | 'OTHER'
  characterId: string
  characterName: string
  aboutCharacterId: string
  aboutCharacterName: string
  sourceMessageId: string | null
  content: string
  summary: string
  keywords: string[]
  importance: number
  /** Episodic spine (dry-run visibility): declared kind + raw/resolved anchors. */
  kind: 'semantic' | 'episodic'
  when: string | null
  occurredAt: string | null
  narrativeTime: string | null
  entities: string[]
}

export interface TurnMemoryProcessingResult {
  success: boolean
  /** Total number of new memories written across all passes. */
  memoriesCreatedCount: number
  /** Total number of existing memories that were reinforced. */
  memoriesReinforcedCount: number
  /** All created memory IDs across all passes (for downstream logging). */
  createdMemoryIds: string[]
  /** All reinforced memory IDs. */
  reinforcedMemoryIds: string[]
  /** Aggregate token usage across every cheap-LLM call this run made. */
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  /** Source message ID to attach debug logs to (latest assistant message of the turn, or null when the turn produced none). */
  sourceMessageId: string | null
  /** Combined debug log lines, one per outcome, in extraction order. */
  debugLogs: string[]
  /** Populated only when the context was run with `dryRun: true`. */
  extractedCandidates?: ExtractedCandidate[]
  error?: string
}

function toCheapLLMConfig(settings: CheapLLMSettings): CheapLLMConfig {
  return {
    strategy: settings.strategy,
    userDefinedProfileId: settings.userDefinedProfileId || undefined,
    fallbackToLocal: settings.fallbackToLocal,
  }
}

interface WriteOptions {
  characterId: string
  characterName: string
  aboutCharacterId: string
  aboutCharacterName: string
  pass: 'SELF' | 'OTHER'
  candidate: MemoryCandidate
  passLabel: string
  ctx: TurnMemoryExtractionContext
  sourceMessageId: string | null
  /** `createdAt` of the source message — the wall-clock anchor for `occurredAt`. */
  sourceMessageCreatedAt: string | null
  debugLogs: string[]
  createdIds: string[]
  reinforcedIds: string[]
  collected: ExtractedCandidate[]
}

/**
 * Resolve a candidate's episodic anchors against the source turn's clock.
 *
 * Stamping rules (episodic spine):
 *  - Every memory gets `occurredAt` = the source message timestamp by default
 *    (authoritative from the transcript — never asked of the model).
 *  - A retold EVENT with a `when` phrase resolves that phrase server-side
 *    against the same anchor; a successful resolution overrides the default.
 *  - On fictional timelines the raw phrase is preserved as `narrativeTime`
 *    (whether or not it also resolved to a wall-clock date).
 */
function resolveCandidateAnchors(
  candidate: MemoryCandidate,
  anchorIso: string | null,
  timelineMode: 'realtime' | 'narrative',
): { occurredAt: string | null; narrativeTime: string | null } {
  const fallback = anchorIso ?? null
  let occurredAt = fallback
  if (candidate.when && fallback) {
    const resolved = resolveWhenPhrase(candidate.when, fallback)
    if (resolved) occurredAt = resolved
  }
  const narrativeTime =
    timelineMode === 'narrative' && candidate.when ? candidate.when : null
  return { occurredAt, narrativeTime }
}

async function writeCandidate(opts: WriteOptions): Promise<void> {
  const timelineMode = opts.ctx.timelineMode ?? 'realtime'
  const anchorIso =
    opts.sourceMessageCreatedAt ??
    opts.ctx.sourceMessageTimestamp ??
    opts.ctx.transcript.turnTimestamp ??
    new Date().toISOString()
  const { occurredAt, narrativeTime } = resolveCandidateAnchors(
    opts.candidate,
    anchorIso,
    timelineMode,
  )

  if (opts.ctx.dryRun) {
    opts.collected.push({
      pass: opts.pass,
      characterId: opts.characterId,
      characterName: opts.characterName,
      aboutCharacterId: opts.aboutCharacterId,
      aboutCharacterName: opts.aboutCharacterName,
      sourceMessageId: opts.sourceMessageId,
      content: opts.candidate.content || '',
      summary: opts.candidate.summary || '',
      keywords: opts.candidate.keywords || [],
      importance: opts.candidate.importance ?? 0.5,
      kind: opts.candidate.kind === 'episodic' ? 'episodic' : 'semantic',
      when: opts.candidate.when ?? null,
      occurredAt,
      narrativeTime,
      entities: opts.candidate.entities ?? [],
    })
    opts.debugLogs.push(
      `[Memory] DRY-RUN ${opts.passLabel} — would write: ${opts.candidate.summary}`
    )
    return
  }

  const outcome: MemoryGateOutcome = await createMemoryWithGate(
    {
      characterId: opts.characterId,
      aboutCharacterId: opts.aboutCharacterId,
      chatId: opts.ctx.chatId,
      projectId: opts.ctx.projectId ?? null,
      content: opts.candidate.content || '',
      summary: opts.candidate.summary || '',
      keywords: opts.candidate.keywords || [],
      importance: opts.candidate.importance || 0.5,
      source: 'AUTO',
      sourceMessageId: opts.sourceMessageId ?? undefined,
      sourceMessageTimestamp: opts.ctx.sourceMessageTimestamp,
      tags: [],
      // 4.6 Private Character Rooms: provenance for auto-extracted memories.
      // Autonomous rooms get explicit attribution; ordinary chats get
      // 'user_present' (the extractor only runs in chats with content, and
      // a user opener is implicit on non-autonomous chats).
      witnessedContext: opts.ctx.inAutonomousRoom ? 'autonomous_room' : 'user_present',
      // Episodic spine: event time + anchors, resolved above.
      occurredAt,
      narrativeTime,
      entities: opts.candidate.entities ?? [],
      kind: opts.candidate.kind === 'episodic' ? 'episodic' : 'semantic',
    },
    { userId: opts.ctx.userId }
  )

  switch (outcome.action) {
    case 'SKIP_NEAR_DUPLICATE': {
      opts.debugLogs.push(
        `[Memory] SKIPPED near-duplicate ${opts.passLabel}: absorbed into ${outcome.memory?.id ?? 'unknown'} ` +
        `(similarity ${outcome.similarity?.toFixed(3) ?? 'n/a'}) — ${opts.candidate.summary}`
      )
      break
    }
    case 'SKIP_EMBEDDING_FAILED': {
      opts.debugLogs.push(
        `[Memory] SKIPPED ${opts.passLabel} — embedding generation failed: ${outcome.reason ?? 'unknown'}`
      )
      break
    }
    case 'REINFORCE': {
      if (outcome.memory) opts.reinforcedIds.push(outcome.memory.id)
      opts.debugLogs.push(
        `[Memory] REINFORCED ${opts.passLabel}: ${outcome.memory?.id ?? 'unknown'} ` +
        `(count ${outcome.memory?.reinforcementCount ?? 1}) — ${opts.candidate.summary}`
      )
      break
    }
    case 'INSERT_RELATED': {
      if (outcome.memory) opts.createdIds.push(outcome.memory.id)
      opts.debugLogs.push(
        `[Memory] Created ${opts.passLabel} (linked to ${outcome.relatedMemoryIds?.length || 0} related) — ` +
        `${opts.candidate.summary}`
      )
      break
    }
    case 'INSERT':
    case 'SKIP_GATE':
    default: {
      if (outcome.memory) opts.createdIds.push(outcome.memory.id)
      opts.debugLogs.push(
        `[Memory] Created ${opts.passLabel} — ${opts.candidate.summary}`
      )
      break
    }
  }
}

/**
 * Run all extraction passes for a single turn.
 */
export async function processTurnForMemory(
  ctx: TurnMemoryExtractionContext
): Promise<TurnMemoryProcessingResult> {
  const debugLogs: string[] = []
  const createdMemoryIds: string[] = []
  const reinforcedMemoryIds: string[] = []
  const collectedCandidates: ExtractedCandidate[] = []
  const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  const sourceMessageId = ctx.transcript.latestAssistantMessageId

  try {
    if (ctx.transcript.characterSlices.length === 0) {
      debugLogs.push('[Memory] Turn has no character contributions — nothing to extract')
      return {
        success: true,
        memoriesCreatedCount: 0,
        memoriesReinforcedCount: 0,
        createdMemoryIds,
        reinforcedMemoryIds,
        usage: totalUsage,
        sourceMessageId,
        debugLogs,
        ...(ctx.dryRun ? { extractedCandidates: collectedCandidates } : {}),
      }
    }

    // Resolve cheap LLM selection ONCE for the whole turn — every pass reuses
    // the same provider so the cacheable prefix the rendered transcript
    // produces actually hits.
    const config = toCheapLLMConfig(ctx.cheapLLMSettings)
    let selection: CheapLLMSelection = getCheapLLMProvider(
      ctx.connectionProfile,
      config,
      ctx.availableProfiles || [],
      false
    )
    selection = resolveUncensoredCheapLLMSelection(
      selection,
      ctx.isDangerousChat ?? false,
      ctx.dangerSettings,
      ctx.availableProfiles ?? []
    )

    const uncensoredFallback: UncensoredFallbackOptions | undefined =
      ctx.dangerSettings && ctx.availableProfiles
        ? { dangerSettings: ctx.dangerSettings, availableProfiles: ctx.availableProfiles }
        : undefined

    const cheapMaxTokens = resolveMaxTokens(ctx.connectionProfile)

    // Non-canonical orienting context, identical across every SELF/OTHER call
    // this turn — built once so it stays in the variable footer without
    // disturbing the cached body prefix.
    const orienting: OrientingContext = {
      projectDescription: ctx.projectDescription ?? null,
      chatContextSummary: ctx.chatContextSummary ?? null,
    }

    // Episodic spine: give the extractor a clock, anchored to the turn's own
    // message timestamps (batch re-extraction passes its historical override).
    const clock: ExtractionClock = {
      nowIso:
        ctx.sourceMessageTimestamp ??
        ctx.transcript.turnTimestamp ??
        new Date().toISOString(),
      timelineMode: ctx.timelineMode ?? 'realtime',
    }

    // Pre-resolve per-character rate limits so we know which characters to
    // skip entirely, throttle, or allow before we start firing LLM calls.
    const rateLimits = new Map<string, RateLimitDecision>()
    for (const slice of ctx.transcript.characterSlices) {
      rateLimits.set(slice.characterId, await resolveExtractionRateLimit(slice.characterId, ctx.memoryExtractionLimits))
    }

    const allowedSlices = ctx.transcript.characterSlices.filter(s => {
      const rl = rateLimits.get(s.characterId)!
      if (rl.mode === 'skip') {
        debugLogs.push(
          `[Memory] SKIPPED extraction for ${s.characterName} — rate limit reached ` +
          `(${rl.recentCount}/${rl.cap} memories in last hour)`
        )
        return false
      }
      if (rl.mode === 'throttle') {
        debugLogs.push(
          `[Memory] THROTTLING ${s.characterName} — ${rl.recentCount}/${rl.cap}; floor ${rl.floor}`
        )
      }
      return true
    })

    // ---------------------------------------------------------------------
    // Build the subject set for the OTHER pass: every allowed character plus
    // the user-controlled character (if any). The user's character record is
    // also used here just like an AI character's — we look up its identity
    // and vault mount point exactly the same way.
    //
    // A user-controlled character now arrives as a slice as well (built from
    // the turn opener), so it would appear both here in the slice loop and in
    // the explicit user block below. De-dupe by character ID: the slice loop
    // wins (it carries the authoritative speaker), and the explicit block only
    // fires as a fallback when the user character is present but silent (e.g. a
    // greeting turn produced no opener slice).
    // ---------------------------------------------------------------------
    type Subject = { id: string; name: string; identity: string | null; description: string | null; isUser: boolean }
    const subjects: Subject[] = []
    const seenSubjectIds = new Set<string>()
    for (const slice of allowedSlices) {
      if (seenSubjectIds.has(slice.characterId)) continue
      seenSubjectIds.add(slice.characterId)
      const character = ctx.participantCharacters.get(slice.characterId)
      subjects.push({
        id: slice.characterId,
        name: slice.characterName,
        identity: character?.identity ?? null,
        description: character?.description ?? null,
        // The user-controlled character's subject entry stays tagged so other
        // observers' OTHER prompts still read "(the user-controlled character)".
        isUser: slice.isUserControlled ?? false,
      })
    }
    if (ctx.transcript.userCharacterId && ctx.transcript.userCharacterName) {
      if (seenSubjectIds.has(ctx.transcript.userCharacterId)) {
        debugLogs.push(
          `[Memory] Skipped duplicate user subject for ${ctx.transcript.userCharacterName} ` +
          `— already present as a turn slice`
        )
      } else {
        seenSubjectIds.add(ctx.transcript.userCharacterId)
        const userCharacter = ctx.participantCharacters.get(ctx.transcript.userCharacterId)
        subjects.push({
          id: ctx.transcript.userCharacterId,
          name: ctx.transcript.userCharacterName,
          identity: userCharacter?.identity ?? null,
          description: userCharacter?.description ?? null,
          isUser: true,
        })
      }
    }

    // ---------------------------------------------------------------------
    // Pass 1: SELF memories (one call per allowed character; canon = own
    // identity, no vault lookup).
    // ---------------------------------------------------------------------
    for (const slice of allowedSlices) {
      const rl = rateLimits.get(slice.characterId)!
      const observerCharacter = ctx.participantCharacters.get(slice.characterId)
      const selfCanonBlock = renderSelfCanonBlock(loadCanonForSelf({
        id: slice.characterId,
        name: slice.characterName,
        manifesto: observerCharacter?.manifesto ?? null,
        personality: observerCharacter?.personality ?? null,
        description: observerCharacter?.description ?? null,
        identity: observerCharacter?.identity ?? null,
      }))

      const selfResult = await extractSelfMemoriesFromTurn(
        ctx.transcript,
        slice.characterId,
        selfCanonBlock,
        selection,
        ctx.userId,
        uncensoredFallback,
        ctx.chatId,
        cheapMaxTokens,
        ctx.inAutonomousRoom === true,
        orienting,
        clock,
      )

      if (selfResult.usage) {
        totalUsage.promptTokens += selfResult.usage.promptTokens
        totalUsage.completionTokens += selfResult.usage.completionTokens
        totalUsage.totalTokens += selfResult.usage.totalTokens
      }

      if (selfResult.success) {
        const rawCandidates = selfResult.result || []
        const candidates = rl.mode === 'throttle'
          ? applyImportanceFloor(rawCandidates, rl.floor)
          : rawCandidates
        if (rl.mode === 'throttle' && candidates.length < rawCandidates.length) {
          debugLogs.push(
            `[Memory] Throttle dropped ${rawCandidates.length - candidates.length} SELF candidate(s) ` +
            `for ${slice.characterName} below importance ${rl.floor}`
          )
        }
        debugLogs.push(
          `[Memory] SELF for ${slice.characterName}` +
          `${slice.isUserControlled ? ' (user-controlled)' : ''}: ${candidates.length} candidate(s)`
        )
        for (const candidate of candidates) {
          await writeCandidate({
            characterId: slice.characterId,
            characterName: slice.characterName,
            aboutCharacterId: slice.characterId,
            aboutCharacterName: slice.characterName,
            pass: 'SELF',
            candidate,
            passLabel: `SELF memory for ${slice.characterName}`,
            ctx,
            sourceMessageId: slice.contributingMessageIds[slice.contributingMessageIds.length - 1] ?? sourceMessageId,
            sourceMessageCreatedAt: slice.lastMessageCreatedAt ?? null,
            debugLogs,
            createdIds: createdMemoryIds,
            reinforcedIds: reinforcedMemoryIds,
            collected: collectedCandidates,
          })
        }
      } else {
        debugLogs.push(`[Memory] SELF extraction failed for ${slice.characterName}: ${selfResult.error}`)
      }
    }

    // ---------------------------------------------------------------------
    // Pass 2: OTHER memories (one multi-subject call per observer; the
    // call covers every other allowed character and the user-controlled
    // character). Observer rate-limit gates the whole call. Each subject's
    // canon block comes from the observer's vault `Others/<subject>.md`
    // first, then falls back to the subject's own identity property; the
    // canon source is preserved per subject so debug logs can attribute it.
    // ---------------------------------------------------------------------
    for (const observer of allowedSlices) {
      const rl = rateLimits.get(observer.characterId)!
      const observerCharacter = ctx.participantCharacters.get(observer.characterId)
      const observerVault = {
        characterId: observer.characterId,
        mountPointId: observerCharacter?.characterDocumentMountPointId ?? null,
      }

      const observerSubjects = subjects.filter(s => s.id !== observer.characterId)
      if (observerSubjects.length === 0) continue

      // Resolve every subject's canon block + pronouns up front so the
      // single LLM call can be assembled in one shot. We hold the source
      // tag separately so per-subject debug logs can still report
      // canon=<source> the way the per-pair version did.
      type ResolvedSubject = OtherSubjectInput & { canonSource: string; subjectName: string }
      const resolvedSubjects: ResolvedSubject[] = []
      for (const subject of observerSubjects) {
        const canon = await loadCanonForObserverAboutSubject(observerVault, subject)
        const subjectCanonBlock = renderOtherCanonBlock(canon)
        const pronouns: Pronouns | null = subject.isUser
          ? (ctx.transcript.userCharacterPronouns ?? null)
          : (ctx.transcript.characterSlices.find(s => s.characterId === subject.id)?.characterPronouns ?? null)
        resolvedSubjects.push({
          id: subject.id,
          name: subject.name,
          pronouns,
          isUser: subject.isUser,
          canonBlock: subjectCanonBlock,
          canonSource: canon.source,
          subjectName: subject.name,
        })
      }

      const otherResult = await extractOtherMemoriesFromTurn(
        ctx.transcript,
        observer.characterId,
        resolvedSubjects,
        selection,
        ctx.userId,
        uncensoredFallback,
        ctx.chatId,
        cheapMaxTokens,
        ctx.inAutonomousRoom === true,
        orienting,
        clock,
      )

      if (otherResult.usage) {
        totalUsage.promptTokens += otherResult.usage.promptTokens
        totalUsage.completionTokens += otherResult.usage.completionTokens
        totalUsage.totalTokens += otherResult.usage.totalTokens
      }

      if (!otherResult.success) {
        debugLogs.push(
          `[Memory] OTHER extraction failed (${observer.characterName} → ${resolvedSubjects.length} subject(s)): ${otherResult.error}`
        )
        continue
      }

      const candidatesBySubject = otherResult.result ?? new Map<string, MemoryCandidate[]>()
      for (const subject of resolvedSubjects) {
        const rawCandidates = candidatesBySubject.get(subject.id) ?? []
        const candidates = rl.mode === 'throttle'
          ? applyImportanceFloor(rawCandidates, rl.floor)
          : rawCandidates
        if (rl.mode === 'throttle' && candidates.length < rawCandidates.length) {
          debugLogs.push(
            `[Memory] Throttle dropped ${rawCandidates.length - candidates.length} OTHER candidate(s) ` +
            `for ${observer.characterName} about ${subject.subjectName} below importance ${rl.floor}`
          )
        }
        debugLogs.push(
          `[Memory] OTHER observer=${observer.characterName}` +
          `${observer.isUserControlled ? ' (user-controlled)' : ''} subject=${subject.subjectName} ` +
          `canon=${subject.canonSource}: ${candidates.length} candidate(s)`
        )
        for (const candidate of candidates) {
          await writeCandidate({
            characterId: observer.characterId,
            characterName: observer.characterName,
            aboutCharacterId: subject.id,
            aboutCharacterName: subject.subjectName,
            pass: 'OTHER',
            candidate,
            passLabel: `OTHER memory ${observer.characterName} about ${subject.subjectName}`,
            ctx,
            sourceMessageId: observer.contributingMessageIds[observer.contributingMessageIds.length - 1] ?? sourceMessageId,
            sourceMessageCreatedAt: observer.lastMessageCreatedAt ?? null,
            debugLogs,
            createdIds: createdMemoryIds,
            reinforcedIds: reinforcedMemoryIds,
            collected: collectedCandidates,
          })
        }
      }
    }

    return {
      success: true,
      memoriesCreatedCount: createdMemoryIds.length,
      memoriesReinforcedCount: reinforcedMemoryIds.length,
      createdMemoryIds,
      reinforcedMemoryIds,
      usage: totalUsage,
      sourceMessageId,
      debugLogs,
      ...(ctx.dryRun ? { extractedCandidates: collectedCandidates } : {}),
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('[Memory] Turn processing error', { chatId: ctx.chatId, userId: ctx.userId }, error instanceof Error ? error : undefined)
    return {
      success: false,
      memoriesCreatedCount: 0,
      memoriesReinforcedCount: 0,
      createdMemoryIds,
      reinforcedMemoryIds,
      usage: totalUsage,
      sourceMessageId,
      debugLogs,
      ...(ctx.dryRun ? { extractedCandidates: collectedCandidates } : {}),
      error: errorMsg,
    }
  }
}

/**
 * Re-export the slice type so callers can avoid importing from turn-transcript directly.
 */
export type { TurnTranscript, TurnCharacterSlice }
