/**
 * Authentication configuration module
 * Handles auth-related environment variables and feature flags
 */

import { logger } from '@/lib/logger';

/**
 * Determine if authentication is disabled
 * When disabled, anonymous access is allowed
 *
 * @returns {boolean} True if AUTH_DISABLED env var is set to 'true', false otherwise
 */
export function isAuthDisabled(): boolean {
  const disabled = process.env.AUTH_DISABLED === 'true';

  logger.debug('Auth disabled check', {
    context: 'isAuthDisabled',
    authDisabled: disabled,
  });

  return disabled;
}

/**
 * Get the anonymous user display name
 * Used when authentication is disabled or for anonymous sessions
 *
 * @returns {string} The anonymous user name from AUTH_ANONYMOUS_USER_NAME env var, or default "Anonymous User"
 */
export function getAnonymousUserName(): string {
  const userName = process.env.AUTH_ANONYMOUS_USER_NAME || 'Anonymous User';

  logger.debug('Anonymous user name retrieved', {
    context: 'getAnonymousUserName',
    userName,
  });

  return userName;
}

/**
 * Get a consistent email address for anonymous users
 * Used for database records and session management when auth is disabled
 *
 * @returns {string} A consistent anonymous email address
 */
export function getAnonymousUserEmail(): string {
  const anonymousEmail = 'anonymous@local';

  logger.debug('Anonymous user email retrieved', {
    context: 'getAnonymousUserEmail',
    email: anonymousEmail,
  });

  return anonymousEmail;
}
