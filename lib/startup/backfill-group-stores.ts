/**
 * Group Store Backfill
 *
 * On server startup, ensures every Group has a populated official document
 * store — the store the group-store overlay reads from. Mirrors
 * `backfillProjectStores()`.
 *
 * For each group:
 *   1. Ensure `officialMountPointId` points at a real store (`ensureGroupOfficialStore`).
 *   2. If the store has no `properties.json`, populate all four overlay files
 *      (`description.md` / `instructions.md` / `state.json` / `properties.json`)
 *      from the raw row via `writeGroupStoreManagedFields`.
 *
 * This is the self-heal for imports and any group that slipped through the
 * cutover migration (e.g. a blocked migration that left some groups without
 * files while the columns still exist). It is the safety net behind the
 * "no column-aware fallback" read overlay: the cutover migration populates
 * files authoritatively before serving; this catches the stragglers.
 *
 * IMPORTANT: reads via `findAllRaw()` — the overlay would throw/drop the very
 * storeless groups we're here to heal. The raw row carries the legacy column
 * values pre-cutover, so the populator writes real data; post-cutover the
 * columns are gone and only defaults remain (restore from backup for lost data).
 *
 * Because that populate step is destructive post-cutover, step 2 fires only on
 * a genuinely absent `properties.json`. `readGroupStoreProperties` throws for a
 * store that exists but is unreadable, which routes to the per-group catch and
 * leaves the files alone — healing a group we merely failed to read would
 * flatten its settings, description, instructions, and state to defaults.
 *
 * Idempotent: groups whose store already has `properties.json` are skipped.
 * Per-group failures are logged and do not stop the remainder of the run.
 *
 * @module startup/backfill-group-stores
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import {
  writeGroupStoreManagedFields,
  readGroupStoreProperties,
} from '@/lib/groups/group-store/write-overlay';

const logger = createServiceLogger('Startup:GroupStoreBackfill');

export interface GroupStoreBackfillResult {
  scanned: number;
  storesCreated: number;
  filesPopulated: number;
  alreadyPopulated: number;
  errors: number;
}

export async function backfillGroupStores(): Promise<GroupStoreBackfillResult> {
  const result: GroupStoreBackfillResult = {
    scanned: 0,
    storesCreated: 0,
    filesPopulated: 0,
    alreadyPopulated: 0,
    errors: 0,
  };

  const repos = getRepositories();
  const groups = await repos.groups.findAllRaw();
  result.scanned = groups.length;

  const { startupProgress } = await import('@/lib/startup/progress');
  startupProgress.setCurrent('subsystem:group-store-backfill:start', {
    detail: `${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`,
  });

  logger.info('Group store backfill scanning', { total: groups.length });

  let index = 0;
  for (const group of groups) {
    index++;
    startupProgress.setSubProgress([
      { current: index, total: groups.length, unit: 'groups' },
    ]);
    try {
      const ensured = await ensureGroupOfficialStore(group.id, group.name);
      if (!ensured) {
        result.errors++;
        logger.warn('Group store backfill: could not ensure store', {
          groupId: group.id,
          name: group.name,
        });
        continue;
      }
      if (ensured.created) {
        result.storesCreated++;
      }
      const mountPointId = ensured.mountPointId;
      // Throws when properties.json exists but can't be read or parsed, so a
      // transient store failure lands in the catch below (logged, counted,
      // group skipped) instead of being mistaken for "never populated" —
      // which would overwrite all four files with the raw row's defaults.
      const existingProps = await readGroupStoreProperties(mountPointId, group.id);
      if (existingProps) {
        result.alreadyPopulated++;
      } else {
        // Populate from the raw row. ensureGroupOfficialStore may have just
        // set officialMountPointId on the row, so point the writer at it.
        await writeGroupStoreManagedFields(mountPointId, {
          ...group,
          officialMountPointId: mountPointId,
        });
        result.filesPopulated++;
      }
    } catch (err) {
      result.errors++;
      logger.error('Failed to backfill group store', {
        groupId: group.id,
        name: group.name,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    // Yield to the event loop between groups so a large group count doesn't
    // hog the main thread (each group is a handful of sync SQLCipher writes).
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  logger.info('Group store backfill complete', result);
  startupProgress.publish({
    rawLabel: 'subsystem:group-store-backfill:complete',
    detail: `${result.filesPopulated} populated, ${result.storesCreated} stores created${result.errors > 0 ? `, ${result.errors} errors` : ''}`,
    level: result.errors > 0 ? 'warn' : 'info',
  });
  startupProgress.setSubProgress(null);
  return result;
}
