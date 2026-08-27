/**
 * Abstract Store-Backed Repository
 *
 * Shared base for repositories whose substantive content lives in the entity's
 * official document store rather than in DB columns (currently projects and
 * groups). It is the chokepoint that hides that split:
 *
 *   - Every read overlays the store (`applyOverlay[One]`) so callers see the
 *     fully-hydrated entity.
 *   - Every write routes store-resident fields to the store (`applyWriteOverlay`)
 *     and strips them (`managedFields`) from the slim DB row.
 *   - `create()` provisions and populates the official store before returning,
 *     so a freshly-created entity is never storeless.
 *
 * Subclasses supply a {@link StoreOverlayBinding} (the entity's overlay engine
 * plus labels/managed-fields) and may override {@link prepareCreateData} to seed
 * create-time defaults. Entity-specific methods (e.g. a project's character
 * roster) stay on the subclass.
 */

import { BaseEntity, TypedQueryFilter, UpdateSpec } from '../interfaces';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';

/** The minimal row shape a store-backed repository operates on. */
export type StoreBackedEntity = BaseEntity & {
  name: string;
  officialMountPointId?: string | null;
};

/**
 * The store-overlay wiring a concrete store-backed repository provides: the five
 * overlay operations, the store-managed field set stripped from the slim row,
 * the provisioning entry point, and the labels used in log lines.
 */
export interface StoreOverlayBinding<T> {
  /** Store-resident field names stripped from the slim DB row. */
  readonly managedFields: Iterable<PropertyKey>;
  /** Capitalized singular label for human log lines, e.g. `'Project'`. */
  readonly entityLabel: string;
  /** Log-field key for the entity id, e.g. `'projectId'`. */
  readonly idLogKey: string;
  applyOverlay(rows: T[]): Promise<T[]>;
  applyOverlayOne(row: T | null): Promise<T | null>;
  applyWriteOverlay(id: string, patch: Partial<T>): Promise<Partial<T>>;
  writeManagedFields(mountPointId: string, entity: T): Promise<void>;
  ensureOfficialStore(id: string, name: string): Promise<{ mountPointId: string } | null>;
}

export abstract class AbstractStoreBackedRepository<
  T extends StoreBackedEntity,
