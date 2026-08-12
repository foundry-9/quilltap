import type { Config } from 'jest'
import nextJest from 'next/jest.js'

// Pin the timezone for the whole suite. Anything rendered with `toLocaleString`
// /`toLocaleDateString` (the Almanack's date stamps, for one) formats in the
// ambient zone, so a snapshot recorded on a developer's machine fails on the
// UTC CI runner. Setting TZ inside a test file is too late: ICU resolves and
// caches the default zone the first time a locale-aware formatter runs in the
// worker process, so a `beforeAll` pin silently does nothing. Setting it here —
// before Jest forks its workers — is what actually takes.
process.env.TZ = 'UTC'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// When jest runs INSIDE a Claude Code agent worktree (a full checkout under
// .claude/worktrees/), every file's absolute path contains "/.claude/", so the
// worktree-exclusion patterns below would ignore the entire test tree. The
// patterns exist to keep the MAIN checkout from picking up worktree copies —
// they don't apply when the rootDir itself is a worktree.
const isAgentWorktree = process.cwd().includes('/.claude/worktrees/')

// Add any custom config to be passed to Jest
const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  // Recycle a worker once it crosses this resident-memory threshold. Over the
  // full ~350-file suite a worker keeps the same process alive across dozens of
  // test files; without recycling, memory accumulates and GC timing grows
  // aggressive, which is one of the conditions that makes the native SQLCipher
  // binding (loaded by the real-binding DB suites) flaky-segfault under parallel
  // load. The DB suites also opt into the `node` environment via a per-file
  // `@jest-environment node` docblock so their native Buffers never cross a
  // jsdom realm boundary — the other half of that fix.
  workerIdleMemoryLimit: '512MB',
  // Runs once before the whole suite: rebuilds the real SQLCipher binding if it
  // was compiled against a different Node ABI than the one running, so the
  // real-binding DB suites self-heal after a Node upgrade instead of failing
  // with NODE_MODULE_VERSION. Cheap no-op when the ABI already matches.
  globalSetup: '<rootDir>/jest.global-setup.js',
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^openid-client$': '<rootDir>/__mocks__/openid-client.ts',
    '^@openrouter/sdk$': '<rootDir>/__mocks__/@openrouter/sdk.ts',
    '^@openrouter/sdk/lib/chat-compat$': '<rootDir>/__mocks__/@openrouter/sdk-chat-compat.ts',
    '^better-sqlite3$': '<rootDir>/__mocks__/better-sqlite3.ts',
    '^better-sqlite3-multiple-ciphers$': '<rootDir>/__mocks__/better-sqlite3.ts',

    '^openai$': '<rootDir>/__mocks__/openai.ts',
    '^@anthropic-ai/sdk$': '<rootDir>/__mocks__/@anthropic-ai/sdk.ts',
    '^@google/generative-ai$': '<rootDir>/__mocks__/@google/generative-ai.ts',
    '^arctic$': '<rootDir>/__mocks__/arctic.ts',
    '^jose$': '<rootDir>/__mocks__/jose.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@openrouter/sdk|jose)/)',
  ],
  collectCoverageFrom: [
    'app/**/*.{js,jsx,ts,tsx}',
    'components/**/*.{js,jsx,ts,tsx}',
    'lib/**/*.{js,jsx,ts,tsx}',
    'features/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/.next/**',
    '!**/coverage/**',
    '!**/jest.config.ts',
  ],
  testMatch: [
    '**/__tests__/unit/**/*.{js,jsx,ts,tsx}',
    '**/*.test.{js,jsx,ts,tsx}',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    String.raw`\.integration\.test\.[jt]sx?$`,
    // Claude Code agent worktrees are full repo checkouts; their duplicated
    // test files must not be picked up (and their packages/plugins would
    // collide in the Haste map — see modulePathIgnorePatterns below).
    // Skipped when jest itself runs inside a worktree (see isAgentWorktree).
    ...(isAgentWorktree ? [] : ['/\\.claude/']),
    // Native-port differential-harness oracle bridge — an external tool's
    // mirror of its test cases into this checkout. Its suites drive the Rust
    // port's harness, not this repo's jest run (they expect harness env/args
    // and fail without them). Gitignored and eslint-ignored for the same reason.
    '/\\.qt-oracle-mirror/',
    '/__tests__/integration/',
    '/__tests__/unit/lib/fixtures/',
  ],
  modulePathIgnorePatterns: [
    '/.next/',
    // Exclude Claude Code agent worktrees so their copies of packages/* and
    // plugins/* don't register as duplicate Haste modules ("looked up in the
    // Haste module map ... several different files") and break unrelated suites.
    // Skipped when jest itself runs inside a worktree (a worktree contains no
    // nested worktrees, so there is nothing to exclude — and the pattern would
    // otherwise ignore the whole rootDir).
    ...(isAgentWorktree ? [] : ['/\\.claude/']),
    // See testPathIgnorePatterns — the oracle mirror carries its own
    // package.json, which would otherwise collide in the Haste map.
    '/\\.qt-oracle-mirror/',
  ],
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageDirectory: 'coverage',
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
