// Memories Search API: Search memories for a character
// POST /api/characters/[id]/memories/search - Semantic/keyword search

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { z } from 'zod'

// Validation schema for search request
const searchMemorySchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  limit: z.number().min(1).max(100).default(20),
  minImportance: z.number().min(0).max(1).optional(),
  source: z.enum(['AUTO', 'MANUAL']).optional(),
})

// POST /api/characters/[id]/memories/search - Search memories
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: characterId } = await params
    const session = await getServerSession(authOptions)
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
    const { query, limit, minImportance, source } = searchMemorySchema.parse(body)

    // For now, use text-based search (semantic search will be added in Sprint 4)
    let memories = await repos.memories.searchByContent(characterId, query)

    // Apply additional filters
    if (minImportance !== undefined) {
      memories = memories.filter(m => m.importance >= minImportance)
    }

    if (source) {
      memories = memories.filter(m => m.source === source)
    }

    // Sort by importance (most important first) and limit
    memories = memories
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit)

    // Enrich with tag names
    const allTags = await repos.tags.findAll()
    const tagMap = new Map(allTags.map(t => [t.id, t]))

    const memoriesWithTags = memories.map(memory => ({
      ...memory,
      tagDetails: memory.tags
        .map(tagId => tagMap.get(tagId))
        .filter(Boolean),
    }))

    // Update access times for returned memories (fire and forget)
    Promise.all(
      memories.map(m => repos.memories.updateAccessTime(characterId, m.id))
    ).catch(console.error)

    return NextResponse.json({
      memories: memoriesWithTags,
      count: memoriesWithTags.length,
      query,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error searching memories:', error)
    return NextResponse.json(
      { error: 'Failed to search memories' },
      { status: 500 }
    )
  }
}
