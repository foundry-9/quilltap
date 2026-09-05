/**
 * Wardrobe transfer API.
 *
 * GET  /api/v1/wardrobe/transfers
 *   Returns destination options for moving/copying wardrobe items.
 *
 * POST /api/v1/wardrobe/transfers
 *   Moves or copies one wardrobe item between wardrobe tiers. For a composite
 *   (outfit), the optional `components` field brings its same-container
 *   components along — all or nothing — with the outfit's `componentItemIds`
 *   rewritten to the components' destination ids when copies mint fresh ones.
 */

import { randomUUID } from 'crypto'
import { z } from 'zod'
import { createContextHandler } from '@/lib/api/middleware'
import { successResponse, badRequest, notFound, serverError } from '@/lib/api/responses'
import { logger } from '@/lib/logger'
import { readGroupWardrobe } from '@/lib/mount-index/group-wardrobe'
import { resolveGroupMountPointIdsForCharacter } from '@/lib/mount-index/tiered-mount-pool'
import {
  createProjectWardrobeItem,
  deleteProjectWardrobeItem,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { wardrobeItemFromCreateBody } from '@/lib/wardrobe/create-body'
import { resolveWardrobeContainer } from '@/lib/wardrobe/resolve-container'
import type { ResolvedWardrobeContainer } from '@/lib/wardrobe/resolve-container'
import type { WardrobeContainerScope } from '@/lib/wardrobe/wardrobe-container'

type TransferAction = 'move' | 'copy'
/** What travels with a composite: its same-container components, or nothing. */
type ComponentMode = 'move' | 'copy' | 'none'

interface ResolvedSource {
  scope: WardrobeContainerScope
  item: WardrobeItem
  characterId: string | null
  mountPointId: string | null
  /**
   * Every item in the source container (the same list the item was found in).
   * Used to gather a composite's same-container components so they can travel
   * with it — components living in *other* tiers stay put.
   */
  containerItems: WardrobeItem[]
}

const transferRequestSchema = z
  .object({
    action: z.enum(['move', 'copy']),
    itemId: z.string().min(1),
    /**
     * Character-view source hint: the item is probed across the character's
     * reachable tiers (vault → project → groups → General). Kept for the
     * dialog's character view, where a merged item's home tier isn't known.
     */
    sourceCharacterId: z.string().min(1).optional(),
    sourceProjectId: z.string().nullable().optional(),
    /**
     * Explicit source container. Used when the dialog is browsing a shared
     * container directly (General / a project / a group), where there is no
     * selected character to probe from and the home tier is already known.
     */
    source: z
      .object({
        scope: z.enum(['character', 'project', 'group', 'general']),
        id: z.string().optional(),
      })
      .optional(),
    destination: z.object({
      scope: z.enum(['general', 'project', 'group', 'character']),
      id: z.string().optional(),
    }),
    /**
     * For a composite (outfit): what to do with the components that live in
     * the same source container. `move` relocates them (ids kept), `copy`
     * duplicates them at the destination (fresh ids; the transferred outfit's
     * `componentItemIds` are rewritten to match), `none`/omitted transfers the
     * outfit alone. All-or-nothing — no per-component picking. A `copy`
     * action refuses `components: 'move'` (it would strand the original).
     */
    components: z.enum(['move', 'copy', 'none']).optional(),
  })
  .refine((body) => Boolean(body.sourceCharacterId || body.source), {
    message: 'Either sourceCharacterId or source is required',
  })
  .refine((body) => !(body.action === 'copy' && body.components === 'move'), {
    message: 'Copying an outfit cannot move its components — the original outfit still needs them',
  })

/**
 * The transitive closure of a composite's components that live in the same
 * source container. Components from other tiers (e.g. a General archetype
 * bundled into a character outfit) are excluded — they are already shared and
 * stay where they are. Cycles are tolerated via the visited set (the write
 * layer refuses to store them, but old data gets no infinite loop here).
 */
function collectContainerComponents(
  outfit: WardrobeItem,
  containerItems: readonly WardrobeItem[],
): WardrobeItem[] {
  const byId = new Map(containerItems.map((i) => [i.id, i]))
  const visited = new Set<string>([outfit.id])
  const result: WardrobeItem[] = []
  const queue = [...outfit.componentItemIds]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (visited.has(id)) continue
    visited.add(id)
    const item = byId.get(id)
    if (!item) continue
    result.push(item)
    queue.push(...item.componentItemIds)
  }
  return result
}

function locationKey(scope: WardrobeContainerScope, id: string | null): string {
  if (scope === 'general') return 'general'
  return `${scope}:${id ?? ''}`
}

/**
 * Look `itemId` up in a resolved container. The hit carries the container's
 * whole item list so a composite's same-container components can be gathered.
 */
async function findInContainer(
  container: ResolvedWardrobeContainer,
  itemId: string,
): Promise<ResolvedSource | null> {
  const containerItems = await container.readItems()
  const item = containerItems.find((i) => i.id === itemId)
  if (!item) return null
  return {
    scope: container.scope,
    item,
    characterId: container.characterId,
    mountPointId: container.mountPointId,
    containerItems,
  }
}

