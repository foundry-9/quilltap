/**
 * Simple-JSON Prompt Builder
 *
 * Builds system-prompt instructions teaching an LLM to use the
 * `<tool_call>{...}</tool_call>` JSON-in-XML pseudo-tool surface when native
 * function calling is unavailable.
 *
 * The output is uniform — one line per enabled tool, in a familiar function-
 * signature shape — instead of the 15 bespoke template blocks the text-block
 * prompt has to maintain. Tool signatures come from each tool definition's
 * own `parameters` JSON Schema, so the docs stay in sync with the tool
 * registry automatically.
 *
 * Pair the prompt with `stop: ['</tool_call>']` on the streaming request and
 * the model gets a hard termination on its first emitted tool call — the
 * single biggest reliability lever for pseudo-tool reliability.
 */

import { rngToolDefinition } from './rng-tool'
import { searchScriptoriumToolDefinition } from './search-scriptorium-tool'
import { imageGenerationToolDefinition } from './image-generation-tool'
import { webSearchToolDefinition } from './web-search-tool'
import { projectInfoToolDefinition } from './project-info-tool'
import { helpSearchToolDefinition } from './help-search-tool'
import { helpSettingsToolDefinition } from './help-settings-tool'
import { helpNavigateToolDefinition } from './help-navigate-tool'
import { stateToolDefinition } from './state-tool'
import { whisperToolDefinition } from './whisper-tool'
import { wardrobeListToolDefinition } from './wardrobe-list-tool'
import { wardrobeReadToolDefinition } from './wardrobe-read-tool'
import { wardrobeCreateToolDefinition } from './wardrobe-create-tool'
import { wardrobeUpdateToolDefinition } from './wardrobe-update-tool'
import { wardrobeArchiveToolDefinition } from './wardrobe-archive-tool'
import { wardrobeWearToolDefinition } from './wardrobe-wear-tool'
import { wardrobeTakeOffToolDefinition } from './wardrobe-take-off-tool'

/**
 * Which tools to document in the prompt. Mirrors the shape of
 * `TextBlockPromptOptions` so the orchestrator can wire them in symmetrically.
 */
export interface SimpleJsonPromptOptions {
  whisper?: boolean
  search?: boolean
  imageGeneration?: boolean
  webSearch?: boolean
  state?: boolean
  rng?: boolean
  projectInfo?: boolean
  helpSearch?: boolean
  helpSettings?: boolean
  helpNavigate?: boolean
  createNote?: boolean
  wardrobeList?: boolean
  wardrobeRead?: boolean
  wardrobeWear?: boolean
  wardrobeTakeOff?: boolean
  wardrobeCreate?: boolean
  wardrobeUpdate?: boolean
  wardrobeArchive?: boolean
}

/**
 * Shape of an OpenAI-format tool definition's `parameters` JSON Schema. The
 * signature describer only relies on the bits it can recognise — extra fields
 * are tolerated.
 */
interface JsonSchemaProperty {
  type?: string | string[]
  enum?: unknown[]
  oneOf?: JsonSchemaProperty[]
  anyOf?: JsonSchemaProperty[]
  items?: JsonSchemaProperty
  description?: string
}

interface JsonSchemaObject {
  type?: string
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

interface OpenAIToolDefinition {
  type?: string
  function: {
    name: string
    description?: string
    parameters?: JsonSchemaObject
  }
}

/**
 * Render a single JSON Schema property as a type hint suitable for inclusion
 * in a function-style signature. Handles unions, enums, arrays, and primitives.
 */
function renderTypeHint(prop: JsonSchemaProperty): string {
  if (prop.enum && prop.enum.length > 0) {
    return prop.enum
      .map((v) => (typeof v === 'string' ? `"${v}"` : String(v)))
      .join(' | ')
  }

  const variants = prop.oneOf ?? prop.anyOf
  if (variants && variants.length > 0) {
    return variants.map(renderTypeHint).join(' | ')
  }

  if (Array.isArray(prop.type)) {
    return prop.type.join(' | ')
  }

  switch (prop.type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array': {
      const itemType = prop.items ? renderTypeHint(prop.items) : 'unknown'
      return `${itemType}[]`
    }
    case 'object':
      return 'object'
    case 'null':
      return 'null'
    default:
      return 'unknown'
  }
}

