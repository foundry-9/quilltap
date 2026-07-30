/**
 * Session utilities for single-user mode
 *
 * Quilltap operates in single-user mode only. This module provides
 * session access that always returns the single user.
 */

import { getOrCreateSingleUser } from '@/lib/auth/single-user';
import { logger } from '@/lib/logger';

/**
 * Session user type
 */
export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

/**
 * Extended session type that includes user ID
 */
export interface ExtendedSession {
  user: SessionUser;
  expires: string;
}

/**
 * Get the current session
 *
 * In single-user mode, this always returns the single user session.
 *
 * @returns The current session (always returns single user)
 */
export async function getServerSession(): Promise<ExtendedSession | null> {
  try {
    const singleUser = await getOrCreateSingleUser();

    return {
      user: {
        id: singleUser.id,
        email: singleUser.email || singleUser.username,
        name: singleUser.name,
        image: singleUser.image,
      },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    };
  } catch (error) {
    logger.error(
      'Failed to get single user session',
      { context: 'getServerSession' },
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }
}

