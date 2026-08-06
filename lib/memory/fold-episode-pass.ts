/**
 * Fold-time episode pass (episodic spine — creation-side keystone).
 *
 * Per-turn extraction sees one turn at a time and produces fragments; a real
 * outing spans many turns and deserves one coherent record. On the existing
 * fold cadence (piggybacking `generateContextSummary`, no new trigger), this
 * pass asks the cheap LLM for 0–2 consolidated episode records over the
 * just-folded message window, writes them as `kind: 'episodic'` memories for
 * each present character through the normal gate (the gate's date guard keeps
 * them from being swallowed by near-dup skips), and links the per-turn
 * fragment memories from the same window via `relatedMemoryIds` so one-hop
 * expansion can pull the fragments when the episode surfaces.
 *
 * Best-effort throughout: never throws into the fold; a failed episode pass
 * costs nothing but the episode.
 *
 * @module memory/fold-episode-pass
 */

import { getRepositories } from '@/lib/repositories/factory'
import {
  extractEpisodesFromFold,
  type ExtractionClock,
  type FoldEpisodeMessage,
} from './cheap-llm-tasks'
import { createMemoryWithGate } from './memory-service'
import { resolveWhenPhrase } from './episodic'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { MessageEvent } from '@/lib/schemas/types'
import { isParticipantPresent } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'

/** Cap on fragment links attached to one episode (per character). */
const MAX_FRAGMENT_LINKS = 8

export interface RunFoldEpisodePassInput {
  chatId: string
  userId: string
  /** The just-folded window: USER + character messages, chronological. */
  windowMessages: MessageEvent[]
  cheapLLM: CheapLLMSelection
  timelineMode: 'realtime' | 'narrative'
  projectId?: string | null
  inAutonomousRoom: boolean
}

export interface FoldEpisodePassResult {
  episodesExtracted: number
  memoriesWritten: number
  fragmentsLinked: number
}

/**
 * Run the episode pass over a folded window. See module docs.
 */
