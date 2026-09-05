/**
 * Memory subject resolution.
 *
 * A character's memory store is keyed on `characterId` alone. It holds what
 * they remember about themselves and what they remember about everyone else
 * side by side, and `aboutCharacterId` is the only thing that separates the
 * two. The self-facing context blocks — `## Memory Anchors`, `## Relevant
 * Memories`, `Most relevant memories for this turn:` — arrive under a
 * second-person heading, so every line about someone else has to name its
 * subject or it reads as the character's own life (bug 122).
 *
 * This module is the one place that turns a pool of memories into the
 * {@link MemorySubjectContext} those formatters need. It lives here rather
 * than in `memory-injector.ts` so that module stays pure formatting with no
 * repository reach.
 */

import type { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import type { MemorySubjectContext } from '@/lib/chat/context/memory-injector'

/**
 * Resolve the display names of every other character a pool of memories is
 * about, and pair them with the owning character.
 *
 * Only ids that are neither absent nor the character's own are looked up, so a
 * store of purely first-person memories costs no query at all. The lookup goes
 * through `findNamesByIds`, which skips the vault overlay and returns an empty
 * map on failure — a missing name degrades one line's prefix to
 * `About another character:` rather than taking the turn down with it.
 */
export async function buildMemorySubjectContext(
  selfCharacterId: string,
  memories: ReadonlyArray<Pick<Memory, 'aboutCharacterId'>>,
): Promise<MemorySubjectContext> {
  const subjectIds = new Set<string>()
  for (const memory of memories) {
    const aboutId = memory.aboutCharacterId
    if (aboutId && aboutId !== selfCharacterId) subjectIds.add(aboutId)
  }

  if (subjectIds.size === 0) {
    return { selfCharacterId, characterNames: new Map() }
  }

  const characterNames = await getRepositories().characters.findNamesByIds(
    Array.from(subjectIds),
  )

  logger.debug('[MemorySubject] Resolved memory subjects', {
    characterId: selfCharacterId,
    memoryCount: memories.length,
    subjectCount: subjectIds.size,
    resolvedCount: characterNames.size,
  })

  return { selfCharacterId, characterNames }
}
