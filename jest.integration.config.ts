import type { Config } from 'jest'
import nextJest from 'next/jest.js'

// Pin the timezone before Jest forks its workers, for the same reason the unit
// config does — see the note in jest.config.ts.
process.env.TZ = 'UTC'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Jest configuration for integration tests
const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'node', // Integration tests should use node environment
  // Same globalSetup as the unit config: arms the V8 Sparkplug segfault guard
  // (nodejs/node#62393 — see the note in jest.global-setup.js) and heals a
  // stale native SQLCipher binding before the real-binding suites load it.
  globalSetup: '<rootDir>/jest.global-setup.js',
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^openid-client$': '<rootDir>/__mocks__/openid-client.ts',
    '^@openrouter/sdk$': '<rootDir>/__mocks__/@openrouter/sdk.ts',
    '^openai$': '<rootDir>/__mocks__/openai.ts',
    '^@anthropic-ai/sdk$': '<rootDir>/__mocks__/@anthropic-ai/sdk.ts',
    '^@google/generative-ai$': '<rootDir>/__mocks__/@google/generative-ai.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@openrouter/sdk)/)',
  ],
  testMatch: [
    '**/__tests__/integration/**/*.test.{js,jsx,ts,tsx}',
    '**/__tests__/unit/**/*.integration.test.{js,jsx,ts,tsx}',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    String.raw`\.spec\.ts$`, // Exclude Playwright spec files
  ],
  modulePathIgnorePatterns: [
    '/.next/',
  ],
  // Integration tests may take longer
  testTimeout: 30000,
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