async function resolveSourceItem(
  userId: string,
  sourceCharacterId: string,
  sourceProjectId: string | null,
  itemId: string,
  repos: RepositoryContainer,
): Promise<ResolvedSource | null> {
  const personal = await resolveWardrobeContainer('character', sourceCharacterId, repos, userId)
  if (!personal) return null
  const own = await findInContainer(personal, itemId)
  if (own) return own

  if (sourceProjectId) {
    const project = await resolveWardrobeContainer('project', sourceProjectId, repos, userId)
    if (project) {
      const projectItem = await findInContainer(project, itemId)
      if (projectItem) return projectItem
    }
  }

  // The group tier: every store of every group this character belongs to. The
  // source character is the one wearing the item, so their memberships are the
  // right scope — matching how the wearable pool resolves the tier.
  const groupMountPointIds = await resolveGroupMountPointIdsForCharacter(sourceCharacterId)
  for (const mountPointId of groupMountPointIds) {
    const groupItems = await readGroupWardrobe(mountPointId, true)
    const groupItem = groupItems.find((item) => item.id === itemId)
    if (groupItem) {
      return {
        scope: 'group',
        item: groupItem,
        characterId: null,
        mountPointId,
        containerItems: groupItems,
      }
    }
  }

  const general = await resolveWardrobeContainer('general', null, repos, userId)
  return general ? findInContainer(general, itemId) : null
}

/**
 * Resolve an item from an explicitly named source container — no probing.
 * Used when the wardrobe dialog is browsing a shared container directly, so
 * the caller already knows exactly where the item lives.
 */
async function resolveExplicitSource(
  userId: string,
  source: { scope: WardrobeContainerScope; id?: string },
  itemId: string,
  repos: RepositoryContainer,
): Promise<ResolvedSource | null> {
  const container = await resolveWardrobeContainer(source.scope, source.id, repos, userId)
  return container ? findInContainer(container, itemId) : null
}

