/**
 * Regression test: cheap-LLM tasks must forward the selected profile's
 * provider parameters (e.g. DeepSeek `thinking: "disabled"`) to the provider,
 * so per-model settings like "reasoning off" actually take effect. Previously
 * `sendToProvider` built a minimal request and dropped these, leaving reasoning
 * models to burn the token budget thinking and return empty content.
 */

import { executeCheapLLMTask } from '../core-execution'
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
  mockGetApiKey.mockResolvedValue('key-123')
  sendMessage.mockResolvedValue({ content: '{"ok":true}', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
  mockCreateProvider.mockResolvedValue({ sendMessage } as never)
})

const MESSAGES: LLMMessage[] = [{ role: 'user', content: 'hi' }]

it('forwards the selection profileParameters to provider.sendMessage', async () => {
  const selection: CheapLLMSelection = {
    provider: 'DEEPSEEK',
    modelName: 'deepseek-v4-flash',
    connectionProfileId: 'p1',
    isLocal: false,
    profileParameters: { thinking: 'disabled', reasoning_effort: 'high' },
  }

  const result = await executeCheapLLMTask(selection, MESSAGES, 'user-1', (c) => c, 'answer-confirmation')

  expect(result.success).toBe(true)
  expect(sendMessage).toHaveBeenCalledTimes(1)
  const [params] = sendMessage.mock.calls[0]
  expect(params.profileParameters).toEqual({ thinking: 'disabled', reasoning_effort: 'high' })
})

it('passes undefined profileParameters through unchanged when the selection has none', async () => {
  const selection: CheapLLMSelection = {
    provider: 'OPENAI',
    modelName: 'gpt-cheap',
    connectionProfileId: 'p2',
    isLocal: false,
  }

  await executeCheapLLMTask(selection, MESSAGES, 'user-1', (c) => c, 'summarize-chat')

  const [params] = sendMessage.mock.calls[0]
  expect(params.profileParameters).toBeUndefined()
})