> extends AbstractBaseRepository<T> {
  /** The entity's store-overlay wiring. Supplied by the concrete subclass. */
  protected abstract readonly store: StoreOverlayBinding<T>;

  // ==========================================================================
  // READS (document-store overlay applied)
  // ==========================================================================

  /**
   * Find by ID, hydrated from the document store. Throws the entity's
   * unavailability error if the store is missing/unreadable — the caller asked
   * for this specific entity, so fail loudly.
   */
  async findById(id: string): Promise<T | null> {
    return this.store.applyOverlayOne(await this._findById(id));
  }

  /**
   * Find by ID **without applying the document-store overlay**. The returned row
   * has empty/default values for every store-resident field.
   *
   * **Almost no caller wants this.** Use {@link findById} for any normal read.
   * The legitimate exceptions are the overlay's own bootstrap, the hot
   * tier-resolution path (which only needs `officialMountPointId`), and startup
   * backfills that operate on the row directly.
   */
  async findByIdRaw(id: string): Promise<T | null> {
    return this._findById(id);
  }

  /**
   * Find all, each hydrated from its document store. A row whose store is
   * unavailable is logged at `error` and dropped so one bad row can't take down
   * the whole list.
   */
  async findAll(): Promise<T[]> {
    return this.store.applyOverlay(await this._findAll());
  }

  /**
   * Find all **without applying the document-store overlay**. See the warnings
   * on {@link findByIdRaw}. Reserved for startup backfills and the overlay's own
   * bootstrap.
   */
  async findAllRaw(): Promise<T[]> {
    return this._findAll();
  }

  /** Find by IDs, each hydrated from its document store. */
  async findByIds(ids: string[]): Promise<T[]> {
    if (ids.length === 0) return [];
    const raw = await this.findByFilter({ id: { $in: ids } } as TypedQueryFilter<T>);
    return this.store.applyOverlay(raw);
  }

  // ==========================================================================
  // CREATE / UPDATE / DELETE
  // ==========================================================================

  /**
   * Hook for create-time default seeding. The base passes the data through
   * unchanged; subclasses override to apply entity-specific defaults before the
   * row is written.
   */
  protected prepareCreateData(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
  ): Omit<T, 'id' | 'createdAt' | 'updatedAt'> {
    return data;
  }

  /**
   * Create an entity, provision its official document store, and populate the
   * store files from the create payload before returning. Fails hard if the
   * store cannot be provisioned — a storeless entity would throw on every read.
   */
  async create(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions,
  ): Promise<T> {
    const label = this.store.entityLabel;
    const lower = label.toLowerCase();
    return this.safeQuery(
      async () => {
        // Drop any incoming officialMountPointId — create always provisions a
        // fresh store. Importers carrying a source pointer shouldn't reuse it.
        const entityData = {
          ...this.prepareCreateData(data),
          officialMountPointId: null,
        } as Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

        // _create validates the full entity (store fields in memory) and writes
        // only the slim row.
        const created = await this._create(entityData, options);

        // Provision the official store, then write the overlay files from the
        // in-memory create payload. ensureOfficialStore sets officialMountPointId
        // on the row.
        const ensured = await this.store.ensureOfficialStore(created.id, created.name);
        if (!ensured) {
          throw new Error(
            `Failed to provision official document store for ${lower} ${created.id}; ` +
              `refusing to return a storeless ${lower}.`,
          );
        }
        await this.store.writeManagedFields(ensured.mountPointId, {
          ...created,
          officialMountPointId: ensured.mountPointId,
        });

        logger.info(`${label} created`, {
          [this.store.idLogKey]: created.id,
          name: created.name,
          officialMountPointId: ensured.mountPointId,
        });

        // Reload through the overlay so the returned entity reflects the
        // store-backed state, including the freshly-set mount pointer.
        const final = await this.findById(created.id);
        if (!final) {
          throw new Error(`${label} ${created.id} disappeared immediately after creation`);
        }
        return final;
      },
      `Error creating ${lower}`,
      { name: data.name },
    );
  }

  /**
   * Update an entity. Store-resident fields are routed to the official store via
   * {@link StoreOverlayBinding.applyWriteOverlay}; the DB-only remainder is
   * written through `_update`. The returned entity is overlaid so callers see
   * the store-backed view, exactly as {@link findById} would.
   */
  async update(id: string, data: Partial<T>): Promise<T | null> {
    const label = this.store.entityLabel;
    return this.safeQuery(
      async () => {
        const dbPatch = await this.store.applyWriteOverlay(id, data);
        const hasDbWork = Object.keys(dbPatch).length > 0;
        const result = hasDbWork ? await this._update(id, dbPatch) : await this._findById(id);
        if (result) {
          logger.info(`${label} updated`, { [this.store.idLogKey]: id });
        }
        return this.store.applyOverlayOne(result);
      },
      `Error updating ${label.toLowerCase()}`,
      { [this.store.idLogKey]: id },
    );
  }

  /**
   * Persist ONLY the `officialMountPointId` FK on the slim row, bypassing the
   * document-store overlay entirely. Provisioning calls this to record a freshly
   * created store's id BEFORE the store files exist — the normal,
   * overlay-applying {@link update} would throw on its closing re-read because
   * `writeManagedFields` hasn't run yet. Write-side sibling of
   * {@link findByIdRaw}; almost no caller wants this.
   */
  async setOfficialMountPointId(id: string, mountPointId: string): Promise<void> {
    await this._update(id, { officialMountPointId: mountPointId } as Partial<T>);
  }

  /**
   * Delete the slim row. Callers are responsible for dropping memberships and
   * unlinking additional stores; the official store is orphaned.
   */
  async delete(id: string): Promise<boolean> {
    const label = this.store.entityLabel;
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);
        if (result) {
          logger.info(`${label} deleted`, { [this.store.idLogKey]: id });
        }
        return result;
      },
      `Error deleting ${label.toLowerCase()}`,
      { [this.store.idLogKey]: id },
    );
  }

  protected createErrorMessage(): string {
    return `Error creating ${this.store.entityLabel.toLowerCase()} entity`;
  }

  /**
   * Store-aware row transform for the base `_create`. Strips store-resident
   * keys before INSERT so callers that pass e.g. `description` or `state` to
   * `create()` don't blow up with "no such column" — those fields belong in
   * the document store.
   */
  protected toPersistedRow(validated: T): T {
    const dbRow = { ...validated } as Record<string, unknown>;
    for (const f of this.store.managedFields) {
      delete dbRow[f as string];
    }
    return dbRow as T;
  }

  /**
   * Store-aware override of the base `_update`. Store-resident fields live in the
   * document store. Read raw, merge, validate, then strip store-resident keys
   * before writing as a defensive backstop so `$set` never references a dropped
   * column.
   */
  protected async _update(id: string, data: Partial<T>): Promise<T | null> {
    return this.safeQuery(async () => {
      const existing = await this.findByIdRaw(id);
      if (!existing) {
        logger.warn('Entity not found for update', { collection: this.collectionName, id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const merged = {
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: ('updatedAt' in data)
          ? (data as Record<string, unknown>).updatedAt as string
          : now,
      } as T;

      const validated = this.validate(merged) as T;

      const dbRow = { ...validated } as Record<string, unknown>;
      for (const f of this.store.managedFields) {
        delete dbRow[f as string];
      }

      const collection = await this.getCollection();
      await collection.updateOne(
        { id } as TypedQueryFilter<T>,
        { $set: dbRow } as UpdateSpec<T>,
      );

      return validated;
    }, `Error updating ${this.store.entityLabel.toLowerCase()} entity`, { id });
  }
}
