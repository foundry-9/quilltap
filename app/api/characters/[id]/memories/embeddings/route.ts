// Memory Embeddings API: Generate and manage embeddings for memories
// POST /api/characters/[id]/memories/embeddings - Generate missing embeddings
// POST /api/characters/[id]/memories/embeddings/rebuild - Rebuild vector index

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import {
  generateMissingEmbeddings,
  rebuildVectorIndex,
} from '@/lib/memory/memory-service'
import { z } from 'zod'
import { logger } from '@/lib/logger'

// Validation schema for generate request
const generateEmbeddingsSchema = z.object({
  batchSize: z.number().min(1).max(50).default(10),
})

// Validation schema for rebuild request
const rebuildIndexSchema = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: 'Must confirm rebuild with confirm: true' }),
  }),
})

// POST /api/characters/[id]/memories/embeddings - Generate missing embeddings
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
    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }
    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Check if user has embedding profile configured
    const defaultProfile = await repos.embeddingProfiles.findDefault(user.id)
    if (!defaultProfile) {
      return NextResponse.json(
        { error: 'No embedding profile configured. Please set up an embedding profile in settings.' },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const { batchSize } = generateEmbeddingsSchema.parse(body)

    // Get memory count for progress info
    const memories = await repos.memories.findByCharacterId(characterId)
    const memoriesWithoutEmbeddings = memories.filter(
      m => !m.embedding || m.embedding.length === 0
    )

    if (memoriesWithoutEmbeddings.length === 0) {
      return NextResponse.json({
        message: 'All memories already have embeddings',
        processed: 0,
        failed: 0,
        skipped: 0,
        total: memories.length,
      })
    }

    // Generate embeddings
    const result = await generateMissingEmbeddings(characterId, {
      userId: user.id,
      batchSize,
    })

    return NextResponse.json({
      message: 'Embedding generation complete',
      ...result,
      total: memories.length,
      remaining: memoriesWithoutEmbeddings.length - result.processed - result.failed,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error generating embeddings', {}, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to generate embeddings' },
      { status: 500 }
    )
  }
}

// PUT /api/characters/[id]/memories/embeddings - Rebuild vector index
export async function PUT(
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
    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }
    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    rebuildIndexSchema.parse(body)

    // Rebuild the vector index
    const result = await rebuildVectorIndex(characterId, {
      userId: user.id,
    })

    return NextResponse.json({
      message: 'Vector index rebuilt successfully',
      ...result,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error rebuilding vector index', {}, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to rebuild vector index' },
      { status: 500 }
    )
  }
}

// GET /api/characters/[id]/memories/embeddings - Get embedding status
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
    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }
    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Get memory stats
    const memories = await repos.memories.findByCharacterId(characterId)
    const withEmbeddings = memories.filter(m => m.embedding && m.embedding.length > 0)
    const withoutEmbeddings = memories.filter(m => !m.embedding || m.embedding.length === 0)

    // Check if embedding profile is configured
    const defaultProfile = await repos.embeddingProfiles.findDefault(user.id)

    return NextResponse.json({
      total: memories.length,
      withEmbeddings: withEmbeddings.length,
      withoutEmbeddings: withoutEmbeddings.length,
      percentComplete: memories.length > 0
        ? Math.round((withEmbeddings.length / memories.length) * 100)
        : 100,
      embeddingProfileConfigured: defaultProfile !== null,
      embeddingProfileName: defaultProfile?.name || null,
    })
  } catch (error) {
    logger.error('Error getting embedding status', {}, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to get embedding status' },
      { status: 500 }
    )
  }
}
