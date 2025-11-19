/**
 * SillyTavern Persona Import/Export
 */

export interface STPersona {
  name: string
  description: string
  personality?: string
  scenario?: string
  mes_example?: string
  avatar?: string
  [key: string]: any
}

/**
 * Multi-persona backup format
 */
export interface MultiPersonaBackup {
  personas: Record<string, string> // filename -> name mapping
  persona_descriptions: Record<string, PersonaDescription>
  default_persona?: string
}

export interface PersonaDescription {
  description: string
  title?: string
  position?: number
  depth?: number
  role?: number
  lorebook?: string
  connections?: Array<{
    type: string
    id: string
  }>
  [key: string]: any
}

/**
 * Import SillyTavern persona data to internal format
 */
export function importSTPersona(stData: STPersona) {
  return {
    name: stData.name,
    description: stData.description,
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
    personality: persona.personalityTraits || '',
  }
}

/**
 * Check if the data is a multi-persona backup format
 */
export function isMultiPersonaBackup(data: any): data is MultiPersonaBackup {
  return (
    data &&
    typeof data === 'object' &&
    'personas' in data &&
    'persona_descriptions' in data &&
    typeof data.personas === 'object' &&
    typeof data.persona_descriptions === 'object'
  )
}

/**
 * Convert multi-persona backup to array of STPersona objects
 */
export function convertMultiPersonaBackup(backup: MultiPersonaBackup): STPersona[] {
  const personas: STPersona[] = []

  // Iterate through each persona in the backup
  for (const [filename, name] of Object.entries(backup.personas)) {
    const description = backup.persona_descriptions[filename]

    if (description) {
      personas.push({
        name: name,
        description: description.description,
        personality: '', // Not directly available in this format
        // Store the full backup data for this persona
        title: description.title,
        position: description.position,
        depth: description.depth,
        role: description.role,
        lorebook: description.lorebook,
        connections: description.connections,
        filename: filename,
        isDefault: backup.default_persona === filename,
        // Store any other fields from the description
        ...description,
      })
    }
  }

  return personas
}
