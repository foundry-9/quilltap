/**
 * How a Staff member is named in prose.
 *
 * The single source of truth for the display name behind a `systemSender`.
 * Every surface that spells one out reads it here: the Salon's announcement
 * chip, the Markdown transcript export, and anything that comes after. Two
 * copies of this table drift the moment a member is added — and adding one
 * already means touching the `systemSender` enum in `lib/schemas/chat.types.ts`,
 * the `chat_messages` column, `getMessageAvatar`, and the export schema, so it
 * has no business also being a hunt for scattered name maps.
 *
 * A Carina answer is the exception the table cannot express: it renders under
 * the ANSWERER character's own name (and avatar), and falls back to 'Carina'
 * only when that character cannot be resolved. Callers handle that before
 * reaching for this map.
 *
 * CLIENT-SAFE: a plain literal, no imports beyond the sender type.
 */

import type { SystemSender } from '@/lib/schemas/chat.types'

export const STAFF_DISPLAY_NAMES: Record<SystemSender, string> = {
  lantern: 'The Lantern',
  aurora: 'Aurora',
  librarian: 'The Librarian',
  concierge: 'The Concierge',
  prospero: 'Prospero',
  host: 'The Host',
  commonplaceBook: 'The Commonplace Book',
  ariel: 'Ariel',
  carina: 'Carina',
  suparna: 'Suparṇā',
  pascal: 'Pascal',
}

/**
 * The display name for a `systemSender`, or `''` when there is none (an
 * ordinary participant message). An unrecognised sender — a row written by a
 * newer build — falls back to the raw tag rather than vanishing.
 */
export function staffDisplayName(sender: string | null | undefined): string {
  if (!sender) return ''
  return STAFF_DISPLAY_NAMES[sender as SystemSender] ?? sender
}

/**
 * Where each Staff member's face lives: `public/images/avatars/<x>-avatar.webp`,
 * referenced by its public path. `null` for Carina, whose answers render with
 * the ANSWERER character's own avatar — there is no Carina staff avatar.
 */
export const STAFF_AVATARS: Record<SystemSender, string | null> = {
  lantern: '/images/avatars/lantern-avatar.webp',
  aurora: '/images/avatars/aurora-avatar.webp',
  librarian: '/images/avatars/librarian-avatar.webp',
  concierge: '/images/avatars/concierge-avatar.webp',
  prospero: '/images/avatars/prospero-avatar.webp',
  host: '/images/avatars/host-avatar.webp',
  commonplaceBook: '/images/avatars/commonplace-book-avatar.webp',
  ariel: '/images/avatars/ariel-avatar.webp',
  carina: null,
  suparna: '/images/avatars/suparna-avatar.webp',
  pascal: '/images/avatars/pascal-avatar.webp',
}

/** The epithet shown under a Staff member's name, where one has it. */
export const STAFF_TITLES: Partial<Record<SystemSender, string>> = {
  pascal: 'the Croupier',
}

/** What the Salon's message bubble shows for a Staff-authored message. */
export interface StaffAvatarCard {
  name: string
  title: string | null
  avatarUrl: string
}

/**
 * The name, epithet and avatar path for a `systemSender`, or `null` when the
 * bubble should be resolved some other way: an unrecognised sender (a row from
 * a newer build) falls through to the ordinary participant lookup, and Carina
 * is the caller's special case (the answerer's own face).
 */
export function staffAvatar(sender: string | null | undefined): StaffAvatarCard | null {
  if (!sender) return null
  const avatarUrl = STAFF_AVATARS[sender as SystemSender]
  if (!avatarUrl) return null
  return {
    name: STAFF_DISPLAY_NAMES[sender as SystemSender],
    title: STAFF_TITLES[sender as SystemSender] ?? null,
    avatarUrl,
  }
}