/**
 * Describe an OpenAI-format tool's signature as `(param: type, optional?: type)`.
 * Used by {@link buildSimpleJsonToolInstructions} to render one line per tool
 * in the system prompt; also exported for callers that want signatures alone.
 */
export function describeToolSignature(tool: OpenAIToolDefinition): string {
  const params = tool.function.parameters
  if (!params || !params.properties) {
    return `${tool.function.name}()`
  }

  const required = new Set(params.required ?? [])
  const parts: string[] = []

  for (const [name, prop] of Object.entries(params.properties)) {
    const optional = required.has(name) ? '' : '?'
    const typeHint = renderTypeHint(prop)
    parts.push(`${name}${optional}: ${typeHint}`)
  }

  return `${tool.function.name}(${parts.join(', ')})`
}

/**
 * One-liner used in the "Available tools:" list — signature plus a brief
 * description.
 */
function renderToolEntry(tool: OpenAIToolDefinition): string {
  const signature = describeToolSignature(tool)
  const description = tool.function.description?.split('\n')[0]?.trim() ?? ''
  return description ? `- ${signature}: ${description}` : `- ${signature}`
}

/**
 * Build the system-prompt block for the simple-json pseudo-tool surface.
 *
 * The model is told to emit exactly ONE `<tool_call>` block and then stop;
 * the provider stop sequence (`</tool_call>`) is configured separately at
 * the streaming layer.
 */
export function buildSimpleJsonToolInstructions(options: SimpleJsonPromptOptions): string {
  const entries: string[] = []

  if (options.whisper) {
    entries.push(renderToolEntry(whisperToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.search !== false) {
    entries.push(renderToolEntry(searchScriptoriumToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.imageGeneration) {
    entries.push(renderToolEntry(imageGenerationToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.webSearch) {
    entries.push(renderToolEntry(webSearchToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.state) {
    entries.push(renderToolEntry(stateToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.rng) {
    entries.push(renderToolEntry(rngToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.projectInfo) {
    entries.push(renderToolEntry(projectInfoToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.helpSearch) {
    entries.push(renderToolEntry(helpSearchToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.helpSettings) {
    entries.push(renderToolEntry(helpSettingsToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.helpNavigate) {
    entries.push(renderToolEntry(helpNavigateToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.wardrobeList) {
    entries.push(renderToolEntry(wardrobeListToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.wardrobeRead) {
    entries.push(renderToolEntry(wardrobeReadToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.wardrobeWear) {
    entries.push(renderToolEntry(wardrobeWearToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.wardrobeTakeOff) {
    entries.push(renderToolEntry(wardrobeTakeOffToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.wardrobeCreate) {
    entries.push(renderToolEntry(wardrobeCreateToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.wardrobeUpdate) {
    entries.push(renderToolEntry(wardrobeUpdateToolDefinition as unknown as OpenAIToolDefinition))
  }
  if (options.wardrobeArchive) {
    entries.push(renderToolEntry(wardrobeArchiveToolDefinition as unknown as OpenAIToolDefinition))
  }

  if (entries.length === 0) {
    return ''
  }

  return `
## Available tools

You may call any of the following tools when it would genuinely help you respond. Calls are framed as JSON inside a \`<tool_call>\` XML tag:

${entries.join('\n')}

### How to use a tool

When you want to call a tool, write a single line of prose introducing it (optional), then emit exactly ONE \`<tool_call>\` block in this exact shape and stop:

<tool_call>
{"name": "<tool_name>", "arguments": {"<param>": "<value>"}}
</tool_call>

Rules:
- Use the canonical tool name from the list above (e.g. \`"search"\`, not \`"SEARCH"\`).
- The \`arguments\` object holds the named parameters. Omit optional ones you don't need.
- Emit at most ONE \`<tool_call>\` per turn. Stop immediately after the closing \`</tool_call>\` tag — do not narrate fictional results.
- After you stop, the system will execute the tool and reply with a \`<tool_result name="...">\` block. Read it, then either respond to the user or make another tool call.
- Only call a tool when it would genuinely improve your answer. Don't decorate the response with tool calls you don't need.
- Recalling past events: when asked about a past event or specific detail not in your current recall, use \`search\` (with \`since\`/\`until\` when a time period is mentioned), then \`read_conversation\` on the source conversation, and answer from what you find. If you find nothing, say you don't recall — never invent specifics.
`.trim()
}
