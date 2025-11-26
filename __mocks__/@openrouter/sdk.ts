/**
 * Mock for @openrouter/sdk
 * Used in unit tests to avoid loading the actual ESM module
 */

const mockChatSend = jest.fn()
const mockModelsList = jest.fn()

export const OpenRouter = jest.fn().mockImplementation(() => ({
  chat: {
    send: mockChatSend,
  },
  models: {
    list: mockModelsList,
  },
}))

export default OpenRouter
