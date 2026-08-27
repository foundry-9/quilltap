/**
 * Seeding the connection-profile columns an *older* archive cannot carry.
 *
 * Backup/restore and `.qtap` import are both schema-driven: an entity is
 * re-inserted by spreading whatever the archive held, so a column added to the
 * Zod schema rides along for free. That is only true for a column the archive
 * actually *has*. A key absent from the archive is absent from the INSERT, and
 * SQLite then applies the table DEFAULT — which is the right answer for a
 * brand-new row and the wrong one for a profile whose owner made a choice
 * before the column existed.
 *
 * Two columns on `connection_profiles` are in that position, both of them
 * decided by a migration on the upgrade path and by nothing at all on the
 * restore/import path:
 *
 * - **`supportsImageUpload`** (4.3+) — `DEFAULT 0`. Restoring a pre-4.3 archive
 *   stripped image upload from every profile that had it. Seeded here from the
 *   historic per-provider capability map, which is what
 *   `add-profile-supports-image-upload-field-v1` did to the same rows in place.
 * - **`multiCharacterPrefill`** (4.9+) — `DEFAULT 1`. Restoring a pre-4.9
 *   archive turned the `[Name]` assistant prefill ON, including for Anthropic
 *   profiles, where 4.6+ rejects an assistant tail outright and every
 *   multi-character turn then fails. Seeded here as an explicit `null` — the
 *   documented "never chosen" state — so `profileUsesNamePrefill()` resolves
 *   the provider default instead of a table default nobody picked.
 *
 * Both restore and import call this, so the two paths cannot drift: a `.qtap`
 * bundle and a backup ZIP carrying the same profile land the same row.
 *
 * @module lib/llm/connection-profile-legacy-fields
 */

import type { ConnectionProfile } from '@/lib/schemas/types';

/**
 * The providers whose models could accept an image before the flag became
 * per-profile. Frozen historic data, not a live capability map — a provider
 * that gains vision today gets it from the profile editor, never from here.
 *
 * Matched case-insensitively. `ProviderEnum` is `z.string().min(1)` — a
 * plugin-supplied id, not a closed enum — so nothing guarantees the stored
 * casing, least of all in an archive old enough to be missing the column.
 * `defaultMultiCharacterPrefill()` normalises for the same reason.
 */
const LEGACY_IMAGE_CAPABLE_PROVIDERS = new Set(['OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK']);

/**
 * Fill in the columns an archive older than them could not have carried.
 *
 * Returns a copy: a key the archive *did* carry is never touched, including a
 * stored `false` and a stored `null`.
 */
export function seedLegacyConnectionProfileFields<T extends Partial<ConnectionProfile>>(
  profile: T
): T {
  const seeded = { ...profile };

  if (seeded.supportsImageUpload === undefined) {
    seeded.supportsImageUpload = LEGACY_IMAGE_CAPABLE_PROVIDERS.has(
      (seeded.provider ?? '').toUpperCase()
    );
  }

  // Absent is NOT the same as unset here: the column is a tri-state, and only
  // an explicit null reads back as "never chosen".
  if (seeded.multiCharacterPrefill === undefined) {
    seeded.multiCharacterPrefill = null;
  }

  return seeded;
}
