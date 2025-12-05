/**
 * API Key Testing Endpoint
 * Phase 0.3: Core Infrastructure
 *
 * POST /api/keys/[id]/test - Test if an API key is valid
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { decryptApiKey } from '@/lib/encryption'
import { logger } from '@/lib/logger'
import { Provider } from '@/lib/json-store/schemas/types'
import { providerRegistry } from '@/lib/plugins/provider-registry'

/**
 * Test API key validity using the provider plugin's validateApiKey method
 */
async function testProviderApiKey(
  provider: Provider,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    logger.debug('Testing provider API key', { context: 'test-api-key', provider })

    // Get provider plugin from registry
    const plugin = providerRegistry.getProvider(provider)
    if (!plugin) {
      logger.warn('Provider plugin not found', { context: 'test-api-key', provider })
      return { valid: false, error: `Provider ${provider} not found` }
    }

    // Use plugin's validateApiKey method
    const isValid = await plugin.validateApiKey(apiKey, baseUrl)
    logger.debug('API key validation result', { context: 'test-api-key', provider, valid: isValid })

    return { valid: isValid }
  } catch (error) {
    logger.error('API key validation failed', { context: 'test-api-key', provider }, error as Error)
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * POST /api/keys/[id]/test
 * Test if an API key is valid
 *
 * Body: {
 *   baseUrl?: string  // Optional, required for Ollama/OpenAI-compatible
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()

    // Get the API key
    const apiKey = await repos.connections.findApiKeyById(id)

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not found' },
        { status: 404 }
      )
    }

    // Decrypt the API key
    const decryptedKey = decryptApiKey(
      apiKey.ciphertext,
      apiKey.iv,
      apiKey.authTag,
      session.user.id
    )

    // Get optional baseUrl from request body
    const body = await req.json().catch(() => ({}))
    const { baseUrl } = body

    // Test the key
    const result = await testProviderApiKey(
      apiKey.provider as Provider,
      decryptedKey,
      baseUrl
    )

    if (result.valid) {
      // Update lastUsed timestamp
      await repos.connections.recordApiKeyUsage(id)

      return NextResponse.json({
        valid: true,
        provider: apiKey.provider,
        message: 'API key is valid',
      })
    }

    return NextResponse.json(
      {
        valid: false,
        provider: apiKey.provider,
        error: result.error,
      },
      { status: 400 }
    )
  } catch (error) {
    logger.error('Failed to test API key:', {}, error as Error)
    return NextResponse.json(
      { error: 'Failed to test API key' },
      { status: 500 }
    )
  }
}
