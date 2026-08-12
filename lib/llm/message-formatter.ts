/**
 * Message Formatter Utility
 * Phase 3: Multi-Character Context Building
 *
 * Handles provider-aware message formatting for multi-character chats.
 * Provides name field support or content prefix fallback depending on provider.
 *
 * NOTE: Registered plugins provide message format support via messageFormat.
 * The legacy fallback constants are imported from fallback-data.ts and used
 * only when no plugin is registered for a provider.
 *
 * @see lib/llm/fallback-data.ts for legacy fallback constants
 */

import { Provider } from '@/lib/schemas/types'
import { getMessageFormat } from '@/lib/plugins/provider-registry'
import {
  LEGACY_PROVIDER_NAME_SUPPORT,
  type LegacyProviderNameSupport,
} from './fallback-data'

/**
 * Provider capabilities for name field support
 */
export interface ProviderNameSupport {
  /** Whether the provider supports a name field on messages */
  supportsNameField: boolean
  /** Which roles support the name field */
  supportedRoles: ('user' | 'assistant')[]
  /** Maximum length for name field (if limited) */
  maxNameLength?: number
}

/**
 * Provider-specific name field support information
 * Re-exported from fallback-data.ts for backward compatibility
 *
 * @deprecated Use getMessageFormat() from provider-registry instead
 */
const PROVIDER_NAME_SUPPORT: Record<string, ProviderNameSupport> =
  LEGACY_PROVIDER_NAME_SUPPORT as Record<string, ProviderNameSupport>

/**
 * Get name field support info for a provider
 */
export function getProviderNameSupport(provider: Provider): ProviderNameSupport {
  // First try the plugin registry (plugins register their own message format support)
  const pluginFormat = getMessageFormat(provider)
  if (pluginFormat.supportsNameField || pluginFormat.supportedRoles.length > 0) {
    return pluginFormat
  }

  // Fall back to hardcoded support for known providers
  const normalized = provider.toUpperCase()
  const support = PROVIDER_NAME_SUPPORT[normalized]

  if (!support) {

    return {
      supportsNameField: false,
      supportedRoles: [],
    }
  }

  return support
}

/**
 * Check if a provider supports the name field for a given role
 */
export function supportsNameField(provider: Provider, role: 'user' | 'assistant'): boolean {
  const support = getProviderNameSupport(provider)
  return support.supportsNameField && support.supportedRoles.includes(role)
}

/**
 * Format a participant name for use in the name field or content prefix
 * Sanitizes and truncates as needed
 */
export function formatParticipantName(name: string, maxLength: number = 64): string {
  // Remove or replace characters that might cause issues
  // OpenAI name field: a-zA-Z0-9_- only, no spaces
  const sanitized = name
    .trim()
    // Replace spaces with underscores
    .replace(/\s+/g, '_')
    // Remove any characters that aren't alphanumeric, underscore, or hyphen
    .replace(/[^a-zA-Z0-9_-]/g, '')
    // Truncate to max length
    .slice(0, maxLength)

  // Ensure we have at least something
  return sanitized || 'Unknown'
}

/**
 * Format a display name for content prefix (more lenient than name field)
 */
export function formatDisplayName(name: string): string {
  return name.trim() || 'Unknown'
}

/**
 * Prefix content with a `[Display Name] ` attribution tag, unless the content
 * already opens with that character's tag (case-insensitive). Single source of
 * truth for the inline speaker-attribution prefix used on both assistant and
 * user turns.
 */
export function buildNamePrefixedContent(name: string, content: string): string {
  const displayName = formatDisplayName(name)
  const existingPrefixPattern = new RegExp(
    `^\\[${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*`,
    'i',
  )
  return existingPrefixPattern.test(content) ? content : `[${displayName}] ${content}`
}

/**
 * Message with optional name and participant info for multi-character context
 */
export interface MultiCharacterMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Source chat_message id (preserved from MessageWithParticipant) */
  id?: string
  /** Name of the participant (character or user character) */
  name?: string
  /** Participant ID for tracking */
  participantId?: string
  /** Google Gemini thought signature */
  thoughtSignature?: string | null
}

/**
 * Format messages for a provider, applying name field or content prefix as needed
 *
 * @param messages Array of messages with optional names
 * @param provider The LLM provider
 * @param respondingCharacterName Name of the character who will respond (their messages become 'assistant')
 * @returns Formatted messages ready for the provider
 */
export function formatMessagesForProvider(
  messages: MultiCharacterMessage[],
  provider: Provider,
  respondingCharacterName: string
): Array<{
  role: 'system' | 'user' | 'assistant'
  content: string
  name?: string
  thoughtSignature?: string
}> {
  const nameSupport = getProviderNameSupport(provider)

  return messages.map((msg) => {
    // System messages don't get name attribution
    if (msg.role === 'system') {
      return {
        role: msg.role,
        content: msg.content,
        thoughtSignature: msg.thoughtSignature ?? undefined,
      }
    }

    // No name to attribute - return as is
    if (!msg.name) {
      return {
        role: msg.role,
        content: msg.content,
        thoughtSignature: msg.thoughtSignature ?? undefined,
      }
    }

    const roleForProvider = msg.role === 'assistant' ? 'assistant' : 'user'
    const supportsNativeName =
      nameSupport.supportsNameField && nameSupport.supportedRoles.includes(roleForProvider)

    // Assistant turns belong to the responding character themselves — prefer
    // the native name field when available and only fall back to prefixing.
    if (roleForProvider === 'assistant') {
      if (supportsNativeName) {
        return {
          role: roleForProvider,
          content: msg.content,
          name: formatParticipantName(msg.name, nameSupport.maxNameLength),
          thoughtSignature: msg.thoughtSignature ?? undefined,
        }
      }
      const prefixedContent = buildNamePrefixedContent(msg.name, msg.content)
      return {
        role: roleForProvider,
        content: prefixedContent,
        thoughtSignature: msg.thoughtSignature ?? undefined,
      }
    }

    // User-role messages mix the actual user, other characters' downgraded
    // assistant turns, and system narration. The OpenAI-style `name` field is
    // a weak signal for cross-speaker attribution, so always inline the
    // [Name] prefix; if the provider also supports the name field, send both.
    const prefixedContent = buildNamePrefixedContent(msg.name, msg.content)

    const result: { role: 'user'; content: string; name?: string; thoughtSignature?: string } = {
      role: 'user',
      content: prefixedContent,
      thoughtSignature: msg.thoughtSignature ?? undefined,
    }
    if (supportsNativeName) {
      result.name = formatParticipantName(msg.name, nameSupport.maxNameLength)
    }
    return result
  })
}

