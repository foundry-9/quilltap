/**
 * Manual mock for `@google/genai` — the SDK behind qtap-plugin-google's text
 * provider. It ships ESM-only, which jest cannot require, and the plugin's
 * request-shaping helpers under test never construct a client.
 */
export const GoogleGenAI = jest.fn().mockImplementation(() => ({
  models: {
    generateContent: jest.fn(),
    generateContentStream: jest.fn(),
    countTokens: jest.fn(),
  },
}));
