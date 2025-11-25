/**
 * API Key Management Routes
 * Phase 0.3: Core Infrastructure
 *
 * GET    /api/keys       - List all API keys for current user
 * POST   /api/keys       - Create a new API key
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { encryptApiKey, maskApiKey } from '@/lib/encryption'
import { ProviderEnum, Provider } from '@/lib/json-store/schemas/types'

// Get the list of valid providers from the Zod enum
const VALID_PROVIDERS = ProviderEnum.options

/**
 * GET /api/keys
 * List all API keys for the authenticated user
 * Returns masked keys for security
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

    const repos = getRepositories()
    const apiKeys = await repos.connections.getAllApiKeys()

    // Sort by creation date
    const sortedKeys = apiKeys
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    // Mask the encrypted keys for security
    const maskedKeys = sortedKeys.map((key) => ({
      id: key.id,
      provider: key.provider,
      label: key.label,
      isActive: key.isActive,
      lastUsed: key.lastUsed,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      keyPreview: maskApiKey(key.ciphertext.substring(0, 32)), // Mask a portion
    }))

    const response = NextResponse.json(maskedKeys)
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
  } catch (error) {
    console.error('Failed to fetch API keys:', error)
    return NextResponse.json(
      { error: 'Failed to fetch API keys' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/keys
 * Create a new encrypted API key
 *
 * Body: {
 *   provider: Provider,
 *   label: string,
 *   apiKey: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const { provider, label, apiKey } = body

    // Validation
    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider' },
        { status: 400 }
      )
    }

    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      return NextResponse.json(
        { error: 'Label is required' },
        { status: 400 }
      )
    }

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      )
    }

    // Encrypt the API key
    const encrypted = encryptApiKey(apiKey, session.user.id)

    const repos = getRepositories()

    // Store in database
    const newKey = await repos.connections.createApiKey({
      provider: provider as Provider,
      label: label.trim(),
      ciphertext: encrypted.encrypted,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      isActive: true,
    })

    return NextResponse.json({
      id: newKey.id,
      provider: newKey.provider,
      label: newKey.label,
      isActive: newKey.isActive,
      createdAt: newKey.createdAt,
      updatedAt: newKey.updatedAt,
    }, { status: 201 })
  } catch (error) {
    console.error('Failed to create API key:', error)
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500 }
    )
  }
}
