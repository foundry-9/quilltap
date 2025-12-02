/**
 * Persona Import API
 * POST /api/personas/import - Import a SillyTavern persona
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { importSTPersona, isMultiPersonaBackup, convertMultiPersonaBackup } from '@/lib/sillytavern/persona'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()

    const body = await req.json()
    const { personaData } = body

    if (!personaData) {
      return NextResponse.json(
        { error: 'Persona data is required' },
        { status: 400 }
      )
    }

    // Check if this is a multi-persona backup or single persona
    if (isMultiPersonaBackup(personaData)) {
      // Handle multi-persona backup format
      const personasArray = convertMultiPersonaBackup(personaData)

      if (personasArray.length === 0) {
        return NextResponse.json(
          { error: 'No personas found in backup file' },
          { status: 400 }
        )
      }

      // Import all personas
      const createdPersonas = await Promise.all(
        personasArray.map(async (personaItem) => {
          const importedData = importSTPersona(personaItem)
          const persona = await repos.personas.create({
            userId: session.user.id,
            ...importedData,
            tags: [] as string[],
            characterLinks: [] as string[],
            defaultImageId: null,
            physicalDescriptions: [],
          })

          // Get character links for response
          const characters = await Promise.all(
            persona.characterLinks.map(async (characterId) => {
              const character = await repos.characters.findById(characterId)
              return character
                ? {
                    character: {
                      id: character.id,
                      name: character.name,
                    },
                  }
                : null
            })
          )

          return {
            ...persona,
            characters: characters.filter(Boolean),
          }
        })
      )

      return NextResponse.json(
        {
          personas: createdPersonas,
          count: createdPersonas.length,
          message: `Successfully imported ${createdPersonas.length} persona${createdPersonas.length === 1 ? '' : 's'}`
        },
        { status: 201 }
      )
    } else {
      // Handle single persona format
      const importedData = importSTPersona(personaData)

      // Create persona in database
      const persona = await repos.personas.create({
        userId: session.user.id,
        ...importedData,
        tags: [] as string[],
        characterLinks: [] as string[],
        defaultImageId: null,
        physicalDescriptions: [],
      })

      // Get character links for response
      const characters = await Promise.all(
        persona.characterLinks.map(async (characterId) => {
          const character = await repos.characters.findById(characterId)
          return character
            ? {
                character: {
                  id: character.id,
                  name: character.name,
                },
              }
            : null
        })
      )

      return NextResponse.json(
        {
          ...persona,
          characters: characters.filter(Boolean),
        },
        { status: 201 }
      )
    }
  } catch (error) {
    logger.error('Error importing persona:', error as Error)
    return NextResponse.json(
      { error: 'Failed to import persona' },
      { status: 500 }
    )
  }
}
