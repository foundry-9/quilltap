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

/** Collection endpoint for a container (list with GET, create with POST). */
export function wardrobeCollectionUrl(container: WardrobeContainer): string {
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

/** Item endpoint for a container (GET / PUT / DELETE one item). */
export function wardrobeItemUrl(container: WardrobeContainer, itemId: string): string {
  return `${wardrobeCollectionUrl(container)}/${itemId}`
}
