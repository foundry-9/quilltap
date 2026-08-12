/**
 * General (instance-wide) state — read/write helpers for the `state.json`
 * document at the root of the singleton "Quilltap General" mount point.
 *
 * General state is the bottom tier of the four-tier state cascade
 * (chat → project → group → general). It is the instance-wide default layer:
 * keys set here are visible to every chat unless a narrower tier overrides
 * them. There is no entity row for it — it is simply a JSON document living at
 * the mount root, provisioned idempotently at startup the same way character
 * vaults get their `metadata.json` (`ensureCharacterMetadataFile`) and the
 * general mount gets its `Scenarios/` folder (`ensureGeneralScenariosFolder`).
 *
 * All helpers degrade gracefully when the mount has not yet been provisioned
 * (the race window before instrumentation finishes migrations): reads return
 * `{}`, `ensure` no-ops, and only the authenticated `write` path throws.
 *
 * @module mount-index/general-state
 */

import { logger } from '@/lib/logger';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { getRepositories } from '@/lib/repositories/factory';
import {
  readDatabaseDocument,
  writeDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';

/** Relative path of the general state document inside the mount. */
export const GENERAL_STATE_JSON_PATH = 'state.json';

/**
 * Idempotent: ensure a `state.json` exists at the root of the "Quilltap
 * General" mount, seeding an empty `{}` if not.
 *
 * Returns true when it created the file, false when the file already existed
 * or the mount is not yet provisioned. Existence is checked directly rather
 * than by parsing: a body the user has hand-edited into invalid JSON is still
 * their state and must never be "healed" into an empty one — mirroring
 * `ensureCharacterMetadataFile`.
 */
export async function ensureGeneralStateFile(): Promise<boolean> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) {
    return false;
  }

  const repos = getRepositories();
  const existing = await repos.docMountDocuments.findByMountPointAndPath(
    mountPointId,
    GENERAL_STATE_JSON_PATH,
  );
  if (existing) return false;

  await writeDatabaseDocument(mountPointId, GENERAL_STATE_JSON_PATH, '{}');
  return true;
}

/**
 * Read general state. Returns `{}` when the mount is not yet provisioned, the
 * document is missing, or its body is unparseable — the last case warns but
 * never throws, matching the group store overlay's corrupt-`state.json`
 * behaviour (state is not the keystone document).
 */
export async function readGeneralState(): Promise<Record<string, unknown>> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) {
    return {};
  }

  try {
    const { content } = await readDatabaseDocument(mountPointId, GENERAL_STATE_JSON_PATH);
    const parsed = JSON.parse(content) ?? {};
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      logger.warn('[GeneralState] state.json is not a JSON object; defaulting to {}', {
        mountPointId,
      });
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
      return {};
    }
    logger.warn('[GeneralState] state.json unparseable; defaulting to {}', {
      mountPointId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Overwrite general state wholesale. Throws when the mount has not yet been
 * provisioned, since this only fires from authenticated write paths where the
 * mount should already exist (matching `setGeneralScenarioDefault`).
 */
export async function writeGeneralState(state: Record<string, unknown>): Promise<void> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) {
    throw new Error('Quilltap General mount has not been provisioned yet');
  }
  await writeDatabaseDocument(
    mountPointId,
    GENERAL_STATE_JSON_PATH,
    JSON.stringify(state ?? {}, null, 2),
  );
}
