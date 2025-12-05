/**
 * Memory Housekeeping API
 * POST /api/characters/:id/memories/housekeep - Run memory cleanup
 *
 * Sprint 6: Housekeeping system for automatic memory cleanup
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { runHousekeeping, getHousekeepingPreview, HousekeepingOptions } from '@/lib/memory/housekeeping'
import { z } from 'zod'
import { logger } from '@/lib/logger'

// Validation schema for housekeeping options
const housekeepingOptionsSchema = z.object({
  /** Maximum number of memories to keep */
  maxMemories: z.number().min(10).max(10000).optional(),
  /** Delete memories older than this many months if not important */
  maxAgeMonths: z.number().min(1).max(120).optional(),
  /** Delete memories not accessed in this many months */
  maxInactiveMonths: z.number().min(1).max(120).optional(),
  /** Delete memories below this importance threshold */
  minImportance: z.number().min(0).max(1).optional(),
  /** Merge semantically similar memories */
  mergeSimilar: z.boolean().optional(),
  /** Similarity threshold for merging (0.8-1.0) */
  mergeThreshold: z.number().min(0.8).max(1).optional(),
  /** Preview changes without applying */
  dryRun: z.boolean().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: characterId } = await params
    const session = await getServerSession()

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId)
    if (!character || character.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Parse and validate options
    const body = await req.json().catch(() => ({}))
    const optionsResult = housekeepingOptionsSchema.safeParse(body)

    if (!optionsResult.success) {
      return NextResponse.json(
        { error: 'Invalid options', details: optionsResult.error.errors },
        { status: 400 }
      )
    }

    const options: HousekeepingOptions = {
      ...optionsResult.data,
      userId: user.id,
    }

    // Get embedding profile from chat settings
    const chatSettings = await repos.users.getChatSettings(user.id)
    if (chatSettings?.cheapLLMSettings?.embeddingProfileId) {
      options.embeddingProfileId = chatSettings.cheapLLMSettings.embeddingProfileId
    }

    // Run housekeeping (or preview if dryRun)
    const result = options.dryRun
      ? await getHousekeepingPreview(characterId, options)
      : await runHousekeeping(characterId, options)

    return NextResponse.json({
      success: true,
      dryRun: !!options.dryRun,
      result: {
        deleted: result.deleted,
        merged: result.merged,
        kept: result.kept,
        totalBefore: result.totalBefore,
        totalAfter: result.totalAfter,
        deletedIds: result.deletedIds,
        mergedIds: result.mergedIds,
        // Only include details in preview mode to avoid large responses
        details: options.dryRun ? result.details : undefined,
      },
    })
  } catch (error) {
    logger.error('Error running housekeeping', {}, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to run housekeeping' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/characters/:id/memories/housekeep - Get housekeeping preview
 *
 * Returns a preview of what would be cleaned up without making changes
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: characterId } = await params
    const session = await getServerSession()

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId)
    if (!character || character.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Parse options from query params
    const url = new URL(req.url)
    const options: HousekeepingOptions = {
      userId: user.id,
    }

    if (url.searchParams.has('maxMemories')) {
      options.maxMemories = parseInt(url.searchParams.get('maxMemories')!, 10)
    }
    if (url.searchParams.has('maxAgeMonths')) {
      options.maxAgeMonths = parseInt(url.searchParams.get('maxAgeMonths')!, 10)
    }
    if (url.searchParams.has('minImportance')) {
      options.minImportance = parseFloat(url.searchParams.get('minImportance')!)
    }
    if (url.searchParams.has('mergeSimilar')) {
      options.mergeSimilar = url.searchParams.get('mergeSimilar') === 'true'
    }

    // Get embedding profile from chat settings
    const chatSettings = await repos.users.getChatSettings(user.id)
    if (chatSettings?.cheapLLMSettings?.embeddingProfileId) {
      options.embeddingProfileId = chatSettings.cheapLLMSettings.embeddingProfileId
    }

    // Get preview
    const preview = await getHousekeepingPreview(characterId, options)

    return NextResponse.json({
      success: true,
      preview: {
        wouldDelete: preview.deleted,
        wouldMerge: preview.merged,
        wouldKeep: preview.kept,
        totalBefore: preview.totalBefore,
        totalAfter: preview.totalAfter,
        details: preview.details,
      },
    })
  } catch (error) {
    logger.error('Error getting housekeeping preview', {}, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to get housekeeping preview' },
      { status: 500 }
    )
  }
}
