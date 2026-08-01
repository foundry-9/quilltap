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

/** The `customAnnouncer` column's shape, structural so callers stay decoupled. */
export interface CustomAnnouncer {
  kind: 'character' | 'custom'
  characterId?: string | null
  displayName?: string | null
}

export interface AnnouncerAttributable {
  content?: string
  customAnnouncer?: CustomAnnouncer | null
}

/**
 * Resolve the display name for an announcer, or null when it can't be named.
 *
 * A `character` announcer whose id resolves to nothing — deleted since the
 * announcement was posted — returns null rather than a placeholder: a wrong or
 * invented name is worse than no name, because the model treats a name as fact.
 */
export function resolveAnnouncerName(
  announcer: CustomAnnouncer | null | undefined,
  characterNamesById: ReadonlyMap<string, string>,
): string | null {
  if (!announcer) return null

  if (announcer.kind === 'character') {
    if (!announcer.characterId) return null
    return characterNamesById.get(announcer.characterId)?.trim() || null
  }

  return announcer.displayName?.trim() || null
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
 * Messages without a `customAnnouncer` pass through untouched — Staff
 * announcements carry their identity in their prose already, and participant
 * messages are attributed by the multi-character path. An announcer that can't
 * be named also passes through unchanged.
 *
 * Pure: no repository access, so the name map is the caller's problem and this
 * stays trivially testable.
 */
export function attributeAdhocAnnouncements<T extends AnnouncerAttributable>(
  messages: T[],
  characterNamesById: ReadonlyMap<string, string>,
): T[] {
  return messages.map(m => {
    const name = resolveAnnouncerName(m.customAnnouncer, characterNamesById)
    if (!name) return m

    const body = m.content ?? ''
    // Idempotent: re-running (a retry, a regenerate) must not stack tags.
    if (body.startsWith(`[${name}]`)) return m

    return { ...m, content: `[${name}] ${body}` }
  })
}
