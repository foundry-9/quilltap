/**
 * NextAuth Configuration
 *
 * Uses lazy initialization pattern to ensure plugins are loaded before
 * auth providers are configured. This allows auth provider plugins to
 * register themselves during startup.
 */

import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/auth/password";
import { JsonStoreAdapter } from "@/lib/json-store/auth-adapter";
import { getJsonStore } from "@/lib/json-store/core/json-store";
import { UsersRepository } from "@/lib/json-store/repositories/users.repository";
import { isAuthDisabled } from "@/lib/auth/config";
import { logger } from "@/lib/logger";
import { getConfiguredAuthProviders } from "@/lib/plugins/auth-provider-registry";
import { initializePlugins, isPluginSystemInitialized } from "@/lib/startup/plugin-initialization";

// ============================================================================
// LAZY-LOADED SINGLETONS
// ============================================================================

let usersRepo: UsersRepository | null = null;
let adapter: ReturnType<typeof JsonStoreAdapter> | null = null;

function getUsersRepository(): UsersRepository {
  usersRepo ??= new UsersRepository(getJsonStore());
  return usersRepo;
}

function getAdapter(): ReturnType<typeof JsonStoreAdapter> {
  adapter ??= JsonStoreAdapter(getJsonStore());
  return adapter;
}

// ============================================================================
// PROVIDER CREATION
// ============================================================================

/**
 * Create an OAuth provider based on provider ID
 * Maps plugin configurations to actual NextAuth providers
 */
function createOAuthProvider(providerId: string): ReturnType<typeof GoogleProvider> | null {
  switch (providerId) {
    case 'google':
      if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        return GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        });
      }
      return null;

    // Future OAuth providers can be added here:
    // case 'github':
    //   return GitHubProvider({ ... });
    // case 'apple':
    //   return AppleProvider({ ... });

    default:
      logger.warn('Unknown OAuth provider ID', { context: 'createOAuthProvider', providerId });
      return null;
  }
}

/**
 * Build credentials provider for email/password login
 */
function buildCredentialsProvider() {
  return CredentialsProvider({
    id: 'credentials',
    name: 'Email and Password',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
      totpCode: { label: '2FA Code (if enabled)', type: 'text' }
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) {
        throw new Error('Email and password required')
      }

      // Find user
      const user = await getUsersRepository().findByEmail(credentials.email)

      if (!user?.passwordHash) {
        throw new Error('Invalid email or password')
      }

      // Verify password
      const valid = await verifyPassword(
        credentials.password,
        user.passwordHash
      )

      if (!valid) {
        throw new Error('Invalid email or password')
      }

      // Check if 2FA is enabled
      if (user.totp?.enabled) {
        if (!credentials.totpCode) {
          throw new Error('2FA code required')
        }

        // Verify TOTP
        const { verifyTOTP } = await import('@/lib/auth/totp')
        const totpValid = await verifyTOTP(user.id, credentials.totpCode)

        if (!totpValid) {
          throw new Error('Invalid 2FA code')
        }
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      }
    },
  });
}

// ============================================================================
// PROVIDER BUILDING
// ============================================================================

// Cache built providers after plugins are initialized
let cachedProviders: NextAuthOptions['providers'] | null = null;

/**
 * Build the list of authentication providers based on configuration
 * When auth is disabled, no providers are configured
 */
function buildProviders(): NextAuthOptions['providers'] {
  // Check if auth is disabled
  if (isAuthDisabled()) {
    logger.info('Authentication is disabled - no providers configured', {
      context: 'buildProviders',
    });
    return [];
  }

  const pluginsInitialized = isPluginSystemInitialized();

  // Return cached providers if available and plugins are initialized
  if (cachedProviders !== null && pluginsInitialized) {
    logger.debug('Returning cached auth providers', {
      context: 'buildProviders',
      totalProviders: cachedProviders.length,
    });
    return cachedProviders;
  }

  const providers: NextAuthOptions['providers'] = [];

  // Load OAuth providers from plugin registry
  const registeredAuthProviders = getConfiguredAuthProviders();

  logger.debug('Building authentication providers', {
    context: 'buildProviders',
    registeredProviders: registeredAuthProviders.length,
    pluginsInitialized,
  });

  // Create providers from registered auth plugins
  for (const entry of registeredAuthProviders) {
    const provider = createOAuthProvider(entry.config.providerId);
    if (provider) {
      providers.push(provider);
      logger.debug('OAuth provider added from plugin', {
        context: 'buildProviders',
        providerId: entry.config.providerId,
        displayName: entry.config.displayName,
      });
    }
  }

  // Fallback: If no plugins registered but Google env vars exist, add Google directly
  if (registeredAuthProviders.length === 0) {
    if (pluginsInitialized) {
      logger.warn('No auth provider plugins registered after plugin initialization', {
        context: 'buildProviders',
        hasGoogleEnvVars: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      });
    } else {
      logger.debug('Plugin system not yet initialized, using fallback providers', {
        context: 'buildProviders',
      });
    }

    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      providers.push(
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        })
      );
      logger.info('Google OAuth provider added via fallback', {
        context: 'buildProviders',
      });
    }
  }

  // Always add credentials provider for email/password login
  providers.push(buildCredentialsProvider());

  logger.debug('Auth providers built', {
    context: 'buildProviders',
    totalProviders: providers.length,
    fromPlugins: registeredAuthProviders.length > 0,
  });

  // Cache providers if plugins are initialized
  if (pluginsInitialized) {
    cachedProviders = providers;
  }

  return providers;
}

