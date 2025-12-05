// Memories Search API: Search memories for a character
// POST /api/characters/[id]/memories/search - Semantic/keyword search

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { z } from 'zod'
import { logger } from '@/lib/logger'

// Validation schema for search request
const searchMemorySchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  limit: z.number().min(1).max(100).default(20),
  minImportance: z.number().min(0).max(1).optional(),
  minScore: z.number().min(0).max(1).optional(),
  source: z.enum(['AUTO', 'MANUAL']).optional(),
})

// POST /api/characters/[id]/memories/search - Search memories
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

    const body = await req.json()
    const { query, limit, minImportance, minScore, source } = searchMemorySchema.parse(body)

    // Use semantic search (falls back to text search if embedding unavailable)
    const searchResults = await searchMemoriesSemantic(characterId, query, {
      userId: user.id,
      limit,
      minScore,
      minImportance,
      source,
    })

    // Enrich with tag names
    const allTags = await repos.tags.findAll()
    const tagMap = new Map(allTags.map(t => [t.id, t]))

    const memoriesWithTags = searchResults.map(result => ({
      ...result.memory,
      score: result.score,
      usedEmbedding: result.usedEmbedding,
      tagDetails: result.memory.tags
        .map(tagId => tagMap.get(tagId))
        .filter(Boolean),
    }))

    // Update access times for returned memories (fire and forget)
    Promise.all(
      searchResults.map(r => repos.memories.updateAccessTime(characterId, r.memory.id))
    ).catch(err =>
      logger.warn('Failed to update memory access times after search', { characterId, error: err instanceof Error ? err.message : String(err) })
    )

    return NextResponse.json({
      memories: memoriesWithTags,
      count: memoriesWithTags.length,
      query,
      usedEmbedding: searchResults.length > 0 ? searchResults[0].usedEmbedding : false,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error searching memories', {}, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to search memories' },
      { status: 500 }
    )
  }
}
