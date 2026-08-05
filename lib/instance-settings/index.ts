/**
 * Instance Settings — Application-Wide Key/Value Store
 *
 * The `instance_settings` table is a tiny key/value store for configuration
 * that belongs to the *server instance* rather than to any particular user.
 * The version guard (`lib/startup/version-guard.ts`) and a couple of
 * startup migrations already use it; this module adds typed helpers for
 * the memory-extraction knobs.
 *
 * Why instance-wide rather than per-user: Quilltap is single-user per
 * instance, but the `chat_settings` table accumulates orphan rows over a
 * database's lifetime (old test users, migrated accounts, etc.). Reading
 * a "knob" from chat_settings means picking the right row out of the pile,
 * which is brittle. The processor concurrency cap and per-hour extraction
 * limits both affect the single background processor that this server
 * runs; they're a property of the instance, not of any user.
 */

import { rawQuery } from '@/lib/database/manager';
import { logger } from '@/lib/logger';
import {
  DataRetentionSettingsSchema,
  type DataRetentionSettings,
  MemoryExtractionLimitsSchema,
  type MemoryExtractionLimits,
  MemoryRecallSettingsSchema,
  type MemoryRecallSettings,
} from '@/lib/schemas/settings.types';

const KEY_MAX_CONCURRENT_JOBS = 'maxConcurrentJobs';
const KEY_MEMORY_EXTRACTION_CONCURRENCY = 'memoryExtractionConcurrency';
const KEY_MEMORY_EXTRACTION_LIMITS = 'memoryExtractionLimits';
const KEY_MEMORY_RECALL = 'memoryRecall';
const KEY_LANTERN_BACKGROUNDS_MOUNT_POINT_ID = 'lanternBackgroundsMountPointId';
const KEY_USER_UPLOADS_MOUNT_POINT_ID = 'userUploadsMountPointId';
const KEY_GENERAL_MOUNT_POINT_ID = 'generalMountPointId';
const KEY_LAST_MAINTENANCE_SWEEP_AT = 'lastMaintenanceSweepAt';
const KEY_DATA_RETENTION = 'dataRetention';

/** Key the version guard writes (see `lib/startup/version-guard.ts`). */
const KEY_HIGHEST_APP_VERSION = 'highest_app_version';

/**
 * Settings that must never leave the instance that wrote them.
 *
 * Keep this list beside the key constants above so adding a setting is a
 * conscious include/exclude decision rather than an accident: the
 * `instance-settings` export type dumps the whole table minus this set, so a
 * new key is portable by default.
 *
 *  - The three mount-point pointers are UUIDs into *this* instance's
 *    mount-index database (the same set backup restore has to remap — see
 *    `MOUNT_POINT_SETTING_KEYS` in `lib/backup/restore/uuid-remap.ts`).
 *    Carrying them over would aim the Lantern, uploads, and general stores at
 *    mount points that don't exist on the receiving instance.
 *  - `lastMaintenanceSweepAt` is local timing state; importing it would make
 *    the receiving instance skip a sweep it never ran.
 *  - `highest_app_version` is the version guard's downgrade tripwire. An
 *    imported value could lock a perfectly healthy instance out of its own
 *    database.
 */
export const NON_PORTABLE_INSTANCE_SETTING_KEYS: ReadonlySet<string> = new Set([
  KEY_LANTERN_BACKGROUNDS_MOUNT_POINT_ID,
  KEY_USER_UPLOADS_MOUNT_POINT_ID,
  KEY_GENERAL_MOUNT_POINT_ID,
  KEY_LAST_MAINTENANCE_SWEEP_AT,
  KEY_HIGHEST_APP_VERSION,
]);

const DEFAULT_MAX_CONCURRENT_JOBS = 4;
const DEFAULT_MEMORY_EXTRACTION_CONCURRENCY = 1;
const DEFAULT_MEMORY_EXTRACTION_LIMITS: MemoryExtractionLimits = {
  enabled: false,
  maxPerHour: 20,
  softStartFraction: 0.7,
  softFloor: 0.7,
};
const DEFAULT_MEMORY_RECALL_SETTINGS: MemoryRecallSettings = {
  scopePolicy: 'down-weight',
  expandRelated: false,
};
const DEFAULT_DATA_RETENTION_SETTINGS: DataRetentionSettings = {
  staleChatDays: 30,
};

