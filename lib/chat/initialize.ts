// Chat Initialization Utility
// Phase 0.5: Single Chat MVP

import { prisma } from '@/lib/prisma'

interface Character {
  id: string
  name: string
  description: string
  personality: string
  scenario: string
  firstMessage: string
  exampleDialogues?: string | null
  systemPrompt?: string | null
}

interface Persona {
  id: string
  name: string
  description: string
  personalityTraits?: string | null
}

export interface ChatContext {
  systemPrompt: string
  firstMessage: string
  character: Character
  persona?: Persona | null
}

export async function buildChatContext(
  characterId: string,
  personaId?: string,
  customScenario?: string
): Promise<ChatContext> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      personas: {
        where: personaId ? { personaId } : { isDefault: true },
        include: { persona: true },
      },
    },
  })

  if (!character) {
    throw new Error('Character not found')
  }

  const persona = personaId
    ? await prisma.persona.findUnique({ where: { id: personaId } })
    : character.personas[0]?.persona

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    character,
    persona: persona || undefined,
    scenario: customScenario || character.scenario,
  })

  // Get first message
  const firstMessage = character.firstMessage

  return {
    systemPrompt,
    firstMessage,
    character,
    persona: persona || null,
  }
}

function buildSystemPrompt({
  character,
  persona,
  scenario,
}: {
  character: Character
  persona?: Persona
  scenario: string
}): string {
  let prompt = character.systemPrompt || ''

  // Add character identity
  prompt += `\n\nYou are roleplaying as ${character.name}.`

  // Add character description
  if (character.description) {
    prompt += `\n\nCharacter Description:\n${character.description}`
  }

  // Add personality
  if (character.personality) {
    prompt += `\n\nPersonality:\n${character.personality}`
  }

  // Add persona (who they're talking to)
  if (persona) {
    prompt += `\n\nYou are talking to ${persona.name}.`
    if (persona.description) {
      prompt += `\n${persona.description}`
    }
    if (persona.personalityTraits) {
      prompt += `\nThey are: ${persona.personalityTraits}`
    }
  }

  // Add scenario
  if (scenario) {
    prompt += `\n\nScenario:\n${scenario}`
  }

  // Add example dialogues
  if (character.exampleDialogues) {
    prompt += `\n\nExample Dialogue:\n${character.exampleDialogues}`
  }

  // Add roleplay instructions
  prompt += `\n\nStay in character at all times. Respond naturally and consistently with ${character.name}'s personality and the current scenario.`

  return prompt.trim()
}