export async function runFoldEpisodePass(
  input: RunFoldEpisodePassInput,
): Promise<FoldEpisodePassResult> {
  const result: FoldEpisodePassResult = {
    episodesExtracted: 0,
    memoriesWritten: 0,
    fragmentsLinked: 0,
  }
  const { chatId, userId, windowMessages, cheapLLM } = input

  try {
    if (windowMessages.length === 0) return result

    const repos = getRepositories()
    const chat = await repos.chats.findById(chatId)
    if (!chat) return result

    // Present character participants form the episode memory — the same set
    // whose recall the whisper feeds. User-controlled characters form
    // memories too (matching the per-turn SELF pass).
    const presentParticipants = chat.participants.filter(
      p => p.type === 'CHARACTER' && isParticipantPresent(p.status) && p.characterId,
    )
    if (presentParticipants.length === 0) return result

    // Anchor the clock to the window's newest message so historical folds
    // (regeneration sweeps) date correctly.
    const lastStamped = [...windowMessages].reverse().find(m => m.createdAt)
    const clock: ExtractionClock = {
      nowIso: lastStamped?.createdAt ?? new Date().toISOString(),
      timelineMode: input.timelineMode,
    }

    // Resolve speaker names per participant (raw read — survives a broken vault).
    const speakerNames = new Map<string, string>()
    for (const p of chat.participants) {
      if (!p.characterId || speakerNames.has(p.id)) continue
      try {
        const character = await repos.characters.findByIdRaw(p.characterId)
        if (character) speakerNames.set(p.id, character.name)
      } catch {
        // Name stays role-labelled below.
      }
    }

    const rendered: FoldEpisodeMessage[] = windowMessages.map(m => ({
      speaker:
        (m.participantId ? speakerNames.get(m.participantId) : undefined) ??
        (m.role === 'USER' ? 'User' : 'Character'),
      content: m.content ?? '',
      createdAt: m.createdAt ?? null,
    }))

    const extraction = await extractEpisodesFromFold(rendered, clock, cheapLLM, userId, chatId)
    if (!extraction.success || !extraction.result || extraction.result.length === 0) {
      if (!extraction.success) {
        logger.warn('[FoldEpisodePass] Episode extraction failed', {
          chatId,
          error: extraction.error,
        })
      }
      return result
    }
    result.episodesExtracted = extraction.result.length

    // First message timestamp of the window — the default occurredAt when the
    // model's `when` phrase doesn't resolve.
    const firstStamped = windowMessages.find(m => m.createdAt)
    const windowStartIso = firstStamped?.createdAt ?? clock.nowIso
    const windowMessageIds = windowMessages.map(m => m.id)
    const sourceMessageId = lastStamped?.id ?? windowMessages[windowMessages.length - 1]?.id ?? null

    for (const episode of extraction.result) {
      const resolved = episode.when ? resolveWhenPhrase(episode.when, clock.nowIso) : null
      const occurredAt = resolved ?? windowStartIso
      const narrativeTime =
        input.timelineMode === 'narrative'
          ? (episode.narrativeTime ?? episode.when ?? null)
          : (episode.narrativeTime ?? null)

      for (const participant of presentParticipants) {
        const characterId = participant.characterId
        try {
          const outcome = await createMemoryWithGate(
            {
              characterId,
              content: episode.narrative,
              summary: episode.summary,
              keywords: [...episode.entities.map(e => e.toLowerCase()), 'past', 'scope: narrow', 'history'],
              importance: episode.importance,
              chatId,
              projectId: input.projectId ?? null,
              source: 'AUTO',
              sourceMessageId,
              sourceMessageTimestamp: occurredAt,
              witnessedContext: input.inAutonomousRoom ? 'autonomous_room' : 'user_present',
              occurredAt,
              narrativeTime,
              entities: episode.entities,
              kind: 'episodic',
              tags: [],
            },
            { userId },
          )

          const memory = outcome.memory
          if (!memory) continue
          if (outcome.action === 'INSERT' || outcome.action === 'INSERT_RELATED' || outcome.action === 'SKIP_GATE') {
            result.memoriesWritten++
          }

          // Link the character's per-turn fragment memories from the same
          // window so one-hop expansion can pull them when the episode
          // surfaces. Union-preserving on both sides (never clobber links the
          // gate already made) — this relies on `createMemoryWithGate` returning
          // the POST-LINK row for INSERT_RELATED, so `memory.relatedMemoryIds`
          // below already carries the gate's links (Bug 26).
          const fragments = await repos.memories.findByCharacterAndSourceMessageIds(
            characterId,
            windowMessageIds,
          )
          const fragmentIds = fragments
            .map(f => f.id)
            .filter(id => id !== memory.id)
            .slice(0, MAX_FRAGMENT_LINKS)
          if (fragmentIds.length === 0) continue

          const episodeLinks = new Set(memory.relatedMemoryIds ?? [])
          let episodeLinksChanged = false
          for (const fragmentId of fragmentIds) {
            if (!episodeLinks.has(fragmentId)) {
              episodeLinks.add(fragmentId)
              episodeLinksChanged = true
            }
          }
          if (episodeLinksChanged) {
            await repos.memories.updateForCharacter(characterId, memory.id, {
              relatedMemoryIds: [...episodeLinks],
            })
          }
          for (const fragment of fragments) {
            if (fragment.id === memory.id) continue
            if (!fragmentIds.includes(fragment.id)) continue
            const links = fragment.relatedMemoryIds ?? []
            if (links.includes(memory.id)) continue
            await repos.memories.updateForCharacter(characterId, fragment.id, {
              relatedMemoryIds: [...links, memory.id],
            })
            result.fragmentsLinked++
          }
        } catch (perCharacterError) {
          logger.warn('[FoldEpisodePass] Failed to write episode for character', {
            chatId,
            characterId,
            error: perCharacterError instanceof Error ? perCharacterError.message : String(perCharacterError),
          })
        }
      }
    }

    logger.info('[FoldEpisodePass] Episode pass complete', {
      chatId,
      episodesExtracted: result.episodesExtracted,
      memoriesWritten: result.memoriesWritten,
      fragmentsLinked: result.fragmentsLinked,
    })
    return result
  } catch (error) {
    logger.warn('[FoldEpisodePass] Episode pass failed (non-fatal)', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
    return result
  }
}
