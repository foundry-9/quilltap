/**
 * Turn Extras — the parts of an outgoing payload that are not context.
 *
 * The context builder produces the messages; the orchestrator then adds things
 * the builder never sees: the tool/function schemas (which ride beside the
 * message array entirely) and one or two system messages spliced in downstream
 * (agent-mode instructions, the tool-change notice).
 *
 * All of it counts against the model's context window, and none of it used to
 * count against the budget — the builder packed history right up to the ceiling
 * and the orchestrator then piled these on top, which is how a turn could clear
 * the budget and still exceed the window.
 *
 * **This module is the one place those additions are built and measured.**
 * Building them here and handing the *same strings* back to the splice sites is
 * the point: a reservation computed from separately-constructed text is a
 * reservation that drifts the first time either copy is edited.
 */

import { Provider } from '@/lib/schemas/types'
import { countMessageTokens, countToolSchemaTokens } from '@/lib/tokens/token-counter'
import { buildAgentModeInstructions } from './agent-mode-resolver.service'

/**
 * Extract tool names from provider-shaped tool definitions.
 *
 * Handles both the OpenAI-style `{type, function: {name}}` wrapper and the flat
 * `{name}` shape; anything unrecognisable is dropped rather than named.
 */
export function extractToolNames(tools: readonly unknown[]): string[] {
  return tools
    .map((tool: unknown) => {
      const toolObj = tool as { function?: { name?: string }; name?: string }
      return toolObj.function?.name || toolObj.name || 'unknown'
    })
    .filter(name => name !== 'unknown')
}

/**
 * Build the notice telling the model its tool roster changed mid-chat.
 *
 * Only fires when the user explicitly changed tool settings — not on the first
 * message and not on an interval.
 */
export function buildToolChangeNotice(toolNames: readonly string[]): string {
  if (toolNames.length === 0) {
    return '[System Notice] Your available tools have been updated. All tools have been disabled for this chat. Do not attempt to use any tools.'
  }

  return `[System Notice] Your available tools have been updated. You now have access to the following ${toolNames.length} tool(s): ${toolNames.join(', ')}. Tools not listed are no longer available for this chat.`
}

export interface TurnExtrasOptions {
  /** Tools as they will be sent (already narrowed to the native-calling set) */
  tools: readonly unknown[]
  /** Agent mode state for this turn */
  agentMode: { enabled: boolean; maxTurns: number }
  /** Whether the user changed tool settings since the last turn */
  toolSettingsChanged: boolean
  /** Provider, for token estimation */
  provider: Provider
}

export interface TurnExtras {
  /** Agent-mode instructions to splice in, or null when agent mode is off */
  agentModeInstructions: string | null
  /** Tool-change notice to splice in, or null when tools did not change */
  toolChangeNotice: string | null
  /** Tokens the tool schemas occupy beside the message array */
  toolSchemaTokens: number
  /**
   * Total tokens these additions will contribute to the outgoing payload —
   * pass as `reservedOutgoingTokens` to the context builder so history is not
   * packed into space they will take.
   */
  reservedTokens: number
}

/**
 * Build and measure everything this turn will add after the context is built.
 *
 * Call before building context (all the inputs are known by then), pass
 * `reservedTokens` into the builder, and splice the returned strings rather
 * than rebuilding them.
 */
export function collectTurnExtras(options: TurnExtrasOptions): TurnExtras {
  const { tools, agentMode, toolSettingsChanged, provider } = options

  const agentModeInstructions = agentMode.enabled
    ? buildAgentModeInstructions(agentMode.maxTurns)
    : null

  const toolChangeNotice = toolSettingsChanged
    ? buildToolChangeNotice(extractToolNames(tools))
    : null

  const toolSchemaTokens = countToolSchemaTokens(tools, provider)

  // Both extras are spliced in as system messages, so they carry the same
  // per-message overhead the builder's own accounting applies.
  const agentModeTokens = agentModeInstructions
    ? countMessageTokens({ role: 'system', content: agentModeInstructions }, provider)
    : 0
  const toolChangeTokens = toolChangeNotice
    ? countMessageTokens({ role: 'system', content: toolChangeNotice }, provider)
    : 0

  return {
    agentModeInstructions,
    toolChangeNotice,
    toolSchemaTokens,
    reservedTokens: toolSchemaTokens + agentModeTokens + toolChangeTokens,
  }
}
