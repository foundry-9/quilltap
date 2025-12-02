/**
 * Image Provider Models Endpoint
 * Phase 6: API Endpoints
 *
 * GET    /api/image-profiles/models  - Get available models for a provider
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { decryptApiKey } from '@/lib/encryption'
import { logger } from '@/lib/logger'

/**
 * GET /api/image-profiles/models
 * Get available models for an image generation provider
 *
 * Query params:
 *   - provider: ImageProvider (dynamic, depends on registered plugins)
 *   - apiKeyId: (optional) API key ID to use for validation
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider')
    const apiKeyId = searchParams.get('apiKeyId')

    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      )
    }

    // Validate provider by attempting to get it
    let imageProvider
    try {
      imageProvider = createImageProvider(provider)
    } catch {
      return NextResponse.json(
        { error: `Provider ${provider} is not available` },
        { status: 400 }
      )
    }

    // Get available models
    let models: string[] = []

    if (apiKeyId) {
      const repos = getRepositories()

      // Fetch the API key
      const apiKey = await repos.connections.findApiKeyById(apiKeyId)

      if (!apiKey) {
        return NextResponse.json(
          { error: 'API key not found' },
          { status: 404 }
        )
      }

      try {
        const decryptedKey = decryptApiKey(
          apiKey.ciphertext,
          apiKey.iv,
          apiKey.authTag,
          session.user.id
        )
        models = await imageProvider.getAvailableModels(decryptedKey)
      } catch (error) {
        logger.error('Failed to get models with API key', { context: 'GET /api/image-profiles/models', provider }, error instanceof Error ? error : undefined)
        // Fall back to default models on error
        models = imageProvider.supportedModels
      }
    } else {
      // Return default models without API key validation
      models = imageProvider.supportedModels
    }

    return NextResponse.json({
      provider,
      models,
      supportedModels: imageProvider.supportedModels,
    })
  } catch (error) {
    logger.error('Failed to fetch models', { context: 'GET /api/image-profiles/models' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    )
  }
}
