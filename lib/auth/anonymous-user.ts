/**
 * Anonymous User Service
 *
 * Manages the creation and retrieval of the anonymous user when authentication is disabled.
 * The anonymous user is identified by a fixed UUID: 00000000-0000-0000-0000-000000000000
 */

import { logger } from '@/lib/logger';
import { User, GeneralSettings, GeneralSettingsSchema, AvatarDisplayMode } from '@/lib/json-store/schemas/types';
import { UsersRepository } from '@/lib/json-store/repositories/users.repository';
import { getJsonStore } from '@/lib/json-store/core/json-store';
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
    const jsonStore = getJsonStore();
    const usersRepository = new UsersRepository(jsonStore);

    // Check if anonymous user already exists
    const existingUser = await usersRepository.findById(ANONYMOUS_USER_ID);

    if (existingUser) {
      logger.debug('Anonymous user already exists', {
        context: 'getOrCreateAnonymousUser',
        userId: ANONYMOUS_USER_ID,
      });
      return existingUser;
    }

    // Create new anonymous user directly in settings
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

    // Read existing settings or create new ones
    let settings: GeneralSettings;
    try {
      // Try to read existing general settings
      settings = await jsonStore.readJson<GeneralSettings>('settings/general.json');
      settings.user = anonymousUser;
      settings.updatedAt = now;
    } catch {
      // Create new settings with anonymous user
      settings = {
        version: 1,
        user: anonymousUser,
        chatSettings: {
          id: generateRandomUuid(),
          userId: ANONYMOUS_USER_ID,
          avatarDisplayMode: 'ALWAYS' as AvatarDisplayMode,
          avatarDisplayStyle: 'CIRCULAR',
          tagStyles: {},
          cheapLLMSettings: {
            strategy: 'PROVIDER_CHEAPEST',
            fallbackToLocal: true,
            embeddingProvider: 'OPENAI',
          },
          createdAt: now,
          updatedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      };
    }

    // Validate and save settings using jsonStore
    const validated = GeneralSettingsSchema.parse(settings);
    await jsonStore.writeJson('settings/general.json', validated);

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
 * Generate a random UUID
 * Used for generating the chat settings ID
 */
function generateRandomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(/[xy]/g, function (c) {
    const r = Math.trunc(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
