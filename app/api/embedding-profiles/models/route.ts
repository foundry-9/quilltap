/**
 * Embedding Models List Route
 *
 * GET /api/embedding-profiles/models
 * Returns the list of available embedding models by provider
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import {
  getEmbeddingProviders,
  getEmbeddingModels,
  getAllEmbeddingModels,
} from '@/lib/plugins/provider-validation'

/**
 * GET /api/embedding-profiles/models
 * Get available embedding models
 *
 * Query params:
 *   - provider: Provider name (optional, returns all if not specified)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Ensure plugin system is initialized
    const pluginSystemInitialized = isPluginSystemInitialized()
    const providerRegistryInitialized = providerRegistry.isInitialized()

    logger.debug('Checking plugin system initialization', {
      pluginSystemInitialized,
      providerRegistryInitialized,
      context: 'GET /api/embedding-profiles/models',
    })

    if (!pluginSystemInitialized || !providerRegistryInitialized) {
      logger.warn('Plugin system not fully initialized, initializing now', {
        pluginSystemInitialized,
        providerRegistryInitialized,
        context: 'GET /api/embedding-profiles/models',
      })
      const initResult = await initializePlugins()
      logger.info('Plugin system initialization result', {
        success: initResult.success,
        stats: initResult.stats,
        context: 'GET /api/embedding-profiles/models',
      })
      if (!initResult.success) {
        logger.error('Failed to initialize plugin system', {
          stats: initResult.stats,
          errors: initResult.errors,
          context: 'GET /api/embedding-profiles/models',
        })
        return NextResponse.json(
          { error: 'Plugin system initialization failed', details: initResult.errors },
          { status: 500 }
        )
      }
    }

    const { searchParams } = new URL(req.url)
    const provider = searchParams.get('provider')?.toUpperCase()

    if (provider) {
      // Get embedding providers from registry
      const embeddingProviders = getEmbeddingProviders()

      if (!embeddingProviders.includes(provider)) {
        logger.debug('Invalid embedding provider requested', {
          provider,
          validProviders: embeddingProviders,
          context: 'GET /api/embedding-profiles/models',
        })
        return NextResponse.json(
          { error: `Invalid provider. Must be one of: ${embeddingProviders.join(', ')}` },
          { status: 400 }
        )
      }

      const models = getEmbeddingModels(provider)
      logger.debug('Returning embedding models for provider', {
        provider,
        modelCount: models.length,
        context: 'GET /api/embedding-profiles/models',
      })

      return NextResponse.json({
        provider,
        models,
      })
    }

    // Return all models grouped by provider
    const allModels = getAllEmbeddingModels()
    logger.debug('Returning all embedding models', {
      providerCount: Object.keys(allModels).length,
      context: 'GET /api/embedding-profiles/models',
    })

    return NextResponse.json(allModels)
  } catch (error) {
    logger.error('Failed to fetch embedding models', { context: 'GET /api/embedding-profiles/models' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch embedding models' },
      { status: 500 }
    )
  }
}
