/**
 * Template Processing for Story String Replacements
 * Supports SillyTavern-compatible template variables
 */

export interface TemplateContext {
  // Character data
  char?: string // Character name
  description?: string // Character description
  personality?: string // Character personality
  scenario?: string // Current scenario

  // Persona data
  user?: string // User/persona name
  persona?: string // Persona description

  // System prompts
  system?: string // System prompt or character's main prompt override

  // Example dialogues
  mesExamples?: string // Formatted example dialogues
  mesExamplesRaw?: string // Raw example dialogues without formatting

  // World Info / Lorebook (future support)
  wiBefore?: string // World info before character defs
  wiAfter?: string // World info after character defs
  loreBefore?: string // Alias for wiBefore
  loreAfter?: string // Alias for wiAfter

  // Anchor points (future support)
  anchorBefore?: string // Content before story string
  anchorAfter?: string // Content after story string
}

/**
 * Process template string by replacing template variables
 * with their corresponding values from the context
 *
 * @param template - String containing template variables like {{char}}, {{user}}, etc.
 * @param context - Object containing values for template variables
 * @returns Processed string with variables replaced
 */
export function processTemplate(template: string, context: TemplateContext): string {
  if (!template) {
    return ''
  }

  let result = template

  // Replace all supported template variables
  // Using a regex to match {{variable}} patterns
  result = result.replace(/\{\{(\w+)\}\}/g, (match, variable) => {
    const value = context[variable as keyof TemplateContext]

    // If value exists and is not undefined, use it
    // Otherwise, keep the original template variable (for debugging)
    if (value !== undefined && value !== null) {
      return String(value)
    }

    // Return empty string for undefined variables
    // This matches SillyTavern behavior where missing variables are excluded
    return ''
  })

  // Handle {{trim}} macro - removes surrounding newlines
  result = result.replace(/\{\{trim\}\}([\s\S]*?)\{\{\/trim\}\}/g, (_match, content) => {
    return content.replace(/^\n+|\n+$/g, '')
  })

  return result
}

/**
 * Build template context from character and persona data
 * This creates the context object used for template replacement
 */
export function buildTemplateContext({
  character,
  persona,
  scenario,
}: {
  character: {
    name: string
    description?: string | null
    personality?: string | null
    scenario?: string | null
    exampleDialogues?: string | null
    systemPrompt?: string | null
  }
  persona?: {
    name: string
    description?: string | null
  } | null
  scenario?: string | null
}): TemplateContext {
  return {
    // Character data
    char: character.name,
    description: character.description || '',
    personality: character.personality || '',
    scenario: scenario || character.scenario || '',

    // Persona data
    user: persona?.name || 'User',
    persona: persona?.description || '',

    // System prompt
    system: character.systemPrompt || '',

    // Example dialogues
    mesExamplesRaw: character.exampleDialogues || '',
    mesExamples: character.exampleDialogues || '',

    // Future support - these will be empty for now
    wiBefore: '',
    wiAfter: '',
    loreBefore: '',
    loreAfter: '',
    anchorBefore: '',
    anchorAfter: '',
  }
}

/**
 * Process all character fields that may contain template variables
 * This ensures consistency across all character data sent to the LLM
 */
export function processCharacterTemplates({
  character,
  persona,
  scenario,
}: {
  character: {
    name: string
    description?: string | null
    personality?: string | null
    scenario?: string | null
    firstMessage?: string | null
    exampleDialogues?: string | null
    systemPrompt?: string | null
  }
  persona?: {
    name: string
    description?: string | null
  } | null
  scenario?: string | null
}): {
  description: string
  personality: string
  scenario: string
  firstMessage: string
  exampleDialogues: string
  systemPrompt: string
} {
  const context = buildTemplateContext({ character, persona, scenario })

  return {
    description: processTemplate(character.description || '', context),
    personality: processTemplate(character.personality || '', context),
    scenario: processTemplate(scenario || character.scenario || '', context),
    firstMessage: processTemplate(character.firstMessage || '', context),
    exampleDialogues: processTemplate(character.exampleDialogues || '', context),
    systemPrompt: processTemplate(character.systemPrompt || '', context),
  }
}
