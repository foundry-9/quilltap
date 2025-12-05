/**
 * Individual API Key Operations
 * Phase 0.3: Core Infrastructure
 *
 * GET    /api/keys/[id]  - Get a specific API key
 * PUT    /api/keys/[id]  - Update an API key
 * DELETE /api/keys/[id]  - Delete an API key
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { encryptApiKey, maskApiKey } from '@/lib/encryption'
import { logger } from '@/lib/logger'

/**
 * GET /api/keys/[id]
 * Get a specific API key (masked)
 */
export async function GET(
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
    const apiKey = await repos.connections.findApiKeyById(id)

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not found' },
        { status: 404 }
      )
    }

    // Return masked key
    return NextResponse.json({
      id: apiKey.id,
      provider: apiKey.provider,
      label: apiKey.label,
      isActive: apiKey.isActive,
      lastUsed: apiKey.lastUsed,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
      keyPreview: maskApiKey(apiKey.ciphertext.substring(0, 32)),
    })
  } catch (error) {
    logger.error('Failed to fetch API key', { endpoint: '/api/keys/[id]', method: 'GET' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch API key' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/keys/[id]
 * Update an API key (label, isActive, or the key itself)
 *
 * Body: {
 *   label?: string,
 *   isActive?: boolean,
 *   apiKey?: string  // If provided, re-encrypts the key
 * }
 */
export async function PUT(
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

    // Verify key exists
    const existingKey = await repos.connections.findApiKeyById(id)

    if (!existingKey) {
      return NextResponse.json(
        { error: 'API key not found' },
        { status: 404 }
      )
    }

    const body = await req.json()
    const { label, isActive, apiKey } = body

    // Build update data
    const updateData: any = {}

    if (label !== undefined) {
      if (typeof label !== 'string' || label.trim().length === 0) {
        return NextResponse.json(
          { error: 'Label must be a non-empty string' },
          { status: 400 }
        )
      }
      updateData.label = label.trim()
    }

    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return NextResponse.json(
          { error: 'isActive must be a boolean' },
          { status: 400 }
        )
      }
      updateData.isActive = isActive
    }

    // If new API key is provided, re-encrypt it
    if (apiKey !== undefined) {
      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return NextResponse.json(
          { error: 'API key must be a non-empty string' },
          { status: 400 }
        )
      }

      const encrypted = encryptApiKey(apiKey, session.user.id)
      updateData.ciphertext = encrypted.encrypted
      updateData.iv = encrypted.iv
      updateData.authTag = encrypted.authTag
    }

    // Update the key
    const updatedKey = await repos.connections.updateApiKey(id, updateData)

    if (!updatedKey) {
      return NextResponse.json(
        { error: 'Failed to update API key' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      id: updatedKey.id,
      provider: updatedKey.provider,
      label: updatedKey.label,
      isActive: updatedKey.isActive,
      lastUsed: updatedKey.lastUsed,
      createdAt: updatedKey.createdAt,
      updatedAt: updatedKey.updatedAt,
    })
  } catch (error) {
    logger.error('Failed to update API key', { endpoint: '/api/keys/[id]', method: 'PUT' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to update API key' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/keys/[id]
 * Delete an API key
 */
export async function DELETE(
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

    // Verify key exists
    const existingKey = await repos.connections.findApiKeyById(id)

    if (!existingKey) {
      return NextResponse.json(
        { error: 'API key not found' },
        { status: 404 }
      )
    }

    // Delete the key
    const deleted = await repos.connections.deleteApiKey(id)

    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete API key' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'API key deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    logger.error('Failed to delete API key', { endpoint: '/api/keys/[id]', method: 'DELETE' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to delete API key' },
      { status: 500 }
    )
  }
}
