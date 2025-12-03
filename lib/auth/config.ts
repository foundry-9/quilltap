/**
 * Authentication configuration module
 * Handles auth-related environment variables and feature flags
 */

import { logger } from '@/lib/logger';

// Cache the auth disabled state after first check
let cachedAuthDisabled: boolean | null = null;

/**
 * Determine if authentication is disabled
 * When disabled, anonymous access is allowed
 *
 * @returns {boolean} True if AUTH_DISABLED env var is set to 'true', false otherwise
 */
export function isAuthDisabled(): boolean {
  // Return cached value to avoid repeated env checks and logging
  if (cachedAuthDisabled !== null) {
    return cachedAuthDisabled;
  }

  cachedAuthDisabled = process.env.AUTH_DISABLED === 'true';

  // Only log once when the value is first determined
  logger.debug('Auth disabled state determined', {
    context: 'isAuthDisabled',
    authDisabled: cachedAuthDisabled,
  });

  return cachedAuthDisabled;
}

// Cache for anonymous user config
let cachedAnonymousUserName: string | null = null;

/**
 * Get the anonymous user display name
 * Used when authentication is disabled or for anonymous sessions
 *
 * @returns {string} The anonymous user name from AUTH_ANONYMOUS_USER_NAME env var, or default "Anonymous User"
 */
export function getAnonymousUserName(): string {
  if (cachedAnonymousUserName !== null) {
    return cachedAnonymousUserName;
  }

  cachedAnonymousUserName = process.env.AUTH_ANONYMOUS_USER_NAME || 'Anonymous User';
  return cachedAnonymousUserName;
}

/**
 * Get a consistent email address for anonymous users
 * Used for database records and session management when auth is disabled
 *
 * @returns {string} A consistent anonymous email address
 */
export function getAnonymousUserEmail(): string {
  return 'anonymous@local';
}
