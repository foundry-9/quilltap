/**
 * Models API Endpoint
 * Phase 0.7: Multi-Provider Support
 *
 * POST /api/models - Get available models for a provider
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { decryptApiKey } from '@/lib/encryption'
import { createLLMProvider } from '@/lib/llm'
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import { requiresBaseUrl, requiresApiKey } from '@/lib/plugins/provider-validation'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// Validation schema
const getModelsSchema = z.object({
  provider: z.string().min(1, 'Provider is required'), // Dynamic providers from plugins
  apiKeyId: z.string().optional(), // Optional API key ID
  baseUrl: z.string().optional(), // Required for Ollama/OpenAI-compatible
})

/**
 * POST /api/models
 * Get available models for a provider
 *
 * Body: {
 *   provider: Provider
 *   apiKeyId?: string  // Optional, uses the API key if provided
 *   baseUrl?: string   // Required for Ollama/OpenAI-compatible
 * }
 *
 * Returns: {
 *   models: string[]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Validate request body
    const body = await req.json()
    const { provider, apiKeyId, baseUrl } = getModelsSchema.parse(body)

    // Get API key if provided
    let decryptedKey = ''
    if (apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(apiKeyId)

      if (!apiKey) {
        return NextResponse.json(
          { error: 'API key not found' },
          { status: 404 }
        )
      }

      decryptedKey = decryptApiKey(
        apiKey.ciphertext,
        apiKey.iv,
        apiKey.authTag,
        user.id
      )
    }

    // Validate baseUrl requirements using provider registry
    if (requiresBaseUrl(provider) && !baseUrl) {
      return NextResponse.json(
        { error: `Base URL is required for ${provider} provider` },
        { status: 400 }
      )
    }

    // Validate API key requirements using provider registry
    // Note: Some providers don't require API keys for fetching models
    if (requiresApiKey(provider) && !decryptedKey) {
      return NextResponse.json(
        { error: `API key is required for ${provider} provider` },
        { status: 400 }
      )
    }

    // Ensure plugin system is initialized
    // Check both the plugin system AND the provider registry specifically
    const pluginSystemInitialized = isPluginSystemInitialized()
    const providerRegistryInitialized = providerRegistry.isInitialized()
    const registryStats = providerRegistry.getStats()

    logger.debug('Checking plugin system initialization', {
      provider,
      pluginSystemInitialized,
      providerRegistryInitialized,
      registryProviderCount: registryStats.total,
      context: 'POST /api/models',
    })

    // Initialize if either the plugin system or provider registry is not initialized
    if (!pluginSystemInitialized || !providerRegistryInitialized) {
      logger.warn('Plugin system not fully initialized in models endpoint, initializing now', {
        provider,
        pluginSystemInitialized,
        providerRegistryInitialized,
        context: 'POST /api/models',
      })
      const initResult = await initializePlugins()
      logger.info('Plugin system initialization result', {
        success: initResult.success,
        stats: initResult.stats,
        providerRegistryStats: providerRegistry.getStats(),
        context: 'POST /api/models',
      })
      if (!initResult.success) {
        logger.error('Failed to initialize plugin system', {
          stats: initResult.stats,
          errors: initResult.errors,
          context: 'POST /api/models',
        })
        return NextResponse.json(
          { error: 'Plugin system initialization failed', details: initResult.errors },
          { status: 500 }
        )
      }
    }

    // Create provider instance
    logger.debug('Creating provider for models endpoint', {
      provider,
      hasBaseUrl: !!baseUrl,
      pluginSystemInitialized: isPluginSystemInitialized(),
      context: 'POST /api/models',
    })
    const llmProvider = await createLLMProvider(provider, baseUrl)

    // Get available models
    const models = await llmProvider.getAvailableModels(decryptedKey)

    return NextResponse.json({
      provider,
      models,
      count: models.length,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to fetch models', { context: 'GET /api/models' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      {
        error: 'Failed to fetch models',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
