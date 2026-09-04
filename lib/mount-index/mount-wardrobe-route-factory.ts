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
import { wardrobeItemFromCreateBody } from '@/lib/wardrobe/create-body';
import { applyArchiveFlag, cleanupEquippedRefs } from '@/lib/wardrobe/item-route-steps';
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
// Shared steps — owner → official store resolution, cycle rejection
// ============================================================================

type OwnerRow = { id: string; name: string };

type OwnerStoreResolution =
  | { ok: true; mountPointId: string }
  | { ok: false; response: NextResponse };

/**
 * The tier's owner-lookup and store-ensure steps, each mapped to the response
 * the collection routes have always returned on failure: an unknown owner is
 * `notFound(ownerLabel)`, an un-ensurable store is a 500. `resolveOwnerStore`
 * composes the two; the create-shaped handlers call them separately so the
 * body parse stays between them (an invalid body must never provision a store).
 */
function makeOwnerStoreSteps(config: MountWardrobeRouteConfig) {
  const { ownerLabel, findOwner, ensureOfficialStore } = config;
  const owner = ownerLabel.toLowerCase();

  async function findOwnerRow(
    repos: RequestContext['repos'],
    id: string,
  ): Promise<{ ok: true; row: OwnerRow } | { ok: false; response: NextResponse }> {
    const row = await findOwner(repos, id);
    if (!row) return { ok: false, response: notFound(ownerLabel) };
    return { ok: true, row };
  }

  async function ensureStore(row: OwnerRow): Promise<OwnerStoreResolution> {
    const ensured = await ensureOfficialStore(row.id, row.name);
    if (!ensured) {
      return { ok: false, response: serverError(`Failed to ensure ${owner} document store`) };
    }
    return { ok: true, mountPointId: ensured.mountPointId };
  }

  async function resolveOwnerStore(
    repos: RequestContext['repos'],
    id: string,
  ): Promise<OwnerStoreResolution> {
    const found = await findOwnerRow(repos, id);
    if (!found.ok) return found;
    return ensureStore(found.row);
  }

  return { findOwnerRow, ensureStore, resolveOwnerStore };
}

/**
 * Cycle rejection from the vault writer surfaces as a plain Error → 400.
 * Anything else is rethrown untouched. Use as `catch (e) { return ...(e) }`.
 */
function componentCycleToBadRequest(error: unknown): NextResponse {
  if (error instanceof Error && error.message.includes('component cycle')) {
    return badRequest(error.message);
  }
  throw error;
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
    readWardrobe,
    ensureWardrobeFolder,
    logListedItems,
  } = config;
  const owner = ownerLabel.toLowerCase();
  const { findOwnerRow, ensureStore, resolveOwnerStore } = makeOwnerStoreSteps(config);

  // GET /api/v1/<owner>s/[id]/wardrobe?action=instructions
  async function handleGetInstructions(
    _req: NextRequest,
    { repos }: RequestContext,
    { id }: { id: string },
  ): Promise<NextResponse> {
    const resolved = await resolveOwnerStore(repos, id);
    if (!resolved.ok) return resolved.response;
    const { mountPointId } = resolved;

    return handleReadWardrobeInstructions(mountPointId, ({ present }) => {
      logger.debug(`${logTag} Read ${owner} dressing instructions`, {
        [logIdKey]: id,
        mountPointId,
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
    const found = await findOwnerRow(repos, id);
    if (!found.ok) return found.response;

    const body = await parseWardrobeInstructionsBody(req);

    const store = await ensureStore(found.row);
    if (!store.ok) return store.response;
    const { mountPointId } = store;
    await ensureWardrobeFolder(mountPointId);

    return handleWriteWardrobeInstructions(mountPointId, body, ({ cleared }) => {
      logger.info(`${logTag} ${ownerLabel} dressing instructions updated`, {
        [logIdKey]: id,
        userId: user.id,
        mountPointId,
        cleared,
        context: 'wardrobe',
      });
    });
  }

  // GET — list wardrobe items
  const GET = createContextParamsHandler<{ id: string }>(
    withActionDispatch({ instructions: handleGetInstructions },
    async (req: NextRequest, { repos }: RequestContext, { id }) => {
      const resolved = await resolveOwnerStore(repos, id);
      if (!resolved.ok) return resolved.response;
      const { mountPointId } = resolved;
      await ensureWardrobeFolder(mountPointId);

      const wardrobeItems = await readWardrobe(mountPointId, readIncludeArchived(req));

      logListedItems?.({ ownerId: id, mountPointId, count: wardrobeItems.length });

      return successResponse({ mountPointId, wardrobeItems });
    }),
  );

  // POST — create a new wardrobe item
  const POST = createContextParamsHandler<{ id: string }>(
    withActionDispatch({ instructions: handlePostInstructions },
    async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
      const found = await findOwnerRow(repos, id);
      if (!found.ok) return found.response;

      const body = await req.json();
      const validated = createWardrobeSchema.parse(body);

      const store = await ensureStore(found.row);
      if (!store.ok) return store.response;
      const { mountPointId } = store;
      await ensureWardrobeFolder(mountPointId);

      const now = new Date().toISOString();
      const item: WardrobeItem = {
        id: randomUUID(),
        ...wardrobeItemFromCreateBody(validated, null),
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      let stored;
      try {
        stored = await createProjectWardrobeItem(mountPointId, item);
      } catch (error) {
        return componentCycleToBadRequest(error);
      }

      logger.info(`${logTag} Created ${owner} wardrobe item`, {
        [logIdKey]: id,
        userId: user.id,
        mountPointId,
        itemId: stored.id,
        title: stored.title,
        context: 'wardrobe',
      });

      // Return the freshly listed items so the client doesn't need a follow-up GET.
      const wardrobeItems = await readWardrobe(mountPointId, true);
      return created({ mountPointId, wardrobeItem: stored, wardrobeItems });
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
  const { ownerLabel, logTag, logIdKey, readWardrobe } = config;
  const owner = ownerLabel.toLowerCase();
  const { resolveOwnerStore } = makeOwnerStoreSteps(config);

  /**
   * Resolve the tier's official store mount, or null when unavailable. The
   * item routes have always collapsed both failures (unknown owner, store not
   * ensurable) to `notFound(ownerLabel)`, so the resolver's response is
   * deliberately not surfaced here.
   */
  async function resolveMount(
    repos: RequestContext['repos'],
    ownerId: string,
  ): Promise<string | null> {
    const resolved = await resolveOwnerStore(repos, ownerId);
    return resolved.ok ? resolved.mountPointId : null;
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
        archivePatch = applyArchiveFlag(current.archivedAt, archived);
      }

      let item;
      try {
        item = await updateProjectWardrobeItem(mountPointId, itemId, {
          ...fields,
          ...(archivePatch ?? {}),
        });
      } catch (error) {
        return componentCycleToBadRequest(error);
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

      await cleanupEquippedRefs(repos.chats, itemId, logTag, {
        [logIdKey]: id,
        itemId,
        context: 'wardrobe',
      });

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
