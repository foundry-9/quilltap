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
import { ImageProvider } from '@/lib/types/prisma'
import { getImageGenProvider } from '@/lib/image-gen/factory'
import { decryptApiKey } from '@/lib/encryption'

/**
 * GET /api/image-profiles/models
 * Get available models for an image generation provider
 *
 * Query params:
 *   - provider: ImageProvider (OPENAI, GROK, GOOGLE_IMAGEN)
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

    // Validate provider
    if (!Object.values(ImageProvider).includes(provider as ImageProvider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${Object.values(ImageProvider).join(', ')}` },
        { status: 400 }
      )
    }

    let imageProvider
    try {
      imageProvider = getImageGenProvider(provider)
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
        console.error('Failed to get models with API key:', error)
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
    console.error('Failed to fetch models:', error)
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    )
  }
}
