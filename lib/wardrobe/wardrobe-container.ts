/**
 * Wardrobe containers — the four places a wardrobe item or outfit can live.
 *
 * A *container* is a browsable wardrobe location: a character's personal vault,
 * the singleton Quilltap General library, a project's document store, or a
 * group's document store. The wardrobe dialog's top selector picks one, and
 * every scoped mutation (create / edit / duplicate / star / delete) routes to
 * the container's own API endpoints via the URL helpers below.
 *
 * Client-safe: no server-only imports. Shared by the dialog, the item editor,
 * and the transfer dialog so the scope encoding can't drift between them.
 *
 * @module lib/wardrobe/wardrobe-container
 */

export type WardrobeContainerScope = 'character' | 'general' | 'project' | 'group'

export interface WardrobeContainer {
  scope: WardrobeContainerScope
  /** Owning entity id — null only for the singleton `general` scope. */
  id: string | null
}

export const GENERAL_CONTAINER: WardrobeContainer = { scope: 'general', id: null }

/** Serialize a container for use as a `<select>` option value (`scope:id`). */
export function encodeWardrobeContainer(container: WardrobeContainer): string {
  return `${container.scope}:${container.id ?? ''}`
}

/** Parse a `<select>` option value back into a container, or null if mangled. */
export function decodeWardrobeContainer(value: string): WardrobeContainer | null {
  const [scopeRaw, idRaw] = value.split(':', 2)
  if (
    scopeRaw !== 'character' &&
    scopeRaw !== 'general' &&
    scopeRaw !== 'project' &&
    scopeRaw !== 'group'
  ) {
    return null
  }
  const id = idRaw && idRaw.length > 0 ? idRaw : null
  if (scopeRaw !== 'general' && !id) return null
  return { scope: scopeRaw, id }
}

/** True when two containers name the same place. */
export function sameWardrobeContainer(
  a: WardrobeContainer | null | undefined,
  b: WardrobeContainer | null | undefined,
): boolean {
  if (!a || !b) return false
  return a.scope === b.scope && (a.id ?? null) === (b.id ?? null)
}

/**
 * Collection endpoint for a container (list with GET, create with POST).
 *
 * `opts.includeArchived` appends the opt-in every wardrobe list endpoint
 * honours. Building it here — the one place these URLs are spelled — is what
 * keeps the param from drifting, and means a caller that simply doesn't ask
 * gets the archived-free list by construction.
 */
export function wardrobeCollectionUrl(
  container: WardrobeContainer,
  opts?: { includeArchived?: boolean },
): string {
  return withWardrobeArchivedParam(baseCollectionUrl(container), opts?.includeArchived === true)
}

function baseCollectionUrl(container: WardrobeContainer): string {
  switch (container.scope) {
    case 'character':
      return `/api/v1/characters/${container.id}/wardrobe`
    case 'project':
      return `/api/v1/projects/${container.id}/wardrobe`
    case 'group':
      return `/api/v1/groups/${container.id}/wardrobe`
    case 'general':
      return '/api/v1/wardrobe'
  }
}

/** Append `?includeArchived=true` to any wardrobe URL, query string or not. */
export function withWardrobeArchivedParam(url: string, includeArchived: boolean): string {
  if (!includeArchived) return url
  return `${url}${url.includes('?') ? '&' : '?'}includeArchived=true`
}

/** Item endpoint for a container (GET / PUT / DELETE one item). */
export function wardrobeItemUrl(container: WardrobeContainer, itemId: string): string {
  return `${baseCollectionUrl(container)}/${itemId}`
}
