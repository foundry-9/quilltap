/**
 * Search Scriptorium Tool Definition
 * Project Scriptorium Phase 2
 *
 * Provides a unified search tool for LLMs to search across character
 * memories and conversation history simultaneously.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { llmNumber } from './llm-number'

/**
 * Zod schema for the search-scriptorium tool's input.
 */
export const searchScriptoriumToolInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'What to search for across memories, conversations, documents, and your own knowledge base. Be specific about the topic, event, or detail you want to find.'
    ),
  sources: z
    .array(z.enum(['memories', 'conversations', 'documents', 'knowledge']))
    .describe(
      'Which layers to search. Defaults to all sources if not specified. "memories" recalls your personal commonplace-book memories; "conversations" searches rendered transcripts of past chats; "documents" searches every file in every document store within the current `scope`; "knowledge" searches only files under a `Knowledge/` folder inside those same stores. Each knowledge result is tagged with its tier (character, project, or global) so you can tell whose voice it speaks in.'
    )
    .optional(),
  scope: z
    .enum(['all', 'project', 'character', 'group'])
    .default('all')
    .describe(
      "Which document stores the `documents` and `knowledge` sources reach into. \"all\" (the default) searches every store you can see — your own character vault, the stores of every group you belong to, every document store linked to this chat's project, and the instance-wide Quilltap General store. \"project\" narrows to just the document stores linked to this chat's project (returns nothing if no project is attached). \"character\" narrows to just your own character vault. \"group\" narrows to just the document stores of the groups you are a member of (returns nothing if you belong to no groups). `scope` has no effect on `memories` or `conversations`."
    )
    .optional(),
  limit: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(20)
      .describe('Maximum number of results to return across all sources. Default is 10.')
  )
    .default(10)
    .optional(),
  minImportance: llmNumber(
    z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Minimum importance score (0-1) for memory results. Only affects memory search, not conversations. Default is 0.'
      )
  )
    .default(0)
    .optional(),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, 'ISO date (YYYY-MM-DD) required')
    .describe(
      'Only return memories/conversations from this ISO date (YYYY-MM-DD) onward. Use when a time period is mentioned ("last week", "back in March") — memories filter on when the event HAPPENED, conversations on when they took place. Affects only the memories and conversations sources.'
    )
    .optional(),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, 'ISO date (YYYY-MM-DD) required')
    .describe(
      'Only return memories/conversations up to this ISO date (YYYY-MM-DD), inclusive. Pair with `since` to bracket a period.'
    )
    .optional(),
  aboutCharacter: z
    .string()
    .min(1)
    .max(100)
    .describe(
      'Only return memories you hold ABOUT this character (by name). Affects only the memories source.'
    )
    .optional(),
})

/**
 * Input parameters for the search scriptorium tool
 */
export type SearchScriptoriumToolInput = z.infer<typeof searchScriptoriumToolInputSchema>

/**
 * Individual search result from any source
 */
export interface SearchScriptoriumResult {
  content: string
  sourceType: 'memory' | 'conversation' | 'document' | 'knowledge'
  relevanceScore: number
  metadata: {
    // Memory-specific
    memoryId?: string
    summary?: string
    importance?: number
    effectiveWeight?: number
    createdAt?: string
    source?: 'AUTO' | 'MANUAL'
    /** When the remembered EVENT happened (episodic spine) — distinct from createdAt (write time). */
    occurredAt?: string | null
    /** In-story time phrase, for fictional-timeline chats. */
    narrativeTime?: string | null
    /** 'semantic' | 'episodic' declared memory kind. */
    kind?: string
    // Conversation-specific (also set on memory hits: the memory's source
    // conversation, callable via `read_conversation`)
    conversationId?: string
    interchangeIndex?: number
    conversationTitle?: string
    participantNames?: string[]
    // Document-specific
    mountPointName?: string
    fileName?: string
    filePath?: string
    /** Canonical qtap:// URI for the matched document/knowledge file. */
    uri?: string
    chunkIndex?: number
    headingContext?: string
    // Knowledge-specific
    knowledgeTier?: 'character' | 'group' | 'project' | 'global'
  }
}

/**
 * Output from the search scriptorium tool
 */
export interface SearchScriptoriumToolOutput {
  success: boolean
  results?: SearchScriptoriumResult[]
  error?: string
  totalFound: number
  query: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const searchScriptoriumToolDefinition = {
  type: 'function',
  function: {
    name: 'search',
    description:
      "Search across your memories, past conversation history, and every document store you can reach. Returns results from your personal memories, rendered conversations, files in your character vault, files in every document store linked to this chat's project, files in the instance-wide Quilltap General store, and — when narrowed to the `knowledge` source — the `Knowledge/` folders inside those same stores. Use `scope` to confine the search to your own vault or to the project pool. Use this to find information from past interactions, recall conversation details, locate specific discussions by topic, search through reference documents, or look up what's been written down — by you, by the project, or by the operator at large.",
    parameters: zodToOpenAISchema(searchScriptoriumToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateSearchScriptoriumInput(
  input: unknown
): SearchScriptoriumToolInput | null {
  const parsed = searchScriptoriumToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

// ============================================================================
// Brahma Console variant — memory source removed
// ============================================================================

/**
 * Zod schema for the search tool as exposed to the **Brahma Console** — the
 * character-less, memory-free operator surface. The `memories` source is
 * removed entirely: the console has no character and no access to anyone's
 * commonplace-book memories. Everything else (conversations, documents,
 * knowledge) is searched operator-wide across every document store the user
 * can see. Keeping a distinct Zod schema (rather than post-filtering) preserves
 * the schema-as-single-source-of-truth rule for the tool chokepoint.
 */
export const searchScriptoriumBrahmaToolInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'What to search for across the operator\'s conversations, documents, and knowledge base. Be specific about the topic, event, or detail you want to find.'
    ),
  sources: z
    .array(z.enum(['conversations', 'documents', 'knowledge']))
    .describe(
      'Which layers to search. Defaults to all available sources if not specified. "conversations" searches rendered transcripts of past chats; "documents" searches every file in every document store; "knowledge" searches only files under a `Knowledge/` folder inside those stores. NOTE: this console has NO access to memories — the commonplace-book memory source is deliberately unavailable here.'
    )
    .optional(),
  scope: z
    .enum(['all', 'project', 'character', 'group'])
    .default('all')
    .describe(
      'Which document stores the `documents` and `knowledge` sources reach into. The Brahma Console searches every enabled document store regardless of scope, so this parameter has no practical effect here.'
    )
    .optional(),
  limit: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(20)
      .describe('Maximum number of results to return across all sources. Default is 10.')
  )
    .default(10)
    .optional(),
})

export type SearchScriptoriumBrahmaToolInput = z.infer<typeof searchScriptoriumBrahmaToolInputSchema>

/**
 * Brahma Console search tool definition. Same tool name (`search`) and handler
 * as the standard scriptorium search, but its parameter schema omits the
 * `memories` source so the model never sees it. The handler enforces the same
 * exclusion defensively (operator surface → memory search is forced off).
 */
export const searchScriptoriumBrahmaToolDefinition = {
  type: 'function',
  function: {
    name: 'search',
    description:
      "Search across the operator's past conversation history and every document store you can reach (every file in every store, plus the `Knowledge/` folders within them via the `knowledge` source). Use this to find information from past chats, locate specific discussions by topic, search through reference documents, or look up what's been written down. NOTE: you do NOT have access to the operator's memories — the commonplace-book memory layer is intentionally not searchable from the Brahma Console.",
    parameters: zodToOpenAISchema(searchScriptoriumBrahmaToolInputSchema),
  },
}
