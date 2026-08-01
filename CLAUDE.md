# CLAUDE.md

Guidance for Claude Code when working in this repository. This file is loaded on every turn, so it stays short and points at deeper docs. **The rules in "Standing rules" below are not optional — follow them on every task.**

## Project Overview

Quilltap is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who wants an AI assistant that actually knows what they're working on. Connect to any LLM provider, organize work into projects with persistent files and context, create characters with real personalities, and build a private AI environment that learns and remembers.

- **Already implemented:** see the [README](README.md).
- **Roadmap:** `docs/developer/features/`; completed work in `docs/developer/features/complete/`.

## Standing rules (apply on every task)

### Spelling — non-negotiable

The project is **"Quilltap"** (quill + tap), **never** "Quilttap" (quilt + tap). A lint rule enforces this. Never write "quilttap" anywhere.

### Writing voice

- **User-facing** writing (UI, help docs, prompts, migration loading-screen labels) is in the style of *steampunk + Roaring 20s + Great Gatsby + Wodehouse + Lemony Snicket*.
- **`docs/CHANGELOG.md` is the exception:** terse, direct, plain American English. No steampunk voice.

### Before committing

- Record changes in `docs/CHANGELOG.md` (reverse chronological, plain voice — see above).
- **All user-visible changes MUST be documented in `help/*.md`.** Help files need a `url` frontmatter field (with `?tab=`/`&section=` for settings deep-links) and an "In-Chat Navigation" section whose `help_navigate(url: "...")` call matches that `url`.
- Keep the docs listed in [update-documentation](/.claude/commands/update-documentation.md) current; update that file if you add docs.
- Linting, testing, type-checking, and version bumps are handled by the [/commit](/.claude/commands/commit.md) command. The `.githooks/pre-commit` hook kills the dev server, cleans `.next`, stops watchman, and stages dependency artifacts.
- Check TypeScript with **`npx tsc`**, not `npm run build`.

### Hard stops (ask first / never work around)

- **`packages/` changes:** bump the version, then **stop and ask the human to `npm publish`** before installing. Never hand-copy package contents into place. If publish fails, fix the npm problem — don't work around it. **Exception — `packages/quilltap` (the CLI):** still bump its version, but don't ask for a manual `npm publish`; it publishes automatically at release.
- **Plugin changes:** bump the patch version in `package.json` (and `manifest.json` if needed), then re-run `npm run build:plugins` before staging. That build now typechecks each plugin first (`tsc -p tsconfig.json`, extending [`plugins/tsconfig.base.json`](./plugins/tsconfig.base.json)) and fails on any error — the root `npx tsc` excludes `plugins/`, so this is the only thing checking plugin types. A new plugin needs its own `tsconfig.json` extending that base plus a `typecheck` script.
- **Release (`tag-for-release`):** only after the human confirms they've walked the [release checklist](./docs/developer/DEVELOPMENT.md#checklist-before-release). Don't initiate it yourself.
- **No stubs or `TODO` code** unless agreed in advance.
- **Database writes via the CLI** use `--write` (lock-gated). Never use `--lock-override`.

### Code-path chokepoints (don't bypass)

- **Memory deletion** goes through `deleteMemoryWithUnlink(id)` / `deleteMemoriesWithUnlinkBatch(ids)` in `lib/memory/memory-gate.ts` — they scrub deleted IDs from neighbours' `relatedMemoryIds` first. Never call `repos.memories.delete*` directly. (Mirror of `createMemoryWithGate` on the write side.)
- **Tool definitions in `lib/tools/`:** the Zod input schema is the single source of truth. Export `xxxToolInputSchema`, derive `parameters` via `zodToOpenAISchema(...)`, and make `validateXxxInput` a one-line `safeParse(...).success` delegate. **Never hand-write the `parameters` JSON Schema or duplicate validation** — they drift. Field descriptions go on `.describe()`; extra checks on `.refine()`. Register new tools in `lib/tools/__tests__/tool-definitions-snapshot.test.ts` and run `npx jest -u` on it.
- **API routes:** new routes only under `/api/v1/` with the action-dispatch pattern (see below). Use middleware from `@/lib/api/middleware` and helpers from `@/lib/api/responses`.

