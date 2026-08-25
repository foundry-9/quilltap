/**
 * Wardrobe transfer API.
 *
 * GET  /api/v1/wardrobe/transfers
 *   Returns destination options for moving/copying wardrobe items.
 *
 * POST /api/v1/wardrobe/transfers
 *   Moves or copies one wardrobe item between wardrobe tiers.
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

interface ResolvedSource {
  scope: SourceScope
  item: WardrobeItem
  characterId: string | null
  mountPointId: string | null
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
  })
  .refine((body) => Boolean(body.sourceCharacterId || body.source), {
    message: 'Either sourceCharacterId or source is required',
  })

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
    return { scope: 'general', item, characterId: null, mountPointId: null }
  }

  if (!source.id) return null

  if (source.scope === 'character') {
    const character = await repos.characters.findById(source.id)
    if (!character || character.userId !== userId) return null
    const personalItems = await repos.wardrobe.findByCharacterId(source.id, true)
    const item = personalItems.find((i) => i.id === itemId)
    if (!item) return null
    return { scope: 'character', item, characterId: source.id, mountPointId: null }
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
    return { scope: 'project', item, characterId: null, mountPointId: ensured.mountPointId }
  }

  const group = await repos.groups.findById(source.id)
  if (!group) return null
  const ensured = await ensureGroupOfficialStore(group.id, group.name || 'Group')
  if (!ensured) return null
  await ensureGroupWardrobeFolder(ensured.mountPointId)
  const groupItems = await readGroupWardrobe(ensured.mountPointId, true)
  const item = groupItems.find((i) => i.id === itemId)
  if (!item) return null
  return { scope: 'group', item, characterId: null, mountPointId: ensured.mountPointId }
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
  repos: {
    wardrobe: { delete: (id: string, ownerCharacterId?: string | null) => Promise<boolean> }
  },
): Promise<boolean> {
  // Project and group items both live in a mount's `Wardrobe/` folder rather
  // than a character vault, so both delete by mount point.
  if (source.scope === 'project' || source.scope === 'group') {
    return deleteProjectWardrobeItem(source.mountPointId as string, source.item.id)
  }
  return repos.wardrobe.delete(source.item.id, source.characterId)
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
    const now = new Date().toISOString()
    const nextId = action === 'copy' ? randomUUID() : source.item.id
    const nextItem: WardrobeItem = {
      ...source.item,
      id: nextId,
      characterId: destination.scope === 'character' ? destination.characterId : null,
      createdAt: action === 'copy' ? now : source.item.createdAt,
      updatedAt: action === 'copy' ? now : source.item.updatedAt,
    }

    const destinationItems = await readDestinationItems(destination, repos)
    if (destinationItems.some((item) => item.id === nextItem.id)) {
      return badRequest('An item with that ID already exists at the destination')
    }

    const stored = await createAtDestination(destination, nextItem, repos)

    if (action === 'move') {
      const removed = await deleteFromSource(source, repos)
      if (!removed) {
        return serverError('Failed to remove item from source after move')
      }
    }

    logger.info('[WardrobeTransfers v1] Wardrobe item transferred', {
      userId: user.id,
      action,
      itemId: source.item.id,
      resultItemId: stored.id,
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
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues.map((issue) => issue.message).join('; '))
    }
    logger.error('[WardrobeTransfers v1] Failed to transfer item', {}, error instanceof Error ? error : undefined)
    return serverError('Failed to transfer wardrobe item')
  }
})