async function createAtDestination(
  destination: ResolvedWardrobeContainer,
  item: WardrobeItem,
  repos: RepositoryContainer,
): Promise<WardrobeItem> {
  if (destination.scope === 'general' || destination.scope === 'character') {
    // A transferred item keeps its provenance and archived state, which a
    // fresh create never carries.
    const created = await repos.wardrobe.create(
      {
        ...wardrobeItemFromCreateBody(item, destination.characterId),
        migratedFromClothingRecordId: item.migratedFromClothingRecordId ?? null,
        archivedAt: item.archivedAt ?? null,
      },
      {
        id: item.id,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    )
    return created
  }

  return createProjectWardrobeItem(destination.mountPointId as string, item)
}

async function deleteFromSource(
  source: ResolvedSource,
  itemId: string,
  repos: RepositoryContainer,
): Promise<boolean> {
  // Project and group items both live in a mount's `Wardrobe/` folder rather
  // than a character vault, so both delete by mount point.
  if (source.scope === 'project' || source.scope === 'group') {
    return deleteProjectWardrobeItem(source.mountPointId as string, itemId)
  }
  return repos.wardrobe.delete(itemId, source.characterId)
}

export const GET = createContextHandler(async (_req, { user, repos }) => {
  try {
    const [projects, groups, characters] = await Promise.all([
      repos.projects.findAll(),
      repos.groups.findAll(),
      repos.characters.findByUserId(user.id),
    ])

    return successResponse({
      destinations: {
        general: { available: true, label: 'Quilltap General' },
        projects: projects
          .map((project) => ({ id: project.id, name: project.name || 'Untitled project' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        groups: groups
          .map((group) => ({ id: group.id, name: group.name || 'Untitled group' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        users: characters
          .map((character) => ({ id: character.id, name: character.name || 'Unnamed user' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    })
  } catch (error) {
    logger.error('[WardrobeTransfers v1] Failed to list destinations', {
      userId: user.id,
    }, error instanceof Error ? error : undefined)
    return serverError('Failed to load transfer destinations')
  }
})

export const POST = createContextHandler(async (req, { user, repos }) => {
  try {
    const body = transferRequestSchema.parse(await req.json())

    const source = body.source
      ? await resolveExplicitSource(user.id, body.source, body.itemId, repos)
      : await resolveSourceItem(
          user.id,
          body.sourceCharacterId as string,
          body.sourceProjectId ?? null,
          body.itemId,
          repos,
        )
    if (!source) {
      return notFound('Wardrobe item')
    }

    const destination = await resolveWardrobeContainer(
      body.destination.scope,
      body.destination.id,
      repos,
      user.id,
    )
    if (!destination) {
      return badRequest('Invalid destination')
    }

    const sourceId = source.scope === 'character' ? source.characterId : source.mountPointId
    const destinationId =
      destination.scope === 'character' ? destination.characterId : destination.mountPointId
    if (locationKey(source.scope, sourceId) === locationKey(destination.scope, destinationId)) {
      return badRequest('Source and destination are the same')
    }

    const action = body.action as TransferAction
    const componentMode: ComponentMode = body.components ?? 'none'
    const now = new Date().toISOString()
    const destinationCharacterId =
      destination.scope === 'character' ? destination.characterId : null

    // The components travelling along: the transitive closure of the outfit's
    // components that live in the same source container. All-or-nothing.
    const travellingComponents =
      componentMode === 'none'
        ? []
        : collectContainerComponents(source.item, source.containerItems)

    // Plan every write up front so id remapping is consistent across the
    // whole set. Moves keep ids; copies mint fresh ones — and every
    // `componentItemIds` reference to a travelling component is rewritten to
    // that component's destination id, so the outfit still points at the very
    // pieces that made the journey with it.
    const idMap = new Map<string, string>()
    for (const component of travellingComponents) {
      idMap.set(component.id, componentMode === 'copy' ? randomUUID() : component.id)
    }
    const remapComponentIds = (ids: readonly string[]): string[] =>
      ids.map((id) => idMap.get(id) ?? id)

    const plannedComponents: WardrobeItem[] = travellingComponents.map((component) => ({
      ...component,
      id: idMap.get(component.id) as string,
      characterId: destinationCharacterId,
      componentItemIds: remapComponentIds(component.componentItemIds),
      createdAt: componentMode === 'copy' ? now : component.createdAt,
      updatedAt: componentMode === 'copy' ? now : component.updatedAt,
    }))

    const nextItem: WardrobeItem = {
      ...source.item,
      id: action === 'copy' ? randomUUID() : source.item.id,
      characterId: destinationCharacterId,
      componentItemIds: remapComponentIds(source.item.componentItemIds),
      createdAt: action === 'copy' ? now : source.item.createdAt,
      updatedAt: action === 'copy' ? now : source.item.updatedAt,
    }

    // Refuse the whole transfer before writing anything if any planned id is
    // already taken at the destination — all-or-nothing means no half-landed
    // outfits.
    const destinationItems = await destination.readItems()
    const destinationIds = new Set(destinationItems.map((item) => item.id))
    for (const planned of [nextItem, ...plannedComponents]) {
      if (destinationIds.has(planned.id)) {
        return badRequest(
          `An item with the ID of "${planned.title}" already exists at the destination`,
        )
      }
    }

    // Components land first so the outfit's references resolve the moment it
    // arrives; the write layer tolerates missing components, but there is no
    // reason to create that window.
    for (const planned of plannedComponents) {
      await createAtDestination(destination, planned, repos)
    }
    const stored = await createAtDestination(destination, nextItem, repos)

    if (action === 'move') {
      // `components: 'copy'` leaves the originals at the source (they were
      // duplicated, not relocated); only `'move'` removes them.
      if (componentMode === 'move') {
        for (const component of travellingComponents) {
          const removed = await deleteFromSource(source, component.id, repos)
          if (!removed) {
            return serverError('Failed to remove a component from source after move')
          }
        }
      }
      const removed = await deleteFromSource(source, source.item.id, repos)
      if (!removed) {
        return serverError('Failed to remove item from source after move')
      }
    }

    // Post-write verification: read the outfit BACK from the destination and
    // check that its component references survived the storage round-trip
    // exactly as planned — the vault serializes references as title slugs, so
    // a subtle resolution bug shows up here, not in the pre-projection value
    // `createAtDestination` returned. Anything planned-but-absent from the
    // read-back list is reported.
    const afterItems = await destination.readItems()
    const afterOutfit = afterItems.find((item) => item.id === stored.id)
    const readBackIds = new Set(afterOutfit?.componentItemIds ?? [])
    const unresolvedComponentIds = nextItem.componentItemIds.filter(
      (id) => !readBackIds.has(id),
    )
    if (!afterOutfit || unresolvedComponentIds.length > 0) {
      logger.error('[WardrobeTransfers v1] Transferred outfit did not read back with its planned component references', {
        userId: user.id,
        outfitId: stored.id,
        outfitFoundAtDestination: Boolean(afterOutfit),
        plannedComponentIds: nextItem.componentItemIds,
        readBackComponentIds: afterOutfit?.componentItemIds ?? [],
        unresolvedComponentIds,
        destinationScope: destination.scope,
        destinationMountPointId: destination.mountPointId,
      })
    }

    logger.info('[WardrobeTransfers v1] Wardrobe item transferred', {
      userId: user.id,
      action,
      componentMode,
      itemId: source.item.id,
      resultItemId: stored.id,
      componentsTransferred: plannedComponents.length,
      sourceScope: source.scope,
      destinationScope: destination.scope,
      sourceCharacterId: source.characterId,
      destinationCharacterId: destination.characterId,
      sourceMountPointId: source.mountPointId,
      destinationMountPointId: destination.mountPointId,
    })

    return successResponse({
      wardrobeItem: stored,
      action,
      componentsTransferred: plannedComponents.length,
      ...(unresolvedComponentIds.length > 0 ? { unresolvedComponentIds } : {}),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues.map((issue) => issue.message).join('; '))
    }
    logger.error('[WardrobeTransfers v1] Failed to transfer item', {}, error instanceof Error ? error : undefined)
    return serverError('Failed to transfer wardrobe item')
  }
})
