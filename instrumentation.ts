/**
 * Next.js Instrumentation
 *
 * This file is automatically run by Next.js on server startup.
 * We use it to:
 * 1. Run migrations FIRST - before any requests can be served
 * 2. Seed initial data (on first startup)
 * 3. Initialize the plugin system
 * 4. Initialize file storage
 *
 * CRITICAL: Migrations MUST complete successfully before the server accepts requests.
 * If migrations fail, the process exits with code 1 to prevent serving stale data.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in Node.js runtime (not Edge Runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // ================================================================
    // PHASE -1: Pre-materialize cloud-evicted data files
    // ================================================================
    // Instances stored in a cloud-synced folder (iCloud Drive, etc.) can have
    // their database files evicted to dataless placeholders. Opening one before
    // the provider rehydrates it yields "file is not a database" / partial reads
    // that wedge startup. Force the top-level data/ files to download BEFORE
    // anything — even the .dbkey below — reads them. Best-effort and bounded:
    // it never throws and a stalled download trips a stall guard rather than
    // hanging the boot. The logger isn't imported yet, so failures go to the
    // console; the existing retry-next-restart path is the backstop.
    if (process.env.SKIP_ENV_VALIDATION !== 'true' &&
        process.env.NEXT_PHASE !== 'phase-production-build') {
      try {
        const { materializeDataDirFiles } = await import('./lib/startup/materialize-cloud-files');
        await materializeDataDirFiles();
      } catch (err) {
        console.warn(
          '[startup] cloud-file pre-materialization failed (continuing):',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ================================================================
    // PHASE -0.5a: Database Key Provisioning (before env validation)
    // ================================================================
    // Must run before logger/env imports since those now allow optional pepper.
    // Uses standalone migration logger and file-based .dbkey system.
    let dbKeyState: string = 'needs-setup';
    if (process.env.SKIP_ENV_VALIDATION !== 'true' &&
        process.env.NEXT_PHASE !== 'phase-production-build') {
      const { provisionDbKey } = await import('./lib/startup/dbkey');
      dbKeyState = await provisionDbKey();

      // If dbkey returned needs-setup, check if there's an old pepper_vault
      // table in the plaintext DB that we can extract from
      if (dbKeyState === 'needs-setup') {
        try {
          const { getSQLiteDatabasePath } = await import('./lib/paths');
          const fs = await import('fs');
          const dbPath = getSQLiteDatabasePath();

          if (fs.default.existsSync(dbPath)) {
            // Try to extract pepper from old pepper_vault using legacy system
            const { provisionPepper } = await import('./lib/startup/pepper-vault');
            const legacyState = await provisionPepper();

            if (legacyState === 'resolved' || legacyState === 'needs-vault-storage') {
              // Successfully extracted pepper from old vault — write .dbkey file
              const { storeEnvPepperInDbKey, getDbKeyState } = await import('./lib/startup/dbkey');
              // Override the state to allow storage
              (global as any).__quilltapDbKeyState = 'needs-vault-storage';
              storeEnvPepperInDbKey('');
              dbKeyState = 'resolved';
            } else if (legacyState === 'needs-unlock') {
              // Old vault has a passphrase — user needs to unlock via old system first
              dbKeyState = 'needs-passphrase';
            }
          }
        } catch {
          // Legacy extraction failed — fall through to normal setup flow
        }
      }

      // Store state temporarily on global for transfer to startupState after import
      (global as any).__quilltapPepperState = dbKeyState;
    }

    // Use dynamic import for logger to avoid Edge Runtime issues
    const { logger } = await import('./lib/logger');
    const { startupState } = await import('./lib/startup/startup-state');
    const { startupProgress } = await import('./lib/startup/progress');

    startupProgress.setCurrent('subsystem:booting');

    // Transfer pepper state from global to startupState
    if ((global as any).__quilltapPepperState) {
      startupState.setPepperState((global as any).__quilltapPepperState);
    }

    // If in locked mode, stop here and wait for passphrase via unlock endpoint
    if (startupState.isLockedMode()) {
      startupState.setPhase('locked');
      startupProgress.setCurrent('subsystem:locked');
      logger.info('Server entering locked mode — passphrase required to proceed', {
        context: 'instrumentation.register',
        dbKeyState: startupState.getPepperState(),
      });
      return;
    }

    logger.info('Server starting - initializing services', {
      context: 'instrumentation.register',
      runtime: process.env.NEXT_RUNTIME,
      nodeVersion: process.version,
    });

    // ================================================================
    // PHASE -1: Enforce Single User Mode (before anything else)
    // ================================================================
    // This check MUST happen before any other initialization to prevent
    // starting with unsupported authentication configuration.
    const { enforceSingleUserMode } = await import('./lib/startup/enforce-single-user');
    enforceSingleUserMode();

    try {
      // ================================================================
      // PHASE 0: Migrate Legacy Data Files (before any database access)
      // ================================================================
      // This MUST happen before database initialization to copy the actual database
      const {
        ensureDataDirectoriesExist,
        getPlatform,
        getBaseDataDirWithSource,
        getDataDir,
        getFilesDir,
        getLegacyPaths,
        hasMigrationMarker,
        createMigrationMarker,
      } = await import('./lib/paths');
      const fs = await import('fs');
      const path = await import('path');

      const platform = getPlatform();
      const baseDirInfo = getBaseDataDirWithSource();
      const baseDir = baseDirInfo.path;

      logger.info('Quilltap data directory configuration', {
        context: 'instrumentation.register',
        baseDir,
        source: baseDirInfo.source,
        sourceDescription: baseDirInfo.sourceDescription,
        platform,
      });

      logger.info('Phase 0: Ensuring data directories exist', {
        context: 'instrumentation.register',
        platform,
        baseDir,
      });

      // Create directories first
      ensureDataDirectoriesExist();

      // On macOS/Windows, check if we need to copy legacy data BEFORE database init
      if (platform === 'darwin' || platform === 'win32') {
        const legacy = getLegacyPaths();
        const newDataDir = getDataDir();
        const newFilesDir = getFilesDir();
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const legacyBase = path.default.join(homeDir, '.quilltap');

        // Only migrate if paths are different
        if (path.default.resolve(baseDir) !== path.default.resolve(legacyBase)) {
          // Check for legacy database at ~/.quilltap/data/quilltap.db
          const legacyDbPath = path.default.join(legacy.homeDataDir, 'quilltap.db');
          const newDbPath = path.default.join(newDataDir, 'quilltap.db');

          if (fs.default.existsSync(legacyDbPath) && !hasMigrationMarker(legacy.homeDataDir)) {
            // Check if new database doesn't exist OR is much smaller (empty)
            let shouldCopy = !fs.default.existsSync(newDbPath);
            if (!shouldCopy) {
              const legacySize = fs.default.statSync(legacyDbPath).size;
              const newSize = fs.default.statSync(newDbPath).size;
              // If new file is less than 10% the size of old, it's probably empty
              shouldCopy = newSize < legacySize * 0.1;
            }

            if (shouldCopy) {
              logger.info('Copying legacy database to new location', {
                context: 'instrumentation.register',
                from: legacyDbPath,
                to: newDbPath,
              });

              try {
                fs.default.copyFileSync(legacyDbPath, newDbPath);
                // Also copy WAL files if they exist
                const walPath = legacyDbPath + '-wal';
                const shmPath = legacyDbPath + '-shm';
                if (fs.default.existsSync(walPath)) {
                  fs.default.copyFileSync(walPath, newDbPath + '-wal');
                }
                if (fs.default.existsSync(shmPath)) {
                  fs.default.copyFileSync(shmPath, newDbPath + '-shm');
                }
                createMigrationMarker(legacy.homeDataDir, newDataDir);
                logger.info('Legacy database copied successfully', {
                  context: 'instrumentation.register',
                });
              } catch (err) {
                logger.error('Failed to copy legacy database', {
                  context: 'instrumentation.register',
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }

          // Check for legacy files at ~/.quilltap/files
          if (fs.default.existsSync(legacy.filesDir) && !hasMigrationMarker(legacy.filesDir)) {
            const files = fs.default.readdirSync(legacy.filesDir);
            if (files.length > 0 && files.some(f => f !== '.MIGRATED')) {
              logger.info('Copying legacy files to new location', {
                context: 'instrumentation.register',
                from: legacy.filesDir,
                to: newFilesDir,
              });

              try {
                // Copy files recursively
                const copyRecursive = (src: string, dest: string) => {
                  const entries = fs.default.readdirSync(src, { withFileTypes: true });
                  for (const entry of entries) {
                    if (entry.name === '.MIGRATED') continue;
                    const srcPath = path.default.join(src, entry.name);
                    const destPath = path.default.join(dest, entry.name);
                    if (entry.isDirectory()) {
                      if (!fs.default.existsSync(destPath)) {
                        fs.default.mkdirSync(destPath, { recursive: true });
                      }
                      copyRecursive(srcPath, destPath);
                    } else if (!fs.default.existsSync(destPath)) {
                      fs.default.copyFileSync(srcPath, destPath);
                    }
                  }
                };
                copyRecursive(legacy.filesDir, newFilesDir);
                createMigrationMarker(legacy.filesDir, newFilesDir);
                logger.info('Legacy files copied successfully', {
                  context: 'instrumentation.register',
                });
              } catch (err) {
                logger.error('Failed to copy legacy files', {
                  context: 'instrumentation.register',
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
        }
      }

      // ================================================================
      // PHASE -0.5b: DB Encryption Conversion (plaintext → SQLCipher)
      // ================================================================
      // Only runs if: pepper is resolved + DB file exists + DB is plaintext
      if (startupState.isPepperResolved() && process.env.ENCRYPTION_MASTER_PEPPER) {
        // Close any existing database connections before encryption conversion.
        // During deferred startup (after passphrase unlock), the pepper-vault
        // provisioning or other code may have left connections open.
        try {
          const { closeSQLite } = await import('./migrations/lib/database-utils');
          closeSQLite();
        } catch { /* ignore — module may not be loaded yet */ }

        const { getSQLiteDatabasePath, getLLMLogsDatabasePath, getMountIndexDatabasePath } = await import('./lib/paths');
        const { getDatabaseEncryptionState } = await import('./lib/startup/db-encryption-state');
        const { convertDatabaseToEncrypted } = await import('./lib/startup/db-encryption-converter');
        const fsMod = await import('fs');

        const mainDbPath = getSQLiteDatabasePath();
        const llmLogsDbPath = getLLMLogsDatabasePath();
        const mountIndexDbPath = getMountIndexDatabasePath();
        const pepper = process.env.ENCRYPTION_MASTER_PEPPER;

        // Convert main database if it exists and is plaintext.
        // Skip on `unknown` (transient read failure) — re-encrypting a DB
        // we couldn't verify is far worse than waiting for the next restart.
        if (fsMod.default.existsSync(mainDbPath)) {
          const state = getDatabaseEncryptionState(mainDbPath);
          if (state === 'unknown') {
            logger.warn('Skipping main database encryption check — header read failed; will retry on next restart', {
              context: 'instrumentation.register',
              dbPath: mainDbPath,
            });
          } else if (state === 'plaintext') {
            logger.info('Phase -0.5b: Converting main database to encrypted format', {
              context: 'instrumentation.register',
              dbPath: mainDbPath,
            });

            try {
              convertDatabaseToEncrypted(mainDbPath, pepper);
              logger.info('Main database encryption conversion complete', {
                context: 'instrumentation.register',
              });
            } catch (convErr) {
              logger.error('Main database encryption conversion FAILED', {
                context: 'instrumentation.register',
                error: convErr instanceof Error ? convErr.message : String(convErr),
              });
              // Fatal — can't proceed with inconsistent encryption state
              process.exit(1);
            }
          }
        }

        // Convert LLM logs database if it exists and is plaintext
        if (fsMod.default.existsSync(llmLogsDbPath)) {
          const state = getDatabaseEncryptionState(llmLogsDbPath);
          if (state === 'unknown') {
            logger.warn('Skipping LLM logs encryption check — header read failed; will retry on next restart', {
              context: 'instrumentation.register',
              dbPath: llmLogsDbPath,
            });
          } else if (state === 'plaintext') {
            logger.info('Phase -0.5b: Converting LLM logs database to encrypted format', {
              context: 'instrumentation.register',
              dbPath: llmLogsDbPath,
            });

            try {
              convertDatabaseToEncrypted(llmLogsDbPath, pepper);
              logger.info('LLM logs database encryption conversion complete', {
                context: 'instrumentation.register',
              });
            } catch (convErr) {
              logger.warn('LLM logs database encryption conversion failed — continuing', {
                context: 'instrumentation.register',
                error: convErr instanceof Error ? convErr.message : String(convErr),
              });
              // Non-fatal for LLM logs — they're expendable
            }
          }
        }

        // Convert mount index database if it exists and is plaintext
        if (fsMod.default.existsSync(mountIndexDbPath)) {
          const state = getDatabaseEncryptionState(mountIndexDbPath);
          if (state === 'unknown') {
            logger.warn('Skipping mount index encryption check — header read failed; will retry on next restart', {
              context: 'instrumentation.register',
              dbPath: mountIndexDbPath,
            });
          } else if (state === 'plaintext') {
            logger.info('Phase -0.5b: Converting mount index database to encrypted format', {
              context: 'instrumentation.register',
              dbPath: mountIndexDbPath,
            });

            try {
              convertDatabaseToEncrypted(mountIndexDbPath, pepper);
              logger.info('Mount index database encryption conversion complete', {
                context: 'instrumentation.register',
              });
            } catch (convErr) {
              logger.warn('Mount index database encryption conversion failed — continuing', {
                context: 'instrumentation.register',
                error: convErr instanceof Error ? convErr.message : String(convErr),
              });
              // Non-fatal for mount index — it can be rebuilt
            }
          }
        }
      }

      // ================================================================
      // PHASE 0.5: Version Guard (before migrations)
      // ================================================================
      // Prevents an older app version from running against a database
      // that was touched by a newer version (which could have run
      // schema-altering migrations).
      {
        const { checkVersionGuard } = await import('./lib/startup/version-guard');
        const versionGuardResult = await checkVersionGuard();

        if (versionGuardResult.blocked) {
          logger.error('Version guard: database was modified by a newer Quilltap version', {
            context: 'instrumentation.register',
            currentVersion: versionGuardResult.currentVersion,
            highestVersion: versionGuardResult.highestVersion,
          });
          startupState.setVersionGuardBlock({
            currentVersion: versionGuardResult.currentVersion,
            highestVersion: versionGuardResult.highestVersion,
          });
          // Keep server alive for Electron UI but block all data access
          return;
        }
      }

      // ================================================================
      // PHASE 1: Run Migrations FIRST - before anything else
      // ================================================================
      // This ensures data compatibility before any API requests
      startupState.setPhase('migrations');
      startupProgress.setCurrent('subsystem:migrations:start');

      const { MigrationRunner } = await import('./migrations');
      const migrationRunner = new MigrationRunner();

      logger.info('Running startup migrations', {
        context: 'instrumentation.register',
      });

      const migrationResult = await migrationRunner.runMigrations();

      if (!migrationResult.success) {
        logger.error('Migrations failed - cannot start server', {
          context: 'instrumentation.register',
          failedMigrations: migrationResult.failed,
          error: migrationResult.error,
          migrationsRun: migrationResult.migrationsRun,
          migrationsSkipped: migrationResult.migrationsSkipped,
        });
        // Exit with code 1 to prevent container from starting with incompatible data
        process.exit(1);
      }

      logger.info('Migrations completed successfully', {
        context: 'instrumentation.register',
        migrationsRun: migrationResult.migrationsRun,
        migrationsSkipped: migrationResult.migrationsSkipped,
        totalDurationMs: migrationResult.totalDurationMs,
      });

      // Mark migrations as complete
      startupState.markMigrationsComplete();
      startupProgress.publish({ rawLabel: 'subsystem:migrations:complete', detail: `${migrationResult.migrationsRun} migrations run, ${migrationResult.migrationsSkipped} already current` });

      // Store current version in instance_settings so future older versions
      // know not to touch this database
      {
        const { storeCurrentVersion } = await import('./lib/startup/version-guard');
        await storeCurrentVersion();
      }

      // Clean up migration runner's database connection
      await migrationRunner.cleanup();

      // ================================================================
      // PHASE 1.1: Auto-repair TEXT embeddings
      // ================================================================
      // Hot-reloads can cause embeddings to be written as JSON text instead
      // of Float32 BLOBs. This converts any TEXT embeddings back to BLOBs.
      try {
        const { repairTextEmbeddings } = await import('./lib/startup/repair-text-embeddings');
        await repairTextEmbeddings();
      } catch (repairError) {
        // Non-fatal — don't block startup
        logger.warn('TEXT embedding repair failed, continuing startup', {
          context: 'instrumentation.register',
          error: repairError instanceof Error ? repairError.message : String(repairError),
        });
      }

      // ================================================================
      // PHASE 1.25: Seed Initial Data (first startup only)
      // ================================================================
      // Seeds default character(s) when database is empty
      startupState.setPhase('seeding');
      startupProgress.setCurrent('subsystem:seeding');

      try {
        const { seedInitialData } = await import('./lib/startup/seed-initial-data');
        await seedInitialData();
      } catch (seedError) {
        // Seeding failure should not block startup
        logger.warn('Error during initial data seeding, continuing startup', {
          context: 'instrumentation.register',
          error: seedError instanceof Error ? seedError.message : String(seedError),
        });
      }

      // ================================================================
      // PHASE 1.5: Auto-upgrade npm-installed plugins
      // ================================================================
      startupState.setPhase('plugin-updates');
      startupProgress.setCurrent('subsystem:plugin-updates:start', { prettyLabel: 'Polishing the plugin brass' });

      try {
        const { checkForUpdates } = await import('./lib/plugins/version-checker');
        const { upgradePlugins } = await import('./lib/plugins/upgrader');

        const updates = await checkForUpdates();
        const nonBreakingUpdates = updates.filter(u => u.isNonBreaking);

        if (nonBreakingUpdates.length > 0) {
          logger.info('Non-breaking plugin updates available, upgrading', {
            context: 'instrumentation.register',
            count: nonBreakingUpdates.length,
            plugins: nonBreakingUpdates.map(u => `${u.packageName}@${u.currentVersion} -> ${u.latestVersion}`),
          });

          const results = await upgradePlugins(nonBreakingUpdates);
          startupState.setPluginUpgrades(results);

          logger.info('Plugin auto-upgrade complete', {
            context: 'instrumentation.register',
            upgraded: results.upgraded.length,
            failed: results.failed.length,
          });
        } else if (updates.length > 0) {
          // Only breaking updates available
          logger.info('Only breaking plugin updates available, skipping auto-upgrade', {
            context: 'instrumentation.register',
            breakingUpdates: updates.filter(u => !u.isNonBreaking).map(u => `${u.packageName}@${u.currentVersion} -> ${u.latestVersion}`),
          });
        } else {
          logger.info('No plugin updates available', {
            context: 'instrumentation.register',
          });
        }
      } catch (pluginUpdateError) {
        // Plugin updates failing should not block startup
        logger.warn('Error during plugin auto-upgrade, continuing startup', {
          context: 'instrumentation.register',
          error: pluginUpdateError instanceof Error ? pluginUpdateError.message : String(pluginUpdateError),
        });
      }

      // ================================================================
      // PHASE 2: Initialize Plugins (MongoDB support removed)
      // ================================================================
      const { initializePlugins } = await import('./lib/startup/plugin-initialization');
      startupState.setPhase('plugins');
      startupProgress.setCurrent('subsystem:plugins:start');
      const result = await initializePlugins();

      if (result.success) {
        logger.info('Plugin system initialized successfully', {
          context: 'instrumentation.register',
          total: result.stats.total,
          enabled: result.stats.enabled,
          disabled: result.stats.disabled,
          errors: result.stats.errors,
        });
      } else {
        logger.error('Plugin system initialization failed', {
          context: 'instrumentation.register',
          stats: result.stats,
          errors: result.errors,
        });
      }

      // ================================================================
      // PHASE 3: Initialize File Storage
      // ================================================================
      const { fileStorageManager } = await import('./lib/file-storage/manager');
      startupState.setPhase('file-storage');
      startupProgress.setCurrent('subsystem:file-storage:start');
      if (!fileStorageManager.isInitialized()) {
        await fileStorageManager.initialize();
      }

      // ================================================================
      // PHASE 3.25: Filesystem Reconciliation (after file storage init)
      // ================================================================
      try {
        const { reconcileFilesystem } = await import('./lib/file-storage/reconciliation');
        await reconcileFilesystem();
      } catch (reconcileError) {
        logger.warn('Error during filesystem reconciliation, continuing startup', {
          context: 'instrumentation.register',
          error: reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
        });
      }

      // ================================================================
      // PHASE 3.2: Character Vault Backfill (fire-and-forget)
      // ================================================================
      // For every Character that isn't already linked to a character
      // document store, create a database-backed vault, scaffold the
      // preset structure, and populate it with the character's current
      // data. Idempotent — linked characters are skipped.
      //
      // Runs asynchronously so the sync SQLCipher writes (hundreds to
      // thousands, depending on character count and prompt/scenario
      // density) don't stall the event loop during startup. New vaults
      // will be picked up on the next mount-point scan pass.
      // Promises for the two fire-and-forget background backfills below. They
      // finish well after the server is `isReady`, so the UI startup gate
      // holds the progress screen until both settle (see markBackgroundSettled
      // after Phase 4). Default to resolved so an import failure can't wedge
      // the gate.
      let vaultBackfillSettled: Promise<unknown> = Promise.resolve();
      let mountScanSettled: Promise<unknown> = Promise.resolve();

      try {
        const { backfillCharacterVaults } = await import('./lib/startup/backfill-character-vaults');
        vaultBackfillSettled = backfillCharacterVaults()
          .then(async () => {
            // Chained after backfill so newly created vaults (already in the
            // new shape) aren't visited a second time for no reason.
            const { migrateVaultPhysicalFiles } = await import(
              './lib/startup/migrate-vault-physical-files'
            );
            await migrateVaultPhysicalFiles();

            // One-time projection of every linked vault's wardrobe into the
            // Wardrobe/<title>.md + Outfits/<name>.md folder layout, deleting
            // the legacy wardrobe.json on the way out. Gated by an
            // instance_settings flag so steady-state startups no-op.
            const { refreshVaultWardrobe } = await import(
              './lib/startup/refresh-vault-wardrobe'
            );
            await refreshVaultWardrobe();

            // Wardrobe vault cutover for shared items: move the legacy
            // `characterId = null` archetype rows into the Quilltap General
            // mount's Wardrobe/ folder and drop them from the DB. Must run
            // here (post mount-index init), not as a migration. Idempotent.
            const { moveSharedWardrobeToGeneral } = await import(
              './lib/startup/move-shared-wardrobe-to-general'
            );
            await moveSharedWardrobeToGeneral();

            // One-time scan that enqueues a head-and-shoulders portrait-prompt
            // backfill job for every character that has appearance text but no
            // `headAndShouldersPrompt` yet (avatars prefer that variant). Jobs
            // are enqueued (never run inline) so a large library can't block
            // startup; gated by an instance_settings flag. Runs last so every
            // character already has a vault to write the result back into.
            const { enqueueHeadShouldersBackfill } = await import(
              './lib/startup/enqueue-headshoulders-backfill'
            );
            await enqueueHeadShouldersBackfill();
          })
          .catch((backfillError) => {
            logger.warn('Error during character vault backfill or physical-file migration', {
              context: 'instrumentation.register',
              error: backfillError instanceof Error ? backfillError.message : String(backfillError),
            });
          });
      } catch (backfillImportError) {
        logger.warn('Failed to import character vault backfill module', {
          context: 'instrumentation.register',
          error: backfillImportError instanceof Error ? backfillImportError.message : String(backfillImportError),
        });
      }

      // ================================================================
      // PHASE 3.3: Document Mount Point Scan (after filesystem ready)
      // ================================================================
      // Fire-and-forget: scan runs asynchronously so large vaults don't
      // block server startup. Embedding jobs are enqueued during scan
      // and processed by the background job processor after Phase 3.5.
      try {
        const { scanAllMountPoints } = await import('./lib/mount-index/scan-runner');
        mountScanSettled = scanAllMountPoints().catch((scanError) => {
          logger.warn('Document mount point scan failed', {
            context: 'instrumentation.register',
            error: scanError instanceof Error ? scanError.message : String(scanError),
          });
        });
      } catch (mountScanError) {
        logger.warn('Error initializing document mount point scanner, continuing startup', {
          context: 'instrumentation.register',
          error: mountScanError instanceof Error ? mountScanError.message : String(mountScanError),
        });
      }

      // ================================================================
      // PHASE 3.3b: Reap orphaned doc-store children (Bug 9)
      // ================================================================
      // Sweep links/folders/documents whose mount point no longer exists —
      // orphans a pre-fix non-atomic store delete (or a hand-built index) left
      // behind. Read connections keep FKs off, so these sit silent until a
      // backup carries them into a restore that fails with a FK error. Cheap,
      // synchronous, and idempotent; the daily maintenance sweep repeats it.
      try {
        const { getRepositories } = await import('./lib/repositories/factory');
        await getRepositories().docMountFileLinks.sweepOrphanedStoreChildren();
      } catch (reapError) {
        logger.warn('Error reaping orphaned doc-store children, continuing startup', {
          context: 'instrumentation.register',
          error: reapError instanceof Error ? reapError.message : String(reapError),
        });
      }

      // ================================================================
      // PHASE 3.4a: Project Store Backfill
      // ================================================================
      // For every project, ensure its official document store is populated
      // with the four overlay files (description.md / instructions.md /
      // state.json / properties.json). The project-store read overlay reads
      // from these files with no DB-column fallback, so they must exist before
      // any overlay read. The cutover migration populates them authoritatively
      // (pre-Phase 3); this is the self-heal for imports and any project a
      // blocked migration left storeless while its columns still exist.
      // Synchronous so files exist before the first request hits.
      try {
        const { backfillProjectStores } = await import('./lib/startup/backfill-project-stores');
        await backfillProjectStores();
      } catch (backfillError) {
        logger.warn('Error during project store backfill, continuing startup', {
          context: 'instrumentation.register',
          error: backfillError instanceof Error ? backfillError.message : String(backfillError),
        });
      }

      // ================================================================
      // PHASE 3.4: Ensure Project Scenario Infrastructure
      // ================================================================
      // For every project, make sure `officialMountPointId` is populated
      // (creating a `Project Files: <name>` store if needed) and the
      // `Scenarios/` folder exists inside it. Idempotent — steady-state
      // boots are a no-op for healed projects. Synchronous so newly
      // created stores are visible before the first request hits.
      try {
        const { ensureProjectScenariosForAllProjects } = await import(
          './lib/startup/ensure-project-scenarios'
        );
        await ensureProjectScenariosForAllProjects();
      } catch (ensureError) {
        logger.warn('Error ensuring project scenario infrastructure, continuing startup', {
          context: 'instrumentation.register',
          error: ensureError instanceof Error ? ensureError.message : String(ensureError),
        });
      }

      // ================================================================
      // PHASE 3.4b: Group store backfill + scenario/knowledge infrastructure
      // ================================================================
      // Groups mirror projects: each group's official store holds
      // description.md / properties.json / state.json plus Scenarios/ and
      // Knowledge/ folders. Backfill populates store files for any group whose
      // store is missing them (imports / a blocked migration), then ensure the
      // official store pointer and the two folders exist. Both idempotent and
      // synchronous so stores are visible before the first request hits.
      try {
        const { backfillGroupStores } = await import('./lib/startup/backfill-group-stores');
        await backfillGroupStores();
      } catch (backfillError) {
        logger.warn('Error during group store backfill, continuing startup', {
          context: 'instrumentation.register',
          error: backfillError instanceof Error ? backfillError.message : String(backfillError),
        });
      }
      try {
        const { ensureGroupScenariosForAllGroups } = await import(
          './lib/startup/ensure-group-scenarios'
        );
        await ensureGroupScenariosForAllGroups();
      } catch (ensureError) {
        logger.warn('Error ensuring group scenario infrastructure, continuing startup', {
          context: 'instrumentation.register',
          error: ensureError instanceof Error ? ensureError.message : String(ensureError),
        });
      }

      // Companion: ensure the instance-wide "Quilltap General" mount has its
      // Scenarios/ folder. Idempotent and silent when the provisioning
      // migration hasn't run yet (returns null mountPointId).
      try {
        const { ensureGeneralScenariosFolder } = await import(
          './lib/mount-index/general-scenarios'
        );
        await ensureGeneralScenariosFolder();
      } catch (ensureError) {
        logger.warn('Error ensuring general scenarios folder, continuing startup', {
          context: 'instrumentation.register',
          error: ensureError instanceof Error ? ensureError.message : String(ensureError),
        });
      }

      // Companion: ensure the instance-wide "Quilltap General" mount has its
      // root state.json (the bottom tier of the state cascade). Idempotent and
      // silent when the mount hasn't been provisioned yet; never heals existing
      // content.
      try {
        const { ensureGeneralStateFile } = await import(
          './lib/mount-index/general-state'
        );
        const seeded = await ensureGeneralStateFile();
        if (seeded) {
          logger.info('Seeded general state.json in the Quilltap General mount', {
            context: 'instrumentation.register',
          });
        }
      } catch (ensureError) {
        logger.warn('Error ensuring general state.json, continuing startup', {
          context: 'instrumentation.register',
          error: ensureError instanceof Error ? ensureError.message : String(ensureError),
        });
      }

      // ================================================================
      // PHASE 3.5: Start Background Schedulers (non-critical)
      // ================================================================
      try {
        const { scheduleCleanup } = await import('./lib/background-jobs/scheduled-cleanup');
        scheduleCleanup();

        const { scheduleHousekeeping } = await import('./lib/background-jobs/scheduled-housekeeping');
        scheduleHousekeeping();

        const { scheduleMaintenance } = await import('./lib/background-jobs/scheduled-maintenance');
        scheduleMaintenance();

        const { scheduleDangerScan } = await import('./lib/background-jobs/scheduled-danger-scan');
        await scheduleDangerScan();

        // Reconcile autonomous-room rows that were mid-run when the server
        // last shut down. Must happen BEFORE scheduleAutonomousRooms() ticks,
        // so we don't race a fresh schedule against a stuck-running row.
        try {
          const { reconcileAutonomousRunsAtStartup } = await import('./lib/services/chat-message/autonomous-room.service');
          await reconcileAutonomousRunsAtStartup();
        } catch (reconcileError) {
          logger.warn('Failed to reconcile autonomous-room runs at startup, continuing', {
            context: 'instrumentation.register',
            error: reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
          });
        }

        const { scheduleAutonomousRooms } = await import('./lib/background-jobs/scheduled-autonomous-rooms');
        scheduleAutonomousRooms();

        // Start filesystem watcher for real-time sync
        const { startWatcher } = await import('./lib/file-storage/watcher');
        startWatcher();

        // Start mount point watchers for real-time Scriptorium re-indexing
        const { startMountWatchers } = await import('./lib/mount-index/watcher');
        startMountWatchers().catch((watcherError) => {
          logger.warn('Mount point watchers failed to start', {
            context: 'instrumentation.register',
            error: watcherError instanceof Error ? watcherError.message : String(watcherError),
          });
        });

        logger.info('Background schedulers and filesystem watchers started', {
          context: 'instrumentation.register',
        });
      } catch (schedulerError) {
        logger.warn('Error starting background schedulers, continuing startup', {
          context: 'instrumentation.register',
          error: schedulerError instanceof Error ? schedulerError.message : String(schedulerError),
        });
      }

      // ================================================================
      // PHASE 3.6: Reconcile half-rendered / un-embedded conversations
      // ================================================================
      // Self-heal for the Scriptorium pipeline: re-enqueue a CONVERSATION_RENDER
      // for any chat with real messages but no rendered Markdown, or with
      // interchange chunks that were never embedded (e.g. the embedder was down
      // when the turn fired). Fire-and-forget so a backlog can't delay
      // readiness; a no-op on a healthy instance. Runs every boot because the
      // gap recurs. Enqueued here, after the job processor is available.
      try {
        const { reconcileConversationRendering } = await import(
          './lib/startup/reconcile-conversation-rendering'
        );
        reconcileConversationRendering().catch((reconcileError) => {
          logger.warn('Conversation render reconciliation failed', {
            context: 'instrumentation.register',
            error: reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
          });
        });
      } catch (reconcileImportError) {
        logger.warn('Failed to import conversation render reconciliation module', {
          context: 'instrumentation.register',
          error: reconcileImportError instanceof Error ? reconcileImportError.message : String(reconcileImportError),
        });
      }

      // ================================================================
      // PHASE 3.7: Reconcile embedding dimensions against the default profile
      // ================================================================
      // There is one embedding standard per instance — the default profile's
      // output. This pass deletes non-conforming vector-index entries, snaps
      // index metadata, converges stale chats to the cold tier, and enqueues
      // a mismatched-dim reindex for anything that needs re-embedding.
      // Fire-and-forget: a large backlog must not delay readiness; a no-op
      // (COUNT-only) on a conforming corpus. Runs every boot because the gap
      // recurs (killed reindexes, restored backups, provider outages).
      try {
        const { reconcileEmbeddingDimensions } = await import(
          './lib/startup/reconcile-embedding-dimensions'
        );
        reconcileEmbeddingDimensions().catch((dimReconcileError) => {
          logger.warn('Embedding dimension reconciliation failed', {
            context: 'instrumentation.register',
            error: dimReconcileError instanceof Error ? dimReconcileError.message : String(dimReconcileError),
          });
        });
      } catch (dimReconcileImportError) {
        logger.warn('Failed to import embedding dimension reconciliation module', {
          context: 'instrumentation.register',
          error: dimReconcileImportError instanceof Error ? dimReconcileImportError.message : String(dimReconcileImportError),
        });
      }

      // ================================================================
      // PHASE 4: Mark startup complete
      // ================================================================
      startupState.setPhase('complete');
      startupState.markReady();
      startupProgress.setCurrent('subsystem:ready');

      logger.info('All services initialized successfully', {
        context: 'instrumentation.register',
        migrationsComplete: startupState.areMigrationsComplete(),
      });

      // ================================================================
      // PHASE 4.5: Track background settling (UI gate only)
      // ================================================================
      // The server is `isReady` and serving now, but the Phase 3.2 vault
      // backfill chain and Phase 3.3 mount scan are still running. Until they
      // settle, server-rendered pages (the home dashboard especially) can read
      // empty/partial data and look like total data loss. Flip a UI-only
      // `backgroundSettled` flag once both finish so the startup gate can hold
      // the progress screen until then and refresh server-rendered content on
      // release. Bounded by a cap so a hung job can't wedge the gate forever;
      // this never gates request handling (that's `isReady`).
      const SETTLE_CAP_MS = 5 * 60_000;
      void Promise.race([
        Promise.allSettled([vaultBackfillSettled, mountScanSettled]),
        new Promise((resolve) => setTimeout(resolve, SETTLE_CAP_MS)),
      ]).then(() => {
        if (!startupState.isBackgroundSettled()) {
          startupState.markBackgroundSettled();
        }
      });
    } catch (error) {
      logger.error('Fatal error initializing services', {
        context: 'instrumentation.register',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Mark startup as failed but allow server to start
      startupState.setPhase('failed');
      startupProgress.publish({
        rawLabel: 'subsystem:errored',
        level: 'error',
        detail: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - allow server to start even if initialization fails
    }
  }
}
