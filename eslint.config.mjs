import { defineConfig } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import pluginQuery from '@tanstack/eslint-plugin-query'
import quilltapPlugin from './eslint-quilltap-plugin.js'

const eslintConfig = defineConfig([
  ...nextVitals,
  // TanStack Query lint guardrails (exhaustive-deps, no-rest-destructuring, …)
  ...pluginQuery.configs['flat/recommended'],
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'node_modules/**',
      'dist/**',
      '.git/**',
      'coverage/**',
      // Claude Code tooling scratch — agent worktrees, plans, etc. These are
      // gitignored and may contain full repo checkouts whose nested build
      // artifacts (plugins/dist, pdf.worker.mjs) escape the root-anchored
      // ignores below. Never lint anything under here.
      '.claude/**',
      // Native-port differential-harness oracle bridge — an external tool's
      // mirror of its test cases into this checkout (so they can import real
      // lib/ code). Gitignored, generated, not ours to lint.
      '.qt-oracle-mirror/**',
      // Bundled plugin JavaScript files (source is in TypeScript)
      'plugins/dist/**/*.js',
      // PDF.js worker file (third-party, copied from node_modules)
      'public/pdf.worker.mjs',
    ],
  },
  {
    rules: {
      // Disable no-img-element globally - we often use <img> intentionally
      // for dynamic/external images that Next.js Image can't optimize
      '@next/next/no-img-element': 'off',
    },
  },
  {
    plugins: {
      quilltap: quilltapPlugin,
    },
    rules: {
      'quilltap/no-quilltap-misspelling': 'error',
    },
  },
  {
    // The rule's own implementation, and the pattern it shares with the
    // repo-wide sweep, have to spell the forbidden word in order to match it.
    files: ['eslint-quilltap-plugin.js', 'quilltap-spelling.js'],
    rules: {
      'quilltap/no-quilltap-misspelling': 'off',
    },
  },
])

export default eslintConfig
