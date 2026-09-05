/**
 * Unit tests for the one-shot Brahma engine (`runBrahmaQuery`) — the isolated
 * console answer that backs the Brahma pseudocharacter when consulted as a Carina
 * answerer from a Salon.
 *
 * Construction-level checks with the heavy collaborators mocked. The invariants
 * under test: a `[system, user]`-only slate (NEVER the Salon transcript), the
 * Brahma tool flags (no ask_carina, no workspace tools, memory-less search, SQL
 * on), tool execution at the operator surface, accumulated-answer return, and a
 * clean `no-profile` failure.
 */

import { runBrahmaQuery } from '../one-shot.service'

jest.mock('@/lib/plugins/provider-validation', () => ({
  requiresApiKey: jest.fn(() => false),
  acceptsApiKey: jest.fn(() => false),
}))
jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  buildTools: jest.fn(),
  streamMessage: jest.fn(),
}))
jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  processToolCalls: jest.fn(),
  detectToolCallsInResponse: jest.fn(),
}))
jest.mock('@/lib/services/chat-message/pseudo-tool.service', () => ({
  buildNativeToolSystemInstructions: jest.fn(() => 'NATIVE'),
  checkShouldUseTextBlockTools: jest.fn(() => false),
  buildTextBlockSystemInstructions: jest.fn(() => 'TEXTBLOCK'),
  parseTextBlocksFromResponse: jest.fn(() => []),
  stripTextBlockMarkersFromResponse: jest.fn((s: string) => s),
}))
jest.mock('@/lib/tools', () => ({
  hasTextBlockMarkers: jest.fn(() => false),
}))
jest.mock('@/lib/services/chat-message/agent-mode-resolver.service', () => ({
  buildAgentModeInstructions: jest.fn(() => 'AGENT'),
  buildForceFinalMessage: jest.fn(() => 'FORCE FINAL'),
  extractSubmitFinalResponseFromText: jest.fn((s: string) => s),
}))
jest.mock('@/lib/brahma-console/system-prompt-builder', () => ({
  buildBrahmaSystemPrompt: jest.fn(() => 'BRAHMA_SYS'),
}))
jest.mock('../orchestrator.service', () => ({
  resolveBrahmaConnectionProfile: jest.fn(),
  normalizeToolCallSignature: jest.fn(() => 'sig'),
}))
jest.mock('../turn-budget', () => ({
  resolveBrahmaMaxAgentTurns: jest.fn().mockResolvedValue(25),
}))

import { buildTools, streamMessage } from '@/lib/services/chat-message/streaming.service'
import { processToolCalls, detectToolCallsInResponse } from '@/lib/services/chat-message/tool-execution.service'
import { resolveBrahmaConnectionProfile } from '../orchestrator.service'
import { resolveBrahmaMaxAgentTurns } from '../turn-budget'

const MOCK_PROFILE = {
  id: 'conn-1',
  provider: 'anthropic',
  modelName: 'claude-haiku',
  apiKeyId: null,
  allowWebSearch: false,
}

const REPOS = {} as never

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(resolveBrahmaConnectionProfile).mockResolvedValue(MOCK_PROFILE as never)
  jest.mocked(buildTools).mockResolvedValue({
    tools: [{ function: { name: 'run_sql' } }],
    modelSupportsNativeTools: true,
    useNativeWebSearch: false,
  } as never)
  jest.mocked(detectToolCallsInResponse).mockReturnValue([])
  jest.mocked(processToolCalls).mockResolvedValue({ toolMessages: [], generatedImagePaths: [] } as never)
  jest.mocked(streamMessage).mockImplementation(async function* () {
    yield { content: 'Tables: foo, bar.' }
    yield { done: true, rawResponse: {} }
  } as never)
})

