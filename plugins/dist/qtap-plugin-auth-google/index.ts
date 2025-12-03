/**
 * Google OAuth Authentication Provider Plugin
 *
 * Provides Google OAuth authentication for Quilltap.
 * This plugin is loaded by the auth provider registry.
 */

import GoogleProvider from 'next-auth/providers/google';

// ============================================================================
// TYPES (duplicated to avoid import issues in standalone plugin)
// ============================================================================

interface AuthProviderConfig {
  providerId: string;
  displayName: string;
  icon?: string;
  requiredEnvVars: string[];
  optionalEnvVars?: string[];
  buttonColor?: string;
  buttonTextColor?: string;
}

interface ProviderConfigStatus {
  isConfigured: boolean;
  missingVars: string[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const REQUIRED_ENV_VARS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

const config: AuthProviderConfig = {
  providerId: 'google',
  displayName: 'Google',
  icon: 'google',
  requiredEnvVars: REQUIRED_ENV_VARS,
  buttonColor: 'bg-white hover:bg-gray-50 border border-gray-300',
  buttonTextColor: 'text-gray-700',
};

// ============================================================================
// HELPERS
// ============================================================================

function checkEnvVars(requiredVars: string[]): ProviderConfigStatus {
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  return {
    isConfigured: missingVars.length === 0,
    missingVars,
  };
}

// ============================================================================
// PROVIDER FUNCTIONS
// ============================================================================

/**
 * Check if the provider is properly configured
 */
function isConfigured(): boolean {
  const status = getConfigStatus();
  return status.isConfigured;
}

/**
 * Get detailed configuration status
 */
function getConfigStatus(): ProviderConfigStatus {
  return checkEnvVars(REQUIRED_ENV_VARS);
}

/**
 * Create the NextAuth Google OAuth provider
 * Returns null if not properly configured
 */
function createProvider() {
  if (!isConfigured()) {
    return null;
  }

  return GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  });
}

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

module.exports = {
  config,
  isConfigured,
  getConfigStatus,
  createProvider,
};
