/**
 * Mount-scoped wardrobe route factory.
 *
 * The group and project wardrobe endpoints
 * (`/api/v1/{groups,projects}/[id]/wardrobe` and `.../wardrobe/[itemId]`) are
 * identical modulo the owning tier: its labels, its store resolver
 * (`ensureGroupOfficialStore` / `ensureProjectOfficialStore`), its read
 * function, and its log lines. Group and project items share the same
 * mount-folder storage, so both tiers already call the same writers
 * (`createProjectWardrobeItem` / `updateProjectWardrobeItem` /
 * `deleteProjectWardrobeItem`). This factory owns the handler bodies once —
 * including the `?action=instructions` pair, built on the shared helpers in
 * `lib/wardrobe/wardrobe-instructions.ts` — and each route file supplies a
 * small config.
 *
 * Behaviour contract: every status code, response body, error string and log
 * message is preserved byte-for-byte from the four original route files. The
 * one asymmetry the originals had — the group collection GET's extra
 * "Listed ... wardrobe items" debug line — is carried by the optional
 * `logListedItems` config hook.
 *
 * @module mount-index/mount-wardrobe-route-factory
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createContextParamsHandler, withActionDispatch } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, created, successResponse } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import {
  createProjectWardrobeItem,
  updateProjectWardrobeItem,
  deleteProjectWardrobeItem,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { createWardrobeSchema, updateWardrobeSchema } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { archivedPatch } from '@/lib/wardrobe/archived-patch';
import {
  parseWardrobeInstructionsBody,
  handleReadWardrobeInstructions,
  handleWriteWardrobeInstructions,
} from '@/lib/wardrobe/wardrobe-instructions-handlers';

export interface MountWardrobeRouteConfig {
  /** Capitalised owner label — `'Group'` / `'Project'`. Feeds `notFound(...)`
   *  bodies and, lower-cased, the error strings and log messages. */
  ownerLabel: 'Group' | 'Project';
  /** Log-message prefix — `'[Groups v1]'` / `'[Projects v1]'`. */
  logTag: string;
  /** Metadata key naming the owner id in log lines — `'groupId'` / `'projectId'`. */
  logIdKey: string;
  /** Repo lookup for the owning row (id + name feed the store resolver). */
  findOwner: (
    repos: RequestContext['repos'],
    id: string,
  ) => Promise<{ id: string; name: string } | null>;
  /** `ensureGroupOfficialStore` / `ensureProjectOfficialStore`. */
  ensureOfficialStore: (
    ownerId: string,
    ownerName: string,
  ) => Promise<{ mountPointId: string } | null>;
  /** `readGroupWardrobe` / `readProjectWardrobe`. */
  readWardrobe: (mountPointId: string, includeArchived: boolean) => Promise<WardrobeItem[]>;
}

export interface MountWardrobeCollectionConfig extends MountWardrobeRouteConfig {
  /** `ensureGroupWardrobeFolder` / `ensureProjectWardrobeFolder` — collection
   *  routes ensure the folder before touching it; item routes never do. */
  ensureWardrobeFolder: (mountPointId: string) => Promise<unknown>;
  /** Optional post-list debug hook — the group tier logs a "Listed ..." line
   *  the project tier never had; omit to keep that asymmetry. */
  logListedItems?: (info: { ownerId: string; mountPointId: string; count: number }) => void;
}

export interface MountWardrobeCollectionHandlers {
  GET: ReturnType<typeof createContextParamsHandler<{ id: string }>>;
  POST: ReturnType<typeof createContextParamsHandler<{ id: string }>>;
}

export interface MountWardrobeItemHandlers {
  GET: ReturnType<typeof createContextParamsHandler<{ id: string; itemId: string }>>;
  PUT: ReturnType<typeof createContextParamsHandler<{ id: string; itemId: string }>>;
  DELETE: ReturnType<typeof createContextParamsHandler<{ id: string; itemId: string }>>;
}

// ============================================================================
// Collection — GET (list) / POST (create), each with ?action=instructions
// ============================================================================

/**
 * Build the collection handlers for one tier's `/wardrobe` endpoint,
 * `?action=instructions` included.
 */
