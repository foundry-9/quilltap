import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Jest configuration for integration tests
const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'node', // Integration tests should use node environment
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^openid-client$': '<rootDir>/__mocks__/openid-client.ts',
    '^@openrouter/sdk$': '<rootDir>/__mocks__/@openrouter/sdk.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@openrouter/sdk)/)',
  ],
  testMatch: [
    '**/__tests__/integration/**/*.test.{js,jsx,ts,tsx}',
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
