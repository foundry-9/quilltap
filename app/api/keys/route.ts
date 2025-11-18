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
import { prisma } from '@/lib/prisma'
import { encryptApiKey, maskApiKey } from '@/lib/encryption'
import { Provider } from '@prisma/client'

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

    const apiKeys = await prisma.apiKey.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        provider: true,
        label: true,
        isActive: true,
        lastUsed: true,
        createdAt: true,
        updatedAt: true,
        keyEncrypted: true, // We'll mask this below
      },
    })

    // Mask the encrypted keys for security
    const maskedKeys = apiKeys.map(key => ({
      id: key.id,
      provider: key.provider,
      label: key.label,
      isActive: key.isActive,
      lastUsed: key.lastUsed,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      keyPreview: maskApiKey(key.keyEncrypted.substring(0, 32)), // Mask a portion
    }))

    return NextResponse.json(maskedKeys)
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
    if (!provider || !Object.values(Provider).includes(provider as Provider)) {
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

    // Store in database
    const newKey = await prisma.apiKey.create({
      data: {
        userId: session.user.id,
        provider: provider as Provider,
        label: label.trim(),
        keyEncrypted: encrypted.encrypted,
        keyIv: encrypted.iv,
        keyAuthTag: encrypted.authTag,
      },
      select: {
        id: true,
        provider: true,
        label: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json(newKey, { status: 201 })
  } catch (error) {
    console.error('Failed to create API key:', error)
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500 }
    )
  }
}
