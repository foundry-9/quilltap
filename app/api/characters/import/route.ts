/**
 * Character Import API
 * POST /api/characters/import - Import a SillyTavern character (PNG or JSON)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { importSTCharacter, parseSTCharacterPNG } from '@/lib/sillytavern/character'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const contentType = req.headers.get('content-type')

    let characterData = null
    let avatarUrl = null

    if (contentType?.includes('multipart/form-data')) {
      // Handle file upload (PNG)
      const formData = await req.formData()
      const file = formData.get('file') as File

      if (!file) {
        return NextResponse.json(
          { error: 'No file provided' },
          { status: 400 }
        )
      }

      const buffer = Buffer.from(await file.arrayBuffer())

      // Check if it's a PNG file
      if (file.type === 'image/png' || file.name.endsWith('.png')) {
        characterData = await parseSTCharacterPNG(buffer)

        if (!characterData) {
          return NextResponse.json(
            { error: 'Invalid SillyTavern PNG file' },
            { status: 400 }
          )
        }

        // TODO: Store the avatar image
        // For now, we'll just note that we should save it
        avatarUrl = null // Will implement avatar storage later
      } else if (
        file.type === 'application/json' ||
        file.name.endsWith('.json')
      ) {
        // JSON file
        const jsonText = buffer.toString('utf-8')
        characterData = JSON.parse(jsonText)
      } else {
        return NextResponse.json(
          { error: 'Unsupported file type. Please upload PNG or JSON' },
          { status: 400 }
        )
      }
    } else if (contentType?.includes('application/json')) {
      // Handle JSON body
      const body = await req.json()
      characterData = body.characterData || body

      if (!characterData) {
        return NextResponse.json(
          { error: 'Character data is required' },
          { status: 400 }
        )
      }
    } else {
      return NextResponse.json(
        { error: 'Unsupported content type' },
        { status: 400 }
      )
    }

    // Import character from SillyTavern format
    const importedData = importSTCharacter(characterData)

    // Create character in database
    const character = await repos.characters.create({
      userId: session.user.id,
      ...importedData,
      avatarUrl: avatarUrl,
      isFavorite: false,
      tags: [] as string[],
      personaLinks: [] as { personaId: string; isDefault: boolean }[],
      avatarOverrides: [] as { chatId: string; imageId: string }[],
      defaultImageId: null,
    })

    // Get chat count for response (will be 0 for new character)
    const chats = await repos.chats.findByCharacterId(character.id)

    const response = {
      id: character.id,
      name: character.name,
      description: character.description,
      avatarUrl: character.avatarUrl,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
      _count: {
        chats: chats.length,
      },
    }

    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    console.error('Error importing character:', error)
    return NextResponse.json(
      { error: 'Failed to import character' },
      { status: 500 }
    )
  }
}
