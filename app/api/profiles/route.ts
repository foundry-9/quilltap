/**
 * Connection Profile Management Routes
 * Phase 0.3: Core Infrastructure
 *
 * GET    /api/profiles   - List all connection profiles for current user
 * POST   /api/profiles   - Create a new connection profile
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Provider } from '@prisma/client'

/**
 * GET /api/profiles
 * List all connection profiles for the authenticated user
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

    const profiles = await prisma.connectionProfile.findMany({
      where: {
        userId: session.user.id,
      },
      include: {
        apiKey: {
          select: {
            id: true,
            label: true,
            provider: true,
            isActive: true,
          },
        },
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    })

    return NextResponse.json(profiles)
  } catch (error) {
    console.error('Failed to fetch connection profiles:', error)
    return NextResponse.json(
      { error: 'Failed to fetch connection profiles' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/profiles
 * Create a new connection profile
 *
 * Body: {
 *   name: string,
 *   provider: Provider,
 *   apiKeyId?: string,
 *   baseUrl?: string,
 *   modelName: string,
 *   parameters?: {
 *     temperature?: number,
 *     max_tokens?: number,
 *     top_p?: number,
 *     ...
 *   },
 *   isDefault?: boolean
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
    const {
      name,
      provider,
      apiKeyId,
      baseUrl,
      modelName,
      parameters = {},
      isDefault = false,
    } = body

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    if (!provider || !Object.values(Provider).includes(provider as Provider)) {
      return NextResponse.json(
        { error: 'Invalid provider' },
        { status: 400 }
      )
    }

    if (!modelName || typeof modelName !== 'string' || modelName.trim().length === 0) {
      return NextResponse.json(
        { error: 'Model name is required' },
        { status: 400 }
      )
    }

    // Validate apiKeyId if provided
    if (apiKeyId) {
      const apiKey = await prisma.apiKey.findFirst({
        where: {
          id: apiKeyId,
          userId: session.user.id,
        },
      })

      if (!apiKey) {
        return NextResponse.json(
          { error: 'API key not found' },
          { status: 404 }
        )
      }

      // Ensure provider matches
      if (apiKey.provider !== provider) {
        return NextResponse.json(
          { error: 'API key provider does not match profile provider' },
          { status: 400 }
        )
      }
    }

    // Validate baseUrl for providers that need it
    if ((provider === 'OLLAMA' || provider === 'OPENAI_COMPATIBLE') && !baseUrl) {
      return NextResponse.json(
        { error: `Base URL is required for ${provider}` },
        { status: 400 }
      )
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await prisma.connectionProfile.updateMany({
        where: {
          userId: session.user.id,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      })
    }

    // Create profile
    const profile = await prisma.connectionProfile.create({
      data: {
        userId: session.user.id,
        name: name.trim(),
        provider: provider as Provider,
        apiKeyId: apiKeyId || null,
        baseUrl: baseUrl || null,
        modelName: modelName.trim(),
        parameters: parameters,
        isDefault,
      },
      include: {
        apiKey: {
          select: {
            id: true,
            label: true,
            provider: true,
            isActive: true,
          },
        },
      },
    })

    return NextResponse.json(profile, { status: 201 })
  } catch (error) {
    console.error('Failed to create connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to create connection profile' },
      { status: 500 }
    )
  }
}