describe('runBrahmaQuery', () => {
  it('returns no-profile when there is no resolvable connection profile', async () => {
    jest.mocked(resolveBrahmaConnectionProfile).mockResolvedValue(null as never)
    const result = await runBrahmaQuery({ repos: REPOS, userId: 'u1', chatId: 'c1', question: 'hi' })
    expect(result).toEqual({ ok: false, detail: 'no-profile' })
    expect(streamMessage).not.toHaveBeenCalled()
  })

  it('sends only [system, user] — never the Salon transcript', async () => {
    await runBrahmaQuery({ repos: REPOS, userId: 'u1', chatId: 'c1', question: 'what tables exist?' })
    const streamArgs = jest.mocked(streamMessage).mock.calls[0][0] as unknown as {
      messages: Array<{ role: string; content: string }>
    }
    expect(streamArgs.messages).toHaveLength(2)
    expect(streamArgs.messages[0]).toMatchObject({ role: 'system', content: 'BRAHMA_SYS' })
    expect(streamArgs.messages[1]).toMatchObject({ role: 'user', content: 'what tables exist?' })
  })

  it('builds tools with the Brahma flags (no ask_carina / no workspace / no memory search / SQL on)', async () => {
    await runBrahmaQuery({ repos: REPOS, userId: 'u1', chatId: 'c1', question: 'q' })
    const args = jest.mocked(buildTools).mock.calls[0]
    expect(args[8]).toBe(true) // agentModeEnabled
    expect(args[13]).toBe(true) // documentEditingEnabled
    expect(args[14]).toBe(false) // askCarinaEnabled — recursion guard
    expect(args[15]).toBe(false) // includeWorkspaceTools
    expect(args[16]).toBe(true) // excludeMemorySearch
    expect(args[17]).toBe(true) // sqlAccess
  })

  it('returns the accumulated answer when the model replies without tools', async () => {
    const result = await runBrahmaQuery({ repos: REPOS, userId: 'u1', chatId: 'c1', question: 'q' })
    expect(result).toEqual({ ok: true, answer: 'Tables: foo, bar.' })
  })

  it('executes tools at the operator surface', async () => {
    jest
      .mocked(streamMessage)
      .mockImplementationOnce(async function* () {
        yield { done: true, rawResponse: { tool: true } }
      } as never)
      .mockImplementationOnce(async function* () {
        yield { content: 'Two tables.' }
        yield { done: true, rawResponse: {} }
      } as never)
    jest
      .mocked(detectToolCallsInResponse)
      .mockReturnValueOnce([{ name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c1' }] as never)
      .mockReturnValueOnce([] as never)
    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [{ toolName: 'run_sql', success: true, content: 'rows', callId: 'c1' }],
      generatedImagePaths: [],
    } as never)

    const result = await runBrahmaQuery({ repos: REPOS, userId: 'u1', chatId: 'c1', question: 'q' })

    expect(result).toEqual({ ok: true, answer: 'Two tables.' })
    const toolCtx = jest.mocked(processToolCalls).mock.calls[0][1] as { operatorSurface?: boolean }
    expect(toolCtx.operatorSurface).toBe(true)
  })

  it('returns an empty-response failure when the model produces nothing', async () => {
    jest.mocked(streamMessage).mockImplementation(async function* () {
      yield { done: true, rawResponse: {} }
    } as never)
    const result = await runBrahmaQuery({ repos: REPOS, userId: 'u1', chatId: 'c1', question: 'q' })
    expect(result).toEqual({ ok: false, detail: 'empty response' })
  })

  it('salvages a partial answer from tool data when the turn budget is exhausted (Bug 47)', async () => {
    // Budget of 2: turn 1 runs a tool; turn 2 is the forced-final turn (runs no
    // tools) and the model answers it with another tool call, not a final
    // response — so the accumulated prose is empty.
    jest.mocked(resolveBrahmaMaxAgentTurns).mockResolvedValue(2)
    jest.mocked(streamMessage).mockImplementation(async function* () {
      yield { done: true, rawResponse: { tool: true } }
    } as never)
    jest.mocked(detectToolCallsInResponse).mockReturnValue(
      [{ name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c1' }] as never,
    )
    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [{ toolName: 'run_sql', success: true, content: 'rows: 7', callId: 'c1' }],
      generatedImagePaths: [],
    } as never)

    const result = await runBrahmaQuery({ repos: REPOS, userId: 'u1', chatId: 'c1', question: 'q' })

    // Rather than a bare failure after spending real budget, the caller gets an
    // explanatory answer that folds in the last tool result.
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.answer).toContain('2-turn budget')
      expect(result.answer).toContain('rows: 7')
    }
  })
})
