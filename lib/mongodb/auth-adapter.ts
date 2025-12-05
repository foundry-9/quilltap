/**
 * NextAuth MongoDB Adapter
 *
 * Custom adapter for NextAuth v4+ that uses MongoDB for persistence.
 * This adapter uses UUID-style string IDs (in the `id` field) instead of
 * MongoDB ObjectIds to maintain compatibility with the rest of the application.
 *
 * Implements the Adapter interface to support:
 * - User creation and retrieval
 * - Account linking for OAuth providers
 * - Session management
 * - Verification token handling
 */

import {
  Adapter,
  AdapterUser,
  AdapterAccount,
  AdapterSession,
  VerificationToken,
} from 'next-auth/adapters';
import { getMongoDatabase } from './client';
import { logger } from '@/lib/logger';
import crypto from 'node:crypto';

/**
 * MongoDB user document type
 * Uses `id` field (UUID) as the application identifier
 */
interface MongoUser {
  id: string; // UUID-style application ID
  email: string;
  emailVerified: string | null;
  name?: string | null;
  image?: string | null;
  passwordHash?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * MongoDB account document type
 * Uses string userId to match the user's `id` field
 */
interface MongoAccount {
  userId: string; // References user.id (UUID)
  type: string;
  provider: string;
  providerAccountId: string;
  refresh_token?: string;
  access_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
  session_state?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * MongoDB session document type
 * Uses string userId to match the user's `id` field
 */
interface MongoSession {
  id: string;
  sessionToken: string;
  userId: string; // References user.id (UUID)
  expires: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * MongoDB verification token document type
 */
interface MongoVerificationToken {
  identifier: string;
  token: string;
  expires: string;
  createdAt: string;
}

/**
 * Generate a UUID for new entities
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current timestamp as ISO string
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Get the NextAuth MongoDB adapter
 *
 * This adapter uses UUID-style IDs stored in the `id` field, maintaining
 * compatibility with the application's data model.
 *
 * @returns Adapter instance for NextAuth
 * @throws Error if MongoDB connection fails
 */
export function getMongoDBAuthAdapter(): Adapter {
  return {
    /**
     * Create a new user in the database
     */
    async createUser(user: Omit<AdapterUser, 'id'>): Promise<AdapterUser> {
      try {
        logger.debug('MongoDB Auth: Creating user', {
          email: user.email,
          name: user.name,
        });

        const db = await getMongoDatabase();
        const usersCollection = db.collection<MongoUser>('users');

        const id = generateId();
        const timestamp = now();

        const mongoUser: MongoUser = {
          id,
          email: user.email,
          emailVerified: user.emailVerified
            ? user.emailVerified.toISOString()
            : null,
          name: user.name || null,
          image: user.image || null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        await usersCollection.insertOne(mongoUser as any);

        logger.debug('MongoDB Auth: User created successfully', {
          userId: id,
          email: user.email,
        });

        return {
          id,
          email: user.email,
          emailVerified: user.emailVerified,
          name: user.name,
          image: user.image,
        };
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to create user',
          { email: user.email },
          error instanceof Error ? error : undefined
        );
        throw error;
      }
    },

    /**
     * Get a user by their ID (UUID)
     */
    async getUser(id: string): Promise<AdapterUser | null> {
      try {
        logger.debug('MongoDB Auth: Getting user by ID', { userId: id });

        const db = await getMongoDatabase();
        const usersCollection = db.collection<MongoUser>('users');

        // Look up by the `id` field (UUID), not `_id`
        const mongoUser = await usersCollection.findOne({ id });

        if (!mongoUser) {
          logger.debug('MongoDB Auth: User not found', { userId: id });
          return null;
        }

        logger.debug('MongoDB Auth: User retrieved', {
          userId: id,
          email: mongoUser.email,
        });

        return {
          id: mongoUser.id,
          email: mongoUser.email,
          emailVerified: mongoUser.emailVerified
            ? new Date(mongoUser.emailVerified)
            : null,
          name: mongoUser.name || undefined,
          image: mongoUser.image || undefined,
        };
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to get user',
          { userId: id },
          error instanceof Error ? error : undefined
        );
        return null;
      }
    },

    /**
     * Get a user by their email address
     */
    async getUserByEmail(email: string): Promise<AdapterUser | null> {
      try {
        logger.debug('MongoDB Auth: Getting user by email', { email });

        const db = await getMongoDatabase();
        const usersCollection = db.collection<MongoUser>('users');

        const mongoUser = await usersCollection.findOne({ email });

        if (!mongoUser) {
          logger.debug('MongoDB Auth: User not found by email', { email });
          return null;
        }

        logger.debug('MongoDB Auth: User retrieved by email', {
          userId: mongoUser.id,
          email,
        });

        return {
          id: mongoUser.id,
          email: mongoUser.email,
          emailVerified: mongoUser.emailVerified
            ? new Date(mongoUser.emailVerified)
            : null,
          name: mongoUser.name || undefined,
          image: mongoUser.image || undefined,
        };
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to get user by email',
          { email },
          error instanceof Error ? error : undefined
        );
        return null;
      }
    },

