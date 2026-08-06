/**
 * Speaker attribution for ad-hoc announcements (Insert Announcement composer).
 *
 * `customAnnouncer` names who is speaking — an off-scene workspace character,
 * or a free-text display name — but it is a *rendering* field: the Salon paints
 * that name and avatar on the bubble, and nothing carried it into the model's
 * context. So an announcement posted as a named character arrived at every
 * character as an anonymous block of prose, and the model had to guess who was
 * talking. It guesses badly, and confidently: a whispered announcement written
 * in one character's voice was read as a different character entirely, and the
 * mistake then became part of the scene.
 *
 * Every other authored line in a context carries a speaker — participant
 * messages are tagged `[Name]` by `attributeMessagesForCharacter`, and Staff
 * name themselves in their own prose ("Prospero opens his ledger…"). The
 * ad-hoc announcement was the sole anonymous line, and it is the one place the
 * operator explicitly *chose* a speaker. The Courier transport already resolved
 * the name for its own transcript (`courier-transport.service.ts`), so the same
 * message was attributed on one path and anonymous on the other — the model's
 * reading of a scene changed with the transport carrying it.
 *
 * The tag uses the same `[Name] ` form the multi-character path already emits,
 * so it reads as one convention rather than a second dialect.
 */

import { staffDisplayName } from '@/lib/chat/staff-display-names'

/** The `customAnnouncer` column's shape, structural so callers stay decoupled. */
export interface CustomAnnouncer {
  kind: 'character' | 'custom'
  characterId?: string | null
  displayName?: string | null
}

export interface AnnouncerAttributable {
  content?: string
  opaqueContent?: string | null
  customAnnouncer?: CustomAnnouncer | null
  systemSender?: string | null
  systemKind?: string | null
}

/**
 * Resolve the display name for an announcer, or null when it can't be named.
 *
 * A `character` announcer whose id resolves to nothing — deleted since the
 * announcement was posted — returns null rather than a placeholder: a wrong or
 * invented name is worse than no name, because the model treats a name as fact.
 *
 * When no `customAnnouncer` is present the announcement was signed as Staff
 * (the Insert Announcement dialog's `staff` mode writes a `systemSender` and no
 * `customAnnouncer`). Those still need a speaker: an operator-authored line
 * signed as the Host is not prose the Host wrote, so it carries no self-naming,
 * and without a fallback it reaches the model as an anonymous `user` turn. Fall
 * back to the `systemSender`, resolved through the single staff-name table.
 */
export function resolveAnnouncerName(
  announcer: CustomAnnouncer | null | undefined,
  characterNamesById: ReadonlyMap<string, string>,
  systemSender?: string | null,
): string | null {
  if (announcer) {
    if (announcer.kind === 'character') {
      if (!announcer.characterId) return null
      return characterNamesById.get(announcer.characterId)?.trim() || null
    }
    return announcer.displayName?.trim() || null
  }

  if (systemSender) {
    return staffDisplayName(systemSender).trim() || null
  }

  return null
}

/** Character ids an announcement references, for a single up-front name lookup. */
export function collectAnnouncerCharacterIds(
  messages: readonly AnnouncerAttributable[],
): string[] {
  const ids = new Set<string>()
  for (const m of messages) {
    if (m.customAnnouncer?.kind === 'character' && m.customAnnouncer.characterId) {
      ids.add(m.customAnnouncer.characterId)
    }
  }
  return [...ids]
}

/**
 * Prefix each ad-hoc announcement's body with its speaker.
 *
 * A `customAnnouncer` (character/custom mode) names the speaker directly. A
 * `staff`-mode announcement carries a `systemSender` instead — but only ad-hoc
 * announcements (`systemKind === 'announcement'`) take that fallback: ordinary
 * Staff whispers (image notices, tool bubbles, memory recalls) also carry a
 * `systemSender`, and they name themselves in their own prose, so prefixing
 * them here would double-tag every one. A message with neither field, and an
 * announcer that can't be named, both pass through unchanged.
 *
 * The prefix lands on `opaqueContent` too when present: an opaque-anywhere chat
 * swaps that persona-free body into the LLM context in place of `content`
 * (`normalizeWhisperRoles`), so tagging only `content` would leave the model's
 * copy anonymous in exactly that mode.
 *
 * Pure: no repository access, so the name map is the caller's problem and this
 * stays trivially testable.
 */
export function attributeAdhocAnnouncements<T extends AnnouncerAttributable>(
  messages: T[],
  characterNamesById: ReadonlyMap<string, string>,
): T[] {
  return messages.map(m => {
    const systemSender = m.systemKind === 'announcement' ? m.systemSender : undefined
    const name = resolveAnnouncerName(m.customAnnouncer, characterNamesById, systemSender)
    if (!name) return m

    const tag = `[${name}]`
    const prefix = (text: string) =>
      // Idempotent: re-running (a retry, a regenerate) must not stack tags.
      text.startsWith(tag) ? text : `${tag} ${text}`

    const next: T = { ...m, content: prefix(m.content ?? '') }
    if (typeof m.opaqueContent === 'string') {
      next.opaqueContent = prefix(m.opaqueContent)
    }
    return next
  })
}
