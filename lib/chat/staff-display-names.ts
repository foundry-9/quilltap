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
