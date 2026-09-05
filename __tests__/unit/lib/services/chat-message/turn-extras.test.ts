/**
 * Unit tests for turn extras — the parts of an outgoing payload that are not
 * context: the tool schemas (which never enter the message array) and the
 * system messages the orchestrator splices in after the context is built.
 *
 * These used to be spent without being budgeted, so the builder packed history
 * to the ceiling and the orchestrator then piled these on top. See bug 70.
 */

import {
  collectTurnExtras,
  buildToolChangeNotice,
  extractToolNames,
} from '@/lib/services/chat-message/turn-extras'
import { countToolSchemaTokens } from '@/lib/tokens/token-counter'

const OPENAI_STYLE_TOOL = {
  type: 'function',
  function: {
    name: 'doc_read',
    description: 'Read a document from the vault by path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path to the file.' },
      },
      required: ['path'],
    },
  },
}

const ANTHROPIC_STYLE_TOOL = {
  name: 'doc_write',
  description: 'Write a document into the vault.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
  },
}

describe('extractToolNames', () => {
  it('reads both provider shapes and drops the unrecognisable', () => {
    expect(
      extractToolNames([OPENAI_STYLE_TOOL, ANTHROPIC_STYLE_TOOL, { nonsense: true }])
    ).toEqual(['doc_read', 'doc_write'])
  })

  it('returns an empty list for no tools', () => {
    expect(extractToolNames([])).toEqual([])
  })
})

describe('buildToolChangeNotice', () => {
  it('names the tools that remain', () => {
    const notice = buildToolChangeNotice(['doc_read', 'doc_write'])
    expect(notice).toContain('2 tool(s)')
    expect(notice).toContain('doc_read, doc_write')
  })

  it('says so plainly when every tool is gone', () => {
    expect(buildToolChangeNotice([])).toContain('All tools have been disabled')
  })
})

describe('countToolSchemaTokens', () => {
  it('counts nothing for an empty roster', () => {
    expect(countToolSchemaTokens([], 'OPENAI')).toBe(0)
    expect(countToolSchemaTokens(null, 'OPENAI')).toBe(0)
    expect(countToolSchemaTokens(undefined, 'OPENAI')).toBe(0)
  })

  it('scales with the size of the schema', () => {
    const one = countToolSchemaTokens([OPENAI_STYLE_TOOL], 'OPENAI')
    const two = countToolSchemaTokens([OPENAI_STYLE_TOOL, ANTHROPIC_STYLE_TOOL], 'OPENAI')

    expect(one).toBeGreaterThan(0)
    expect(two).toBeGreaterThan(one)
  })

  it('survives a definition that cannot be serialized', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular

    expect(countToolSchemaTokens([circular], 'OPENAI')).toBe(0)
  })
})

describe('collectTurnExtras', () => {
  const baseOptions = {
    tools: [OPENAI_STYLE_TOOL],
    agentMode: { enabled: false, maxTurns: 25 },
    toolSettingsChanged: false,
    provider: 'OPENAI' as const,
  }

  it('reserves the tool schemas even when nothing is spliced in', () => {
    const extras = collectTurnExtras(baseOptions)

    expect(extras.agentModeInstructions).toBeNull()
    expect(extras.toolChangeNotice).toBeNull()
    expect(extras.toolSchemaTokens).toBeGreaterThan(0)
    expect(extras.reservedTokens).toBe(extras.toolSchemaTokens)
  })

  it('reserves room for the agent-mode instructions it hands back', () => {
    const extras = collectTurnExtras({
      ...baseOptions,
      agentMode: { enabled: true, maxTurns: 25 },
    })

    expect(extras.agentModeInstructions).toContain('Agent Mode')
    expect(extras.reservedTokens).toBeGreaterThan(extras.toolSchemaTokens)
  })

  it('reserves room for the tool-change notice it hands back', () => {
    const extras = collectTurnExtras({ ...baseOptions, toolSettingsChanged: true })

    expect(extras.toolChangeNotice).toContain('doc_read')
    expect(extras.reservedTokens).toBeGreaterThan(extras.toolSchemaTokens)
  })

  it('reserves nothing when there are no tools and no injections', () => {
    expect(
      collectTurnExtras({ ...baseOptions, tools: [] }).reservedTokens
    ).toBe(0)
  })

  it('accumulates both injections', () => {
    const both = collectTurnExtras({
      ...baseOptions,
      agentMode: { enabled: true, maxTurns: 25 },
      toolSettingsChanged: true,
    })
    const agentOnly = collectTurnExtras({
      ...baseOptions,
      agentMode: { enabled: true, maxTurns: 25 },
    })

    expect(both.reservedTokens).toBeGreaterThan(agentOnly.reservedTokens)
  })
})
