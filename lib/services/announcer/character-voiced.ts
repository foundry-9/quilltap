/**
 * Character-voiced announcement rewriter.
 *
 * Given a seed text the operator typed for an off-scene character and a
 * chosen connection profile, this rewrites the seed in the character's own
 * voice. The character is told they are NOT in the chat — they are speaking
 * in character to the people who are. The system gives them their normal
 * identity stack (no scenario, no tools, no roleplay template), runs a
 * Commonplace Book recall against the seed so they bring in relevant
 * memories, and lists the currently active or silent participants so the
 * character has an audience to address. The result is returned to the
 * caller for the operator to review, edit, regenerate, or post. Nothing is
 * persisted by this service.
 *
 * When the operator has chosen a whisper audience, the roster is replaced by
 * that audience and the character is told the remark is private. A line pitched
 * to a full room reads wrong when only one person hears it, so the audience has
 * to reach the rewrite rather than being applied after the fact.
 */

import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import { getRepositories } from '@/lib/repositories/factory'
import type { Character, ConnectionProfile } from '@/lib/schemas/types'
import { profileParams, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { LLMMessage } from '@/lib/llm/base'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { buildSystemPrompt } from '@/lib/chat/context/system-prompt-builder'
import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { formatDynamicMemoryHead } from '@/lib/chat/context/memory-injector'
import { buildCommonplaceLLMContext } from '@/lib/services/commonplace-notifications/writer'

export interface CharacterVoicedAnnouncementParams {
  chatId: string
  character: Character
  profile: ConnectionProfile
  seedMarkdown: string
  systemPromptId?: string
  userId: string
  /**
   * Display names of the whisper audience the operator has chosen, already
   * resolved and verified. Empty / omitted means the announcement is public
   * and the character addresses the whole room.
   */
  audienceNames?: string[]
}

export interface CharacterVoicedAnnouncementResult {
  success: boolean
  proposedMarkdown: string
  error?: string
}

const TASK_TYPE = 'announcement-rewrite'

function buildSelection(profile: ConnectionProfile): CheapLLMSelection {
  return {
    provider: profile.provider,
    modelName: profile.modelName,
    baseUrl: profile.baseUrl || undefined,
    connectionProfileId: profile.id,
    isLocal: profile.provider === 'OLLAMA',
    // Forward the profile's provider params (e.g. DeepSeek thinking mode) so
    // per-model settings take effect for this utility call too.
    profileParameters: profileParams(profile),
  }
}

/** "Alice", "Alice and Bob", "Alice, Bob, and Carol". */
function formatNameList(names: string[]): string {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

/**
 * Build the present-roster block from a chat's participants. Includes only
 * participants whose status is 'active' or 'silent' (not 'absent' or
 * 'removed'). The off-scene speaking character is filtered out in case they
 * also appear as a participant.
 */
async function buildRoster(
  chatId: string,
  speakingCharacterId: string,
): Promise<string> {
  const repos = getRepositories()
  const chat = await repos.chats.findById(chatId)
  if (!chat) return ''

  const rosterParticipants = chat.participants.filter(p =>
    p.type === 'CHARACTER'
    && (p.status === 'active' || p.status === 'silent')
    && p.characterId !== speakingCharacterId,
  )

  if (rosterParticipants.length === 0) return ''

  const rosterEntries = await Promise.all(
    rosterParticipants.map(async p => {
      const character = await repos.characters.findById(p.characterId)
      const name = character?.name?.trim() || 'Someone'
      return `- ${name} (${p.status})`
    }),
  )

  return rosterEntries.join('\n')
}

export async function generateCharacterVoicedAnnouncement(
  params: CharacterVoicedAnnouncementParams,
): Promise<CharacterVoicedAnnouncementResult> {
  const { chatId, character, profile, seedMarkdown, systemPromptId, userId, audienceNames } = params
  const whisperAudience = audienceNames?.filter(n => n.trim().length > 0) ?? []

  try {
    const selection = buildSelection(profile)

    // System prompt: identity stack only — no roleplay template, no tools.
    const systemPrompt = buildSystemPrompt({
      character,
      selectedSystemPromptId: systemPromptId ?? null,
    })

    // Commonplace recall against the seed text.
    let recallText = ''
    try {
      const memoryResults = await searchMemoriesSemantic(
        character.id,
        seedMarkdown,
        {
          userId,
          limit: 20,
          minImportance: 0.3,
        },
      )

      if (memoryResults.length > 0) {
        const formatted = formatDynamicMemoryHead(memoryResults, profile.provider, {
          maxEntries: 12,
        })
        if (formatted.content) {
          recallText = buildCommonplaceLLMContext({ relevant: formatted.content })
        }
      }
    } catch (err) {
      // Memory recall failure should not block the rewrite — proceed without.
      logger.warn('[CharacterVoicedAnnouncement] Memory recall failed; proceeding without', {
        chatId,
        characterId: character.id,
        error: getErrorMessage(err),
      })
    }

    // Who's listening. A whisper's audience is the audience — the room's wider
    // roster is not merely irrelevant to it, it would mislead the rewrite into
    // pitching a private aside at people who will never hear it.
    const roster = whisperAudience.length > 0 ? '' : await buildRoster(chatId, character.id)

    // Compose the user-role message.
    const seedTrimmed = seedMarkdown.trim()
    const userParts: string[] = []
    if (recallText) {
      userParts.push(recallText)
    }
    const presenceLine = whisperAudience.length > 0
      ? `You want to say something privately to ${formatNameList(whisperAudience)} — others are present in the chat, but this remark is for ${whisperAudience.length === 1 ? 'them' : 'those named'} alone and no one else will hear it. Pitch it as a private aside, not a declaration to the room.`
      : roster
        ? `You want to say something to the people in the chat. The following people are present:\n${roster}`
        : 'You want to say something to the people in the chat.'
    userParts.push(
      `${presenceLine}\n\nBelow is your own rough draft — the meaning and substance of what you want to convey. Rewrite it in your own voice, the way you would actually say it given your personality, manner of speech, and current circumstances. Keep the meaning, the addressees, and any specific facts; refine the voice and phrasing. Narration, action, and stage directions are welcome where they fit your voice. Do not respond to the draft — it is yours.\n\nDraft:`,
    )
    userParts.push(seedTrimmed)

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userParts.join('\n\n') },
    ]

    const llmResult = await executeCheapLLMTask<string>(
      selection,
      messages,
      userId,
      (content: string) => content.trim(),
      TASK_TYPE,
      chatId,
      undefined,
      undefined,
      2048,
      character.id,
    )

    if (!llmResult.success || !llmResult.result) {
      return {
        success: false,
        proposedMarkdown: '',
        error: llmResult.error || 'The LLM returned no content.',
      }
    }

    return {
      success: true,
      proposedMarkdown: llmResult.result,
    }
  } catch (error) {
    logger.error('[CharacterVoicedAnnouncement] Unexpected failure', {
      chatId,
      characterId: character.id,
      error: getErrorMessage(error),
    }, error as Error)
    return {
      success: false,
      proposedMarkdown: '',
      error: getErrorMessage(error),
    }
  }
}
