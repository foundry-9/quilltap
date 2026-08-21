/**
 * Providers API v1
 *
 * GET /api/v1/providers - List available LLM providers
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import {
  serverError,
  successResponse,
} from '@/lib/api/responses';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { searchProviderRegistry } from '@/lib/plugins/search-provider-registry';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextHandler(async (req, context) => {
  try {
    // Get all registered LLM providers
    const plugins = providerRegistry.getAllProviders();

    // Transform to response format
    const providerList = plugins.map((plugin) => {
      // Ask each plugin for its connection-profile options schema, if any.
      // Plugins that don't implement the hook fall back to undefined and
      // the host renderer draws nothing for them.
      let optionsSchema: ReturnType<NonNullable<typeof plugin.getProviderOptionsSchema>> | undefined;
      try {
        optionsSchema = plugin.getProviderOptionsSchema?.();
      } catch (err) {
        logger.warn('[Providers v1] getProviderOptionsSchema threw', {
          provider: plugin.metadata.providerName,
          error: err instanceof Error ? err.message : String(err),
        });
        optionsSchema = undefined;
      }
      return {
        id: plugin.metadata.providerName,
        name: plugin.metadata.providerName,
        displayName: plugin.metadata.displayName,
        description: plugin.metadata.description,
        abbreviation: plugin.metadata.abbreviation,
        colors: plugin.metadata.colors,
        icon: plugin.icon || null,
        type: 'llm',
        capabilities: plugin.capabilities,
        configRequirements: plugin.config,
        optionsSchema: optionsSchema ?? null,
        // How the profile editor tells whether the profile in front of the
        // user will run a thinking turn, which decides the multi-character
        // prefill default (bug 85). Declarative precisely so it can cross the
        // wire — the browser cannot call a server-side plugin.
        thinkingTurnRule: plugin.thinkingTurnRule ?? null,
      };
    });

    // Get all registered search providers
    const searchPlugins = searchProviderRegistry.getAllProviders();

    const searchProviderList = searchPlugins.map((plugin) => ({
      id: plugin.metadata.providerName,
      name: plugin.metadata.providerName,
      displayName: plugin.metadata.displayName,
      description: plugin.metadata.description,
      abbreviation: plugin.metadata.abbreviation,
      colors: plugin.metadata.colors,
      icon: plugin.icon || null,
      type: 'search',
      configRequirements: {
        requiresApiKey: plugin.config.requiresApiKey,
        requiresBaseUrl: plugin.config.requiresBaseUrl,
        apiKeyLabel: plugin.config.apiKeyLabel,
      },
    }));

    // Combine both lists
    const allProviders = [...providerList, ...searchProviderList];

    const providersWithIcons = allProviders.filter(p => p.icon !== null).length;
    logger.info('[Providers v1] Listed providers', {
      llmCount: providerList.length,
      searchCount: searchProviderList.length,
      totalCount: allProviders.length,
    });
    return successResponse({
      providers: allProviders,
      count: allProviders.length,
    });
  } catch (error) {
    logger.error(
      '[Providers v1] Error listing providers',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch providers');
  }
});
