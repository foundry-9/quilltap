/**
 * Standing Instructions
 *
 * Projects and groups each carry an optional `instructions` field ("the
 * prompt") that is injected into the system prompt of every character speaking
 * in scope of that entity:
 *
 *   - **Project instructions** apply to every chat with `chat.projectId` set.
 *   - **Group instructions** apply per *responding character* — a character in
 *     scope of a turn receives the instructions of every group they are a
 *     member of, regardless of which chat the turn is in. (Same doctrine as
 *     the group document-store tier: membership follows the character, never
 *     the chat. See docs/developer/features/complete/groups.md §4.2.)
 *
 * The rendered section sits inside system block 1 — the cacheable prefix —
 * between the Taboo section and the tool instructions. Like Taboo, it is
 * stable across turns (it changes only when the user edits a project/group or
 * changes a membership) and emits nothing at all when there is nothing to say,
 * so chats without standing instructions build byte-identical prompts to the
 * pre-feature layout.
 *
 * Help and Brahma chats never receive the section: they have their own prompt
 * builders that do not call `buildSystemPrompt`. Carina one-off queries DO
 * receive it (mirrored insertion in `lib/services/carina/carina.service.ts`).
 *
 * Unlike Taboo phrases, instructions ARE template-processed by the consumer
 * (`{{char}}`/`{{user}}` etc.), matching the character system-prompt and
 * roleplay-template precedent — a group prompt legitimately wants to address
 * "{{char}}" when several member characters share it.
 *
 * @module chat/context/standing-instructions
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'

/** One entity's contribution to the standing-instructions section. */
export interface StandingInstructionsSource {
  kind: 'project' | 'group'
  name: string
  instructions: string
}

/**
 * Preamble of the standing-instructions section. Follows the universal-section
 * precedent (`MATH_FORMATTING_INSTRUCTION`, `TABOO_SECTION_PREAMBLE`):
 * bracketed all-caps tag, imperative, addressed to the speaking character.
 * The "refine, never replace" clause keeps the character's own identity stack
 * primary when a project or group prompt brushes against it.
 */
const STANDING_INSTRUCTIONS_PREAMBLE = `[STANDING INSTRUCTIONS]
The sections below are standing instructions attached to this chat's project and to groups you belong to. They hold for the entire conversation. They refine how you conduct yourself here; they never replace who you are.`

/**
 * Resolve the standing-instruction sources for a turn: the chat's project
 * (when `projectId` is set) followed by every group the responding character
 * belongs to, sorted by group name (then id) for cache determinism.
 *
 * Every lookup fails soft: a missing project, a broken official store, or a
 * degraded mount-index DB drops that source rather than losing the turn.
 * Entities whose `instructions` are empty or whitespace contribute nothing.
 */
export async function resolveStandingInstructions(options: {
  projectId?: string | null
  characterId?: string | null
}): Promise<StandingInstructionsSource[]> {
  const { projectId, characterId } = options
  const repos = getRepositories()
  const sources: StandingInstructionsSource[] = []

  if (projectId) {
    try {
      const project = await repos.projects.findById(projectId)
      const instructions = project?.instructions?.trim()
      if (project && instructions) {
        sources.push({ kind: 'project', name: project.name, instructions })
      }
    } catch (error) {
      logger.warn('[StandingInstructions] Failed to load project instructions — continuing without them', {
        projectId,
        error: getErrorMessage(error),
      })
    }
  }

  if (characterId) {
    try {
      const memberships = await repos.groupCharacterMembers.findByCharacterId(characterId)
      const groupSources: StandingInstructionsSource[] = []
      for (const membership of memberships) {
        try {
          const group = await repos.groups.findById(membership.groupId)
          const instructions = group?.instructions?.trim()
          if (group && instructions) {
            groupSources.push({ kind: 'group', name: group.name, instructions })
          }
        } catch (error) {
          logger.warn('[StandingInstructions] Failed to load group instructions — skipping that group', {
            groupId: membership.groupId,
            characterId,
            error: getErrorMessage(error),
          })
        }
      }
      // Deterministic order: membership rows carry no meaningful order, and a
      // Map/array-order wobble here would bisect the provider cache prefix.
      groupSources.sort((a, b) => a.name.localeCompare(b.name) || a.instructions.localeCompare(b.instructions))
      sources.push(...groupSources)
    } catch (error) {
      logger.warn('[StandingInstructions] Failed to load group memberships — continuing without group instructions', {
        characterId,
        error: getErrorMessage(error),
      })
    }
  }

  if (sources.length > 0) {
    logger.debug('[StandingInstructions] Resolved standing instructions', {
      projectId: projectId ?? null,
      characterId: characterId ?? null,
      sourceCount: sources.length,
      kinds: sources.map(s => s.kind),
    })
  }

  return sources
}

/**
 * Render the standing-instructions section, or `null` when there is nothing
 * to say — no header, no blank block, byte-identical to the pre-feature
 * prompt (the Taboo contract).
 */
export function renderStandingInstructionsSection(
  sources: StandingInstructionsSource[] | null | undefined,
): string | null {
  if (!sources || sources.length === 0) return null
  const blocks: string[] = []
  for (const source of sources) {
    const instructions = source.instructions.trim()
    if (!instructions) continue
    const heading = source.kind === 'project'
      ? `## Project Instructions — ${source.name}`
      : `## Group Instructions — ${source.name}`
    blocks.push(`${heading}\n${instructions}`)
  }
  if (blocks.length === 0) return null
  return `${STANDING_INSTRUCTIONS_PREAMBLE}\n\n${blocks.join('\n\n')}`
}

/**
 * Convenience wrapper: resolve + render in one call. Used by the async call
 * sites (`buildContext`, Carina, `self_inventory`) that hand the finished
 * string to a synchronous builder.
 */
export async function resolveStandingInstructionsSection(options: {
  projectId?: string | null
  characterId?: string | null
}): Promise<string | null> {
  return renderStandingInstructionsSection(await resolveStandingInstructions(options))
}
