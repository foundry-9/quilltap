/**
 * Generic document-store overlay engine.
 *
 * The project store and the group store are the same machine: a slim DB row
 * whose substantive content (description, instructions, state, and a JSON
 * property bag) actually lives in the entity's official document store, behind
 * four overlay files (`properties.json`, `description.md`, `instructions.md`,
 * `state.json`). This module is the single implementation of that machine;
 * `lib/projects/project-store` and `lib/groups/group-store` each instantiate it
 * with their entity's schema, paths, and typed unavailability error.
 *
 * Failure is asymmetric (a deliberate divergence from the character vault
 * overlay, which degrades gracefully):
 *   - {@link DocumentStoreOverlay.applyOverlayOne} (single, behind `findById`)
 *     THROWS the entity's unavailability error — the caller asked for that one.
 *   - {@link DocumentStoreOverlay.applyOverlay} (batched, behind `findAll`) logs
 *     at `error` and DROPS the offending row so one corrupt store can't take
 *     down the whole list. The startup backfill heals it.
 *
 *   - {@link DocumentStoreOverlay.readProperties} returns `null` ONLY for a
 *     genuinely absent `properties.json`, and THROWS when the file exists but
 *     is unreadable or unparseable. Its callers treat `null` as "seed from the
 *     raw row", and post-cutover that row holds no property values — so a
 *     lenient read silently resets the settings bag to schema defaults.
 *
 * Per-mount-point writes are serialized through a promise chain (mirrors the
 * character wardrobe-sync pattern) so concurrent property/state writes can't
 * clobber each other's read-modify-write.
 *
 * @module database/document-store-overlay
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  writeDatabaseDocument,
  readDatabaseDocumentIfExists,
} from '@/lib/mount-index/database-store';

/** The minimal shape a store-backed row must expose to the overlay engine. */
export interface StoreBackedRow {
  id: string;
  officialMountPointId?: string | null;
  description?: string | null;
  instructions?: string | null;
  state?: unknown;
}

/** Per-entity configuration that specializes the generic overlay machine. */
export interface DocumentStoreOverlayConfig<T extends StoreBackedRow, P> {
  /** Lowercase singular label for log lines, e.g. `'project'`. */
  entityLabel: string;
  /** Capitalized label used in log message prefixes, e.g. `'Project'`. */
  entityLabelCapitalized: string;
  /** Log-field key for the entity id, e.g. `'projectId'`. */
  idLogKey: string;
  /** The property-bag keys (schema-derived so they can't drift). */
  propertyKeys: readonly string[];
  /** Parse + validate the property bag; throws on an invalid body. */
  parseProperties(value: unknown): P;
  /** Store-resident field names stripped from the DB-bound patch. */
  managedFields: Iterable<PropertyKey>;
  paths: {
    properties: string;
    description: string;
    instructions: string;
    state: string;
    /** Every single-file overlay path, in stable order. */
    all: readonly string[];
  };
  /** Construct the entity's typed "store unavailable" error. */
  createUnavailableError(id: string, mountPointId: string | null | undefined, detail?: string): Error;
  /** Type guard for the entity's "store unavailable" error. */
  isUnavailableError(err: unknown): boolean;
  /** Read the raw (non-overlaid) row — used only by the write overlay. */
  findRawById(id: string): Promise<T | null>;
}

/** The five overlay operations a store-backed repository drives. */
export interface DocumentStoreOverlay<T extends StoreBackedRow, P> {
  applyOverlay(rows: T[]): Promise<T[]>;
  applyOverlayOne(row: T | null): Promise<T | null>;
  /**
   * `null` means `properties.json` is genuinely absent. A store that exists but
   * can't be read or parsed throws — never conflate the two, see the
   * implementation's docblock for why.
   */
  readProperties(mountPointId: string, entityId?: string): Promise<P | null>;
  writeManagedFields(mountPointId: string, entity: T): Promise<void>;
  applyWriteOverlay(id: string, patch: Partial<T>): Promise<Partial<T>>;
}

/** path → (mountPointId → file content) */
type ContentByPath = Map<string, Map<string, string>>;

/** Empty markdown file → null so nullable fields keep their unset semantics. */
function markdownToNullable(content: string): string | null {
  return content === '' ? null : content;
}

/**
 * Build a document-store overlay specialized for one entity type. Each instance
 * owns its own per-mount-point write-serialization map, so two entity types
 * never share a lock (mount-point ids are unique per store anyway).
 */
