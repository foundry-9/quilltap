/**
 * Migration Types
 *
 * Defines the interfaces for version upgrade migrations in Quilltap.
 */

/**
 * Result of running a single migration
 */
export interface MigrationResult {
  /** Migration ID */
  id: string;
  /** Whether the migration succeeded */
  success: boolean;
  /** Number of items affected (e.g., profiles converted) */
  itemsAffected: number;
  /** Human-readable message */
  message: string;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp when migration ran */
  timestamp: string;
}

/**
 * Migration definition interface
 */
export interface Migration {
  /** Unique identifier for this migration */
  id: string;
  /** Human-readable description */
  description: string;
  /** Version this migration was introduced */
  introducedInVersion: string;
  /** Dependencies on other migrations (by ID) */
  dependsOn?: string[];
  /** Function to check if migration needs to run */
  shouldRun: () => Promise<boolean>;
  /** Function to run the migration */
  run: () => Promise<MigrationResult>;
  /** Optional rollback function */
  rollback?: () => Promise<MigrationResult>;
}

/**
 * Migration state stored in the migrations tracking file
 */
export interface MigrationState {
  /** Migrations that have been completed */
  completedMigrations: MigrationRecord[];
  /** Last time migrations were checked */
  lastChecked: string;
  /** Current Quilltap version */
  quilltapVersion: string;
}

/**
 * Record of a completed migration
 */
export interface MigrationRecord {
  /** Migration ID */
  id: string;
  /** When the migration ran */
  completedAt: string;
  /** Version of Quilltap when migration ran */
  quilltapVersion: string;
  /** Items affected */
  itemsAffected: number;
  /** Result message */
  message: string;
}

/**
 * Result of running all migrations
 */
export interface UpgradeResult {
  /** Whether all migrations succeeded */
  success: boolean;
  /** Number of migrations that ran */
  migrationsRun: number;
  /** Number of migrations skipped (already completed) */
  migrationsSkipped: number;
  /** Results for each migration that ran */
  results: MigrationResult[];
  /** Total duration in milliseconds */
  totalDurationMs: number;
}

/**
 * Upgrade plugin interface
 */
export interface UpgradePlugin {
  /** Run all pending migrations */
  runMigrations: () => Promise<UpgradeResult>;
  /** Check which migrations need to run */
  getPendingMigrations: () => Promise<string[]>;
  /** Get list of all available migrations */
  getAllMigrations: () => Migration[];
  /** Get migration state */
  getMigrationState: () => Promise<MigrationState>;
  /** Force re-run a specific migration (for debugging) */
  forceRunMigration?: (id: string) => Promise<MigrationResult>;
}
