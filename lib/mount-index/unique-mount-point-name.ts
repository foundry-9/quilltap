/**
 * Mount-point name uniquification — pure string logic, client-safe.
 *
 * Single source of truth for the "append ` (2)`, ` (3)`, … until unique"
 * naming policy used when provisioning document stores. Shared by:
 *   - runtime auto-creation (`ensure-project-store.ts`, `ensure-group-store.ts`,
 *     via `ensure-official-store.ts`);
 *   - the one-time cutover migration (`cutover-projects-to-store.ts`);
 *   - the legacy file-conversion migration
 *     (`convert-project-files-to-document-stores.ts`).
 *
 * Keeping the policy here guarantees runtime and migrations agree on naming.
 * This module imports nothing node-only, so it stays importable from any
 * context (the callers supply the set of taken names from their own DB access).
 *
 * @module mount-index/unique-mount-point-name
 */

/**
 * Returns `desired` if it is absent from `takenNames`, otherwise the first of
 * `desired (2)`, `desired (3)`, … that is absent.
 *
 * Matching is case-insensitive (trimmed): mount-point names form one
 * namespace regardless of casing, so `lore` counts as taken when `Lore`
 * exists. Callers pass names in their stored casing; folding happens here.
 *
 * Numbering starts at `(2)` (there is no `(1)`); the suffix is ` (N)` with a
 * single leading space and parentheses around the number.
 *
 * @param takenNames Set of mount-point names already in use.
 * @param desired    The preferred name.
 */
export function nextUniqueMountPointName(takenNames: Set<string>, desired: string): string {
  const takenLower = new Set<string>();
  for (const name of takenNames) takenLower.add(name.trim().toLowerCase());
  if (!takenLower.has(desired.trim().toLowerCase())) return desired;
  let suffix = 2;
  while (takenLower.has(`${desired} (${suffix})`.trim().toLowerCase())) suffix++;
  return `${desired} (${suffix})`;
}