/**
 * Build a multi-character context description for the system prompt
 *
 * @param otherParticipants Array of other participants (name and brief description)
 * @param respondingCharacterName Name of the character who will respond
 * @returns String to append to system prompt
 */
export function buildMultiCharacterContextSection(
  otherParticipants: Array<{ name: string; aliases?: string[]; pronouns?: { subject: string; object: string; possessive: string }; description?: string; type: 'CHARACTER'; status?: string }>,
  respondingCharacterName: string
): string {
  if (otherParticipants.length === 0) {
    return ''
  }

  const lines: string[] = [
    '',
    '## Other Participants in This Conversation',
    '',
  ]

  // Status guide — always present so the LLM understands the participation model
  lines.push('**Participant Status Guide:**')
  lines.push('- **active**: Present and participating normally in the conversation')
  lines.push('- **silent**: Present but observing silently — may think and act physically, but does not speak aloud')
  lines.push('- **absent**: Away from the scene — cannot perceive what is happening')
  lines.push('')

  for (const participant of otherParticipants) {
    const typeLabel = participant.type === 'CHARACTER' && participant.name.includes('User') ? '(the user)' : ''
    const aliasNote = participant.aliases && participant.aliases.length > 0
      ? ` (also known as: ${participant.aliases.join(', ')})`
      : ''
    const pronounNote = participant.pronouns
      ? ` (pronouns: ${participant.pronouns.subject}/${participant.pronouns.object}/${participant.pronouns.possessive})`
      : ''
    const statusNote = ` [${participant.status || 'active'}]`
    const description = participant.description ? ` - ${participant.description}` : ''
    lines.push(`- **${participant.name}**${aliasNote}${pronounNote}${statusNote} ${typeLabel}${description}`)
  }

  lines.push('')
  lines.push(
    `You are ${respondingCharacterName}. Stay in character when responding to the other participants. ` +
    `Messages from other characters and the user will be marked with their names. ` +
    `Your responses will be attributed to you (${respondingCharacterName}).`
  )

  return lines.join('\n')
}

// `normalizeContentBlockFormat` and `stripCharacterNamePrefix` moved to the
// dependency-free `response-normalizer.ts` so client-safe modules can import
// them without dragging in the provider registry (node:fs). Re-exported here
// for backward compatibility with existing importers.
export {
  normalizeContentBlockFormat,
  stripCharacterNamePrefix,
} from './response-normalizer'

/** Result of {@link truncateAtForeignSpeaker}. */
export interface ForeignSpeakerTruncation {
  /** The response up to (not including) the first foreign speaker tag, right-trimmed. */
  text: string
  /**
   * Offset into the INPUT where truncation occurred (start of the foreign tag's
   * line), or `null` if no foreign tag was found. `0` means the input began with
   * a foreign tag.
   */
  truncatedAt: number | null
}

/**
 * Multi-character anti-hijack safeguard: detect the point where a model has
 * begun writing ANOTHER participant's turn — a line that opens with a known
 * other-participant name as a speaker tag, either `[Name]` or `Name:` — and
 * truncate the response there. Returns the text before that tag (right-trimmed)
 * plus the offset it cut at.
 *
 * This is a model-agnostic structural backstop to the system-prompt
 * anti-impersonation guidance: even if an LLM ignores "only write your own
 * turn", its output can never carry another character's lines into the
 * transcript. It deliberately matches ONLY the supplied `foreignNames` (and
 * their aliases) as line-anchored speaker tags — never arbitrary bracketed
 * content — so roleplay action tags (`[*sighs*]`), status lines
 * (`[Whisper sent.]`), prose mentions ("I told Charlie:"), and the speaker's
 * OWN name are all left intact. Strip the speaker's own leading prefix with
 * {@link stripCharacterNamePrefix} first; pass only the OTHER participants here.
 */
export function truncateAtForeignSpeaker(
  content: string,
  foreignNames: string[],
): ForeignSpeakerTruncation {
  if (!content || foreignNames.length === 0) return { text: content, truncatedAt: null }

  const escaped = foreignNames
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (escaped.length === 0) return { text: content, truncatedAt: null }

  const names = escaped.join('|')
  // Line-anchored (start of string or after a newline), optional leading
  // whitespace, then either "[Name]" or "Name:" — the two screenplay speaker
  // formats LLMs slip into when continuing the scene for everyone.
  const re = new RegExp(`(?:^|\\n)[ \\t]*(?:\\[(?:${names})\\]|(?:${names})[ \\t]*:)`, 'i')
  const m = re.exec(content)
  if (!m) return { text: content, truncatedAt: null }

  // m.index is the position of the matched newline (or 0 at string start).
  // Slicing there drops the newline and everything after it.
  const cut = m.index
  const text = content.slice(0, cut).replace(/\s+$/, '')
  return { text, truncatedAt: cut }
}
