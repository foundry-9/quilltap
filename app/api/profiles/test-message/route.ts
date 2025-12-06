/**
 * Connection Profile Test Message Endpoint
 * Phase 0.7: Multi-Provider Support
 *
 * POST /api/profiles/test-message - Send a test message to verify provider functionality
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { decryptApiKey } from '@/lib/encryption'
import { createLLMProvider } from '@/lib/llm'
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import { validateProviderConfig } from '@/lib/plugins/provider-validation'
import { ProviderEnum } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// Validation schema
const testMessageSchema = z.object({
  provider: ProviderEnum,
  apiKeyId: z.string().optional(),
  baseUrl: z.string().optional(),
  modelName: z.string(),
  parameters: z.object({
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().min(1).optional(),
    top_p: z.number().min(0).max(1).optional(),
  }).optional(),
})

/**
 * POST /api/profiles/test-message
 * Send a test message to verify provider functionality
 *
 * Body: {
 *   provider: Provider
 *   apiKeyId?: string
 *   baseUrl?: string
 *   modelName: string
 *   parameters?: {
 *     temperature?: number
 *     max_tokens?: number
 *     top_p?: number
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Validate request body
    const body = await req.json()
    const { provider, apiKeyId, baseUrl, modelName, parameters = {} } = testMessageSchema.parse(body)

    const repos = getRepositories()

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
      context: 'POST /api/profiles/test-message',
    })

    // Initialize if either the plugin system or provider registry is not initialized
    if (!pluginSystemInitialized || !providerRegistryInitialized) {
      logger.warn('Plugin system not fully initialized in test-message endpoint, initializing now', {
        provider,
        pluginSystemInitialized,
        providerRegistryInitialized,
        context: 'POST /api/profiles/test-message',
      })
      const initResult = await initializePlugins()
      logger.info('Plugin system initialization result', {
        success: initResult.success,
        stats: initResult.stats,
        providerRegistryStats: providerRegistry.getStats(),
        context: 'POST /api/profiles/test-message',
      })
      if (!initResult.success) {
        logger.error('Failed to initialize plugin system', {
          stats: initResult.stats,
          errors: initResult.errors,
          context: 'POST /api/profiles/test-message',
        })
        return NextResponse.json(
          { error: 'Plugin system initialization failed', details: initResult.errors },
          { status: 500 }
        )
      }
    }

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
        session.user.id
      )
    }

    // Validate requirements using centralized provider config validation
    const configValidation = validateProviderConfig(provider, {
      apiKey: decryptedKey,
      baseUrl,
    })
    if (!configValidation.valid) {
      return NextResponse.json(
        { error: configValidation.errors[0] },
        { status: 400 }
      )
    }

    // Create provider instance
    const llmProvider = await createLLMProvider(provider, baseUrl)

    // Send test message
    const testPrompt = 'Hello! Please respond with a brief greeting to confirm the connection is working.'

    logger.debug(`[TEST-MESSAGE] Starting test for provider: ${provider}, model: ${modelName}`, { context: 'POST /api/profiles/test-message' })

    try {
      logger.debug('[TEST-MESSAGE] Calling sendMessage', { context: 'POST /api/profiles/test-message' })
      const response = await llmProvider.sendMessage(
        {
          model: modelName,
          messages: [
            {
              role: 'user',
              content: testPrompt,
            },
          ],
          temperature: parameters.temperature,
          maxTokens: parameters.max_tokens || 50, // Limit tokens for test
          topP: parameters.top_p,
        },
        decryptedKey
      )

      if (!response) {
        logger.debug('[TEST-MESSAGE] Null response from provider', { context: 'POST /api/profiles/test-message' })
        return NextResponse.json(
          {
            success: false,
            provider,
            error: 'No response received from model',
          },
          { status: 500 }
        )
      }

      logger.debug('[TEST-MESSAGE] Received response:', { context: 'POST /api/profiles/test-message', hasContent: response.content !== undefined && response.content !== null, contentLength: response.content?.length })

      // Check if we got a response with content (even empty string is valid)
      if (response.content !== undefined && response.content !== null) {
        logger.debug('[TEST-MESSAGE] Success - returning response', { context: 'POST /api/profiles/test-message' })
        const preview = response.content.substring(0, 100)
        const isTruncated = response.content.length > 100
        const suffix = isTruncated ? '...' : ''
        const message = preview.length === 0
          ? 'Test message successful! Model responded but returned empty content.'
          : `Test message successful! Model responded: "${preview}${suffix}"`
        return NextResponse.json({
          success: true,
          provider,
          modelName,
          message,
          responsePreview: response.content.substring(0, 200),
        })
      }

      logger.debug('[TEST-MESSAGE] No content in response (undefined or null)', { context: 'POST /api/profiles/test-message' })
      return NextResponse.json(
        {
          success: false,
          provider,
          error: 'No response received from model',
        },
        { status: 500 }
      )
    } catch (error) {
      logger.error('[TEST-MESSAGE] Error caught', { context: 'POST /api/profiles/test-message' }, error instanceof Error ? error : undefined)
      if (error instanceof Error) {
        logger.error('[TEST-MESSAGE] Error details', { context: 'POST /api/profiles/test-message', message: error.message, stack: error.stack }, error)
      }
      return NextResponse.json(
        {
          success: false,
          provider,
          error: error instanceof Error ? error.message : 'Failed to send test message',
        },
        { status: 500 }
      )
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to test message', { context: 'POST /api/profiles/test-message' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      {
        error: 'Failed to test message',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
