/**
 * Help Navigate Tool Definition
 *
 * Provides a tool interface for LLMs to navigate the user's browser to a
 * specific Quilltap page. This is particularly useful after searching help
 * documentation — the LLM can direct the user straight to the relevant
 * settings page, opening the correct tab and section automatically.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Allowed URL path prefixes for navigation (security: prevent navigating to arbitrary URLs)
 */
const ALLOWED_PATH_PREFIXES = [
  '/settings',
  '/aurora',
  '/salon',
  '/prospero',
  '/profile',
  '/files',
  '/setup',
] as const

/**
 * Zod schema for the help navigate tool's input.
 */
export const helpNavigateToolInputSchema = z.object({
  url: z
    .string()
    .min(1)
    .refine((val) => val.trim().length > 0, { message: 'URL cannot be whitespace-only' })
    .refine((val) => val.startsWith('/'), { message: 'URL must start with /' })
    .refine(
      (val) => {
        const pathname = val.split('?')[0]
        return ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
      },
      { message: 'URL must point to an allowed Quilltap route' }
    )
    .describe(
      'The internal Quilltap URL to navigate to. Must start with /. Examples: "/settings?tab=chat&section=dangerous-content", "/settings?tab=appearance", "/aurora", "/salon"'
    ),
})

/**
 * Input parameters for the help navigate tool
 */
export type HelpNavigateToolInput = z.infer<typeof helpNavigateToolInputSchema>

/**
 * Output from the help navigate tool
 */
export interface HelpNavigateToolOutput {
  success: boolean
  url: string
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const helpNavigateToolDefinition = {
  type: 'function',
  function: {
    name: 'help_navigate',
    description:
      'Navigate the user\'s browser to a specific Quilltap page. Use this after searching help documentation to take the user directly to the relevant settings page, feature page, or configuration section. URLs can include tab and section parameters to open specific settings tabs and expand specific collapsible sections automatically. Only use URLs found in help documentation results or that you know to be valid Quilltap routes.',
    parameters: zodToOpenAISchema(helpNavigateToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateHelpNavigateInput(
  input: unknown
): HelpNavigateToolInput | null {
  const parsed = helpNavigateToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
