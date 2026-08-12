/**
 * Database Unlock API v1
 *
 * GET /api/v1/system/unlock - Returns database key state, hasUserPassphrase, autoLockMinutes
 * POST /api/v1/system/unlock?action=setup - First-run setup
 * POST /api/v1/system/unlock?action=unlock - Unlock with passphrase
 * POST /api/v1/system/unlock?action=store - Store env var pepper in .dbkey file
 * POST /api/v1/system/unlock?action=change-passphrase - Change the .dbkey passphrase
 * POST /api/v1/system/unlock?action=lock - Lock the application (auto-lock)
 *
 * This endpoint is unauthenticated because it must be accessible before
 * the app is fully operational (during locked mode and initial setup).
 *
 * Replaces the pepper-vault endpoint with .dbkey file-based key management.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, serverError, successResponse, unauthorized } from '@/lib/api/responses';

export const dynamic = 'force-dynamic';

const unlockLogger = logger.child({ module: 'api-unlock' });

type UnlockAction = 'setup' | 'unlock' | 'store' | 'change-passphrase' | 'lock';

/**
 * GET /api/v1/system/unlock
 *
 * Returns the current database key state.
 */
export async function GET() {
  try {
    const { startupState } = await import('@/lib/startup/startup-state');
    const { getDbKeyState, getHasUserPassphrase } = await import('@/lib/startup/dbkey');

    // startupState is the authoritative source (set during instrumentation.ts)
    const state = startupState.getPepperState?.() ?? getDbKeyState();
    const hasUserPassphrase = getHasUserPassphrase();

    // Only fetch autoLockMinutes when the app is unlocked and operational
    let autoLockMinutes: number | null = null;
    if (state === 'resolved') {
      try {
        const { getRepositories } = await import('@/lib/database/repositories');
        const repos = getRepositories();
        // Get chat settings for the default user
        const { SINGLE_USER_ID } = await import('@/lib/auth/single-user');
        const userId = SINGLE_USER_ID;
        const chatSettings = await repos.chatSettings.findByUserId(userId);
        if (chatSettings?.autoLockSettings?.enabled) {
          autoLockMinutes = chatSettings.autoLockSettings.idleMinutes;
        }
      } catch (settingsError) {
        unlockLogger.debug('Could not fetch auto-lock settings', {
          error: settingsError instanceof Error ? settingsError.message : String(settingsError),
        });
      }
    }

    return successResponse({ state, hasUserPassphrase, autoLockMinutes });
  } catch (error) {
    unlockLogger.error('Error getting database key status', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to get database key status');
  }
}

/**
 * POST /api/v1/system/unlock?action=setup|unlock|store
 *
 * Dispatches database key actions.
 */
export async function POST(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action');

  if (!action) {
    return badRequest('Missing action parameter. Use ?action=setup, ?action=unlock, ?action=store, ?action=change-passphrase, or ?action=lock');
  }

  if (!isUnlockAction(action)) {
    return badRequest(`Unknown action: ${action}`);
  }

  const body = await parseRequestBody(request);
  if (body instanceof NextResponse) {
    return body;
  }

  try {
    return dispatchUnlockAction(action, body);
  } catch (error) {
    unlockLogger.error('Error in database key action', {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError(error instanceof Error ? error.message : 'Internal server error');
  }
}

function isUnlockAction(action: string): action is UnlockAction {
  return action === 'setup'
    || action === 'unlock'
    || action === 'store'
    || action === 'change-passphrase'
    || action === 'lock';
}

async function parseRequestBody(request: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return badRequest('Request body must be a JSON object');
    }
    return body as Record<string, unknown>;
  } catch {
    return badRequest('Invalid JSON body');
  }
}

function getPassphrase(body: Record<string, unknown>): string {
  return typeof body.passphrase === 'string' ? body.passphrase : '';
}

function dispatchUnlockAction(action: UnlockAction, body: Record<string, unknown>): Promise<NextResponse> {
  const actionHandlers: Record<UnlockAction, () => Promise<NextResponse>> = {
    setup: () => handleSetup(getPassphrase(body)),
    unlock: () => handleUnlock(getPassphrase(body)),
    store: () => handleStore(getPassphrase(body)),
    'change-passphrase': () => handleChangePassphrase(body),
    lock: () => handleLock(),
  };

  return actionHandlers[action]();
}

/**
 * Handle first-run setup: generate pepper, encrypt, write .dbkey.
 *
 * After setup, any existing plaintext databases are encrypted immediately
 * so there is no window where data sits unencrypted on disk.
 */
async function handleSetup(passphrase: string): Promise<NextResponse> {
  unlockLogger.info('Database key setup requested');

  const { setupDbKey } = await import('@/lib/startup/dbkey');
  const { startupState } = await import('@/lib/startup/startup-state');

  const result = setupDbKey(passphrase);
  startupState.setPepperState('resolved');

  unlockLogger.info('Database key setup complete');

  // Encrypt any existing plaintext databases now — on fresh installs the
  // database is created during migrations (Phase 1) before the user runs
  // setup, so it starts life as plaintext.  Without this, the DB would
  // only get encrypted on the next restart (Phase -0.5b).
  try {
    const fs = await import('fs');
    const { getSQLiteDatabasePath, getLLMLogsDatabasePath } = await import('@/lib/paths');
    const { getDatabaseEncryptionState } = await import('@/lib/startup/db-encryption-state');
    const { convertDatabaseToEncrypted } = await import('@/lib/startup/db-encryption-converter');

    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      // Close any open migration connections before conversion
      try {
        const { closeSQLite } = await import('../../../../../migrations/lib/database-utils');
        closeSQLite();
      } catch { /* ignore */ }

      // Close the main app database singleton if open
      try {
        const { closeSQLiteClient } = await import('@/lib/database/backends/sqlite/client');
        closeSQLiteClient();
      } catch { /* ignore */ }

      for (const dbPath of [getSQLiteDatabasePath(), getLLMLogsDatabasePath()]) {
        if (!fs.default.existsSync(dbPath)) continue;
        const state = getDatabaseEncryptionState(dbPath);
        if (state === 'unknown') {
          unlockLogger.warn('Skipping post-setup encryption — header read failed; will retry on next restart', { dbPath });
          continue;
        }
        if (state === 'plaintext') {
          unlockLogger.info('Encrypting existing plaintext database after setup', { dbPath });
          convertDatabaseToEncrypted(dbPath, pepper);
        }
      }
    }
  } catch (encErr) {
    // Non-fatal — Phase -0.5b will retry on next restart
    unlockLogger.warn('Post-setup database encryption failed (will retry on next restart)', {
      error: encErr instanceof Error ? encErr.message : String(encErr),
    });
  }

  // Return the pepper once for the user to save
  return successResponse({
    pepper: result.pepper,
    message: 'Encryption key generated and stored. Save this value — it will not be displayed again.',
  });
}