### Conventions

- **Logging:** every new or touched backend path fires debug logs, with appropriate levels elsewhere, via the built-in logging system.
- **Data/schema changes:** check whether they must be reflected in `.qtap`/SillyTavern exports, [`qtap-export.schema.json`](./public/schemas/qtap-export.schema.json), backups, and/or `migrations/`. Update [DDL.md](docs/developer/DDL.md) — it must stay current. Files kept only for migrations belong in `migrations/`.
- **Linting:** don't swap HTML `<img>` for Next.js `<Image>` — `<img>` is deliberate where sources come from APIs Next.js can't pre-resolve.
- **Next.js (16+) — don't reach for old-version patterns:** App Router only (`app/`, no `pages/` dir). There's no `middleware.ts`; cross-cutting request handling (security headers, CORS — *not* auth, which is single-user) lives in `proxy.ts` on the Edge runtime. Request APIs are async: `await cookies()` / `await headers()`, and route `params` / `searchParams` are Promises (`await params`). Don't write the old synchronous forms or look for conventions that moved.
- **Migrations** have extra rules (loading-screen labels + progress reporting) — see [Writing migrations](#writing-migrations).
- **Principles:** encapsulation, single source of truth (prefer inheritance over duplication), SRP, DRY, KISS, YAGNI.

### Working environment

- Dev runs via `npm run dev` (nearly always running, holds the instance lock) at `http://localhost:3000/`. Track it by tailing `logs/combined.log` (UTC timestamps).
- macOS dev: account for BSD tool variants; GNU coreutils and `gnu-sed` are installed under `g`-prefixed names (`gsed`, etc.).
- **Planning large changes:** plan with your most capable model and aggressively delegate well-specified subtasks to cheaper agent models (e.g. plan in Opus, delegate to Haiku). Don't use `git stash` or worktrees with agents — it tends to make a mess.

## Technology Stack

- **Framework / language:** React via Next.js, TypeScript, npm.
- **Testing:** Jest (native coverage) and Playwright.
- **Data:** SQLite + SQLCipher encryption at rest via `better-sqlite3-multiple-ciphers`, **aliased as `better-sqlite3`** in the root `package.json`. Runtime and tests `require('better-sqlite3')`, not the native name (which only resolves where a sub-package declares it directly). Tests needing both should fall back `better-sqlite3-multiple-ciphers` → `better-sqlite3`. Models are TS interfaces with Zod schemas.
- **File storage:** local filesystem only.
- **LLM providers:** OpenAI, Anthropic, Grok (xAI), Google, Ollama, OpenRouter, any OpenAI-compatible endpoint.
- **Design docs:** Storybook. **User docs:** `/help/`, searchable via MessagePack.
- **Electron shell:** separate repo ([quilltap-shell](https://github.com/foundry-9/quilltap-shell)); this repo produces the standalone tarball it consumes.
- **Native modules:** `better-sqlite3` (node-gyp) and `sharp` (platform binaries). Both need special handling in standalone/Docker builds. New native modules → update `next.config.js` (`serverExternalPackages` + `outputFileTracingIncludes`).
- **Background jobs:** forked child process; parent is the only DB writer. See [Background jobs](#background-jobs-summary).

## API Architecture

All new routes live under `/api/v1/`:

- **Collection:** `/api/v1/[resource]` · **Item:** `/api/v1/[resource]/[id]` · **System:** `/api/v1/system/[feature]`

Use the `?action=` query parameter instead of per-action routes:

```ts
import { createContextHandler, withActionDispatch } from '@/lib/api/middleware';

// POST /api/v1/characters/[id]?action=favorite
export const POST = createContextHandler<{ id: string }>(
  withActionDispatch({ favorite: handleFavorite, avatar: handleAvatar }, handleDefaultPost)
);
```

- **Context:** `createContextHandler` / `withContext` (`@/lib/api/middleware`)
- **Action dispatch:** `withActionDispatch` / `withCollectionActionDispatch` (`@/lib/api/middleware/actions`)
- **Responses:** `successResponse`, `errorResponse`, `notFound`, `badRequest`, `validationError`, `created`, … (`@/lib/api/responses`)

Legacy non-v1 routes were removed in v2.8. Exceptions that remain: `/api/health`, `/api/plugin-routes/[...path]`, `/api/themes/*`. Note content/character/chat **API** paths stay at `/api/v1/characters`, `/api/v1/chats`, `/api/v1/projects` even though their UI routes were renamed (below). Full reference: [API.md](docs/developer/API.md).

## Client data fetching (TanStack Query)

Client server-state runs on **TanStack Query v5** (`@tanstack/react-query`); SWR is fully removed. `<QueryProvider>` (`lib/query/QueryProvider.tsx`) is the top-level provider. See the completed [migration spec](docs/developer/features/complete/tanstack-query-migration.md).

- **Query keys are the single source of truth.** Never pass a raw string/array key to `useQuery`/`useMutation`/`invalidateQueries` — always go through the factory in `lib/query/keys.ts` (e.g. `queryKeys.characters.detail(id)`). Prefix invalidation (`invalidateQueries({ queryKey: queryKeys.characters.all })`) depends on it. Add a block when you introduce a new entity.
- **Fetcher:** `apiFetch<T>(url, init?)` from `lib/query/fetcher.ts` as the `queryFn`, forwarding the signal: `queryFn: ({ signal }) => apiFetch<T>(url, { signal })`. Throws `ApiFetchError` (`status` + parsed `info`) on non-2xx.
- **Mutations** use `useMutation` with `onSuccess`/`onSettled` invalidation; optimistic updates via `onMutate` + `setQueryData` + rollback in `onError`.
- **Tests** wrap with `renderWithQuery` / `createQueryWrapper` from `__tests__/helpers/renderWithQuery.tsx` (fresh client, retries off, `gcTime: 0`); `fetch` stays mocked via `jest-fetch-mock`.
- The Salon's SSE streaming transport is **out of scope** — migrate the reads *around* streaming, never the stream itself.

## Glossary

### Feature names (UI route · settings)

| Name | What it is |
|---|---|
| **The Salon** | chat interface — `/salon` |
| **Aurora** | characters UI (`/aurora`) + roleplay templates (`/settings?tab=templates`) |
| **Prospero** | agentic / tool-use systems — `/prospero`; `/settings?tab=system` |
| **The Scriptorium** | external document stores / mountable knowledge — `/scriptorium` (API stays `/api/v1/mount-points`) |
| **The Foundry** | architecture, plugins, packages — `/settings` (tabs from `lib/foundry/subsystem-defaults.ts`) |
| **Calliope** | UX/UI + themes — `/settings?tab=appearance` |
| **The Commonplace Book** | character memory (self-managed RAG) — `/settings?tab=memory` |
| **The Lantern** | story-background / image subsystem — `/settings?tab=images` |
| **The Concierge** | dangerous-content tracking/rerouting — `/settings?tab=chat` |
| **Pascal the Croupier** | RNG / game-state — `/settings?tab=chat`; custom-tool editor **Pascal's Workbench** — `/custom-tools` |
| **Saquel Ytzama** | encryption / secrets / API keys — `/settings?tab=system` |
| **The Librarian** | synthetic author for Document-Mode events + character `doc_*` calls |
| **The Host** | synthetic author for Salon participation + autonomous-room events |
| **Carina** | inline LLM queries (`@Name:` / `@Name?` / `ask_carina`) — see [Carina](#carina-summary) |

Old UI routes (`/foundry/*`, `/chats`, `/characters`, `/projects`) redirect to their current equivalents.

### Character fields (by vantage point)

Four vantage-point fields plus a foundational one (`manifesto`). **Not interchangeable — never collapse them.** The character optimizer enforces these.

- **manifesto** — axiomatic core; the load-bearing truths every other field stays consistent with. Not a vantage point. Short, declarative. Synced as `manifesto.md` in the vault (case-insensitive lookup).
- **identity** — surface knowledge from outside: name, station, occupation, public reputation. Never internal motivation.
- **description** — what an interlocutor perceives: behaviour, mannerisms, verbal patterns. **NOT** physical appearance (that's `physicalDescriptions`) and not internal monologue.
- **personality** — what the character knows about themselves; the internal driver. Unseen by others unless shared.
- **title** — the user's/character's own private framing (e.g. "the rival"). Not how others refer to them; out of optimizer scope.

### Personified-feature avatars

When a personified feature "speaks" via a synthetic message, its avatar lives at `public/images/avatars/<feature>-avatar.webp` (lowercase, hyphenated; e.g. `lantern-avatar.webp`). Referenced as `/images/avatars/<feature>-avatar.webp`; resolved in `getMessageAvatar` (`app/salon/[id]/page.tsx`), keyed off `systemSender`.

- **Always WebP.** Convert with `cwebp -q 82 -m 6 -mt in.png -o out.webp`, then delete the PNG — every byte ships with the app.
- **Adding a sender** means updating the `systemSender` Zod enum in `lib/schemas/chat.types.ts` **and** the matching `chat_messages` SQLite column, adding a `getMessageAvatar` branch, and adding the value to `public/schemas/qtap-export.schema.json`.
- **The authoritative `systemSender` list is the enum in `lib/schemas/chat.types.ts`** — read it there rather than trusting a copy here. Per-sender responsibilities: `lantern` (image pipeline), `aurora` (avatar/wardrobe), `librarian` (Document-Mode + `doc_*`), `concierge` (dangerous-content), `host` (participation + autonomous-room), `prospero` (tool-use / connection-profile / Run-Tool bubbles; `private:true` runs hide via `targetParticipantIds`), `commonplaceBook` (memory-recall whispers, targeted), `ariel` (terminal PTY open/close), `carina` (renders with the **answerer's own** avatar — no `carina-avatar.webp`), `suparna` (Suparṇā's Post Office mail-delivery announcements — new letters in a character's vault `Mail/` folder), `pascal` (Pascal the Croupier's custom-tool (pseudo-tool) roll outcomes; the roll record lives in `pascalMeta`, posted server-side so a model cannot fudge a failure into a success).

## Instances and the CLI

An **instance** is a self-contained base directory you point Quilltap at, holding `data/`, `files/`, and `logs/` subdirectories. OS defaults: macOS `~/Library/Application Support/Quilltap/`, Linux `~/.quilltap/`, Windows `%APPDATA%\Quilltap\`, Docker `/app/quilltap/`. Override with `QUILLTAP_DATA_DIR`, `--data-dir`/`-d`, `--instance <name>`, or a Docker volume mount.

> When I say I'm "in the `~/iCloud/Quilltap/Friday` instance," the troubleshooting paths are `~/iCloud/Quilltap/Friday/{data,files,logs}/`. Logs there include `combined.log` / `error.log` (auto-rolled every 2–3 MB) plus `quilltap-{stdout,stderr}.log`, `startup.log`, and sometimes `stdout.log`.

**Databases are SQLCipher-encrypted — the `sqlite3` binary can't open them. Use `npx quilltap`.** Prefer high-level subcommands over raw SQL; they auto-pick the database, resolve names to UUIDs, and are read-only unless you pass `--write`. **Full command reference: [CLI.md](docs/developer/CLI.md).** Database schema: [DDL.md](docs/developer/DDL.md).

## Themes

- **Bundle format (`.qtap-theme`)** is primary: declarative zip archives (JSON tokens, CSS, fonts, images), no build tools. **Plugin (npm) format is deprecated** — existing ones still work; new themes use bundles. `create-quilltap-theme` defaults to bundles (`--plugin` for legacy npm format).
- 6 bundled themes (Art Deco, Earl Grey, Great Estate, Madman's Box, Old School, Rains) ship as bundle dirs in `themes/bundled/`. Installed bundles live at `<dataDir>/themes/<themeId>/` (index `themes-index.json`). Registries support remote browse/install with Ed25519 verification.
- **Architecture:** registry singleton `lib/themes/theme-registry.ts` (sources `default`/`plugin`/`bundle`); loader `lib/themes/bundle-loader.ts`; registry client `lib/themes/registry-client.ts`; crypto `lib/themes/crypto.ts`; manifest schema `QtapThemeManifestSchema` (`lib/themes/types.ts`) / JSON Schema `public/schemas/qtap-theme.schema.json`; asset/font routes under `app/api/themes/`. CLI: `npx quilltap themes`.
- **`qt-*` semantic classes:** themes depend primarily on these. If you'd add a new Tailwind class, add it to a `qt-*` utility instead, then apply that.
- **Mirroring `qt-*` into theme-storybook is not optional.** *Every* `qt-*` change — new class, new rule, or a fix to an existing one — must be mirrored into [`packages/theme-storybook/src/css/qt-components.css`](/packages/theme-storybook/src/css/qt-components.css) in the same change, de-Tailwinded to plain CSS (that file uses no `@apply`). Mirror the app **faithfully**, including quirks; if the app rule is itself wrong, fix both or neither — never let them diverge. If the class family isn't in the storybook yet, port the whole family, not just your one rule. Then bump the package's patch version and **stop and ask the human to `npm publish` — the publish gates the commit.** (`dist/` is gitignored; `npm run build` in the package keeps the local copy current.) Also consider the stylebook, [create-quilltap-theme](/packages/create-quilltap-theme), and the bundled themes.

## Subsystem pointers

### Background jobs (summary)

All job handlers run in a lazily-forked child process. **The parent (Next.js HTTP) is the only DB writer;** the child reads via a readonly SQLCipher connection, buffers write payloads in an `AsyncLocalStorage`, and ships them over IPC. The parent partitions writes by target DB (main / mount-index / llm-logs) and commits each in its own transaction, so one partition's failure can't roll back others. **In a handler, treat `getRepositories()` as a proxy: reads pass through, writes buffer — never assume read-your-writes within a single job.** Full mechanics (main-primary autonomous turns, folder-conflict id remapping, the two `AsyncLocalStorage` contexts): [BACKGROUND_JOBS_CHILD.md](docs/developer/BACKGROUND_JOBS_CHILD.md).

### Carina (summary)

Inline LLM queries: users/characters address a designated answerer character via `@Name:` (public), `@Name?` (whisper), or the `ask_carina` tool. The answerer builds a fresh minimal call, the result posts as a `systemSender: 'carina'` message rendered with the **answerer's own avatar**, and the answer is surfaced live via a `carinaAnswer` SSE event. Carina answers are kept out of the normal per-turn memory extractor but **do** form memories and receive recall through dedicated paths (`CARINA_MEMORY_EXTRACTION` job; recall injected by `runCarinaQuery`). Failed-query errors are authored by Prospero (`systemKind: 'carina-error'`), not Carina. Full design: [features/carina.md](docs/developer/features/carina.md).

## Writing migrations

Every migration in `migrations/scripts/` (listed in `index.ts`) must satisfy two rules so the startup loading screen can describe it:

1. **A pretty-label entry in [`lib/startup/prettify.ts`](./lib/startup/prettify.ts)** (`PRETTY_LABELS`), in the steampunk-Wodehouse voice — terse, present-continuous, about the user's data, not the implementation. Without it the screen leaks the internal migration ID.
2. **Any loop over a collection calls `reportProgress(...)`** from [`migrations/lib/progress.ts`](./migrations/lib/progress.ts) (throttled to ~250 ms, safe every iteration):

   ```ts
   import { reportProgress } from '../lib/progress';
   reportProgress(i + 1, items.length, 'items');                              // flat
   reportProgress([{ current: p + 1, total: projects.length, unit: 'projects' },
                   { current: f + 1, total: files.length, unit: 'files' }]);   // nested (outer first)
   ```

   For batched/streaming migrations, count totals upfront with `SELECT COUNT(*)` and pass the running `totalScanned`. Synchronous `db.transaction(...)` can't reach the UI mid-transaction — skipping there is fine.

The commit skill enforces both rules and will block a non-compliant migration.
