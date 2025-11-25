/**
 * API Key Validation Endpoint for Image Providers
 * Phase 6: API Endpoints
 *
 * POST   /api/image-profiles/validate-key  - Validate an API key for image generation
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { ImageProvider, ImageProviderEnum } from '@/lib/json-store/schemas/types'
import { getImageGenProvider } from '@/lib/image-gen/factory'
import { decryptApiKey } from '@/lib/encryption'

// Get the list of valid image providers from the Zod enum
const VALID_IMAGE_PROVIDERS = ImageProviderEnum.options

/**
 * POST /api/image-profiles/validate-key
 * Validate an API key for image generation
 *
 * Body: {
 *   provider: ImageProvider,
 *   apiKeyId?: string (optional - if provided, uses stored key)
 *   apiKey?: string (optional - if provided, validates the key directly)
 * }
 *
 * Response:
 * {
 *   valid: boolean,
 *   message?: string,
 *   models?: string[]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { provider, apiKeyId, apiKey } = body

    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      )
    }

    // Validate provider
    if (!VALID_IMAGE_PROVIDERS.includes(provider as ImageProvider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${VALID_IMAGE_PROVIDERS.join(', ')}` },
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

    let keyToValidate: string | null = null

    // Get the API key to validate
    if (apiKeyId) {
      const repos = getRepositories()

      // Fetch from stored keys
      const storedKey = await repos.connections.findApiKeyById(apiKeyId)

      if (!storedKey) {
        return NextResponse.json(
          { error: 'API key not found' },
          { status: 404 }
        )
      }

      try {
        keyToValidate = decryptApiKey(
          storedKey.ciphertext,
          storedKey.iv,
          storedKey.authTag,
          session.user.id
        )
      } catch (error) {
        console.error('Failed to decrypt API key:', error)
        return NextResponse.json(
          { error: 'Failed to decrypt API key' },
          { status: 500 }
        )
      }
    } else if (apiKey) {
      // Use provided key directly
      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return NextResponse.json(
          { error: 'API key must be a non-empty string' },
          { status: 400 }
        )
      }
      keyToValidate = apiKey.trim()
    } else {
      return NextResponse.json(
        { error: 'Either apiKeyId or apiKey is required' },
        { status: 400 }
      )
    }

    // Validate the API key
    let isValid = false
    let models: string[] = []

    try {
      isValid = await imageProvider.validateApiKey(keyToValidate)

      if (isValid) {
        // Try to get available models
        try {
          models = await imageProvider.getAvailableModels(keyToValidate)
        } catch (error) {
          console.error('Failed to fetch models:', error)
          // Key is valid but models fetch failed - still return success
          models = imageProvider.supportedModels
        }
      }
    } catch (error) {
      console.error('API key validation error:', error)
      isValid = false
    }

    return NextResponse.json({
      valid: isValid,
      message: isValid
        ? 'API key is valid'
        : 'API key validation failed. Please check your key and try again.',
      models: isValid ? models : undefined,
    })
  } catch (error) {
    console.error('Failed to validate API key:', error)
    return NextResponse.json(
      { error: 'Failed to validate API key' },
      { status: 500 }
    )
  }
}
