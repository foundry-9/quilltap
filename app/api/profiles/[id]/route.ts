/**
 * Individual Connection Profile Operations
 * Phase 0.3: Core Infrastructure
 *
 * GET    /api/profiles/[id]  - Get a specific profile
 * PUT    /api/profiles/[id]  - Update a profile
 * DELETE /api/profiles/[id]  - Delete a profile
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Provider } from '@/lib/types/prisma'

/**
 * GET /api/profiles/[id]
 * Get a specific connection profile
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const profile = await prisma.connectionProfile.findFirst({
      where: {
        id,
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
    })

    if (!profile) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(profile)
  } catch (error) {
    console.error('Failed to fetch connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to fetch connection profile' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/profiles/[id]
 * Update a connection profile
 *
 * Body: {
 *   name?: string,
 *   apiKeyId?: string,
 *   baseUrl?: string,
 *   modelName?: string,
 *   parameters?: object,
 *   isDefault?: boolean
 * }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify ownership
    const existingProfile = await prisma.connectionProfile.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    })

    if (!existingProfile) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    const body = await req.json()
    const { name, apiKeyId, baseUrl, modelName, parameters, isDefault } = body

    // Build update data
    const updateData: any = {}

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name must be a non-empty string' },
          { status: 400 }
        )
      }
      updateData.name = name.trim()
    }

    if (apiKeyId !== undefined) {
      if (apiKeyId === null) {
        updateData.apiKeyId = null
      } else {
        // Validate the API key exists and belongs to user
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
        if (apiKey.provider !== existingProfile.provider) {
          return NextResponse.json(
            { error: 'API key provider does not match profile provider' },
            { status: 400 }
          )
        }

        updateData.apiKeyId = apiKeyId
      }
    }

    if (baseUrl !== undefined) {
      updateData.baseUrl = baseUrl || null
    }

    if (modelName !== undefined) {
      if (typeof modelName !== 'string' || modelName.trim().length === 0) {
        return NextResponse.json(
          { error: 'Model name must be a non-empty string' },
          { status: 400 }
        )
      }
      updateData.modelName = modelName.trim()
    }

    if (parameters !== undefined) {
      if (typeof parameters !== 'object' || Array.isArray(parameters)) {
        return NextResponse.json(
          { error: 'Parameters must be an object' },
          { status: 400 }
        )
      }
      updateData.parameters = parameters
    }

    if (isDefault !== undefined) {
      if (typeof isDefault !== 'boolean') {
        return NextResponse.json(
          { error: 'isDefault must be a boolean' },
          { status: 400 }
        )
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await prisma.connectionProfile.updateMany({
          where: {
            userId: session.user.id,
            isDefault: true,
            NOT: {
              id,
            },
          },
          data: {
            isDefault: false,
          },
        })
      }

      updateData.isDefault = isDefault
    }

    // Update the profile
    const updatedProfile = await prisma.connectionProfile.update({
      where: {
        id,
      },
      data: updateData,
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

    return NextResponse.json(updatedProfile)
  } catch (error) {
    console.error('Failed to update connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to update connection profile' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/profiles/[id]
 * Delete a connection profile
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify ownership
    const existingProfile = await prisma.connectionProfile.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    })

    if (!existingProfile) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    // Delete the profile
    await prisma.connectionProfile.delete({
      where: {
        id,
      },
    })

    return NextResponse.json(
      { message: 'Connection profile deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Failed to delete connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to delete connection profile' },
      { status: 500 }
    )
  }
}
