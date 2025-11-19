// Tags API: List, Search, and Create
// GET /api/tags?search=query - List/search all tags for user
// POST /api/tags - Create a new tag

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Validation schema
const createTagSchema = z.object({
  name: z.string().min(1, 'Tag name is required').max(50),
})

// GET /api/tags - List or search tags
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const searchParams = req.nextUrl.searchParams
    const search = searchParams.get('search')

    const tags = await prisma.tag.findMany({
      where: {
        userId: user.id,
        ...(search && {
          nameLower: {
            contains: search.toLowerCase(),
          },
        }),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            characterTags: true,
            personaTags: true,
            chatTags: true,
            connectionProfileTags: true,
          },
        },
      },
    })

    return NextResponse.json({ tags })
  } catch (error) {
    console.error('Error fetching tags:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tags' },
      { status: 500 }
    )
  }
}

// POST /api/tags - Create a new tag
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = createTagSchema.parse(body)

    const nameLower = validatedData.name.toLowerCase()

    // Check if tag already exists (case-insensitive)
    const existingTag = await prisma.tag.findUnique({
      where: {
        userId_nameLower: {
          userId: user.id,
          nameLower,
        },
      },
    })

    if (existingTag) {
      // Return existing tag instead of error
      return NextResponse.json({ tag: existingTag })
    }

    const tag = await prisma.tag.create({
      data: {
        userId: user.id,
        name: validatedData.name,
        nameLower,
      },
    })

    return NextResponse.json({ tag }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error creating tag:', error)
    return NextResponse.json(
      { error: 'Failed to create tag' },
      { status: 500 }
    )
  }
}