export function createMountWardrobeHandlers(
  config: MountWardrobeCollectionConfig,
): MountWardrobeCollectionHandlers {
  const {
    ownerLabel,
    logTag,
    logIdKey,
    findOwner,
    ensureOfficialStore,
    readWardrobe,
    ensureWardrobeFolder,
    logListedItems,
  } = config;
  const owner = ownerLabel.toLowerCase();

  // GET /api/v1/<owner>s/[id]/wardrobe?action=instructions
  async function handleGetInstructions(
    _req: NextRequest,
    { repos }: RequestContext,
    { id }: { id: string },
  ): Promise<NextResponse> {
    const row = await findOwner(repos, id);
    if (!row) return notFound(ownerLabel);

    const ensured = await ensureOfficialStore(row.id, row.name);
    if (!ensured) return serverError(`Failed to ensure ${owner} document store`);

    return handleReadWardrobeInstructions(ensured.mountPointId, ({ present }) => {
      logger.debug(`${logTag} Read ${owner} dressing instructions`, {
        [logIdKey]: id,
        mountPointId: ensured.mountPointId,
        present,
        context: 'wardrobe',
      });
    });
  }

  // POST /api/v1/<owner>s/[id]/wardrobe?action=instructions
  async function handlePostInstructions(
    req: NextRequest,
    { user, repos }: RequestContext,
    { id }: { id: string },
  ): Promise<NextResponse> {
    const row = await findOwner(repos, id);
    if (!row) return notFound(ownerLabel);

    const body = await parseWardrobeInstructionsBody(req);

    const ensured = await ensureOfficialStore(row.id, row.name);
    if (!ensured) return serverError(`Failed to ensure ${owner} document store`);
    await ensureWardrobeFolder(ensured.mountPointId);

    return handleWriteWardrobeInstructions(ensured.mountPointId, body, ({ cleared }) => {
      logger.info(`${logTag} ${ownerLabel} dressing instructions updated`, {
        [logIdKey]: id,
        userId: user.id,
        mountPointId: ensured.mountPointId,
        cleared,
        context: 'wardrobe',
      });
    });
  }

  // GET — list wardrobe items
  const GET = createContextParamsHandler<{ id: string }>(
    withActionDispatch({ instructions: handleGetInstructions },
    async (req: NextRequest, { repos }: RequestContext, { id }) => {
      const row = await findOwner(repos, id);
      if (!row) return notFound(ownerLabel);

      const ensured = await ensureOfficialStore(row.id, row.name);
      if (!ensured) {
        return serverError(`Failed to ensure ${owner} document store`);
      }
      await ensureWardrobeFolder(ensured.mountPointId);

      const wardrobeItems = await readWardrobe(
        ensured.mountPointId,
        readIncludeArchived(req),
      );

      logListedItems?.({ ownerId: id, mountPointId: ensured.mountPointId, count: wardrobeItems.length });

      return successResponse({
        mountPointId: ensured.mountPointId,
        wardrobeItems,
      });
    }),
  );

  // POST — create a new wardrobe item
  const POST = createContextParamsHandler<{ id: string }>(
    withActionDispatch({ instructions: handlePostInstructions },
    async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
      const row = await findOwner(repos, id);
      if (!row) return notFound(ownerLabel);

      const body = await req.json();
      const validated = createWardrobeSchema.parse(body);

      const ensured = await ensureOfficialStore(row.id, row.name);
      if (!ensured) {
        return serverError(`Failed to ensure ${owner} document store`);
      }
      await ensureWardrobeFolder(ensured.mountPointId);

      const now = new Date().toISOString();
      const item: WardrobeItem = {
        id: randomUUID(),
        characterId: null,
        title: validated.title,
        description: validated.description ?? null,
        imagePrompt: validated.imagePrompt ?? null,
        types: validated.types,
        componentItemIds: validated.componentItemIds ?? [],
        appropriateness: validated.appropriateness ?? null,
        isDefault: validated.isDefault ?? false,
        replace: validated.replace ?? false,
        migratedFromClothingRecordId: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      let stored;
      try {
        stored = await createProjectWardrobeItem(ensured.mountPointId, item);
      } catch (error) {
        // Cycle rejection from the vault writer surfaces as a plain Error → 400.
        if (error instanceof Error && error.message.includes('component cycle')) {
          return badRequest(error.message);
        }
        throw error;
      }

      logger.info(`${logTag} Created ${owner} wardrobe item`, {
        [logIdKey]: id,
        userId: user.id,
        mountPointId: ensured.mountPointId,
        itemId: stored.id,
        title: stored.title,
        context: 'wardrobe',
      });

      // Return the freshly listed items so the client doesn't need a follow-up GET.
      const wardrobeItems = await readWardrobe(ensured.mountPointId, true);
      return created({
        mountPointId: ensured.mountPointId,
        wardrobeItem: stored,
        wardrobeItems,
      });
    }),
  );

  return { GET, POST };
}

