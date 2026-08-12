/**
 * Official Document-Store Lifecycle — server-only, shared core.
 *
 * Single implementation of the "find / adopt / create" flow that provisions an
 * entity's canonical "official" document store and persists the FK on the
 * entity row. Both `ensure-project-store.ts` and `ensure-group-store.ts` are
 * thin wrappers that build an {@link EnsureOfficialStoreConfig} and delegate
 * here; the two differ only in entity/prefix names and which repository
 * methods they call.
 *
 * Imports the repository factory (for `findAll` / `create`), which transitively
 * pulls in node-only modules. Kept separate from the `*-store-naming.ts`
 * pure-function modules so those remain client-safe.
 *
 * @module mount-index/ensure-official-store
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { nextUniqueMountPointName } from './unique-mount-point-name';

/** Minimal shape of the raw entity row this flow needs. */
export interface OfficialStoreEntityRow {
  officialMountPointId?: string | null;
}

/**
 * Per-entity wiring for {@link ensureOfficialStore}. Everything that differs
 * between the project and group variants is expressed here; the resolution
 * order, create payload, and logging are owned by the shared core.
 */
export interface EnsureOfficialStoreConfig {
  /** Lowercase entity noun used in log messages, e.g. `'project'` / `'group'`. */
  entityLabel: string;
  /** Capitalised entity noun used in log messages, e.g. `'Project'` / `'Group'`. */
  entityLabelCapitalized: string;
  /** Log-context key for the entity id, e.g. `'projectId'` / `'groupId'`. */
  entityIdLogKey: string;
  /** Name prefix for a freshly-created store, e.g. `'Project Files: '`. */
  storeNamePrefix: string;

  /** Read the RAW entity row (never the overlay-applied read). */
  findEntityRaw(entityId: string): Promise<OfficialStoreEntityRow | null>;
  /** Raw FK write — must not re-read the store overlay. */
  setOfficialMountPointId(entityId: string, mountPointId: string): Promise<void>;
  /** All mount-point links for the entity. */
  findLinks(entityId: string): Promise<Array<{ mountPointId: string }>>;
  /** Link a mount point to the entity. */
  link(entityId: string, mountPointId: string): Promise<unknown>;
  /** True when `name` matches this entity's own-store naming convention. */
  isOwnStoreName(name: string): boolean;
}

/**
 * Find or create the entity's canonical "official" document store and return
 * its mount-point ID. Idempotent.
 *
 * Resolution order:
 *   1. If `entity.officialMountPointId` is set and the mount point still
 *      exists, return it.
 *   2. If a link exists to a database-backed `documents` store (preferring a
 *      name-prefix match), adopt it: write its ID to the entity FK and return.
 *   3. Otherwise create a fresh `<prefix><name>` mount point (using
 *      `nextUniqueMountPointName` for collision handling), insert the link,
 *      write the ID to the entity FK, and return it.
 *
 * Returns `{ mountPointId, created }` where `created` is true when this call
 * created a new mount point (vs. adopting/finding an existing one).
 */
export async function ensureOfficialStore(
  config: EnsureOfficialStoreConfig,
  entityId: string,
  entityName: string,
): Promise<{ mountPointId: string; created: boolean } | null> {
  const repos = getRepositories();

  // Read the RAW row, never the overlay-applied `findById`. Provisioning runs
  // BEFORE the store files exist (entity creation, startup backfill, and the
  // cutover migration all call this), so the store-only overlay would throw
  // a `*StoreUnavailableError` (missing properties.json) or, mid-migration,
  // the schema-validating read can reject a legacy wide row. We only need the
  // entity's existence, name, and `officialMountPointId` — all raw-row fields.
  const entity = await config.findEntityRaw(entityId);
  if (!entity) {
    logger.warn(`ensure${config.entityLabelCapitalized}OfficialStore: ${config.entityLabel} not found`, {
      [config.entityIdLogKey]: entityId,
    });
    return null;
  }

  // 1. Existing FK still valid?
  if (entity.officialMountPointId) {
    const existing = await repos.docMountPoints.findById(entity.officialMountPointId);
    if (existing) {
      return { mountPointId: existing.id, created: false };
    }
    logger.info(`${config.entityLabelCapitalized} officialMountPointId points to a missing mount point; will heal`, {
      [config.entityIdLogKey]: entityId,
      staleMountPointId: entity.officialMountPointId,
    });
  }

  // 2. Adopt an existing linked store if one matches.
  const links = await config.findLinks(entityId);
  if (links.length > 0) {
    const linkedStores = await Promise.all(
      links.map(l => repos.docMountPoints.findById(l.mountPointId)),
    );
    const eligible = linkedStores.filter(
      (s): s is NonNullable<typeof s> =>
        !!s && s.mountType === 'database' && (s.storeType ?? 'documents') === 'documents',
    );
    const adoptable = eligible.find(s => config.isOwnStoreName(s.name)) ?? eligible[0] ?? null;
    if (adoptable) {
      // Raw FK write — must not re-read the store overlay. On the create path
      // the adopted store may have no properties.json yet; the overlay-applying
      // `update()` would throw *StoreUnavailableError. See setOfficialMountPointId.
      await config.setOfficialMountPointId(entityId, adoptable.id);
      logger.info(`Adopted existing linked store as ${config.entityLabel} official`, {
        [config.entityIdLogKey]: entityId,
        mountPointId: adoptable.id,
        storeName: adoptable.name,
      });
      return { mountPointId: adoptable.id, created: false };
    }
  }

  // 3. Create a fresh `<prefix><name>` store and link it.
  const desiredName = `${config.storeNamePrefix}${(entityName || 'Untitled').trim()}`.slice(0, 200);
  const all = await repos.docMountPoints.findAll();
  const taken = new Set(all.map(mp => mp.name));
  const finalName = nextUniqueMountPointName(taken, desiredName);

  const mountPoint = await repos.docMountPoints.create({
    name: finalName,
    basePath: '',
    mountType: 'database',
    storeType: 'documents',
    includePatterns: [],
    excludePatterns: ['.git', 'node_modules', '.obsidian', '.trash'],
    enabled: true,
    lastScannedAt: null,
    scanStatus: 'idle',
    lastScanError: null,
    conversionStatus: 'idle',
    conversionError: null,
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
  });

  await config.link(entityId, mountPoint.id);
  // Raw FK write — `create()` populates the store files (properties.json et al.)
  // only AFTER this returns, so the overlay-applying `update()` would throw
  // *StoreUnavailableError on its closing re-read. See setOfficialMountPointId.
  await config.setOfficialMountPointId(entityId, mountPoint.id);

  logger.info(`Created ${config.entityLabel}-official document store`, {
    [config.entityIdLogKey]: entityId,
    mountPointId: mountPoint.id,
    storeName: finalName,
  });

  return { mountPointId: mountPoint.id, created: true };
}
