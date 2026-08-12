/**
 * Mock for @openrouter/sdk/lib/chat-compat
 *
 * The real subpath is ESM in the plugin's own node_modules and can't be parsed
 * by the test runner. The provider only uses `fromChatMessages` on the
 * no-tools/no-images streaming path; a pass-through identity is enough for the
 * unit tests, which exercise the direct-fetch and SDK send paths.
 */
export const fromChatMessages = jest.fn().mockImplementation((messages: unknown[]) => messages)
