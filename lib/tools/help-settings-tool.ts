/**
 * Help Settings Tool Definition
 *
 * Provides a tool interface for LLMs to read Quilltap instance settings
 * during conversations. This allows help characters like Lorian and Riya
 * to understand and assist with the user's current configuration.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Valid settings categories
 */
export type HelpSettingsCategory =
  | 'overview'
  | 'chat'
  | 'connections'
  | 'embeddings'
  | 'images'
  | 'appearance'
  | 'templates'
  | 'system'

/**
 * Zod schema for the help settings tool's input.
 */
export const helpSettingsToolInputSchema = z.object({
  category: z
    .enum(['overview', 'chat', 'connections', 'embeddings', 'images', 'appearance', 'templates', 'system'])
    .describe(
      'Which settings category to read. "overview" returns a high-level summary of all categories. "chat" returns token display, context compression, memory cascade, timestamps, agent mode, and content settings. "connections" returns configured LLM providers and models (API keys are never shown). "embeddings" returns embedding/memory search profiles. "images" returns image generation profiles and story background settings. "appearance" returns theme and avatar settings. "templates" returns roleplay templates. "system" returns plugin list and logging settings.'
    ),
})

/**
 * Input parameters for the help settings tool
 */
export type HelpSettingsToolInput = z.infer<typeof helpSettingsToolInputSchema>

/**
 * Output from the help settings tool
 */
export interface HelpSettingsToolOutput {
  success: boolean
  category: HelpSettingsCategory
  data?: Record<string, unknown>
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const helpSettingsToolDefinition = {
  type: 'function',
  function: {
    name: 'help_settings',
    description:
      'Read Quilltap instance settings to understand the current configuration. Use this to help users understand their setup, troubleshoot configuration issues, or suggest settings changes. Select a category to read specific settings.',
    parameters: zodToOpenAISchema(helpSettingsToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateHelpSettingsInput(
  input: unknown
): HelpSettingsToolInput | null {
  const parsed = helpSettingsToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
