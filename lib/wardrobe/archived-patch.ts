/**
 * The one place `archived: boolean` (what the API accepts) is turned into
 * `archivedAt: string | null` (what a wardrobe item stores).
 *
 * All four item endpoints — character, general, project, group — take the
 * boolean and route it through here so the semantics can't drift:
 *
 *   - archiving is **idempotent**: re-archiving an already-archived item keeps
 *     its original `archivedAt` rather than resetting the clock;
 *   - restoring clears the stamp outright.
 *
 * Returns `null` when the item is already in the requested state, so callers
 * can skip a pointless vault rewrite.
 *
 * @module lib/wardrobe/archived-patch
 */

export function archivedPatch(
  currentArchivedAt: string | null | undefined,
  archived: boolean,
  now: string,
): { archivedAt: string | null } | null {
  const isArchived = Boolean(currentArchivedAt);
  if (isArchived === archived) return null;
  return { archivedAt: archived ? now : null };
}
