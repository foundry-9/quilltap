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
  {
    // Tier B of the composer character-insertion engine — emoji (Layer 2.0e)
    // and Unicode (Layer 2.0u) as two dataset profiles over one implementation.
    // See docs/developer/features/complete/composer-{emoji,unicode}.md.
    //
    // `lib/char-insert/**` is framework-free by contract: quilltap-v5 (Rust core,
    // Angular SPA, ProseMirror editor) copies the directory near-verbatim, and
    // the ~120 lines that know about React and Lexical live in components/chat/
    // where they get rewritten. This override is what MECHANICALLY enforces
    // that — without it, Tier B rots within two changes and the port has to
    // re-derive the ranking order by hand.
    //
    // Adding an import here is not a lint failure to silence; it means the code
    // belongs in the adapter instead.
    files: ['lib/char-insert/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react',
            'react-*',
            'next',
            'next/*',
            'lexical',
            '@lexical/*',
            '@tanstack/*',
            '@/components/*',
            '@/hooks/*',
            '@/lib/*',
          ],
        },
      ],
    },
  },
  {
    // Tier A of smart typography (Layer 1.6, Part B) — the `--`/`---`/`...`
    // rule engine. Same contract, same reasoning, same enforcement as
    // `lib/char-insert/**` above: quilltap-v5 copies this directory wholesale
    // and rewrites only the Lexical adapter in components/chat/.
    //
    // See docs/developer/features/composer-smart-typography.md. Adding an
    // import here is not a lint failure to silence; it means the code belongs
    // in `components/chat/lexical/plugins/SmartTypographyPlugin.tsx` instead.
    files: ['lib/smart-typography/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react',
            'react-*',
            'next',
            'next/*',
            'lexical',
            '@lexical/*',
            '@tanstack/*',
            '@/components/*',
            '@/hooks/*',
            '@/lib/*',
          ],
        },
      ],
    },
  },
])

export default eslintConfig
