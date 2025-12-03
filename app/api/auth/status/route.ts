/**
 * Auth Status Endpoint
 *
 * Returns information about the authentication configuration,
 * including which OAuth providers are available.
 */

import { NextResponse } from 'next/server';
import { isAuthDisabled } from '@/lib/auth/config';
import { getConfiguredAuthProviders, getAllAuthProviders } from '@/lib/plugins/auth-provider-registry';
import { isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const authDisabled = isAuthDisabled();
    const pluginsInitialized = isPluginSystemInitialized();

    // If auth is disabled, return minimal info
    if (authDisabled) {
      logger.debug('Auth status requested - auth disabled', { context: 'auth/status' });
      return NextResponse.json({
        authDisabled: true,
        hasOAuthProviders: false,
        providers: [],
        credentialsEnabled: false,
        warning: null,
      });
    }

    // Get provider information
    const configuredProviders = pluginsInitialized ? getConfiguredAuthProviders() : [];
    const allProviders = pluginsInitialized ? getAllAuthProviders() : [];

    // Build provider info for response
    const providers = configuredProviders.map(p => ({
      id: p.config.providerId,
      name: p.config.displayName,
      icon: p.config.icon,
      buttonColor: p.config.buttonColor,
      buttonTextColor: p.config.buttonTextColor,
    }));

    // Determine warning message
    let warning: string | null = null;
    if (!pluginsInitialized) {
      warning = 'Plugin system is still initializing. OAuth providers may not be available yet.';
    } else if (configuredProviders.length === 0) {
      const unconfiguredCount = allProviders.filter(p => !p.isConfigured).length;
      if (unconfiguredCount > 0) {
        warning = `${unconfiguredCount} authentication plugin(s) are registered but not configured. Check environment variables.`;
      } else {
        warning = 'No OAuth authentication plugins are configured. Only credentials-based login is available.';
      }
    }

    logger.debug('Auth status requested', {
      context: 'auth/status',
      authDisabled,
      pluginsInitialized,
      configuredProviders: configuredProviders.length,
      totalProviders: allProviders.length,
    });

    return NextResponse.json({
      authDisabled: false,
      hasOAuthProviders: configuredProviders.length > 0,
      providers,
      credentialsEnabled: true,
      pluginsInitialized,
      warning,
    });
  } catch (error) {
    logger.error('Failed to get auth status', { context: 'auth/status' }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      { error: 'Failed to get auth status' },
      { status: 500 }
    );
  }
}
