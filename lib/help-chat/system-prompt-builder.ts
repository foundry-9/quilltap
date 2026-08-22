/**
 * Help Chat System Prompt Builder
 *
 * Builds system prompts for characters in help chat mode.
 * Simpler than the Salon prompt builder: includes character identity,
 * help-specific instructions, page context, and tool guidance.
 * Omits: roleplay templates, scene state, timestamps, Concierge, project context.
 */

import type { Character } from '@/lib/schemas/types'
import { processTemplate, type TemplateContext } from '@/lib/templates/processor'
import { buildIdentityReinforcement } from '@/lib/chat/context/system-prompt-builder'
import type { HelpPageContext } from './context-resolver'
import { logger } from '@/lib/logger'

const helpChatLogger = logger.child({ context: 'HelpChat' })

export interface HelpSystemPromptOptions {
  character: Character
  userCharacter?: { name: string; description: string } | null
  pageContext?: HelpPageContext | null
  additionalPageContexts?: HelpPageContext[]
  otherCharacterNames?: string[]
  toolInstructions?: string
}

/**
 * Build the system prompt for a help chat character
 */
export function buildHelpChatSystemPrompt(options: HelpSystemPromptOptions): string {
  const {
    character,
    userCharacter,
    pageContext,
    additionalPageContexts,
    otherCharacterNames,
    toolInstructions,
  } = options

  const parts: string[] = []
  const userName = userCharacter?.name || 'User'

  // Template context for {{char}}/{{user}} replacement
  const templateContext: TemplateContext = {
    char: character.name,
    user: userName,
    description: character.description || '',
    personality: character.personality || '',
    scenario: character.scenarios?.[0]?.content || '',
    persona: userCharacter?.description || '',
  }

  // 1. Identity preamble (same anchor as Salon)
  parts.push(processTemplate(
    '## Character Identity\nYou are {{char}}. Everything that follows defines who you are and how you behave. Stay in character at all times.',
    templateContext
  ))

  // 2. Help chat role definition
  parts.push(`## Help Assistant Role
You are assisting the user with Quilltap, a self-hosted AI workspace for writers, worldbuilders, and roleplayers. Your role is to answer questions about the application, help them navigate features, and troubleshoot issues — all while staying in character as ${character.name}.

When helping:
- Use your tools (help_search, help_settings, help_navigate) to find accurate information
- Be specific and actionable in your guidance
- If you're not sure about something, search for it rather than guessing
- **IMPORTANT:** Whenever you direct the user to a specific page, settings tab, or section, you MUST call the \`help_navigate\` tool with the appropriate URL. This gives the user a clickable button to go directly there. Do not just describe the navigation steps — always also call the tool so they can click through. The help documentation includes the correct URLs for each page.
- Stay warm and helpful while remaining in character`)

  // 3. Tool instructions
  if (toolInstructions) {
    const processedToolInstructions = processTemplate(toolInstructions, templateContext)
    parts.push(processedToolInstructions)
  }

  // 4. Character personality (simplified - no scenario/dialogues for help)
  if (character.personality) {
    const processedPersonality = processTemplate(character.personality, templateContext)
    parts.push(`## Character Personality\n${processedPersonality}`)
  }

  // 5. Character pronouns
  if (character.pronouns) {
    parts.push(`## Character Pronouns\nThis character's pronouns are: ${character.pronouns.subject}/${character.pronouns.object}/${character.pronouns.possessive}. Always use these pronouns when referring to this character.`)
  }

  // 6. Tool reinforcement. Second person, mirroring the Salon builder — see the
  // WHY note in lib/chat/context/system-prompt-builder.ts. The pronoun lookup it
  // replaces defaulted to 'they', which rendered "they CALLS them".
  if (toolInstructions) {
    const toolReinforcement = processTemplate(
      `When you use workspace tools, you CALL them — you do not merely describe calling them. Every tool action produces a tool_use block, not prose.`,
      templateContext
    )
    parts.push(toolReinforcement)
  }

  // 7. Page context (the resolved help documentation)
  if (pageContext) {
    parts.push(`## Current Page Context
The user is currently viewing: **${pageContext.title}**
URL: \`${pageContext.url}\`

### Page Documentation
${pageContext.content}`)
  }

  // Additional page contexts (wildcard docs like sidebar, search)
  if (additionalPageContexts && additionalPageContexts.length > 0) {
    for (const ctx of additionalPageContexts) {
      parts.push(`### Additional Context: ${ctx.title}\n${ctx.content}`)
    }
  }

  // 8. User character info
  if (userCharacter) {
    parts.push(`## User Character\nYou are speaking with ${userCharacter.name}. ${userCharacter.description}`)
  }

  // 9. Multi-character note (if multiple help characters)
  if (otherCharacterNames && otherCharacterNames.length > 0) {
    parts.push(`## Other Help Characters\nYou are one of several characters helping the user. The others are: ${otherCharacterNames.join(', ')}. Each of you will respond to the user's questions. Try not to repeat what others have already said.`)
  }

  // 10. Identity reinforcement bookend
  parts.push(buildIdentityReinforcement(character.name))

  helpChatLogger.debug('Built help chat system prompt', {
    characterName: character.name,
    hasPageContext: !!pageContext,
    pageTitle: pageContext?.title,
    additionalContextCount: additionalPageContexts?.length ?? 0,
    promptLength: parts.join('\n\n').length,
  })

  return parts.join('\n\n').trim()
}
