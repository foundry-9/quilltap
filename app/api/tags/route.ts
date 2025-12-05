// Tags API: List, Search, and Create
// GET /api/tags?search=query - List/search all tags for user
// POST /api/tags - Create a new tag

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { z } from 'zod'
import { logger } from '@/lib/logger'

// Validation schema
const createTagSchema = z.object({
  name: z.string().min(1, 'Tag name is required').max(50),
})

// GET /api/tags - List or search tags
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const searchParams = req.nextUrl.searchParams
    const search = searchParams.get('search')

    // Get all tags for the user
    let tags = await repos.tags.findByUserId(user.id)

    // Filter by search if provided
    if (search) {
      const searchLower = search.toLowerCase()
      tags = tags.filter(tag => tag.nameLower.includes(searchLower))
    }

    // Sort by name
    tags.sort((a, b) => a.name.localeCompare(b.name))

    // Get usage counts for each tag
    const allCharacters = await repos.characters.findAll()
    const allPersonas = await repos.personas.findAll()
    const allChats = await repos.chats.findAll()
    const allConnections = await repos.connections.findAll()

    const tagsWithCounts = tags.map(tag => {
      const characterTags = allCharacters.filter(c => c.tags.includes(tag.id)).length
      const personaTags = allPersonas.filter(p => p.tags.includes(tag.id)).length
      const chatTags = allChats.filter(c => c.tags.includes(tag.id)).length
      const connectionProfileTags = allConnections.filter(c => c.tags.includes(tag.id)).length

      return {
        id: tag.id,
        name: tag.name,
        quickHide: tag.quickHide,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
        _count: {
          characterTags,
          personaTags,
          chatTags,
          connectionProfileTags,
        },
      }
    })

    return NextResponse.json({ tags: tagsWithCounts })
  } catch (error) {
    logger.error('Error fetching tags:', error as Error)
    return NextResponse.json(
      { error: 'Failed to fetch tags' },
      { status: 500 }
    )
  }
}

// POST /api/tags - Create a new tag
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = createTagSchema.parse(body)

    const nameLower = validatedData.name.toLowerCase()

    // Check if tag already exists (case-insensitive)
    const existingTag = await repos.tags.findByName(user.id, validatedData.name)

    if (existingTag) {
      // Return existing tag instead of error
      return NextResponse.json({ tag: existingTag })
    }

    const tag = await repos.tags.create({
      userId: user.id,
      name: validatedData.name,
      nameLower,
      quickHide: false,
    })

    return NextResponse.json({ tag }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error creating tag:', error as Error)
    return NextResponse.json(
      { error: 'Failed to create tag' },
      { status: 500 }
    )
  }
}