async function readSetting(key: string): Promise<string | null> {
  try {
    const rows = (await rawQuery<Array<{ value: string }>>(
      'SELECT "value" FROM "instance_settings" WHERE "key" = ?',
      [key],
    )) ?? [];
    return rows[0]?.value ?? null;
  } catch (error) {
    logger.warn('[InstanceSettings] Failed to read setting', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  await rawQuery(
    'INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?) ' +
      'ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"',
    [key, value],
  );
}

/**
 * Read the per-instance global background-job concurrency cap — the maximum
 * number of jobs of any type the dispatcher runs at once. Returns the
 * documented default (4) when the setting hasn't been written yet; clamped to
 * the supported 1–32 range. The dispatcher re-reads this each claim cycle, so a
 * change takes effect within ~2 s without a restart.
 */
export async function getMaxConcurrentJobs(): Promise<number> {
  const raw = await readSetting(KEY_MAX_CONCURRENT_JOBS);
  if (raw === null) return DEFAULT_MAX_CONCURRENT_JOBS;
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_CONCURRENT_JOBS;
  return Math.max(1, Math.min(32, parsed));
}

export async function setMaxConcurrentJobs(value: number): Promise<void> {
  if (!Number.isFinite(value)) {
    throw new Error('Concurrency must be a finite number');
  }
  const clamped = Math.max(1, Math.min(32, Math.floor(value)));
  await writeSetting(KEY_MAX_CONCURRENT_JOBS, String(clamped));
}

/**
 * Read the per-instance MEMORY_EXTRACTION concurrency cap. Returns the
 * documented default (1) when the setting hasn't been written yet.
 */
export async function getMemoryExtractionConcurrency(): Promise<number> {
  const raw = await readSetting(KEY_MEMORY_EXTRACTION_CONCURRENCY);
  if (raw === null) return DEFAULT_MEMORY_EXTRACTION_CONCURRENCY;
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MEMORY_EXTRACTION_CONCURRENCY;
  return Math.max(1, Math.min(32, parsed));
}

export async function setMemoryExtractionConcurrency(value: number): Promise<void> {
  if (!Number.isFinite(value)) {
    throw new Error('Concurrency must be a finite number');
  }
  const clamped = Math.max(1, Math.min(32, Math.floor(value)));
  await writeSetting(KEY_MEMORY_EXTRACTION_CONCURRENCY, String(clamped));
}

/**
 * Read the per-instance memory extraction rate limits. Returns the
 * documented defaults (off, 20/hour, soft-start 0.7, soft-floor 0.7)
 * when the setting hasn't been written yet.
 */
export async function getMemoryExtractionLimits(): Promise<MemoryExtractionLimits> {
  const raw = await readSetting(KEY_MEMORY_EXTRACTION_LIMITS);
  if (raw === null) return DEFAULT_MEMORY_EXTRACTION_LIMITS;
  try {
    const parsed = JSON.parse(raw);
    return MemoryExtractionLimitsSchema.parse(parsed);
  } catch (error) {
    logger.warn('[InstanceSettings] memoryExtractionLimits failed to parse — using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_MEMORY_EXTRACTION_LIMITS;
  }
}

export async function setMemoryExtractionLimits(value: MemoryExtractionLimits): Promise<void> {
  const validated = MemoryExtractionLimitsSchema.parse(value);
  await writeSetting(KEY_MEMORY_EXTRACTION_LIMITS, JSON.stringify(validated));
}

/**
 * Read the per-instance Commonplace Book recall settings (cross-project scope
 * policy). Returns the documented default (`down-weight`) when the setting
 * hasn't been written yet. Read on the per-turn recall path
 * (`lib/chat/context-manager.ts`, `lib/services/chat-message/pre-compute.service.ts`).
 */
export async function getMemoryRecallSettings(): Promise<MemoryRecallSettings> {
  const raw = await readSetting(KEY_MEMORY_RECALL);
  if (raw === null) return DEFAULT_MEMORY_RECALL_SETTINGS;
  try {
    const parsed = JSON.parse(raw);
    return MemoryRecallSettingsSchema.parse(parsed);
  } catch (error) {
    logger.warn('[InstanceSettings] memoryRecall failed to parse — using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_MEMORY_RECALL_SETTINGS;
  }
}

export async function setMemoryRecallSettings(value: MemoryRecallSettings): Promise<void> {
  const validated = MemoryRecallSettingsSchema.parse(value);
  await writeSetting(KEY_MEMORY_RECALL, JSON.stringify(validated));
}

/**
 * Read the per-instance data-retention settings (the stale-chat window that
 * governs the daily maintenance sweep's cache collapse, image collapse, and
 * conversation-chunk cold-tiering). Returns the documented default (30 days)
 * when the setting hasn't been written yet.
 */
export async function getDataRetentionSettings(): Promise<DataRetentionSettings> {
  const raw = await readSetting(KEY_DATA_RETENTION);
  if (raw === null) return DEFAULT_DATA_RETENTION_SETTINGS;
  try {
    const parsed = JSON.parse(raw);
    return DataRetentionSettingsSchema.parse(parsed);
  } catch (error) {
    logger.warn('[InstanceSettings] dataRetention failed to parse — using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_DATA_RETENTION_SETTINGS;
  }
}

export async function setDataRetentionSettings(value: DataRetentionSettings): Promise<void> {
  const validated = DataRetentionSettingsSchema.parse(value);
  await writeSetting(KEY_DATA_RETENTION, JSON.stringify(validated));
}

/**
 * Read the Lantern Backgrounds mount-point id. The provisioning migration
 * writes this on first boot; runtime callers (the Lantern bridge) read it
 * to find where to land generated story backgrounds when no project context
 * is available.
 */
export async function getLanternBackgroundsMountPointId(): Promise<string | null> {
  return readSetting(KEY_LANTERN_BACKGROUNDS_MOUNT_POINT_ID);
}


/**
 * Read the Quilltap Uploads mount-point id. The provisioning migration writes
 * this on first boot; runtime callers (the user-uploads bridge) read it to
 * find where to land project-less file uploads, image pastes, shell-tool
 * copies, capabilities reports, and restored project-less backup files.
 */
export async function getUserUploadsMountPointId(): Promise<string | null> {
  return readSetting(KEY_USER_UPLOADS_MOUNT_POINT_ID);
}


/**
 * Read the Quilltap General mount-point id. The provisioning migration writes
 * this on first boot; runtime callers (`lib/mount-index/general-scenarios.ts`)
 * read it to find the instance-wide store that houses general chat-starter
 * scenarios offered alongside project and character scenarios.
 */
export async function getGeneralMountPointId(): Promise<string | null> {
  return readSetting(KEY_GENERAL_MOUNT_POINT_ID);
}


/**
 * Read the timestamp of the last completed scheduled maintenance pass, as a
 * `Date`, or `null` if it has never run (or the stored value is unparseable).
 * Note this marks when a pass *finished*, not that every sweep within it
 * succeeded: the scheduler records it at the end of the pass even when an
 * individual sweep failed (failures are isolated and swallowed), so a transient
 * error in one sweep doesn't force a full re-run on the next dev restart.
 *
 * The maintenance scheduler (`lib/background-jobs/scheduled-maintenance.ts`)
 * has no job rows to peek at — unlike the memory-housekeeping scheduler, which
 * short-circuits its startup tick via `backgroundJobs.findRecentByType`. So it
 * persists this timestamp here instead and reads it back at boot to decide
 * whether to skip the dev-restart-friendly startup tick. Instance-scoped and
 * internal: not user-facing, not part of any `.qtap`/SillyTavern export.
 */
export async function getLastMaintenanceSweepAt(): Promise<Date | null> {
  const raw = await readSetting(KEY_LAST_MAINTENANCE_SWEEP_AT);
  if (raw === null) return null;
  const ts = new Date(raw);
  return Number.isNaN(ts.getTime()) ? null : ts;
}

/**
 * Record the timestamp of a completed scheduled maintenance pass (ISO 8601).
 * Written at the end of the pass regardless of whether individual sweeps
 * failed — it tracks "last attempted pass," not "last fully-successful pass."
 */
export async function setLastMaintenanceSweepAt(when: Date = new Date()): Promise<void> {
  await writeSetting(KEY_LAST_MAINTENANCE_SWEEP_AT, when.toISOString());
}

/**
 * Every portable `instance_settings` row, in key order — the payload behind
 * the `instance-settings` export type ("move my setup"). Keys in
 * {@link NON_PORTABLE_INSTANCE_SETTING_KEYS} are withheld.
 *
 * Returns [] when the table is missing (very old databases predating the
 * instance_settings provisioning migration), matching `dumpInstanceSettings`
 * in the backup service.
 */
export async function listPortableInstanceSettings(): Promise<
  Array<{ key: string; value: string }>
> {
  try {
    const rows =
      (await rawQuery<Array<{ key: string; value: string }>>(
        'SELECT "key", "value" FROM "instance_settings" ORDER BY "key"',
      )) ?? [];
    return rows.filter((row) => !NON_PORTABLE_INSTANCE_SETTING_KEYS.has(row.key));
  } catch (error) {
    logger.warn('[InstanceSettings] Failed to list settings for export', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Upsert one raw `instance_settings` row.
 *
 * Exposed for the `instance-settings` importer, which writes values it cannot
 * interpret — the whole point of "move my setup" is that a setting travels
 * without the import path needing a typed helper for it. Prefer the typed
 * setters above everywhere else.
 */
export async function writeInstanceSetting(key: string, value: string): Promise<void> {
  await writeSetting(key, value);
}

// Re-export the schema for callers that want to validate independently.
export { DataRetentionSettingsSchema, MemoryExtractionLimitsSchema, MemoryRecallSettingsSchema };
export type { DataRetentionSettings, MemoryExtractionLimits, MemoryRecallSettings };
