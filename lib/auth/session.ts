/**
 * Session utilities for authentication
 *
 * Provides a unified session access that handles both authenticated
 * and no-auth modes transparently.
 *
 * This module uses buildAuthOptionsAsync() to ensure plugins are
 * initialized before checking sessions.
 */

import { getServerSession as nextAuthGetServerSession, Session } from 'next-auth';
import { buildAuthOptionsAsync } from '@/lib/auth';
import { isAuthDisabled } from '@/lib/auth/config';
import { getOrCreateAnonymousUser } from '@/lib/auth/anonymous-user';
import { logger } from '@/lib/logger';

/**
 * Extended session type that includes user ID
 */
export interface ExtendedSession extends Session {
  user: Session['user'] & {
    id: string;
  };
}

/**
 * Get the current session, handling no-auth mode
 *
 * When AUTH_DISABLED=true, returns an anonymous user session.
 * Otherwise, delegates to NextAuth's getServerSession.
 *
 * @returns The current session or null if not authenticated
 */
export async function getServerSession(): Promise<ExtendedSession | null> {
  // If auth is disabled, return anonymous user session
  if (isAuthDisabled()) {
    logger.debug('Auth disabled - returning anonymous session', {
      context: 'getServerSession',
    });

    try {
      const anonymousUser = await getOrCreateAnonymousUser();

      return {
        user: {
          id: anonymousUser.id,
          name: anonymousUser.name,
          email: anonymousUser.email,
          image: anonymousUser.image,
        },
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      };
    } catch (error) {
      logger.error(
        'Failed to get anonymous user session',
        { context: 'getServerSession' },
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  // Normal auth flow - use async auth options to ensure plugins are initialized
  const authOptions = await buildAuthOptionsAsync();
  const session = await nextAuthGetServerSession(authOptions);

  if (!session) {
    return null;
  }

  // Ensure the session has user.id
  return session as ExtendedSession;
}

/**
 * Get required session or throw
 *
 * Convenience wrapper that throws if no session is available.
 * Useful for API routes that require authentication.
 *
 * @throws Error if no session is available
 * @returns The current session
 */
export async function getRequiredSession(): Promise<ExtendedSession> {
  const session = await getServerSession();

  if (!session?.user?.id) {
    throw new Error('Unauthorized: No valid session');
  }

  return session;
}

/**
 * Get current user ID from session
 *
 * @returns The current user ID or null if not authenticated
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession();
  return session?.user?.id ?? null;
}

/**
 * Get required user ID from session
 *
 * @throws Error if no session is available
 * @returns The current user ID
 */
export async function getRequiredUserId(): Promise<string> {
  const session = await getRequiredSession();
  return session.user.id;
}