export function createDocumentStoreOverlay<T extends StoreBackedRow, P>(
  config: DocumentStoreOverlayConfig<T, P>,
): DocumentStoreOverlay<T, P> {
  const { entityLabel: label, entityLabelCapitalized: Label, idLogKey, propertyKeys, paths } = config;
  const syncChains = new Map<string, Promise<void>>();

  async function runOnChain(mountPointId: string, work: () => Promise<void>): Promise<void> {
    const prev = syncChains.get(mountPointId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => work());
    syncChains.set(mountPointId, next);
    try {
      await next;
    } finally {
      if (syncChains.get(mountPointId) === next) {
        syncChains.delete(mountPointId);
      }
    }
  }

  async function loadStoreFiles(mountPointIds: string[]): Promise<ContentByPath> {
    const byPath: ContentByPath = new Map();
    for (const path of paths.all) {
      byPath.set(path, new Map());
    }
    if (mountPointIds.length === 0) {
      return byPath;
    }
    const repos = getRepositories();
    const results = await Promise.all(
      paths.all.map((path) =>
        repos.docMountDocuments.findManyByMountPointsAndPath(mountPointIds, path),
      ),
    );
    for (let i = 0; i < paths.all.length; i++) {
      const byMount = byPath.get(paths.all[i])!;
      for (const doc of results[i]) {
        byMount.set(doc.mountPointId, doc.content);
      }
    }
    return byPath;
  }

  function hydrateOne(row: T, byPath: ContentByPath): T {
    const mountId = row.officialMountPointId;
    if (!mountId) {
      throw config.createUnavailableError(row.id, mountId, 'officialMountPointId is null');
    }

    const propsRaw = byPath.get(paths.properties)?.get(mountId);
    if (propsRaw === undefined) {
      throw config.createUnavailableError(row.id, mountId, 'properties.json missing');
    }
    let properties: P;
    try {
      properties = config.parseProperties(JSON.parse(propsRaw));
    } catch (err) {
      throw config.createUnavailableError(
        row.id,
        mountId,
        `properties.json unparseable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const descRaw = byPath.get(paths.description)?.get(mountId);
    const instrRaw = byPath.get(paths.instructions)?.get(mountId);
    const stateRaw = byPath.get(paths.state)?.get(mountId);

    let state: unknown = {};
    if (stateRaw !== undefined) {
      try {
        state = JSON.parse(stateRaw) ?? {};
      } catch {
        // A corrupt state.json is non-fatal — treat as empty (state is not the
        // keystone invariant; only properties.json + the mount are).
        logger.warn(`${Label} state.json unparseable; defaulting to {}`, {
          [idLogKey]: row.id,
          officialMountPointId: mountId,
        });
        state = {};
      }
    }

    return {
      ...row,
      ...properties,
      description: descRaw !== undefined ? markdownToNullable(descRaw) : null,
      instructions: instrRaw !== undefined ? markdownToNullable(instrRaw) : null,
      state,
    } as T;
  }

  async function applyOverlay(rows: T[]): Promise<T[]> {
    if (rows.length === 0) {
      return rows;
    }
    const mountPointIds = [
      ...new Set(rows.map((r) => r.officialMountPointId).filter((id): id is string => !!id)),
    ];
    const byPath = await loadStoreFiles(mountPointIds);

    const out: T[] = [];
    let dropped = 0;
    for (const row of rows) {
      try {
        out.push(hydrateOne(row, byPath));
      } catch (err) {
        if (config.isUnavailableError(err)) {
          dropped++;
          logger.error(`Dropping ${label} from list — document store unavailable`, {
            [idLogKey]: row.id,
            officialMountPointId: row.officialMountPointId ?? null,
            reason: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        throw err;
      }
    }
    if (dropped > 0) {
      logger.warn(`apply${Label}StoreOverlay dropped ${label}s with unavailable stores`, {
        dropped,
        of: rows.length,
      });
    }
    return out;
  }

  async function applyOverlayOne(row: T | null): Promise<T | null> {
    if (!row) {
      return row;
    }
    const mountId = row.officialMountPointId;
    if (!mountId) {
      logger.error(`apply${Label}StoreOverlayOne: ${label} has null officialMountPointId`, {
        [idLogKey]: row.id,
      });
      throw config.createUnavailableError(row.id, mountId, 'officialMountPointId is null');
    }
    const byPath = await loadStoreFiles([mountId]);
    return hydrateOne(row, byPath);
  }

  /**
   * Read + validate the property bag.
   *
   * Returns `null` **only** when `properties.json` is genuinely absent from the
   * store. Every other failure — an unreadable mount index, a transient
   * repository error, malformed JSON, a body the schema rejects — throws the
   * entity's unavailability error.
   *
   * That distinction is load-bearing, not pedantry. Callers read `null` as
   * "nothing persisted yet, seed from the raw row", and post-cutover the slim
   * DB row carries no property values at all. Collapsing a *failed* read into
   * `null` therefore resets the entire settings bag to schema defaults — and
   * because the no-default optionals then serialize to nothing, the loss is
   * invisible in the file and compounds through every later write.
   *
   * `entityId` is for the error message only; callers that have it should pass
   * it so a failure names the project/group rather than just its mount point.
   */
  async function readProperties(
    mountPointId: string,
    entityId = '(unknown)',
  ): Promise<P | null> {
    let content: string | null;
    try {
      content = await readDatabaseDocumentIfExists(mountPointId, paths.properties);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.error(`${Label} ${paths.properties} unreadable — refusing to treat as absent`, {
        [idLogKey]: entityId,
        officialMountPointId: mountPointId,
        reason: detail,
      });
      throw config.createUnavailableError(
        entityId,
        mountPointId,
        `${paths.properties} unreadable: ${detail}`,
      );
    }
    if (content === null) {
      logger.debug(`${Label} ${paths.properties} absent — caller may seed defaults`, {
        [idLogKey]: entityId,
        officialMountPointId: mountPointId,
      });
      return null;
    }

    try {
      return config.parseProperties(JSON.parse(content));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.error(`${Label} ${paths.properties} unparseable — refusing to treat as absent`, {
        [idLogKey]: entityId,
        officialMountPointId: mountPointId,
        reason: detail,
      });
      throw config.createUnavailableError(
        entityId,
        mountPointId,
        `${paths.properties} unparseable: ${detail}`,
      );
    }
  }

  async function writeManagedFields(mountPointId: string, entity: T): Promise<void> {
    await runOnChain(mountPointId, async () => {
      await writeDatabaseDocument(
        mountPointId,
        paths.properties,
        JSON.stringify(config.parseProperties(entity), null, 2),
      );
      await writeDatabaseDocument(mountPointId, paths.description, entity.description ?? '');
      await writeDatabaseDocument(mountPointId, paths.instructions, entity.instructions ?? '');
      await writeDatabaseDocument(
        mountPointId,
        paths.state,
        JSON.stringify(entity.state ?? {}, null, 2),
      );
    });
  }

  async function applyWriteOverlay(id: string, patch: Partial<T>): Promise<Partial<T>> {
    const entity = await config.findRawById(id);
    if (!entity) {
      // Caller will hit the same not-found in _update; let it surface there.
      return patch;
    }

    const p = patch as Record<string, unknown>;
    const dbPatch: Partial<T> = { ...patch };
    const touchedProps = propertyKeys.filter((k) => k in patch);
    const touchesDescription = 'description' in patch;
    const touchesInstructions = 'instructions' in patch;
    const touchesState = 'state' in patch;
    const touchesStore =
      touchedProps.length > 0 || touchesDescription || touchesInstructions || touchesState;

    if (touchesStore) {
      const mountPointId = entity.officialMountPointId;
      if (!mountPointId) {
        logger.error(
          `apply${Label}StoreWriteOverlay: ${label} has null officialMountPointId but the patch carries store-resident fields`,
          {
            [idLogKey]: id,
            storeFieldsInPatch: [
              ...touchedProps,
              ...(touchesDescription ? ['description'] : []),
              ...(touchesInstructions ? ['instructions'] : []),
              ...(touchesState ? ['state'] : []),
            ],
          },
        );
        throw config.createUnavailableError(id, mountPointId, 'write attempted with null officialMountPointId');
      }

      await runOnChain(mountPointId, async () => {
        if (touchesDescription) {
          const value = (p.description ?? '') as string;
          await writeDatabaseDocument(mountPointId, paths.description, value);
        }
        if (touchesInstructions) {
          const value = (p.instructions ?? '') as string;
          await writeDatabaseDocument(mountPointId, paths.instructions, value);
        }
        if (touchesState) {
          const value = JSON.stringify(p.state ?? {}, null, 2);
          await writeDatabaseDocument(mountPointId, paths.state, value);
        }
        if (touchedProps.length > 0) {
          // Read-modify-write so a partial patch doesn't blow away unspecified
          // keys. `readProperties` throws rather than returning null when the
          // file exists but can't be read or parsed, so the seed-from-entity
          // fallback fires only for a store that has no properties.json at all
          // — a broken invariant the backfill heals, where there is nothing to
          // preserve anyway. (Seeding from a raw row on a *failed* read is what
          // silently reset a project's whole settings bag to defaults.)
          const current =
            (await readProperties(mountPointId, id)) ?? config.parseProperties(entity);
          const next = { ...(current as Record<string, unknown>) };
          for (const k of touchedProps) {
            next[k] = p[k];
          }
          const value = JSON.stringify(config.parseProperties(next), null, 2);
          await writeDatabaseDocument(mountPointId, paths.properties, value);
        }
      });
    }

    // Strip every store-resident key from the DB-bound patch so it never reaches
    // a (post-cutover nonexistent) column. Deleting keys not present is a no-op.
    for (const f of config.managedFields) {
      delete (dbPatch as Record<string, unknown>)[f as string];
    }
    return dbPatch;
  }

  return { applyOverlay, applyOverlayOne, readProperties, writeManagedFields, applyWriteOverlay };
}
