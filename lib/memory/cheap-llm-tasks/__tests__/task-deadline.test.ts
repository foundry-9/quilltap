/**
 * Regression test: a cheap-LLM task must abandon a provider that accepts the
 * request and then never answers.
 *
 * Provider SDKs default to a 10-minute request timeout. Because several cheap
 * tasks (the memory recap especially) are awaited inline on a user-visible
 * turn, a stalled provider used to freeze the turn for the full 600s with no
 * log output — observed in the wild as a 622,451ms memory recap against a call
 * that normally takes ~9s.
 */

import {
  executeCheapLLMTask,
  CHEAP_LLM_TASK_TIMEOUT_MS,
  CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS,
} from '../core-execution'
import { createLLMProvider } from '@/lib/llm'
import { getApiKeyForCheapLLMSelection } from '@/lib/services/api-key.service'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { LLMMessage } from '@/lib/llm/base'

jest.mock('@/lib/llm', () => ({ createLLMProvider: jest.fn() }))
jest.mock('@/lib/services/api-key.service', () => ({ getApiKeyForCheapLLMSelection: jest.fn() }))
jest.mock('@/lib/services/llm-logging.service', () => ({ logLLMCall: jest.fn().mockResolvedValue(undefined) }))

const mockCreateProvider = jest.mocked(createLLMProvider)
const mockGetApiKey = jest.mocked(getApiKeyForCheapLLMSelection)

const sendMessage = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  mockGetApiKey.mockResolvedValue('key-123')
  mockCreateProvider.mockResolvedValue({ sendMessage } as never)
})

afterEach(() => {
  jest.useRealTimers()
})

const MESSAGES: LLMMessage[] = [{ role: 'user', content: 'hi' }]

const REMOTE: CheapLLMSelection = {
  provider: 'DEEPSEEK',
  modelName: 'deepseek-v4-flash',
  connectionProfileId: 'p1',
  isLocal: false,
}

const LOCAL: CheapLLMSelection = {
  provider: 'OLLAMA',
  modelName: 'qwen3',
  connectionProfileId: 'p2',
  isLocal: true,
}

it('abandons a remote provider that never answers, instead of waiting on the SDK', async () => {
  sendMessage.mockReturnValue(new Promise(() => {})) // accepted, never answers

  const task = executeCheapLLMTask(REMOTE, MESSAGES, 'user-1', (c) => c, 'memory-recap-summarization')

  await jest.advanceTimersByTimeAsync(CHEAP_LLM_TASK_TIMEOUT_MS + 1)
  const result = await task

  expect(result.success).toBe(false)
  expect(result.error).toContain('budget')
})

it('does not abandon a call that finishes inside the budget', async () => {
  sendMessage.mockResolvedValue({
    content: 'a recap',
    usage: { promptTokens: 511, completionTokens: 410, totalTokens: 921 },
  })

  const task = executeCheapLLMTask(REMOTE, MESSAGES, 'user-1', (c) => c, 'memory-recap-summarization')

  await jest.advanceTimersByTimeAsync(CHEAP_LLM_TASK_TIMEOUT_MS + 1)
  const result = await task

  expect(result.success).toBe(true)
  expect(result.result).toBe('a recap')
})

it('gives local providers the longer budget — slow is not the same as stalled', async () => {
  let settle: (value: unknown) => void = () => {}
  sendMessage.mockReturnValue(new Promise((resolve) => { settle = resolve }))

  const task = executeCheapLLMTask(LOCAL, MESSAGES, 'user-1', (c) => c, 'summarize-chat')

  // Past the remote budget, a local call is still considered healthy.
  await jest.advanceTimersByTimeAsync(CHEAP_LLM_TASK_TIMEOUT_MS + 1)
  settle({ content: 'slow but fine', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })

  const result = await task
  expect(result.success).toBe(true)
  expect(result.result).toBe('slow but fine')
})

it('hands the provider a hard budget just inside our own deadline', async () => {
  sendMessage.mockResolvedValue({ content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })

  await executeCheapLLMTask(REMOTE, MESSAGES, 'user-1', (c) => c, 'title-chat')

  const [params] = sendMessage.mock.calls[0]
  // Strictly inside, so the provider aborts its own socket before we give up
  // waiting and leave the request orphaned.
  expect(params.requestTimeoutMs).toBeLessThan(CHEAP_LLM_TASK_TIMEOUT_MS)
  expect(params.requestTimeoutMs).toBeGreaterThan(0)
})

it('scales the provider budget to the local deadline for local providers', async () => {
  sendMessage.mockResolvedValue({ content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })

  await executeCheapLLMTask(LOCAL, MESSAGES, 'user-1', (c) => c, 'title-chat')

  const [params] = sendMessage.mock.calls[0]
  expect(params.requestTimeoutMs).toBeLessThan(CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS)
  expect(params.requestTimeoutMs).toBeGreaterThan(CHEAP_LLM_TASK_TIMEOUT_MS)
})

it('eventually abandons a local provider too', async () => {
  sendMessage.mockReturnValue(new Promise(() => {}))

  const task = executeCheapLLMTask(LOCAL, MESSAGES, 'user-1', (c) => c, 'summarize-chat')

  await jest.advanceTimersByTimeAsync(CHEAP_LLM_TASK_TIMEOUT_LOCAL_MS + 1)
  const result = await task

  expect(result.success).toBe(false)
  expect(result.error).toContain('budget')
})
