/**
 * NextAuth JSON Store Adapter
 *
 * Custom adapter for NextAuth v4+ that uses the JSON store instead of Prisma.
 * Implements the Adapter interface to support:
 * - User creation and retrieval
 * - Account linking for OAuth providers
 * - Session management
 * - Verification token handling
 */

import { Adapter, AdapterUser, AdapterAccount } from 'next-auth/adapters';
import { JsonStore } from './core/json-store';
import { UsersRepository } from './repositories/users.repository';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { Account, Session, VerificationToken as VerificationTokenType } from './schemas/types';
import crypto from 'node:crypto';

/**
 * Create a custom NextAuth adapter for JSON store
 */
export function JsonStoreAdapter(jsonStore: JsonStore): Adapter {
  const usersRepo = new UsersRepository(jsonStore);

  /**
   * Read accounts from auth/accounts.json
   */
  async function getAccounts(): Promise<Account[]> {
    try {
      const accounts = await jsonStore.readJson<Account[]>('auth/accounts.json');
      return Array.isArray(accounts) ? accounts : [];
    } catch {
      return [];
    }
  }

  /**
   * Write accounts to auth/accounts.json
   */
  async function saveAccounts(accounts: Account[]): Promise<void> {
    try {
      await jsonStore.ensureDir('auth');
      await jsonStore.writeJson('auth/accounts.json', accounts);
    } catch (error) {
      logger.error('Failed to save accounts', { context: 'JsonStoreAdapter.saveAccounts' }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Read sessions from auth/sessions.jsonl
   */
  async function getSessions(): Promise<Session[]> {
    try {
      return await jsonStore.readJsonl<Session>('auth/sessions.jsonl');
    } catch {
      return [];
    }
  }

  /**
   * Read verification tokens from auth/verification-tokens.jsonl
   */
  async function getVerificationTokens(): Promise<VerificationTokenType[]> {
    try {
      return await jsonStore.readJsonl<VerificationTokenType>('auth/verification-tokens.jsonl');
    } catch {
      return [];
    }
  }

  return {
    async createUser(user: Omit<AdapterUser, 'id'>): Promise<AdapterUser> {
      try {
        logger.debug('Creating user', { context: 'JsonStoreAdapter.createUser', email: user.email });
        const created = await usersRepo.create({
          email: user.email,
          emailVerified: user.emailVerified ? (user.emailVerified instanceof Date ? user.emailVerified.toISOString() : user.emailVerified) : null,
          image: user.image,
          name: user.name,
          passwordHash: null,
        });
        logger.debug('User created', { context: 'JsonStoreAdapter.createUser', userId: created.id });

        return {
          id: created.id,
          email: created.email,
          emailVerified: created.emailVerified ? new Date(created.emailVerified) : null,
          image: created.image,
          name: created.name,
        };
      } catch (error) {
        logger.error('Failed to create user', { context: 'JsonStoreAdapter.createUser', email: user.email }, error instanceof Error ? error : undefined);
        throw error;
      }
    },

    async getUser(id: string): Promise<AdapterUser | null> {
      const user = await usersRepo.findById(id);
      if (!user) return null;

      return {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified ? new Date(user.emailVerified) : null,
        image: user.image,
        name: user.name,
      };
    },

    async getUserByEmail(email: string): Promise<AdapterUser | null> {
      const user = await usersRepo.findByEmail(email);
      if (!user) return null;

      return {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified ? new Date(user.emailVerified) : null,
        image: user.image,
        name: user.name,
      };
    },

    async getUserByAccount(
      provider_providerAccountId: { provider: string; providerAccountId: string }
    ): Promise<AdapterUser | null> {
      const accounts = await getAccounts();
      const account = accounts.find(
        (a) => a.provider === provider_providerAccountId.provider &&
               a.providerAccountId === provider_providerAccountId.providerAccountId
      );

      if (!account) return null;

      const user = await usersRepo.findById(account.userId);
      if (!user) return null;

      return {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified ? new Date(user.emailVerified) : null,
        image: user.image,
        name: user.name,
      };
    },

    async updateUser(user: Partial<AdapterUser> & { id: string }): Promise<AdapterUser> {
      const emailVerified = user.emailVerified ? (user.emailVerified instanceof Date ? user.emailVerified.toISOString() : user.emailVerified) : undefined;
      const updated = await usersRepo.update(user.id, {
        email: user.email,
        emailVerified,
        image: user.image,
        name: user.name,
      });

      if (!updated) {
        throw new Error(`User ${user.id} not found`);
      }

      return {
        id: updated.id,
        email: updated.email,
        emailVerified: updated.emailVerified ? new Date(updated.emailVerified) : null,
        image: updated.image,
        name: updated.name,
      };
    },

    async deleteUser(userId: string): Promise<void> {
      // In single-user system, we don't delete
      logger.warn('User deletion not supported in single-user system', { context: 'JsonStoreAdapter.deleteUser', userId });
    },

    async linkAccount(account: AdapterAccount): Promise<void> {
      try {
        const accounts = await getAccounts();
        accounts.push(account as unknown as Account);
        await saveAccounts(accounts);
      } catch (error) {
        logger.error('Failed to link account', { context: 'JsonStoreAdapter.linkAccount', provider: account.provider }, error instanceof Error ? error : undefined);
        throw error;
      }
    },

    async unlinkAccount(
      provider_providerAccountId: { provider: string; providerAccountId: string }
    ): Promise<void> {
      const accounts = await getAccounts();
      const filtered = accounts.filter(
        (a) => !(a.provider === provider_providerAccountId.provider &&
                 a.providerAccountId === provider_providerAccountId.providerAccountId)
      );
      await saveAccounts(filtered);
    },

    async createSession(session: {
      sessionToken: string;
      userId: string;
      expires: Date;
    }) {
      const newSession: Session = {
        id: crypto.randomUUID(),
        sessionToken: session.sessionToken,
        userId: session.userId,
        expires: session.expires.toISOString(),
      };

      await jsonStore.appendJsonl('auth/sessions.jsonl', [newSession]);
      return {
        sessionToken: newSession.sessionToken,
        userId: newSession.userId,
        expires: session.expires,
      };
    },

    async getSessionAndUser(sessionToken: string) {
      const sessions = await getSessions();
      const session = sessions.find((s) => s.sessionToken === sessionToken);

      if (!session || new Date(session.expires) < new Date()) {
        return null;
      }

      const user = await usersRepo.findById(session.userId);
      if (!user) return null;

      return {
        session: {
          sessionToken: session.sessionToken,
          userId: session.userId,
          expires: new Date(session.expires),
        },
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified ? new Date(user.emailVerified) : null,
          image: user.image,
          name: user.name,
        },
      };
    },

    async updateSession(session: Partial<{ sessionToken: string; userId: string; expires: Date }> & { sessionToken: string }) {
      const sessions = await getSessions();
      const index = sessions.findIndex((s) => s.sessionToken === session.sessionToken);

      if (index === -1) return null;

      const updated: Session = {
        ...sessions[index],
        expires: session.expires ? session.expires.toISOString() : sessions[index].expires,
      };

      sessions[index] = updated;
      // Delete old file and recreate with updated sessions
      await jsonStore.deleteFile('auth/sessions.jsonl');
      if (sessions.length > 0) {
        await jsonStore.appendJsonl('auth/sessions.jsonl', sessions);
      }

      return {
        sessionToken: updated.sessionToken,
        userId: updated.userId,
        expires: new Date(updated.expires),
      };
    },

    async deleteSession(sessionToken: string): Promise<void> {
      const sessions = await getSessions();
      const filtered = sessions.filter((s) => s.sessionToken !== sessionToken);
      await jsonStore.deleteFile('auth/sessions.jsonl');
      if (filtered.length > 0) {
        await jsonStore.appendJsonl('auth/sessions.jsonl', filtered);
      }
    },

    async createVerificationToken(verificationToken: {
      identifier: string;
      token: string;
      expires: Date;
    }) {
      const token: VerificationTokenType = {
        identifier: verificationToken.identifier,
        token: verificationToken.token,
        expires: verificationToken.expires.toISOString(),
      };

      await jsonStore.appendJsonl('auth/verification-tokens.jsonl', [token]);
      return {
        identifier: token.identifier,
        token: token.token,
        expires: verificationToken.expires,
      };
    },

    async useVerificationToken(params: {
      identifier: string;
      token: string;
    }) {
      const tokens = await getVerificationTokens();
      const token = tokens.find(
        (t) => t.identifier === params.identifier && t.token === params.token
      );

      if (!token) return null;

      // Remove used token
      const filtered = tokens.filter(
        (t) => !(t.identifier === params.identifier && t.token === params.token)
      );
      await jsonStore.deleteFile('auth/verification-tokens.jsonl');
      if (filtered.length > 0) {
        await jsonStore.appendJsonl('auth/verification-tokens.jsonl', filtered);
      }

      return {
        identifier: token.identifier,
        token: token.token,
        expires: new Date(token.expires),
      };
    },
  };
}
