/**
 * NextAuth MongoDB Adapter
 *
 * Custom adapter for NextAuth v4+ that uses MongoDB for persistence.
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
import { ObjectId } from 'mongodb';

/**
 * MongoDB user document type
 */
interface MongoUser {
  _id: ObjectId;
  email: string;
  emailVerified: string | null;
  name?: string | null;
  image?: string | null;
  passwordHash?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * MongoDB account document type
 */
interface MongoAccount {
  _id: ObjectId;
  userId: ObjectId;
  type: string;
  provider: string;
  providerAccountId: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  idToken?: string;
  sessionState?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * MongoDB session document type
 */
interface MongoSession {
  _id: ObjectId;
  sessionToken: string;
  userId: ObjectId;
  expires: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * MongoDB verification token document type
 */
interface MongoVerificationToken {
  _id: ObjectId;
  identifier: string;
  token: string;
  expires: Date;
  createdAt: Date;
}

/**
 * Convert MongoDB ObjectId to string for adapter interface
 * @param id - ObjectId from MongoDB
 * @returns String representation of ObjectId
 */
function objectIdToString(id: ObjectId): string {
  return id.toHexString();
}

/**
 * Convert string to MongoDB ObjectId
 * @param id - String representation of ObjectId
 * @returns ObjectId instance
 */
function stringToObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new Error(`Invalid ObjectId: ${id}`);
  }
  return new ObjectId(id);
}

/**
 * Get the NextAuth MongoDB adapter
 *
 * @returns Adapter instance for NextAuth
 * @throws Error if MongoDB connection fails
 *
 * @example
 * ```typescript
 * import NextAuth from 'next-auth';
 * import { getMongoDBAuthAdapter } from '@/lib/mongodb/auth-adapter';
 *
 * export const { handlers, auth } = NextAuth({
 *   adapter: getMongoDBAuthAdapter(),
 *   // ... other config
 * });
 * ```
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

        const mongoUser: Omit<MongoUser, '_id'> = {
          email: user.email,
          emailVerified: user.emailVerified
            ? user.emailVerified.toISOString()
            : null,
          name: user.name || null,
          image: user.image || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await usersCollection.insertOne(mongoUser as any);

        logger.debug('MongoDB Auth: User created successfully', {
          userId: result.insertedId.toHexString(),
          email: user.email,
        });

        return {
          id: objectIdToString(result.insertedId),
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
     * Get a user by their ID
     */
    async getUser(id: string): Promise<AdapterUser | null> {
      try {
        logger.debug('MongoDB Auth: Getting user by ID', { userId: id });

        const db = await getMongoDatabase();
        const usersCollection = db.collection<MongoUser>('users');

        const mongoUser = await usersCollection.findOne({
          _id: stringToObjectId(id),
        });

        if (!mongoUser) {
          logger.debug('MongoDB Auth: User not found', { userId: id });
          return null;
        }

        logger.debug('MongoDB Auth: User retrieved', {
          userId: id,
          email: mongoUser.email,
        });

        return {
          id: objectIdToString(mongoUser._id),
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
          userId: objectIdToString(mongoUser._id),
          email,
        });

        return {
          id: objectIdToString(mongoUser._id),
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

        const mongoUser = await usersCollection.findOne({
          _id: account.userId,
        });

        if (!mongoUser) {
          logger.debug('MongoDB Auth: User not found for account', {
            userId: objectIdToString(account.userId),
          });
          return null;
        }

        logger.debug('MongoDB Auth: User retrieved by account', {
          userId: objectIdToString(mongoUser._id),
          provider,
        });

        return {
          id: objectIdToString(mongoUser._id),
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
          updatedAt: new Date(),
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

        const result = await usersCollection.findOneAndUpdate(
          { _id: stringToObjectId(user.id) },
          { $set: updateData },
          { returnDocument: 'after' }
        );

        const updatedUser = (result as any).value as MongoUser | null;
        if (!updatedUser) {
          throw new Error(`User ${user.id} not found`);
        }

        logger.debug('MongoDB Auth: User updated successfully', {
          userId: user.id,
        });

        return {
          id: objectIdToString(updatedUser._id),
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

        const objectId = stringToObjectId(userId);

        // Delete user accounts
        await accountsCollection.deleteMany({ userId: objectId });

        // Delete user sessions
        await sessionsCollection.deleteMany({ userId: objectId });

        // Delete user
        await usersCollection.deleteOne({ _id: objectId });

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

        const mongoAccount: Omit<MongoAccount, '_id'> = {
          userId: stringToObjectId(account.userId),
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          refreshToken: account.refresh_token,
          accessToken: account.access_token,
          expiresAt: account.expires_at,
          tokenType: account.token_type,
          scope: account.scope,
          idToken: account.id_token,
          sessionState: account.session_state,
          createdAt: new Date(),
          updatedAt: new Date(),
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

        const mongoSession: Omit<MongoSession, '_id'> = {
          sessionToken: session.sessionToken,
          userId: stringToObjectId(session.userId),
          expires: session.expires,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await sessionsCollection.insertOne(mongoSession as any);

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
        if (mongoSession.expires < new Date()) {
          logger.debug('MongoDB Auth: Session has expired', { sessionToken });
          return null;
        }

        const mongoUser = await usersCollection.findOne({
          _id: mongoSession.userId,
        });

        if (!mongoUser) {
          logger.debug('MongoDB Auth: User not found for session', {
            userId: objectIdToString(mongoSession.userId),
          });
          return null;
        }

        logger.debug('MongoDB Auth: Session and user retrieved', {
          sessionToken,
          userId: objectIdToString(mongoUser._id),
        });

        return {
          session: {
            sessionToken: mongoSession.sessionToken,
            userId: objectIdToString(mongoSession.userId),
            expires: mongoSession.expires,
          },
          user: {
            id: objectIdToString(mongoUser._id),
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
          updatedAt: new Date(),
        };

        if (session.expires !== undefined) {
          updateData.expires = session.expires;
        }

        const result = await sessionsCollection.findOneAndUpdate(
          { sessionToken: session.sessionToken },
          { $set: updateData },
          { returnDocument: 'after' }
        );

        const updatedSession = (result as any).value as MongoSession | null;
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
          userId: objectIdToString(updatedSession.userId),
          expires: updatedSession.expires,
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

        const mongoToken: Omit<MongoVerificationToken, '_id'> = {
          identifier: verificationToken.identifier,
          token: verificationToken.token,
          expires: verificationToken.expires,
          createdAt: new Date(),
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

        const deletedToken = (result as any).value as MongoVerificationToken | null;
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
          expires: deletedToken.expires,
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