// ============================================================================
// AUTH OPTIONS - LAZY INITIALIZATION
// ============================================================================

// Cache the complete auth options after first successful build
let cachedAuthOptions: NextAuthOptions | null = null;

/**
 * Build NextAuth options asynchronously
 * Ensures plugins are initialized before building providers
 *
 * This is the core function for lazy initialization - it waits for
 * the plugin system to be ready before building auth configuration.
 */
export async function buildAuthOptionsAsync(): Promise<NextAuthOptions> {
  // Fast path: return cached options if available
  if (cachedAuthOptions !== null && isPluginSystemInitialized()) {
    logger.debug('Returning cached auth options', { context: 'buildAuthOptionsAsync' });
    return cachedAuthOptions;
  }

  // Ensure plugins are initialized before building providers
  if (!isPluginSystemInitialized()) {
    logger.info('Waiting for plugin system initialization before building auth options', {
      context: 'buildAuthOptionsAsync',
    });
    await initializePlugins();
  }

  const options: NextAuthOptions = {
    adapter: getAdapter(),
    providers: buildProviders(),
    callbacks: {
      async session({ session, user }) {
        if (session.user) {
          session.user.id = user.id;
        }
        return session;
      },
    },
    pages: {
      signIn: '/auth/signin',
      error: '/auth/error',
    },
    session: {
      strategy: "database",
    },
    debug: process.env.NODE_ENV === "development",
  };

  // Cache the options
  cachedAuthOptions = options;
  logger.info('Auth options built and cached', {
    context: 'buildAuthOptionsAsync',
    providerCount: options.providers.length,
  });

  return options;
}

/**
 * Get auth options synchronously (for backward compatibility)
 * Uses cached options if available, otherwise builds synchronously
 *
 * @deprecated Prefer buildAuthOptionsAsync() for new code
 */
export function getAuthOptions(): NextAuthOptions {
  // Return cached if available
  if (cachedAuthOptions !== null) {
    return cachedAuthOptions;
  }

  // Build synchronously (may not have all plugin providers if plugins aren't ready)
  const options: NextAuthOptions = {
    adapter: getAdapter(),
    providers: buildProviders(),
    callbacks: {
      async session({ session, user }) {
        if (session.user) {
          session.user.id = user.id;
        }
        return session;
      },
    },
    pages: {
      signIn: '/auth/signin',
      error: '/auth/error',
    },
    session: {
      strategy: "database",
    },
    debug: process.env.NODE_ENV === "development",
  };

  // Cache if plugins are ready
  if (isPluginSystemInitialized()) {
    cachedAuthOptions = options;
  }

  return options;
}

/**
 * Legacy authOptions export for backward compatibility
 * New code should use buildAuthOptionsAsync() or the lazy NextAuth handler
 *
 * @deprecated Use buildAuthOptionsAsync() instead
 */
export const authOptions: NextAuthOptions = new Proxy({} as NextAuthOptions, {
  get(_target, prop) {
    return getAuthOptions()[prop as keyof NextAuthOptions];
  },
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clear cached auth options (useful for testing or hot-reload)
 */
export function clearAuthOptionsCache(): void {
  cachedAuthOptions = null;
  cachedProviders = null;
  logger.debug('Auth options cache cleared', { context: 'clearAuthOptionsCache' });
}

/**
 * Refresh auth providers from plugins
 * Call this after plugins are hot-reloaded
 */
export async function refreshAuthProviders(): Promise<void> {
  clearAuthOptionsCache();
  await buildAuthOptionsAsync();
  logger.info('Auth providers refreshed', { context: 'refreshAuthProviders' });
}
