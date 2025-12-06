/**
 * Environment variable validation using Zod
 * Ensures all required environment variables are present and valid
 */

import { z } from 'zod';

const envSchema = z
  .object({
    // Node environment
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Database (legacy - no longer used, MongoDB is required)
    DATABASE_URL: z.string().url().optional(),

    // NextAuth
    NEXTAUTH_URL: z.string().url().min(1, 'NEXTAUTH_URL is required'),
    NEXTAUTH_SECRET: z
      .string()
      .min(32, 'NEXTAUTH_SECRET must be at least 32 characters'),

    // OAuth Providers (all optional - configured via auth plugins)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    APPLE_ID: z.string().optional(),
    APPLE_SECRET: z.string().optional(),
    GITHUB_ID: z.string().optional(),
    GITHUB_SECRET: z.string().optional(),

    // Encryption
    ENCRYPTION_MASTER_PEPPER: z
      .string()
      .min(32, 'ENCRYPTION_MASTER_PEPPER must be at least 32 characters'),

    // Rate Limiting (optional)
    RATE_LIMIT_API_MAX: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_API_WINDOW: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_AUTH_MAX: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_AUTH_WINDOW: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_CHAT_MAX: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_CHAT_WINDOW: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_GENERAL_MAX: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_GENERAL_WINDOW: z.string().regex(/^\d+$/).optional(),

    // Logging (optional)
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional().default('info'),
    LOG_OUTPUT: z.enum(['console', 'file', 'both']).optional().default('console'),
    LOG_FILE_PATH: z.string().optional().default('./logs'),
    LOG_FILE_MAX_SIZE: z.string().regex(/^\d+$/).optional(),
    LOG_FILE_MAX_FILES: z.string().regex(/^\d+$/).optional(),

    // Production SSL (optional)
    DOMAIN: z.string().optional(),
    SSL_EMAIL: z.string().email().optional(),

    // Data Backend Configuration
    // NOTE: 'json' option is deprecated and will be removed in a future version.
    // Use the migration plugin (qtap-plugin-upgrade) to migrate JSON data to MongoDB.
    DATA_BACKEND: z.enum(['json', 'mongodb']).optional().default('mongodb'),

    // MongoDB Configuration (required - MongoDB is the default data backend)
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required for MongoDB backend'),
    MONGODB_DATABASE: z.string().optional().default('quilltap'),
    MONGODB_MODE: z.enum(['external', 'embedded']).optional().default('external'),
    MONGODB_DATA_DIR: z.string().optional().default('/data/mongodb'),
    MONGODB_CONNECTION_TIMEOUT_MS: z.string().regex(/^\d+$/).optional(),
    MONGODB_MAX_POOL_SIZE: z.string().regex(/^\d+$/).optional(),

    // S3 Configuration (required - S3 is the only supported file storage backend)
    // NOTE: 'disabled' option is deprecated and will be removed in a future version.
    // Use the migration plugin (qtap-plugin-upgrade) to migrate local files to S3.
    S3_MODE: z.enum(['embedded', 'external', 'disabled']).optional().default('embedded'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().optional().default('us-east-1'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_BUCKET: z.string().optional().default('quilltap-files'),
    S3_PATH_PREFIX: z.string().optional(),
    S3_PUBLIC_URL: z.string().url().optional(),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
  })
  .refine(
    (data) => {
      // MongoDB URI is required when DATA_BACKEND is 'mongodb' (the default)
      if (data.DATA_BACKEND === 'mongodb' && !data.MONGODB_URI) {
        return false;
      }
      return true;
    },
    {
      message: 'MONGODB_URI is required when DATA_BACKEND is mongodb',
      path: ['MONGODB_URI'],
    }
  )
  .refine(
    (data) => {
      // Warn about deprecated 'json' backend (validation passes but message logged elsewhere)
      // S3 configuration is required when S3_MODE is 'external'
      if (data.S3_MODE === 'external') {
        if (!data.S3_ENDPOINT || !data.S3_ACCESS_KEY || !data.S3_SECRET_KEY) {
          return false;
        }
      }
      return true;
    },
    {
      message:
        'S3_ENDPOINT, S3_ACCESS_KEY, and S3_SECRET_KEY are required when S3_MODE is external',
      path: ['S3_MODE'],
    }
  );

export type Env = z.infer<typeof envSchema>;

/**
 * Validate and parse environment variables
 * Throws an error if validation fails
 */
export function validateEnv(): Env {
  try {
    const env = envSchema.parse(process.env);
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map((err) => {
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
 * Check if we're in production
 */
export const isProduction = env.NODE_ENV === 'production';

/**
 * Check if we're in development
 */
export const isDevelopment = env.NODE_ENV === 'development';

/**
 * Check if we're in test mode
 */
export const isTest = env.NODE_ENV === 'test';
