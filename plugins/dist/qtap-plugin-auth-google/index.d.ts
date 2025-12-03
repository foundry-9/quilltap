/**
 * Google OAuth Authentication Provider Plugin
 *
 * Provides Google OAuth authentication for Quilltap.
 * This plugin is loaded by the auth provider registry.
 */
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
declare const REQUIRED_ENV_VARS: string[];
declare const config: AuthProviderConfig;
declare function checkEnvVars(requiredVars: string[]): ProviderConfigStatus;
/**
 * Check if the provider is properly configured
 */
declare function isConfigured(): boolean;
/**
 * Get detailed configuration status
 */
declare function getConfigStatus(): ProviderConfigStatus;
/**
 * Create the NextAuth Google OAuth provider
 * Returns null if not properly configured
 */
declare function createProvider(): import('next-auth/providers/google').GoogleProfile | null;
