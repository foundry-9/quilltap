/**
 * Auth Provider Plugin Interface
 *
 * Defines the contract for authentication provider plugins.
 * OAuth providers (Google, Apple, GitHub, etc.) implement this interface.
 */

import type { OAuthConfig, OAuthUserConfig } from 'next-auth/providers/oauth';
import { logger } from '@/lib/logger';

/**
 * Configuration for an OAuth authentication provider
 */
export interface AuthProviderConfig {
  /** Provider identifier (e.g., 'google', 'github') */
  providerId: string;

  /** Display name for UI */
  displayName: string;

  /** Icon name or SVG for UI */
  icon?: string;

  /** Environment variables required for this provider */
  requiredEnvVars: string[];

  /** Optional environment variables */
  optionalEnvVars?: string[];

  /** Button color for sign-in page (Tailwind classes) */
  buttonColor?: string;

  /** Button text color (Tailwind classes) */
  buttonTextColor?: string;
}

/**
 * Result of checking if a provider is configured
 */
export interface ProviderConfigStatus {
  isConfigured: boolean;
  missingVars: string[];
}

/**
 * Auth provider plugin export structure
 * This is what plugin index.ts should export
 */
export interface AuthProviderPluginExport {
  /** Provider configuration metadata */
  config: AuthProviderConfig;

  /** Factory function to create the NextAuth provider */
  createProvider: () => OAuthConfig<unknown> | null;

  /** Check if the provider is properly configured */
  isConfigured: () => boolean;

  /** Get detailed configuration status */
  getConfigStatus: () => ProviderConfigStatus;
}

/**
 * Helper to check if required environment variables are set
 */
export function checkEnvVars(requiredVars: string[]): ProviderConfigStatus {
  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  const status: ProviderConfigStatus = {
    isConfigured: missingVars.length === 0,
    missingVars,
  };

  logger.debug('Auth provider env vars check', {
    context: 'checkEnvVars',
    requiredVars,
    missingVars,
    isConfigured: status.isConfigured,
  });

  return status;
}

/**
 * Create a logger for auth provider plugins
 */
export function createAuthProviderLogger(providerId: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      logger.debug(message, { context: `AuthProvider:${providerId}`, ...data }),
    info: (message: string, data?: Record<string, unknown>) =>
      logger.info(message, { context: `AuthProvider:${providerId}`, ...data }),
    warn: (message: string, data?: Record<string, unknown>) =>
      logger.warn(message, { context: `AuthProvider:${providerId}`, ...data }),
    error: (message: string, data?: Record<string, unknown>, error?: Error) =>
      logger.error(message, { context: `AuthProvider:${providerId}`, ...data }, error),
  };
}
