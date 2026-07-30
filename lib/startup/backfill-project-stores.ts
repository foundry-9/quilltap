/**
 * Project Store Backfill
 *
 * On server startup, ensures every Project has a populated official document
 * store — the store the project-store overlay reads from. Mirrors
 * `backfillCharacterVaults()`.
 *
 * For each project:
 *   1. Ensure `officialMountPointId` points at a real store (`ensureProjectOfficialStore`).
 *   2. If the store has no `properties.json`, populate all four overlay files
 *      (`description.md` / `instructions.md` / `state.json` / `properties.json`)
 *      from the raw row via `writeProjectStoreManagedFields`.
 *
 * This is the self-heal for imports and any project that slipped through the
 * cutover migration (e.g. a blocked migration that left some projects without
 * files while the columns still exist). It is the safety net behind the
 * "no column-aware fallback" read overlay: the cutover migration populates
 * files authoritatively before serving; this catches the stragglers.
 *
 * IMPORTANT: reads via `findAllRaw()` — the overlay would throw/drop the very
 * storeless projects we're here to heal. The raw row carries the legacy column
 * values pre-cutover, so the populator writes real data; post-cutover the
 * columns are gone and only defaults remain (restore from backup for lost data).
 *
 * Because that populate step is destructive post-cutover, step 2 fires only on
 * a genuinely absent `properties.json`. `readProjectStoreProperties` throws for
 * a store that exists but is unreadable, which routes to the per-project catch
 * and leaves the files alone — healing a project we merely failed to read would
 * flatten its settings, description, instructions, and state to defaults.
 *
 * Idempotent: projects whose store already has `properties.json` are skipped.
 * Per-project failures are logged and do not stop the remainder of the run.
 *
 * @module startup/backfill-project-stores
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';
import {
  writeProjectStoreManagedFields,
  readProjectStoreProperties,
} from '@/lib/projects/project-store/write-overlay';

const logger = createServiceLogger('Startup:ProjectStoreBackfill');

export interface ProjectStoreBackfillResult {
  scanned: number;
  storesCreated: number;
  filesPopulated: number;
  alreadyPopulated: number;
  errors: number;
}

export async function backfillProjectStores(): Promise<ProjectStoreBackfillResult> {
  const result: ProjectStoreBackfillResult = {
    scanned: 0,
    storesCreated: 0,
    filesPopulated: 0,
    alreadyPopulated: 0,
    errors: 0,
  };

  const repos = getRepositories();
  const projects = await repos.projects.findAllRaw();
  result.scanned = projects.length;

  const { startupProgress } = await import('@/lib/startup/progress');
  startupProgress.setCurrent('subsystem:project-store-backfill:start', {
    detail: `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`,
  });

  logger.info('Project store backfill scanning', { total: projects.length });

  let index = 0;
  for (const project of projects) {
    index++;
    startupProgress.setSubProgress([
      { current: index, total: projects.length, unit: 'projects' },
    ]);
    try {
      const ensured = await ensureProjectOfficialStore(project.id, project.name);
      if (!ensured) {
        result.errors++;
        logger.warn('Project store backfill: could not ensure store', {
          projectId: project.id,
          name: project.name,
        });
        continue;
      }
      if (ensured.created) {
        result.storesCreated++;
      }
      const mountPointId = ensured.mountPointId;
      // Throws when properties.json exists but can't be read or parsed, so a
      // transient store failure lands in the catch below (logged, counted,
      // project skipped) instead of being mistaken for "never populated" —
      // which would overwrite all four files with the raw row's defaults.
      const existingProps = await readProjectStoreProperties(mountPointId, project.id);
      if (existingProps) {
        result.alreadyPopulated++;
      } else {
        // Populate from the raw row. ensureProjectOfficialStore may have just
        // set officialMountPointId on the row, so point the writer at it.
        await writeProjectStoreManagedFields(mountPointId, {
          ...project,
          officialMountPointId: mountPointId,
        });
        result.filesPopulated++;
      }
    } catch (err) {
      result.errors++;
      logger.error('Failed to backfill project store', {
        projectId: project.id,
        name: project.name,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    // Yield to the event loop between projects so a large project count doesn't
    // hog the main thread (each project is a handful of sync SQLCipher writes).
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  logger.info('Project store backfill complete', result);
  startupProgress.publish({
    rawLabel: 'subsystem:project-store-backfill:complete',
    detail: `${result.filesPopulated} populated, ${result.storesCreated} stores created${result.errors > 0 ? `, ${result.errors} errors` : ''}`,
    level: result.errors > 0 ? 'warn' : 'info',
  });
  startupProgress.setSubProgress(null);
  return result;
}
