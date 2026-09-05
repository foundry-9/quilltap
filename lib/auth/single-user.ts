/**
 * Single User Service
 *
 * Manages the creation and retrieval of the single user in single-user mode.
 * Quilltap operates exclusively in single-user mode - no authentication required.
 *
 * The single user is identified by a fixed UUID: ffffffff-ffff-ffff-ffff-ffffffffffff
 */

import { logger } from '@/lib/logger';
import { User, AvatarDisplayMode } from '@/lib/schemas/types';
import { getRepositoriesSafe } from '@/lib/repositories/factory';

/**
 * Fixed UUID for the single user
 * This UUID is reserved for the single-user mode
 */
export const SINGLE_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/**
 * Default single user name
 * Can be overridden via AUTH_UNAUTHENTICATED_USER_NAME env var for backwards compatibility
 */
export function getSingleUserName(): string {
  return process.env.AUTH_UNAUTHENTICATED_USER_NAME || 'Local User';
}

/**
 * Default single user email
 * Used for database records
 */
export function getSingleUserEmail(): string {
  return 'user@localhost.localdomain';
}

/**
 * Get the current timestamp in ISO-8601 format
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Get or create the single user
 *
 * When called, this function will:
 * 1. Check if the single user already exists by ID
 * 2. If not found, check for a legacy user with the same email
 * 3. If legacy user found, migrate it to the new single user ID
 * 4. If no user found at all, create a new single user
 *
 * @returns {Promise<User>} The single user object
 * @throws {Error} If unable to create or retrieve the single user
 */
export async function getOrCreateSingleUser(): Promise<User> {
  try {
    // Use safe version to ensure migrations complete on first run
    const repos = await getRepositoriesSafe();

    // Check if single user already exists by ID
    const existingUser = await repos.users.findById(SINGLE_USER_ID);

    if (existingUser) {
      return existingUser;
    }

    // Check for legacy user with the same email but different ID
    const singleUserEmail = getSingleUserEmail();
    const legacyUser = await repos.users.findByEmail(singleUserEmail);

    if (legacyUser && legacyUser.id !== SINGLE_USER_ID) {
      // Migrate the legacy user to use the canonical single user ID
      logger.info('Migrating legacy user to single user ID', {
        context: 'getOrCreateSingleUser',
        oldId: legacyUser.id,
        newId: SINGLE_USER_ID,
      });

      // Update the user's ID in the database
      await repos.users.migrateUserId(legacyUser.id, SINGLE_USER_ID);

      // Return the user with the new ID
      return {
        ...legacyUser,
        id: SINGLE_USER_ID,
      };
    }

    // Create new single user
    const now = getCurrentTimestamp();

    const singleUser: User = {
      id: SINGLE_USER_ID,
      username: 'localUser',
      email: singleUserEmail,
      name: getSingleUserName(),
      passwordHash: null,
      createdAt: now,
      updatedAt: now,
    };

    // Insert the single user using the repository
    try {
      await repos.users.create(singleUser);
    } catch (error) {
      // Handle race conditions and constraint violations
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('already exists') || msg.includes('unique constraint')) {
          // Race condition - another request created the user, try to fetch it
          const createdUser = await repos.users.findById(SINGLE_USER_ID);
          if (createdUser) {
            return createdUser;
          }
        }
      }
      throw error;
    }

    // Create default chat settings
    await repos.chatSettings.updateForUser(SINGLE_USER_ID, {
      avatarDisplayMode: 'ALWAYS' as AvatarDisplayMode,
      avatarDisplayStyle: 'CIRCULAR',
      tagStyles: {},
      cheapLLMSettings: {
        strategy: 'PROVIDER_CHEAPEST',
        fallbackToLocal: true,
        allowCheapFallback: false,
        embeddingProvider: 'OPENAI',
      },
    });

    logger.info('Created single user', {
      context: 'getOrCreateSingleUser',
      userId: SINGLE_USER_ID,
    });

    return singleUser;
  } catch (error) {
    logger.error(
      'Failed to get or create single user',
      {
        context: 'getOrCreateSingleUser',
        userId: SINGLE_USER_ID,
      },
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