// ============================================================================
// Item — GET / PUT / DELETE
// ============================================================================

/**
 * Build the item-detail handlers for one tier's `/wardrobe/[itemId]` endpoint.
 */
export function createMountWardrobeItemHandlers(
  config: MountWardrobeRouteConfig,
): MountWardrobeItemHandlers {
  const { ownerLabel, logTag, logIdKey, findOwner, ensureOfficialStore, readWardrobe } = config;
  const owner = ownerLabel.toLowerCase();

  /** Resolve the tier's official store mount, or null when unavailable. */
  async function resolveMount(
    repos: RequestContext['repos'],
    ownerId: string,
  ): Promise<string | null> {
    const row = await findOwner(repos, ownerId);
    if (!row) return null;
    const ensured = await ensureOfficialStore(row.id, row.name);
    return ensured?.mountPointId ?? null;
  }

  // GET — fetch one item
  const GET = createContextParamsHandler<{ id: string; itemId: string }>(
    async (_req: NextRequest, { repos }: RequestContext, { id, itemId }) => {
      const mountPointId = await resolveMount(repos, id);
      if (!mountPointId) return notFound(ownerLabel);

      const items = await readWardrobe(mountPointId, true);
      const item = items.find((i) => i.id === itemId);
      if (!item) return notFound(`${ownerLabel} wardrobe item`);

      return successResponse({ wardrobeItem: item });
    },
  );

  // PUT — update one item
  const PUT = createContextParamsHandler<{ id: string; itemId: string }>(
    async (req: NextRequest, { user, repos }: RequestContext, { id, itemId }) => {
      const mountPointId = await resolveMount(repos, id);
      if (!mountPointId) return notFound(ownerLabel);

      const body = await req.json();
      const { archived, ...fields } = updateWardrobeSchema.parse(body);

      // `archived` is a request-shaped boolean; the item stores a timestamp.
      // Archiving is idempotent, so an already-archived item keeps its stamp.
      let archivePatch: { archivedAt: string | null } | null = null;
      if (archived !== undefined) {
        const items = await readWardrobe(mountPointId, true);
        const current = items.find((i) => i.id === itemId);
        if (!current) return notFound(`${ownerLabel} wardrobe item`);
        archivePatch = archivedPatch(current.archivedAt, archived, new Date().toISOString());
      }

      let item;
      try {
        item = await updateProjectWardrobeItem(mountPointId, itemId, {
          ...fields,
          ...(archivePatch ?? {}),
        });
      } catch (error) {
        // Cycle rejection from the vault writer surfaces as a plain Error → 400.
        if (error instanceof Error && error.message.includes('component cycle')) {
          return badRequest(error.message);
        }
        throw error;
      }
      if (!item) return notFound(`${ownerLabel} wardrobe item`);

      logger.info(`${logTag} Updated ${owner} wardrobe item`, {
        [logIdKey]: id,
        userId: user.id,
        mountPointId,
        itemId,
        context: 'wardrobe',
        ...(archivePatch !== null && { archivedAt: archivePatch.archivedAt }),
      });

      return successResponse({ wardrobeItem: item });
    },
  );

  // DELETE — delete one item
  const DELETE = createContextParamsHandler<{ id: string; itemId: string }>(
    async (_req: NextRequest, { repos }: RequestContext, { id, itemId }) => {
      const mountPointId = await resolveMount(repos, id);
      if (!mountPointId) return notFound(ownerLabel);

      // Clean up equipped references before deleting. Composite items may still
      // reference this id in `componentItemIds`, but `expandComposites` tolerates
      // unknown ids, so dangling references are harmless.
      try {
        await repos.chats.removeEquippedItemFromAllChats(itemId);
      } catch (cleanupError) {
        logger.warn(`${logTag} Cleanup of equipped references had issues, proceeding with delete`, {
          [logIdKey]: id,
          itemId,
          context: 'wardrobe',
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }

      const success = await deleteProjectWardrobeItem(mountPointId, itemId);
      if (!success) return notFound(`${ownerLabel} wardrobe item`);

      logger.info(`${logTag} Deleted ${owner} wardrobe item`, {
        [logIdKey]: id,
        mountPointId,
        itemId,
        context: 'wardrobe',
      });

      return successResponse({ success: true });
    },
  );

  return { GET, PUT, DELETE };
}
