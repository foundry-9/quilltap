/**
 * NextAuth Configuration
 *
 * Uses lazy initialization pattern to ensure plugins are loaded before
 * auth providers are configured. This allows auth provider plugins to
 * register themselves during startup.
 */

import { NextAuthOptions } from "next-auth";
import { Adapter } from "next-auth/adapters";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/auth/password";
import { isAuthDisabled } from "@/lib/auth/config";
import { logger } from "@/lib/logger";
import { buildNextAuthProviders, getConfiguredAuthProviders } from "@/lib/plugins/auth-provider-registry";
import { initializePlugins, isPluginSystemInitialized } from "@/lib/startup/plugin-initialization";
import { getMongoDBAuthAdapter } from "@/lib/mongodb/auth-adapter";
import { getRepositories } from "@/lib/repositories/factory";

// ============================================================================
// LAZY-LOADED SINGLETONS
// ============================================================================

let adapter: Adapter | null = null;

function getAdapter(): Adapter {
  if (adapter) return adapter;

  logger.debug('Selecting auth adapter', { context: 'getAdapter', backend: 'mongodb' });
  adapter = getMongoDBAuthAdapter();
  logger.info('Using MongoDB auth adapter', { context: 'getAdapter' });

  return adapter;
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

      // Find user from MongoDB
      const user = await getRepositories().users.findByEmail(credentials.email)

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
// Track if we've logged the auth disabled message
let authDisabledLogged = false;
// Track if we've logged the no auth plugins warning
let noAuthPluginsWarningLogged = false;

/**
 * Build the list of authentication providers based on configuration
 * When auth is disabled, no providers are configured
 * OAuth providers are loaded from plugins via the auth provider registry
 */
function buildProviders(): NextAuthOptions['providers'] {
  // Check if auth is disabled
  if (isAuthDisabled()) {
    if (!authDisabledLogged) {
      logger.info('Authentication is disabled - no providers configured', {
        context: 'buildProviders',
      });
      authDisabledLogged = true;
    }
    return [];
  }

  const pluginsInitialized = isPluginSystemInitialized();

  // Return cached providers if available and plugins are initialized
  if (cachedProviders !== null && pluginsInitialized) {
    return cachedProviders;
  }

  const providers: NextAuthOptions['providers'] = [];

  // Load OAuth providers from plugin registry (plugins must be initialized)
  if (pluginsInitialized) {
    const oauthProviders = buildNextAuthProviders();

    // Filter out any null providers and add valid ones
    for (const provider of oauthProviders) {
      if (provider) {
        providers.push(provider);
      }
    }

    const configuredCount = getConfiguredAuthProviders().length;

    if (configuredCount === 0 && !noAuthPluginsWarningLogged) {
      logger.warn('No authentication plugins are configured. Users will only be able to use credentials-based login.', {
        context: 'buildProviders',
        hint: 'Enable an auth plugin (e.g., qtap-plugin-auth-google) and configure its environment variables.',
      });
      noAuthPluginsWarningLogged = true;
    }
  }

  // Always add credentials provider for email/password login
  providers.push(buildCredentialsProvider());

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
  adapter = null;
  // Reset logging flags so messages can appear again after refresh
  authDisabledLogged = false;
  noAuthPluginsWarningLogged = false;
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
