import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const fallbackPort = Number(process.env.E2E_PORT || process.env.PORT || 3000)
let baseURL = process.env.BASE_URL || `http://localhost:${fallbackPort}`
let serverPort = fallbackPort

try {
  const parsedUrl = new URL(baseURL)
  if (parsedUrl.port) {
    serverPort = Number(parsedUrl.port)
  }
} catch {
  baseURL = `http://localhost:${fallbackPort}`
  serverPort = fallbackPort
}

// Create a fresh data directory for each test run to ensure isolation
// Use E2E_DATA_DIR if set (for reusing across config evaluations), otherwise create new
let testDataDir = process.env.E2E_DATA_DIR
if (!testDataDir) {
  testDataDir = mkdtempSync(join(tmpdir(), 'quilltap-e2e-'))
  process.env.E2E_DATA_DIR = testDataDir
  console.log(`E2E Test Data Directory: ${testDataDir}`)
}

process.env.BASE_URL = baseURL
process.env.QUILLTAP_DATA_DIR = testDataDir

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './__tests__/integration',
  /* Only match .spec.ts files (exclude .test.ts which are Jest tests) */
  testMatch: '**/*.spec.ts',
  /* Run tests in files serially to avoid race conditions with shared server */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry to handle occasional flakiness */
  retries: process.env.CI ? 2 : 1,
  /* Use single worker to avoid race conditions with database */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Global timeout for each test */
  timeout: 60000,
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Longer action timeout for dev server which can be slow during hot reload */
    actionTimeout: 15000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Uncomment to test on Firefox/WebKit (requires: npx playwright install)
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run a production build for stable e2e tests */
  webServer: {
    command: `npm run build && QUILLTAP_DATA_DIR="${testDataDir}" PORT=${serverPort} npm run start`,
    env: {
      // The e2e data directory is a fresh mkdtemp with no `.dbkey`, so the
      // instance provisions to `needs-setup` and every /api/v1 route answers
      // 503 "Setup required" before a single spec runs. Supplying a pepper
      // puts it in `needs-vault-storage` instead, which the API gate counts as
      // resolved — the first-run setup wizard is its own thing to test, not a
      // toll every other spec has to pay. The value is a throwaway because the
      // database it encrypts is thrown away with the directory; it is set
      // explicitly rather than inherited so a real instance's pepper never
      // travels into a test run.
      ENCRYPTION_MASTER_PEPPER: 'e2e-throwaway-pepper',
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300000, // 5 minutes for build + start
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