/**
 * Handle unlock: decrypt .dbkey file with passphrase, then resume startup.
 *
 * Supports two scenarios:
 * 1. Normal: .dbkey file exists with passphrase — use unlockDbKey()
 * 2. Legacy migration: no .dbkey file but pepper_vault has passphrase — use
 *    legacy unlockPepper(), then migrate to .dbkey format
 */
async function handleUnlock(passphrase: string): Promise<NextResponse> {
  unlockLogger.info('Database key unlock requested');

  if (!passphrase) {
    return badRequest('Passphrase is required to unlock');
  }

  const { unlockDbKey, getDbKeyState, storeEnvPepperInDbKey } = await import('@/lib/startup/dbkey');
  const { startupState } = await import('@/lib/startup/startup-state');

  let success: boolean;
  const dbKeyState = getDbKeyState();

  // Legacy migration: startupState says needs-passphrase but dbkey module
  // is in needs-setup (no .dbkey file). This means the pepper is in the old
  // pepper_vault SQLite table and must be unlocked via the legacy system.
  if (dbKeyState === 'needs-setup' && startupState.getPepperState?.() === 'needs-passphrase') {
    unlockLogger.info('Legacy pepper vault detected — unlocking via pepper-vault migration path');

    const { unlockPepper } = await import('@/lib/startup/pepper-vault');
    success = unlockPepper(passphrase);

    if (success) {
      // Pepper is now in process.env — migrate to .dbkey file format
      unlockLogger.info('Legacy pepper unlocked, migrating to .dbkey file');
      try {
        // Set dbkey state to allow storage, then write the .dbkey file
        (global as any).__quilltapDbKeyState = 'needs-vault-storage';
        storeEnvPepperInDbKey(passphrase);
        unlockLogger.info('Legacy pepper migrated to .dbkey file successfully');
      } catch (migrationError) {
        // Migration to .dbkey failed, but pepper is unlocked — continue anyway
        unlockLogger.warn('Failed to migrate legacy pepper to .dbkey file, continuing with unlocked pepper', {
          error: migrationError instanceof Error ? migrationError.message : String(migrationError),
        });
        (global as any).__quilltapDbKeyState = 'resolved';
      }
    }
  } else {
    success = unlockDbKey(passphrase);
  }

  if (!success) {
    unlockLogger.warn('Database key unlock failed: wrong passphrase');
    return unauthorized('Incorrect passphrase');
  }

  startupState.setPepperState('resolved');

  // If the server was in locked mode, trigger deferred initialization
  if (startupState.getPhase() === 'locked') {
    unlockLogger.info('Server unlocked — triggering deferred startup initialization');
    const { startupProgress } = await import('@/lib/startup/progress');
    startupProgress.setCurrent('subsystem:unlocking');

    // Run the rest of the startup sequence asynchronously
    // (The register() function in instrumentation.ts already returned,
    //  so we need to re-trigger the remaining phases.)
    setImmediate(async () => {
      try {
        const { register } = await import('@/instrumentation');
        await register();
      } catch (err) {
        unlockLogger.error('Deferred startup initialization failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        startupState.setPhase('failed');
        startupState.setError(err instanceof Error ? err.message : String(err));
        startupProgress.publish({
          rawLabel: 'subsystem:errored',
          level: 'error',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  unlockLogger.info('Database key unlocked successfully');
  return successResponse({});
}

/**
 * Handle store: encrypt existing env var pepper into .dbkey file
 */
async function handleStore(passphrase: string): Promise<NextResponse> {
  unlockLogger.info('Database key store requested');

  const { storeEnvPepperInDbKey } = await import('@/lib/startup/dbkey');
  const { startupState } = await import('@/lib/startup/startup-state');

  storeEnvPepperInDbKey(passphrase);
  startupState.setPepperState('resolved');

  unlockLogger.info('Pepper stored in .dbkey file successfully');
  return successResponse({});
}

/**
 * Handle change-passphrase: re-wrap the pepper in a new .dbkey with a different passphrase.
 *
 * Requires the app to be in 'resolved' state (unlocked).
 * Accepts { oldPassphrase, newPassphrase } — either can be empty string
 * (empty = no passphrase / internal sentinel).
 *
 * After the `.dbkey` re-wrap succeeds, every ARCHIVE bundle is re-encrypted
 * from the old passphrase to the new one (§4.2c of the character-archive
 * spec) — archives are encrypted under the passphrase, not the pepper, and
 * would otherwise silently still want the old one. A partial failure there
 * does NOT fail the passphrase change (which has already happened); the
 * response's `archives` summary names the bundles left behind so the UI can
 * report them.
 */
async function handleChangePassphrase(body: Record<string, unknown>): Promise<NextResponse> {
  unlockLogger.info('Passphrase change requested');

  const { getDbKeyState, changePassphrase, INTERNAL_PASSPHRASE } = await import('@/lib/startup/dbkey');
  const state = getDbKeyState();

  if (state !== 'resolved') {
    unlockLogger.warn('Cannot change passphrase: app not unlocked', { state });
    return badRequest('Application must be unlocked before changing the passphrase');
  }

  const oldPassphrase = typeof body.oldPassphrase === 'string' ? body.oldPassphrase : '';
  const newPassphrase = typeof body.newPassphrase === 'string' ? body.newPassphrase : '';

  const result = changePassphrase(oldPassphrase, newPassphrase);

  if (!result.success) {
    unlockLogger.warn('Passphrase change failed', { error: result.error });
    return unauthorized(result.error || 'Passphrase change failed');
  }

  // Phase two: rewrite the archive library under the new passphrase, using
  // the same empty-string → internal-sentinel rule changePassphrase applied.
  let archives;
  try {
    const { reencryptArchiveBundles } = await import('@/lib/characters/archive-reencrypt');
    archives = await reencryptArchiveBundles(
      oldPassphrase.length > 0 ? oldPassphrase : INTERNAL_PASSPHRASE,
      newPassphrase.length > 0 ? newPassphrase : INTERNAL_PASSPHRASE
    );
  } catch (error) {
    // The passphrase change itself already succeeded; report the archive
    // sweep as wholly failed rather than pretending it ran.
    unlockLogger.error('Archive re-encryption pass failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    archives = {
      total: -1,
      reencrypted: 0,
      failures: [
        {
          fileId: '',
          filename: '(all archives)',
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  unlockLogger.info('Passphrase changed successfully', {
    archivesTotal: archives.total,
    archivesReencrypted: archives.reencrypted,
    archivesFailed: archives.failures.length,
  });
  return successResponse({ success: true, archives });
}

/**
 * Handle lock: clear pepper from memory and close DB connections.
 * Used by the auto-lock idle timer to re-lock the application.
 */
async function handleLock(): Promise<NextResponse> {
  unlockLogger.info('Auto-lock triggered — locking database');

  const { getDbKeyState, lockDbKey, getHasUserPassphrase } = await import('@/lib/startup/dbkey');
  const state = getDbKeyState();

  if (state !== 'resolved') {
    unlockLogger.warn('Cannot lock: app not in resolved state', { state });
    return badRequest('Application is not currently unlocked');
  }

  if (!getHasUserPassphrase()) {
    unlockLogger.warn('Cannot lock: no user passphrase set');
    return badRequest('Cannot lock without a user passphrase');
  }

  // Close database connections
  try {
    const { closeSQLiteClient } = await import('@/lib/database/backends/sqlite/client');
    closeSQLiteClient();
  } catch (closeErr) {
    unlockLogger.warn('Error closing main SQLite client during lock', {
      error: closeErr instanceof Error ? closeErr.message : String(closeErr),
    });
  }

  try {
    const { closeLLMLogsSQLiteClient } = await import('@/lib/database/backends/sqlite/llm-logs-client');
    closeLLMLogsSQLiteClient();
  } catch (closeErr) {
    unlockLogger.warn('Error closing LLM logs SQLite client during lock', {
      error: closeErr instanceof Error ? closeErr.message : String(closeErr),
    });
  }

  // Clear the pepper and set state to locked
  lockDbKey();

  const { startupState } = await import('@/lib/startup/startup-state');
  startupState.setPepperState('needs-passphrase');
  startupState.setPhase('locked');

  unlockLogger.info('Application locked successfully via auto-lock');
  return successResponse({});
}