    /**
     * Get a user by their linked account (provider + providerAccountId)
     */
    async getUserByAccount({
      provider,
      providerAccountId,
    }: {
      provider: string;
      providerAccountId: string;
    }): Promise<AdapterUser | null> {
      try {
        logger.debug('MongoDB Auth: Getting user by account', {
          provider,
          providerAccountId,
        });

        const db = await getMongoDatabase();
        const accountsCollection = db.collection<MongoAccount>('accounts');
        const usersCollection = db.collection<MongoUser>('users');

        const account = await accountsCollection.findOne({
          provider,
          providerAccountId,
        });

        if (!account) {
          logger.debug('MongoDB Auth: Account not found', {
            provider,
            providerAccountId,
          });
          return null;
        }

        // Look up user by the `id` field (account.userId is a UUID string)
        const mongoUser = await usersCollection.findOne({
          id: account.userId,
        });

        if (!mongoUser) {
          logger.debug('MongoDB Auth: User not found for account', {
            userId: account.userId,
          });
          return null;
        }

        logger.debug('MongoDB Auth: User retrieved by account', {
          userId: mongoUser.id,
          provider,
        });

        return {
          id: mongoUser.id,
          email: mongoUser.email,
          emailVerified: mongoUser.emailVerified
            ? new Date(mongoUser.emailVerified)
            : null,
          name: mongoUser.name || undefined,
          image: mongoUser.image || undefined,
        };
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to get user by account',
          { provider, providerAccountId },
          error instanceof Error ? error : undefined
        );
        return null;
      }
    },

    /**
     * Update a user in the database
     */
    async updateUser(
      user: Partial<AdapterUser> & { id: string }
    ): Promise<AdapterUser> {
      try {
        logger.debug('MongoDB Auth: Updating user', { userId: user.id });

        const db = await getMongoDatabase();
        const usersCollection = db.collection<MongoUser>('users');

        const updateData: Partial<MongoUser> = {
          updatedAt: now(),
        };

        if (user.email !== undefined) {
          updateData.email = user.email;
        }
        if (user.name !== undefined) {
          updateData.name = user.name;
        }
        if (user.image !== undefined) {
          updateData.image = user.image;
        }
        if (user.emailVerified !== undefined) {
          updateData.emailVerified = user.emailVerified
            ? user.emailVerified.toISOString()
            : null;
        }

        // Update by `id` field, not `_id`
        const result = await usersCollection.findOneAndUpdate(
          { id: user.id },
          { $set: updateData },
          { returnDocument: 'after' }
        );

        const updatedUser = result as unknown as MongoUser | null;
        if (!updatedUser) {
          throw new Error(`User ${user.id} not found`);
        }

        logger.debug('MongoDB Auth: User updated successfully', {
          userId: user.id,
        });

        return {
          id: updatedUser.id,
          email: updatedUser.email,
          emailVerified: updatedUser.emailVerified
            ? new Date(updatedUser.emailVerified)
            : null,
          name: updatedUser.name || undefined,
          image: updatedUser.image || undefined,
        };
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to update user',
          { userId: user.id },
          error instanceof Error ? error : undefined
        );
        throw error;
      }
    },

