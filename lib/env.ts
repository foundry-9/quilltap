/**
 * Environment variable validation using Zod
 * Ensures all required environment variables are present and valid
 */

import { z } from 'zod';

const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database (optional - JSON store is now the default)
  DATABASE_URL: z.string().url().optional(),

  // NextAuth
  NEXTAUTH_URL: z.string().url().min(1, 'NEXTAUTH_URL is required'),
  NEXTAUTH_SECRET: z
    .string()
    .min(32, 'NEXTAUTH_SECRET must be at least 32 characters'),

  // OAuth Providers
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),

  // Optional OAuth providers (Phase 2.0+)
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

  // Production SSL (optional)
  DOMAIN: z.string().optional(),
  SSL_EMAIL: z.string().email().optional(),
});

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
