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
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store'
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store'
import { ensureProjectWardrobeFolder, readProjectWardrobe } from '@/lib/mount-index/project-wardrobe'
import { ensureGroupWardrobeFolder, readGroupWardrobe } from '@/lib/mount-index/group-wardrobe'
import { readGeneralWardrobe } from '@/lib/mount-index/general-wardrobe'
import { resolveGroupMountPointIdsForCharacter } from '@/lib/mount-index/tiered-mount-pool'
import {
  createProjectWardrobeItem,
  deleteProjectWardrobeItem,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

type TransferAction = 'move' | 'copy'
type SourceScope = 'character' | 'group' | 'project' | 'general'
type DestinationScope = 'general' | 'project' | 'group' | 'character'
/** What travels with a composite: its same-container components, or nothing. */
type ComponentMode = 'move' | 'copy' | 'none'

interface ResolvedSource {
  scope: SourceScope
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

interface ResolvedDestination {
  scope: DestinationScope
  characterId: string | null
  mountPointId: string | null
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

function locationKey(scope: SourceScope | DestinationScope, id: string | null): string {
  if (scope === 'general') return 'general'
  return `${scope}:${id ?? ''}`
}

async function resolveSourceItem(
  userId: string,
  sourceCharacterId: string,
  sourceProjectId: string | null,
  itemId: string,
  repos: {
    characters: { findById: (id: string) => Promise<{ id: string; userId?: string | null } | null> }
    projects: { findById: (id: string) => Promise<{ id: string; name?: string | null; userId?: string | null } | null> }
    wardrobe: {
      findByCharacterId: (characterId: string, includeArchived?: boolean) => Promise<WardrobeItem[]>
    }
  },
): Promise<ResolvedSource | null> {
  const sourceCharacter = await repos.characters.findById(sourceCharacterId)
  if (!sourceCharacter || sourceCharacter.userId !== userId) {
    return null
  }

  const personalItems = await repos.wardrobe.findByCharacterId(sourceCharacterId, true)
  const personal = personalItems.find((item) => item.id === itemId)
  if (personal) {
    return {
      scope: 'character',
      item: personal,
      characterId: sourceCharacterId,
      mountPointId: null,
      containerItems: personalItems,
    }
  }

  if (sourceProjectId) {
    const project = await repos.projects.findById(sourceProjectId)
    if (project) {
      const ensured = await ensureProjectOfficialStore(project.id, project.name || 'Project')
      if (ensured) {
        await ensureProjectWardrobeFolder(ensured.mountPointId)
        const projectItems = await readProjectWardrobe(ensured.mountPointId, true)
        const projectItem = projectItems.find((item) => item.id === itemId)
        if (projectItem) {
          return {
            scope: 'project',
            item: projectItem,
            characterId: null,
            mountPointId: ensured.mountPointId,
            containerItems: projectItems,
          }
        }
      }
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

  const generalItems = await readGeneralWardrobe(true)
  const general = generalItems.find((item) => item.id === itemId)
  if (general) {
    return {
      scope: 'general',
      item: general,
      characterId: null,
      mountPointId: null,
      containerItems: generalItems,
    }
  }

  return null
}

/**
 * Resolve an item from an explicitly named source container — no probing.
 * Used when the wardrobe dialog is browsing a shared container directly, so
 * the caller already knows exactly where the item lives.
 */
async function resolveExplicitSource(
  userId: string,
  source: { scope: SourceScope; id?: string },
  itemId: string,
  repos: {
    characters: { findById: (id: string) => Promise<{ id: string; userId?: string | null } | null> }
    projects: { findById: (id: string) => Promise<{ id: string; name?: string | null; userId?: string | null } | null> }
    groups: { findById: (id: string) => Promise<{ id: string; name?: string | null; userId?: string | null } | null> }
    wardrobe: {
      findByCharacterId: (characterId: string, includeArchived?: boolean) => Promise<WardrobeItem[]>
    }
  },
): Promise<ResolvedSource | null> {
  if (source.scope === 'general') {
    const generalItems = await readGeneralWardrobe(true)
    const item = generalItems.find((i) => i.id === itemId)
    if (!item) return null
    return { scope: 'general', item, characterId: null, mountPointId: null, containerItems: generalItems }
  }

  if (!source.id) return null

  if (source.scope === 'character') {
    const character = await repos.characters.findById(source.id)
    if (!character || character.userId !== userId) return null
    const personalItems = await repos.wardrobe.findByCharacterId(source.id, true)
    const item = personalItems.find((i) => i.id === itemId)
    if (!item) return null
    return {
      scope: 'character',
      item,
      characterId: source.id,
      mountPointId: null,
      containerItems: personalItems,
    }
  }

  if (source.scope === 'project') {
    const project = await repos.projects.findById(source.id)
    if (!project) return null
    const ensured = await ensureProjectOfficialStore(project.id, project.name || 'Project')
    if (!ensured) return null
    await ensureProjectWardrobeFolder(ensured.mountPointId)
    const projectItems = await readProjectWardrobe(ensured.mountPointId, true)
    const item = projectItems.find((i) => i.id === itemId)
    if (!item) return null
    return {
      scope: 'project',
      item,
      characterId: null,
      mountPointId: ensured.mountPointId,
      containerItems: projectItems,
    }
  }

  const group = await repos.groups.findById(source.id)
  if (!group) return null
  const ensured = await ensureGroupOfficialStore(group.id, group.name || 'Group')
  if (!ensured) return null
  await ensureGroupWardrobeFolder(ensured.mountPointId)
  const groupItems = await readGroupWardrobe(ensured.mountPointId, true)
  const item = groupItems.find((i) => i.id === itemId)
  if (!item) return null
  return {
    scope: 'group',
    item,
    characterId: null,
    mountPointId: ensured.mountPointId,
    containerItems: groupItems,
  }
}

async function resolveDestination(
  userId: string,
  destination: { scope: DestinationScope; id?: string },
  repos: {
    characters: { findById: (id: string) => Promise<{ id: string; userId?: string | null } | null> }
    projects: { findById: (id: string) => Promise<{ id: string; name?: string | null; userId?: string | null } | null> }
    groups: { findById: (id: string) => Promise<{ id: string; name?: string | null; userId?: string | null } | null> }
  },
): Promise<ResolvedDestination | null> {
  if (destination.scope === 'general') {
    return { scope: 'general', characterId: null, mountPointId: null }
  }

  if (!destination.id) {
    return null
  }

  if (destination.scope === 'character') {
    const character = await repos.characters.findById(destination.id)
    if (!character || character.userId !== userId) return null
    return { scope: 'character', characterId: character.id, mountPointId: null }
  }

  if (destination.scope === 'project') {
    const project = await repos.projects.findById(destination.id)
    if (!project) return null
    const ensured = await ensureProjectOfficialStore(project.id, project.name || 'Project')
    if (!ensured) return null
    await ensureProjectWardrobeFolder(ensured.mountPointId)
    return { scope: 'project', characterId: null, mountPointId: ensured.mountPointId }
  }

  const group = await repos.groups.findById(destination.id)
  if (!group) return null
  const ensured = await ensureGroupOfficialStore(group.id, group.name || 'Group')
  if (!ensured) return null
  await ensureGroupWardrobeFolder(ensured.mountPointId)
  return { scope: 'group', characterId: null, mountPointId: ensured.mountPointId }
}

async function readDestinationItems(
  destination: ResolvedDestination,
  repos: {
    wardrobe: {
      findByCharacterId: (characterId: string, includeArchived?: boolean) => Promise<WardrobeItem[]>
    }
  },
): Promise<WardrobeItem[]> {
  if (destination.scope === 'general') {
    return readGeneralWardrobe(true)
  }

  if (destination.scope === 'character') {
    return repos.wardrobe.findByCharacterId(destination.characterId as string, true)
  }

  if (destination.scope === 'group') {
    return readGroupWardrobe(destination.mountPointId as string, true)
  }

  return readProjectWardrobe(destination.mountPointId as string, true)
}

async function createAtDestination(
  destination: ResolvedDestination,
  item: WardrobeItem,
  repos: {
    wardrobe: {
      create: (
        data: Omit<WardrobeItem, 'id' | 'createdAt' | 'updatedAt'>,
        options?: { id?: string; createdAt?: string; updatedAt?: string },
      ) => Promise<WardrobeItem>
    }
  },
): Promise<WardrobeItem> {
  if (destination.scope === 'general' || destination.scope === 'character') {
    const created = await repos.wardrobe.create(
      {
        characterId: destination.scope === 'character' ? destination.characterId : null,
        title: item.title,
        description: item.description ?? null,
        imagePrompt: item.imagePrompt ?? null,
        types: item.types,
        componentItemIds: item.componentItemIds,
        appropriateness: item.appropriateness ?? null,
        isDefault: item.isDefault,
        replace: item.replace,
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
  repos: {
    wardrobe: { delete: (id: string, ownerCharacterId?: string | null) => Promise<boolean> }
  },
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
    const [allProjects, allGroups, characters] = await Promise.all([
      repos.projects.findAll(),
      repos.groups.findAll(),
      repos.characters.findByUserId(user.id),
    ])

    const projects = allProjects
    const groups = allGroups

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

    const destination = await resolveDestination(user.id, body.destination, repos)
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
    const destinationItems = await readDestinationItems(destination, repos)
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
    const afterItems = await readDestinationItems(destination, repos)
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
