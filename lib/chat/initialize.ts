// Chat Initialization Utility
// Phase 0.5: Single Chat MVP

import { getRepositories } from '@/lib/json-store/repositories'
import { processCharacterTemplates } from '@/lib/templates/processor'

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
  const repos = getRepositories()

  const character = await repos.characters.findById(characterId)

  if (!character) {
    throw new Error('Character not found')
  }

  let persona: Persona | null = null
  if (personaId) {
    persona = await repos.personas.findById(personaId) as Persona | null
  } else if (character.personaLinks && character.personaLinks.length > 0) {
    // Find default persona
    const defaultLink = character.personaLinks.find(link => link.isDefault)
    if (defaultLink) {
      persona = await repos.personas.findById(defaultLink.personaId) as Persona | null
    }
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    character,
    persona: persona || undefined,
    scenario: customScenario || character.scenario,
  })

  // Process first message with templates
  const processedCharacter = processCharacterTemplates({
    character,
    persona: persona || undefined,
    scenario: customScenario || character.scenario,
  })
  const firstMessage = processedCharacter.firstMessage

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
  // Process all character templates with the current context
  const processedCharacter = processCharacterTemplates({
    character,
    persona,
    scenario,
  })

  let prompt = processedCharacter.systemPrompt || ''

  // Add character identity
  prompt += `\n\nYou are roleplaying as ${character.name}.`

  // Add character description (with templates processed)
  if (processedCharacter.description) {
    prompt += `\n\nCharacter Description:\n${processedCharacter.description}`
  }

  // Add personality (with templates processed)
  if (processedCharacter.personality) {
    prompt += `\n\nPersonality:\n${processedCharacter.personality}`
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

  // Add scenario (with templates processed)
  if (processedCharacter.scenario) {
    prompt += `\n\nScenario:\n${processedCharacter.scenario}`
  }

  // Add example dialogues (with templates processed)
  if (processedCharacter.exampleDialogues) {
    prompt += `\n\nExample Dialogue:\n${processedCharacter.exampleDialogues}`
  }

  // Add roleplay instructions
  prompt += `\n\nStay in character at all times. Respond naturally and consistently with ${character.name}'s personality and the current scenario.`

  return prompt.trim()
}
