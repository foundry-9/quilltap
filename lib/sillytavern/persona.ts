/**
 * SillyTavern Persona Import/Export
 */

export interface STPersona {
  name: string
  description: string
  title?: string
  personality?: string
  scenario?: string
  mes_example?: string
  avatar?: string
  [key: string]: any
}

/**
 * Import SillyTavern persona data to internal format
 */
export function importSTPersona(stData: STPersona) {
  return {
    name: stData.name,
    description: stData.description,
    title: stData.title || '',
    personalityTraits: stData.personality || '',
    sillyTavernData: stData, // Store original for full fidelity
  }
}

/**
 * Export internal persona to SillyTavern format
 */
export function exportSTPersona(persona: any): STPersona {
  // If we have original ST data, use it as base
  const baseData: STPersona = persona.sillyTavernData || {
    name: persona.name,
    description: persona.description,
  }

  // Override with current values
  return {
    ...baseData,
    name: persona.name,
    description: persona.description,
    title: persona.title || '',
    personality: persona.personalityTraits || '',
  }
}