    /**
     * Delete a user and all associated data (accounts and sessions)
     */
    async deleteUser(userId: string): Promise<void> {
      try {
        logger.debug('MongoDB Auth: Deleting user', { userId });

        const db = await getMongoDatabase();
        const usersCollection = db.collection<MongoUser>('users');
        const accountsCollection = db.collection<MongoAccount>('accounts');
        const sessionsCollection = db.collection<MongoSession>('sessions');

        // Delete by userId (UUID string)
        await accountsCollection.deleteMany({ userId });
        await sessionsCollection.deleteMany({ userId });
        await usersCollection.deleteOne({ id: userId });

        logger.debug('MongoDB Auth: User deleted successfully', { userId });
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to delete user',
          { userId },
          error instanceof Error ? error : undefined
        );
        throw error;
      }
    },

    /**
     * Link an account to a user (for OAuth providers)
     */
    async linkAccount(account: AdapterAccount): Promise<void> {
      try {
        logger.debug('MongoDB Auth: Linking account', {
          userId: account.userId,
          provider: account.provider,
        });

        const db = await getMongoDatabase();
        const accountsCollection = db.collection<MongoAccount>('accounts');

        const timestamp = now();
        const mongoAccount: MongoAccount = {
          userId: account.userId, // UUID string
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          refresh_token: account.refresh_token,
          access_token: account.access_token,
          expires_at: account.expires_at,
          token_type: account.token_type,
          scope: account.scope,
          id_token: account.id_token,
          session_state: account.session_state,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        await accountsCollection.insertOne(mongoAccount as any);

        logger.debug('MongoDB Auth: Account linked successfully', {
          userId: account.userId,
          provider: account.provider,
        });
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to link account',
          { userId: account.userId, provider: account.provider },
          error instanceof Error ? error : undefined
        );
        throw error;
      }
    },

    /**
     * Unlink an account from a user
     */
    async unlinkAccount({
      provider,
      providerAccountId,
    }: {
      provider: string;
      providerAccountId: string;
    }): Promise<void> {
      try {
        logger.debug('MongoDB Auth: Unlinking account', {
          provider,
          providerAccountId,
        });

        const db = await getMongoDatabase();
        const accountsCollection = db.collection<MongoAccount>('accounts');

        await accountsCollection.deleteOne({
          provider,
          providerAccountId,
        });

        logger.debug('MongoDB Auth: Account unlinked successfully', {
          provider,
          providerAccountId,
        });
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to unlink account',
          { provider, providerAccountId },
          error instanceof Error ? error : undefined
        );
        throw error;
      }
    },

    /**
     * Create a new session
     */
    async createSession(
      session: Omit<AdapterSession, 'id'>
    ): Promise<AdapterSession> {
      try {
        logger.debug('MongoDB Auth: Creating session', {
          userId: session.userId,
        });

        const db = await getMongoDatabase();
        const sessionsCollection = db.collection<MongoSession>('sessions');

        const id = generateId();
        const timestamp = now();
        const mongoSession: MongoSession = {
          id,
          sessionToken: session.sessionToken,
          userId: session.userId, // UUID string
          expires: session.expires.toISOString(),
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        await sessionsCollection.insertOne(mongoSession as any);

        logger.debug('MongoDB Auth: Session created successfully', {
          sessionToken: session.sessionToken,
          userId: session.userId,
        });

        return {
          sessionToken: session.sessionToken,
          userId: session.userId,
          expires: session.expires,
        };
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to create session',
          { userId: session.userId },
          error instanceof Error ? error : undefined
        );
        throw error;
      }
    },

    /**
     * Get a session and its associated user
     */
    async getSessionAndUser(
      sessionToken: string
    ): Promise<{ session: AdapterSession; user: AdapterUser } | null> {
      try {
        logger.debug('MongoDB Auth: Getting session and user', {
          sessionToken,
        });

        const db = await getMongoDatabase();
        const sessionsCollection = db.collection<MongoSession>('sessions');
        const usersCollection = db.collection<MongoUser>('users');

        const mongoSession = await sessionsCollection.findOne({
          sessionToken,
        });

        if (!mongoSession) {
          logger.debug('MongoDB Auth: Session not found', { sessionToken });
          return null;
        }

        // Check if session has expired
        const expires = new Date(mongoSession.expires);
        if (expires < new Date()) {
          logger.debug('MongoDB Auth: Session has expired', { sessionToken });
          return null;
        }

        // Look up user by `id` field
        const mongoUser = await usersCollection.findOne({
          id: mongoSession.userId,
        });

        if (!mongoUser) {
          logger.debug('MongoDB Auth: User not found for session', {
            userId: mongoSession.userId,
          });
          return null;
        }

        logger.debug('MongoDB Auth: Session and user retrieved', {
          sessionToken,
          userId: mongoUser.id,
        });

        return {
          session: {
            sessionToken: mongoSession.sessionToken,
            userId: mongoSession.userId,
            expires,
          },
          user: {
            id: mongoUser.id,
            email: mongoUser.email,
            emailVerified: mongoUser.emailVerified
              ? new Date(mongoUser.emailVerified)
              : null,
            name: mongoUser.name || undefined,
            image: mongoUser.image || undefined,
          },
        };
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to get session and user',
          { sessionToken },
          error instanceof Error ? error : undefined
        );
        return null;
      }
    },

    /**
     * Update a session
     */
    async updateSession(
      session: Partial<AdapterSession> & { sessionToken: string }
    ): Promise<AdapterSession | null> {
      try {
        logger.debug('MongoDB Auth: Updating session', {
          sessionToken: session.sessionToken,
        });

        const db = await getMongoDatabase();
        const sessionsCollection = db.collection<MongoSession>('sessions');

        const updateData: Partial<MongoSession> = {
          updatedAt: now(),
        };

        if (session.expires !== undefined) {
          updateData.expires = session.expires.toISOString();
        }

        const result = await sessionsCollection.findOneAndUpdate(
          { sessionToken: session.sessionToken },
          { $set: updateData },
          { returnDocument: 'after' }
        );

        const updatedSession = result as unknown as MongoSession | null;
        if (!updatedSession) {
          logger.debug('MongoDB Auth: Session not found for update', {
            sessionToken: session.sessionToken,
          });
          return null;
        }

        logger.debug('MongoDB Auth: Session updated successfully', {
          sessionToken: session.sessionToken,
        });

        return {
          sessionToken: updatedSession.sessionToken,
          userId: updatedSession.userId,
          expires: new Date(updatedSession.expires),
        };
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to update session',
          { sessionToken: session.sessionToken },
          error instanceof Error ? error : undefined
        );
        return null;
      }
    },

    /**
     * Delete a session
     */
    async deleteSession(sessionToken: string): Promise<void> {
      try {
        logger.debug('MongoDB Auth: Deleting session', { sessionToken });

        const db = await getMongoDatabase();
        const sessionsCollection = db.collection<MongoSession>('sessions');

        await sessionsCollection.deleteOne({ sessionToken });

        logger.debug('MongoDB Auth: Session deleted successfully', {
          sessionToken,
        });
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to delete session',
          { sessionToken },
          error instanceof Error ? error : undefined
        );
        throw error;
      }
    },

    /**
     * Create a verification token (for passwordless sign-in)
     */
    async createVerificationToken(
      verificationToken: VerificationToken
    ): Promise<VerificationToken | null> {
      try {
        logger.debug('MongoDB Auth: Creating verification token', {
          identifier: verificationToken.identifier,
        });

        const db = await getMongoDatabase();
        const tokensCollection = db.collection<MongoVerificationToken>(
          'verification_tokens'
        );

        const mongoToken: MongoVerificationToken = {
          identifier: verificationToken.identifier,
          token: verificationToken.token,
          expires: verificationToken.expires.toISOString(),
          createdAt: now(),
        };

        await tokensCollection.insertOne(mongoToken as any);

        logger.debug('MongoDB Auth: Verification token created successfully', {
          identifier: verificationToken.identifier,
        });

        return verificationToken;
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to create verification token',
          { identifier: verificationToken.identifier },
          error instanceof Error ? error : undefined
        );
        return null;
      }
    },

    /**
     * Use a verification token and delete it
     */
    async useVerificationToken({
      identifier,
      token,
    }: {
      identifier: string;
      token: string;
    }): Promise<VerificationToken | null> {
      try {
        logger.debug('MongoDB Auth: Using verification token', { identifier });

        const db = await getMongoDatabase();
        const tokensCollection = db.collection<MongoVerificationToken>(
          'verification_tokens'
        );

        const result = await tokensCollection.findOneAndDelete({
          identifier,
          token,
        });

        const deletedToken = result as unknown as MongoVerificationToken | null;
        if (!deletedToken) {
          logger.debug('MongoDB Auth: Verification token not found', {
            identifier,
          });
          return null;
        }

        logger.debug('MongoDB Auth: Verification token used successfully', {
          identifier,
        });

        return {
          identifier: deletedToken.identifier,
          token: deletedToken.token,
          expires: new Date(deletedToken.expires),
        };
      } catch (error) {
        logger.error(
          'MongoDB Auth: Failed to use verification token',
          { identifier },
          error instanceof Error ? error : undefined
        );
        return null;
      }
    },
  };
}
