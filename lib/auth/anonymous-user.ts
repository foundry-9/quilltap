/**
 * Anonymous User Service
 *
 * Manages the creation and retrieval of the anonymous user when authentication is disabled.
 * The anonymous user is identified by a fixed UUID: 00000000-0000-0000-0000-000000000000
 */

import { logger } from '@/lib/logger';
import { User, AvatarDisplayMode } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { getAnonymousUserName, getAnonymousUserEmail } from './config';

/**
 * Fixed UUID for the anonymous user
 * This UUID is reserved for anonymous access when authentication is disabled
 */
const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Get the current timestamp in ISO-8601 format
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Get or create the anonymous user
 *
 * When called, this function will:
 * 1. Check if the anonymous user already exists in the repository
 * 2. If not found, create a new anonymous user with:
 *    - The fixed anonymous user UUID
 *    - Email from getAnonymousUserEmail()
 *    - Name from getAnonymousUserName()
 *    - No password hash (null)
 *    - TOTP disabled
 * 3. Return the User object
 *
 * @returns {Promise<User>} The anonymous user object
 * @throws {Error} If unable to create or retrieve the anonymous user
 */
export async function getOrCreateAnonymousUser(): Promise<User> {
  logger.debug('Getting or creating anonymous user', {
    context: 'getOrCreateAnonymousUser',
    userId: ANONYMOUS_USER_ID,
  });

  try {
    const repos = getRepositories();

    // Check if anonymous user already exists
    const existingUser = await repos.users.findById(ANONYMOUS_USER_ID);

    if (existingUser) {
      logger.debug('Anonymous user already exists', {
        context: 'getOrCreateAnonymousUser',
        userId: ANONYMOUS_USER_ID,
      });
      return existingUser;
    }

    // Create new anonymous user
    logger.debug('Creating new anonymous user', {
      context: 'getOrCreateAnonymousUser',
      userId: ANONYMOUS_USER_ID,
      name: getAnonymousUserName(),
      email: getAnonymousUserEmail(),
    });

    const now = getCurrentTimestamp();

    // Construct user with fixed ID
    const anonymousUser: User = {
      id: ANONYMOUS_USER_ID,
      email: getAnonymousUserEmail(),
      name: getAnonymousUserName(),
      passwordHash: null,
      totp: {
        ciphertext: '',
        iv: '',
        authTag: '',
        enabled: false,
      },
      createdAt: now,
      updatedAt: now,
    };

    // Insert the anonymous user directly using MongoDB
    // The repository's create method generates a new ID, but we need the fixed anonymous ID
    const { getMongoClient } = await import('@/lib/mongodb/client');
    const client = await getMongoClient();
    const db = client.db();
    const usersCollection = db.collection('users');

    // Insert the anonymous user with the fixed ID (upsert to avoid duplicates)
    await usersCollection.updateOne(
      { id: ANONYMOUS_USER_ID },
      { $setOnInsert: anonymousUser },
      { upsert: true }
    );

    // Create chat settings using the repository method (which creates if not exists)
    await repos.users.updateChatSettings(ANONYMOUS_USER_ID, {
      avatarDisplayMode: 'ALWAYS' as AvatarDisplayMode,
      avatarDisplayStyle: 'CIRCULAR',
      tagStyles: {},
      cheapLLMSettings: {
        strategy: 'PROVIDER_CHEAPEST',
        fallbackToLocal: true,
        embeddingProvider: 'OPENAI',
      },
    });

    logger.debug('Anonymous user created successfully', {
      context: 'getOrCreateAnonymousUser',
      userId: anonymousUser.id,
      userName: anonymousUser.name,
      userEmail: anonymousUser.email,
    });

    return anonymousUser;
  } catch (error) {
    logger.error(
      'Failed to get or create anonymous user',
      {
        context: 'getOrCreateAnonymousUser',
        userId: ANONYMOUS_USER_ID,
      },
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

/**
 * Check if a user ID belongs to the anonymous user
 *
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if the user ID is the anonymous user ID, false otherwise
 */
export function isAnonymousUser(userId: string): boolean {
  const isAnon = userId === ANONYMOUS_USER_ID;

  logger.debug('Checking if user is anonymous', {
    context: 'isAnonymousUser',
    userId,
    isAnonymous: isAnon,
  });

  return isAnon;
}
