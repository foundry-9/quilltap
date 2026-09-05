/**
 * Environment variable validation using Zod
 * Ensures all required environment variables are present and valid
 */

import { z } from 'zod';

const envSchema = z
  .object({
    // Node environment
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Base URL for the application (used for OAuth callbacks, etc.)
    BASE_URL: z.string().url().optional().default('http://localhost:3000'),

    // OAuth Providers (all optional - configured via auth plugins)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    APPLE_ID: z.string().optional(),
    APPLE_SECRET: z.string().optional(),
    GITHUB_ID: z.string().optional(),
    GITHUB_SECRET: z.string().optional(),

    // NOTE: ENCRYPTION_MASTER_PEPPER is NOT in the schema.
    // It is managed by the pepper vault (lib/startup/pepper-vault.ts) and
    // read directly from process.env at runtime by lib/encryption.ts.
    // See app/setup/page.tsx for the setup wizard.

    // Logging (optional)
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional().default('info'),
    LOG_OUTPUT: z.enum(['console', 'file', 'both']).optional().default('console'),
    LOG_FILE_PATH: z.string().optional().default('./logs'),
    LOG_FILE_MAX_SIZE: z.string().regex(/^\d+$/).optional(),
    LOG_FILE_MAX_FILES: z.string().regex(/^\d+$/).optional(),

    // Production SSL (optional)
    DOMAIN: z.string().optional(),
    SSL_EMAIL: z.string().email().optional(),

    // Timezone Configuration
    // IANA timezone name from the host OS (e.g., "America/New_York")
    // Detected automatically by Electron and passed through to Docker
    // Docker users can set this manually: -e QUILLTAP_TIMEZONE=America/New_York
    QUILLTAP_TIMEZONE: z.string().optional(),

    // File Storage Configuration
    // Base directory for all Quilltap data (database, files, logs)
    // Platform defaults: Linux: ~/.quilltap, macOS: ~/Library/Application Support/Quilltap, Windows: %APPDATA%\Quilltap
    QUILLTAP_DATA_DIR: z.string().optional(),
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Check if we're in a build-only phase (no runtime needed)
 * During Next.js build, we skip env validation since runtime vars aren't available in CI
 */
const isBuildPhase =
  process.env.SKIP_ENV_VALIDATION === 'true' ||
  process.env.NEXT_PHASE === 'phase-production-build' ||
  (process.env.NEXT_RUNTIME === undefined && process.argv.some(arg => arg.includes('next') && process.argv.includes('build')));

/**
 * Validate and parse environment variables
 * Throws an error if validation fails
 * Skips validation during build phase for CI compatibility
 */
export function validateEnv(): Env {
  // Skip validation during build phase - env vars may not be available in CI
  if (isBuildPhase) {
    // Return minimal defaults for build-time type checking
    return {
      NODE_ENV: process.env.NODE_ENV || 'production',
      BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
      LOG_LEVEL: 'info',
      LOG_OUTPUT: 'console',
      LOG_FILE_PATH: './logs',
    } as Env;
  }

  try {
    const env = envSchema.parse(process.env);
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.issues.map((err) => {
        return `  - ${err.path.join('.')}: ${err.message}`;
      });

      console.error('❌ Environment validation failed:');
      console.error(missingVars.join('\n'));
      console.error('\nPlease check your .env file and ensure all required variables are set.');
      console.error('See .env.example for reference.\n');

      // Don't exit in test environment
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
      throw error;
    }
    throw error;
  }
}

/**
 * Validated environment variables
 * Use this instead of process.env for type safety
 */
export const env = validateEnv();

/**
 * Check if we're in development
 */
export const isDevelopment = env.NODE_ENV === 'development';

/**
 * Check if we're in test mode
 */
export const isTest = env.NODE_ENV === 'test';

/**
 * Check if the deployment is user-managed (locally hosted)
 *
 * All deployments are now local-only (no S3/remote storage),
 * so this always returns true.
 *
 * @returns true always — all deployments are self-managed
 */
export function checkIsUserManaged(): boolean {
  return true;
}

/**
 * Whether the deployment is user-managed (locally hosted)
 * Always true since all storage is local
 */
export const isUserManaged = checkIsUserManaged();
