/**
 * Help Document Slugs
 *
 * The database primary key for a help doc is a UUID that changes whenever the
 * doc is re-created, so the slug derived from its file path is the identifier
 * everything outside the database uses: the Guide's category lists
 * (`lib/help-guide/categories.ts`), `Related Pages` links between docs, and the
 * help-docs API.
 */

/**
 * Derive a help document's stable slug from its file path.
 *
 * `help/character-creation.md` -> `character-creation`
 */
export function helpDocSlug(relPath: string): string {
  return relPath
    .replace(/^help\//, '')
    .replace(/\.md$/, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .toLowerCase()
}
