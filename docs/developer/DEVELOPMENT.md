# Development Guide

This document covers the development setup and project structure for Quilltap.

## Project Structure

```text
quilltap/
├── app/                      # Next.js App Router entry point
│   ├── api/                  # Versioned REST API (mostly under api/v1/)
│   ├── about/                # About page
│   ├── aurora/               # Character UI (was /characters)
│   ├── characters/           # Legacy redirect to /aurora
│   ├── chats/                # Legacy redirect to /salon
│   ├── custom-tools/         # Pascal's Workbench (custom pseudo-tool editor)
│   ├── dashboard/            # Dashboard / home
│   ├── files/                # Files browser
│   ├── foundry/              # Legacy redirect to /settings
│   ├── generate-image/       # Standalone image-generation page
│   ├── personas/             # User persona management
│   ├── photos/               # Character photo gallery
│   ├── profile/              # User profile
│   ├── projects/             # Legacy redirect to /prospero
│   ├── prospero/             # Projects / agentic UI (was /projects)
│   ├── salon/                # Chat UI (was /chats)
│   ├── scenarios/            # Scenario editing surface
│   ├── scriptorium/          # Document stores UI
│   ├── settings/             # Tabbed settings hub (Foundry)
│   ├── setup/                # First-run setup wizard
│   ├── styles/               # qt-* utility class stylesheets
│   ├── tools/                # Tools admin / inspection
│   ├── unlock/               # Locked-mode unlock screen
│   ├── workspace/            # Tabbed two-pane workspace shell (the default surface)
│   ├── globals.css           # Root styles and Tailwind imports
│   ├── layout.tsx            # Root layout (providers, themes, fonts)
│   └── page.tsx              # Public landing page
├── components/               # Reusable UI components
│   ├── character/            # Character editor pieces
│   ├── characters/           # Character list / cards
│   ├── chat/                 # Salon: chat surface, Lexical composer, tool palette
│   ├── clothing-records/     # Wardrobe pieces
│   ├── dashboard/            # Dashboard cards
│   ├── files/                # File pickers / file UI
│   ├── help-chat/            # In-app help chat
│   ├── homepage/             # Marketing / homepage components
│   ├── hooks/                # Component-local hooks
│   ├── image-profiles/       # Image-generation profile editors
│   ├── images/               # Image gallery and tile components
│   ├── import/               # Import wizard pieces
│   ├── layout/               # Layout shells, sidebars
│   ├── markdown-editor/      # Lexical-based editor wrapper
│   ├── memory/               # Commonplace Book UI
│   ├── new-chat/             # New-chat dialog and dropdowns
│   ├── physical-descriptions/ # Physical description fields
│   ├── profile/              # User profile pieces
│   ├── providers/            # React context providers
│   ├── quick-hide/           # Concierge quick-hide UI
│   ├── search/               # Search surface
│   ├── settings/             # Settings tab components
│   ├── setup-wizard/         # First-run wizard pieces
│   ├── startup/              # Startup / loading components
│   ├── state/                # Client-side state components
│   ├── tabs/                 # Tab navigation
│   ├── tags/                 # Tag UI
│   ├── tools/                # Tool palette / tool admin
│   ├── ui/                   # Generic UI primitives (Avatar, Badge, Button, …)
│   ├── wardrobe/             # Wardrobe / outfit pieces
│   └── workspace/            # Workspace shell: panes, tab strip, toolbar bridge
├── lib/                      # Domain logic and utilities (large; see lib/ for full list)
│   ├── api/                  # Middleware + response helpers (createContextHandler, withActionDispatch, etc.)
│   ├── api-keys/             # Pepper Vault API-key storage (Saquel)
│   ├── auth/                 # Single-user session
│   ├── background-jobs/      # Job queue + forked child worker (see BACKGROUND_JOBS_CHILD.md)
│   ├── backup/               # Backup / restore logic
│   ├── brahma-console/       # Brahma: character-less LLM surface + read-only SQL
│   ├── characters/           # Character services: vault sync, archive/rehydrate, archive-crypto
│   ├── chat/                 # Salon: context-manager, turn-manager, tool execution
│   ├── database/             # SQLite/SQLCipher connection management
│   ├── doc-edit/             # Document Mode core (open / save / rename / delete)
│   ├── embedding/            # Embedding providers and helpers
│   ├── encryption.ts         # Crypto primitives
│   ├── export/               # .qtap export
│   ├── file-storage/         # Local-filesystem storage manager
│   ├── foundry/              # Subsystem definitions and hub helpers
│   ├── help/, help-chat/, help-guide/  # User-help docs and in-app help chat
│   ├── image-gen/            # Image generation pipeline (Lantern)
│   ├── import/               # .qtap and SillyTavern import
│   ├── llm/                  # LLM utilities (formatting, pricing, streaming, logging)
│   ├── logger.ts, logging/   # Centralized logger
│   ├── memory/               # Commonplace Book (memory + embeddings)
│   ├── mount-index/          # Scriptorium mount-points and document-store index
│   ├── pascal/               # Pascal the Croupier: custom-tool loading, rolls, side effects
│   ├── plugins/              # Plugin registry and loader
│   ├── post-office/          # Suparṇā: inter-character mail
│   ├── prompts/              # Built-in system-prompt templates
│   ├── query/                # TanStack Query keys, fetcher, provider
│   ├── repositories/         # DB repositories (single source of truth for tables)
│   ├── schemas/              # Zod schemas and TS types
│   ├── scriptorium/          # Document-store helpers
│   ├── search-replace/       # Bulk search-and-replace tool support
│   ├── services/             # Cross-cutting services (host-notifications, librarian-notifications, chat-message, …)
│   ├── sillytavern/          # SillyTavern card import/export
│   ├── tags/, tokens/, validation/  # Misc utilities
│   ├── themes/               # Theme registry + bundle loader + Ed25519 crypto
│   ├── tools/                # LLM tool definitions and handlers (doc_*, self_inventory, search, …)
│   ├── wardrobe/             # Wardrobe / outfit logic
│   └── workspace/            # Workspace tab model, deep-link → tab resolution
├── help/                     # User documentation (Markdown, built to MessagePack)
├── migrations/               # Database migration scripts and migration-only files
├── plugins/                  # Plugin source code
│   ├── dist/                 # Built plugins (loaded at runtime)
│   └── src/                  # Plugin source files
├── packages/                 # Published npm packages for plugin development
│   ├── plugin-types/         # TypeScript types (@quilltap/plugin-types)
│   ├── plugin-utils/         # Plugin utilities (@quilltap/plugin-utils)
│   ├── theme-storybook/      # Storybook preset for theme development (@quilltap/theme-storybook)
│   └── create-quilltap-theme/ # Scaffolding CLI for new themes
├── themes/                   # Bundled and built themes
│   └── bundled/              # 6 .qtap-theme bundles (art-deco, earl-grey, great-estate, madmans-box, old-school, rains)
├── hooks/                    # Custom React hooks
├── types/                    # TypeScript type augmentations
├── __tests__/                # Jest test files (unit and integration)
├── __mocks__/                # Test mocks for auth, providers, etc.
├── docs/                     # Documentation (API, deployment, backup guides)
│   └── developer/features/   # Feature roadmap (with completed/ subdir)
├── docker/                   # Docker configuration (entrypoint script)
├── lima/                     # Lima VM configuration (macOS desktop shell)
├── first-startup/            # First-startup helper assets
├── cicd/                     # CI/CD scripts and deploy helpers
├── scripts/                  # Utility scripts (migrations, cleanup, builds)
├── public/                   # Static assets (icons, manifest, schemas)
├── website/                  # Website assets (images, splash graphics)
├── certs/                    # Development TLS certificates
├── logs/                     # Application log files (when LOG_OUTPUT includes file)
├── Dockerfile                # Production Docker build
├── Dockerfile.ci             # CI Docker build
├── proxy.ts                  # Local HTTPS proxy helper for dev (Next.js 16+: middleware lives here, not middleware.ts)
├── instrumentation.ts        # Next.js instrumentation hook
├── jest.config.ts            # Jest unit test configuration
├── jest.integration.config.ts # Jest integration test configuration
├── tailwind.config.ts        # Tailwind CSS configuration
├── eslint.config.mjs         # ESLint configuration
├── eslint-quilltap-plugin.js # Project-local ESLint rules (e.g., the "Quilltap" spelling rule)
├── knip.json                 # Knip dead-code config
├── tsconfig.json             # TypeScript configuration
└── package.json              # Dependencies and npm scripts
```

## Development Workflow

### Prerequisites

- **Node.js 24+** (LTS)
- **SQLite with SQLCipher** (automatic with better-sqlite3-multiple-ciphers) — note that the standard `sqlite3` CLI cannot open Quilltap's encrypted database files; use `npx quilltap db` for direct database access
- **File storage**: Local filesystem

### Running Locally

```bash
# Install dependencies
npm install

# Build plugins (required before first run)
npm run build:plugins

# Start the development server with HTTPS
npm run devssl

# Or plain HTTP
npm run dev

```

The application will be available at [https://localhost:3000](https://localhost:3000)

### Running with Docker

```bash
# Run from Docker Hub
docker run -d --name quilltap -p 3000:3000 -v ~/.quilltap:/app/quilltap foundry9/quilltap

# View logs
docker logs -f quilltap
```

A container can only see host paths bound into it at creation. Database-backed
document stores live in the data directory and ride along, but **filesystem and
Obsidian stores point anywhere on the host and need their own binds** — without
them the store lists its folders (that listing comes from the cached mount index)
while every operation touching real bytes fails. `npm run start:docker`
enumerates the instance's filesystem stores and binds each path-identically;
`--instance NAME` resolves the data directory from the instance registry (and
unlocks an encrypted instance for enumeration), `--recreate` replaces an existing
container (binds are fixed at creation, so this is the only way to change them),
and `--no-store-mounts` opts out. To inspect or hand-assemble the plan:

```bash
npx quilltap docs docker-mounts --format args
```

See [CLI.md](CLI.md) for the planner's rules (collapsed duplicates, nested-path
drops, skipped non-existent paths, and the Windows refusal).

### Running with the Desktop App (Electron)

The Quilltap desktop app (Electron shell) lives in a separate repository. This repo produces a standalone tarball that the Electron shell consumes. See `npm run build:standalone` for details.

### Testing

```bash
# Run all tests (unit + integration)
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run E2E tests with Playwright
npm run test:e2e
```

### Type Checking

```bash
# Check for TypeScript errors (faster than full build)
npx tsc

# Full build including plugins
npm run build
```

### Linting

```bash
# Check for lint errors
npm run lint

# Fix auto-fixable lint errors
npm run lint:fix
```

### Building Plugins

Plugins must be built before running the application:

```bash
# Build all plugins
npm run build:plugins
```

When making changes to a plugin, bump the patch version in its `package.json` and rebuild.

## Data Storage

### SQLite Database

All application data is stored in SQLite, encrypted at rest using **SQLCipher** (via the `better-sqlite3-multiple-ciphers` driver, aliased as `better-sqlite3` throughout the codebase). Every database file is encrypted on disk — the standard `sqlite3` command-line tool cannot open these files. Use the built-in CLI subcommand instead:

```bash
# List tables
npx quilltap db --tables

# Run a SQL query
npx quilltap db "SELECT COUNT(*) FROM characters;"

# Interactive REPL
npx quilltap db --repl

# Query the LLM logs database
npx quilltap db --llm-logs --tables

# Use a custom data directory
npx quilltap db --data-dir /path/to/data --tables
```

The encryption key is stored in a `.dbkey` file in the `data/` subdirectory alongside the database files. **Back up the `.dbkey` file alongside your database** — without it, the database cannot be decrypted. An optional passphrase (locked mode) can be set via environment variable to further protect the key file.

Quilltap actually maintains **three separate encrypted SQLite databases** alongside the main `quilltap.db`:

- **`quilltap.db`** — primary application database (users, characters, chats, messages, files, tags, memories, projects, folders, wardrobe, outfit presets, connection/embedding/image profiles, prompt and roleplay templates, provider models, jobs, plugin configs, vector indices, etc.)
- **`quilltap-llm-logs.db`** — append-only LLM request/response logs
- **`quilltap-mount-index.db`** — Scriptorium mount-point and document-store index (mount points, files, folders, blobs, chunks, project links)

Schemas drift fast and there are 30+ tables across these three databases, so the canonical schema reference lives in **[DDL.md](DDL.md)** — keep that file up-to-date when migrations land. A quick sense of the moving parts:

- **users** — single-user account
- **characters / character_plugin_data / wardrobe_items / outfit_presets** — the Aurora character model
- **chats / chat_messages / chat_settings / chat_documents / conversation_annotations / conversation_chunks** — Salon state
- **memories** — Commonplace Book entries (with `aboutCharacterId` for cross-character relationships)
- **projects / folders** — Prospero project tree
- **files** — file metadata pointing into the local-filesystem file store
- **api_keys** — Pepper Vault (Saquel)
- **connectionProfiles / embeddingProfiles / imageProfiles / providerModels** — provider configuration
- **promptTemplates / roleplayTemplates** — prompt / roleplay format templates
- **background_jobs / embedding_status** — Prospero job queue
- **vector_indices / vector_entries / tfidf_vocabularies** — semantic search and recall
- **plugin_configs / instance_settings / quilltap_meta / migrations_state / migrations_metadata** — instance plumbing
- **help_docs** — built MessagePack help index

The SQLite database file location depends on platform:

| Environment | Database Path                                                              |
| ----------- | -------------------------------------------------------------------------  |
| **Linux**   | `~/.quilltap/data/quilltap.db`                                             |
| **macOS**   | `~/Library/Application Support/Quilltap/data/quilltap.db`                  |
| **Windows** | `%APPDATA%\Quilltap\data\quilltap.db`                                      |
| **Docker**  | `/app/quilltap/data/quilltap.db`                                           |
| **Lima VM** | `/data/quilltap/data/quilltap.db` (VirtioFS mount of the macOS path)       |
| **WSL2**    | Same as Windows; the Windows path is passed through as `QUILLTAP_DATA_DIR` |

Override with `QUILLTAP_DATA_DIR` (non-Docker environments).

### File Storage

Files are stored on the local filesystem only — S3 and other remote backends were retired in v4.x.

- Files live in the platform-specific `files/` directory (e.g., `~/.quilltap/files/` on Linux, `~/Library/Application Support/Quilltap/files/` on macOS)
- No additional configuration required
- Scriptorium document stores live alongside the file store and are indexed in `quilltap-mount-index.db`

## Plugin Development

Plugins are self-contained modules in `plugins/src/` that provide:

- **LLM Providers** - Connect to AI services (OpenAI, Anthropic, Grok, Google, Ollama, OpenRouter, OpenAI-compatible)
- **Embedding Providers** - Vector embeddings for memory and semantic search (e.g., the bundled `builtin-embeddings` plugin)
- **Search Providers** - Web search backends for the `web_search` tool (e.g., `search-serper`, `curl`)
- **Tool Providers** - Custom LLM tools (e.g., the `mcp` connector for Model Context Protocol servers)
- **System Prompts** - Custom system prompt templates for characters
- **Roleplay Templates** - Message formatting templates
- **Themes** - Visual theme packs (deprecated as plugins; use `.qtap-theme` bundles instead)

See [plugins/README.md](plugins/README.md) for the plugin developer guide.

### Theme Development

Themes are now distributed as `.qtap-theme` bundles — declarative zip archives containing JSON tokens, CSS, fonts, and images. No npm, esbuild, or TypeScript required.

```bash
# Create a new theme (bundle format, recommended)
npx create-quilltap-theme my-theme

# Create a legacy npm plugin theme (deprecated)
npx create-quilltap-theme my-theme --plugin
```

Manage themes via CLI:

```bash
npx quilltap themes list              # List all installed themes
npx quilltap themes validate my.qtap-theme  # Validate a bundle
npx quilltap themes install my.qtap-theme   # Install a bundle
npx quilltap themes export earl-grey        # Export any theme as a bundle
npx quilltap themes search "dark"           # Search registries
```

Bundled themes ship in `themes/bundled/`. User-installed themes go to `<dataDir>/themes/<themeId>/`.

See [THEME_PLUGIN_DEVELOPMENT.md](THEME_PLUGIN_DEVELOPMENT.md) for the legacy plugin format guide.

## Logging

The application uses a centralized logging system configurable via environment variables:

- `LOG_LEVEL` - `error`, `warn`, `info`, `debug` (default: `info`)
- `LOG_OUTPUT` - `console`, `file`, or `both` (default: `console`)
- `LOG_FILE_PATH` - Directory for log files (default: `./logs`)

In development, logs are written to `logs/combined.log` and `logs/error.log`. Use standard logging tools to tail and search these files.

## Checklist before release

1. Unless we're implementing an interface or an instance of a generic provider of some kind, we should never directly access the filesystem in this app; we should be using our generic file provider for that
2. Create unit tests to expand coverage for any new functionality, and test specifically for the bugs that were fixed when we apply bugfixes (to ensure there are no regression issues going forward)
3. Refactor according to best practices, including:
   - respect encapsulation and single source of truth. If a feature requires duplicate code, consider inheritance
   - SRP
   - DRY
   - KISS
   - YAGNI
4. Ensure that API endpoints adhere to the `/api/v{version}/{entityname}` standard (currently `/api/v1/{entityname}`), with only these non-versioned exceptions: `/api/health`, `/api/plugin-routes/[...path]`, and `/api/themes/*`.
5. Run a test for dead code and refactor that out. Use `npx knip` if it's helpful. We have a [dead code report](DEAD-CODE-REPORT.md) (in the same directory) and that should be updated.
6. Ensure that the debug logging we always create for new work has been removed unless we still need it.
7. Verify that new UI components that were created adhere to the standard of using `qt-*` theme utility classes
8. As much as possible, plugins should be self-contained or use `plugin-types` and `plugin-utils` to access Quilltap internals; even distributed plugins in `plugins/dist/` should use these, since these plugins are models to independent plugin developers
9. If we updated any packages (in `packages/`), make sure that those are published to npmjs and properly installed in any NPM package.json files that exist throughout the application, including other packages, plugins, and the primary one at the root level
10. Verify that the backup/restore system includes everything that can be backed up (usually everything but things that are so secret they need to be encrypted, like API keys)
11. Make sure that lint/test/build in Github Actions are working
12. Verify that documentation, completions, and tooling for the [Quilltap CLI](../../packages/quilltap/) are up-to-date
13. Check the following Markdown files to be sure they are up-to-date:
    - [README](../../README.md)
    - [Changelog](../CHANGELOG.md)
    - [API Documentation](API.md)
    - [Developer Documentation](DEVELOPMENT.md)
    - [Claude instructions](../../CLAUDE.md)
    - [About Page](../../app/about/page.tsx)
    - [Release notes for this release](../releases/) **MUST EXIST FOR PRODUCTION RELEASE** and must match the version number in package.json exactly, or the version we are going to release at any rate

## Git and Github release instructions

### For dev changes moving to release

**Do NOT just run this script; run the commands one at a time.**

```bash
# Don't just run this script; run the commands one at a time.
git checkout release
# This brings in all the changes without the history
git merge --squash --strategy-option=theirs main
# Remove the detritus after the release
sed -i '' -E 's/("version": "[^"]*)-[^"]*"/\1"/' package.json
# Update package-lock.json to be up-to-date
npm install
# Get new release version for tags
NEWRELEASE=$(sed -n -E 's/.*"version": "([^"]*)".*/\1/p' package.json)
# Change the badge to release version standards
sed -i '' -E 's/(badge\/version-)[^)]+\.svg/\1'"$NEWRELEASE"'-green.svg/' README.md
# Presumably we ran tests and bumped prerelease versions when we committed last time
git add package.json package-lock.json README.md
git commit --no-verify -m "release: $NEWRELEASE"
# We'll tag it so we can handle the release
git tag -s -m "$NEWRELEASE" $NEWRELEASE

# Now we'll start the new dev branch
NEWDEVVERSION=$(echo "$NEWRELEASE" | awk -F. '{print $1"."$2+1".0"}')
git checkout main
# Should just bring over the one updated commit for the release itself
git merge --strategy-option=theirs release
# Make this the new first dev version
sed -i '' -E 's/("version": ")[^"]*"/\1'"$NEWDEVVERSION"'-dev.0"/' package.json
# Update package-lock.json again
npm install
# Let's fix that badge in the README file too
sed -i '' -E 's/(badge\/version-)[^-]*-[a-z]+/\1'"$NEWDEVVERSION"'--dev.0-yellow/' README.md
# Again, we haven't changed anything substantial, so no pre-commits
git add package.json package-lock.json README.md
git commit --no-verify -m "dev: started $NEWDEVVERSION development"
# We'll tag this one too
git tag -s -m "$NEWDEVVERSION-dev" $NEWDEVVERSION-dev

# Let's set up the bugfix version too
git checkout bugfix
# Merge everything that release has
git merge --strategy-option=theirs release
# make this the new first bugfix version
sed -i '' -E 's/("version": ")[^"]*"/\1'"$NEWRELEASE"'-bugfix.0"/' package.json
# Update package-lock.json again
npm install
# Let's fix that badge in the README file too
sed -i '' -E 's/(badge\/version-)[^-]*-[a-z]+/\1'"$NEWRELEASE"'--bugfix.0-yellow/' README.md
# Again, we haven't changed anything substantial, so no pre-commits
git add package.json package-lock.json README.md
git commit --no-verify -m "bugfix: started $NEWRELEASE bug branch"

# Finally, the pushes to Github
git push
git checkout main
git push
git checkout release
git push
git push --tags

# Time to push to Docker
npm run build:docker

# Now let's get back to work!
git checkout main
```

### for bugfix changes moving to release

```bash
# Don't just run this script; run the commands one at a time.
git checkout release
# This brings in all the changes without the history
git merge --squash --strategy-option=theirs bugfix
# Remove the detritus after the release
node -e "const p=require('./package.json');const v=p.version.split('-')[0].split('.');v[2]++;p.version=v.join('.');require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
# Update package-lock.json to be up-to-date
npm install
# Get new release version for tags
NEWRELEASE=$(sed -n -E 's/.*"version": "([^"]*)".*/\1/p' package.json)
# Change the badge to release version standards
sed -i '' -E 's/(badge\/version-)[^)]+\.svg/\1'"$NEWRELEASE"'-green.svg/' README.md
# Presumably we ran tests and bumped prerelease versions when we committed last time
git add package.json package-lock.json README.md
git commit --no-verify -m "release: $NEWRELEASE"
# We'll tag it so we can handle the release
git tag -s -m "$NEWRELEASE" $NEWRELEASE

# Let's set up the bugfix version again
git checkout bugfix
# Merge everything that release has
git merge --strategy-option=theirs release
# make this the new first bugfix version
sed -i '' -E 's/("version": ")[^"]*"/\1'"$NEWRELEASE"'-bugfix.0"/' package.json
# Update package-lock.json again
npm install
# Let's fix that badge in the README file too
sed -i '' -E 's/(badge\/version-)[^-]*-[a-z]+/\1'"$NEWRELEASE"'--bugfix.0-yellow/' README.md
# Again, we haven't changed anything substantial, so no pre-commits
git add package.json package-lock.json README.md
git commit --no-verify -m "bugfix: started $NEWRELEASE bug branch"

# Now let's pull this into dev
```

## Testing Your Changes

1. Check for TypeScript errors: `npx tsc`
2. Run relevant tests: `npm run test:unit`
3. Test the UI manually at `https://localhost:3000`
4. Check application logs in `logs/combined.log`

## Contributing

1. Open an issue first to discuss major changes
2. Fork the repository
3. Create a feature branch
4. Make your changes
5. Run tests and type checking
6. Submit a pull request

## Additional Documentation

- [API Documentation](API.md) - REST endpoints and authentication
- [Database Abstraction](DATABASE_ABSTRACTION.md) - SQLite backend and data directory
- [Deployment Guide](../DEPLOYMENT.md) - Production deployment patterns
- [Backup & Restore Guide](../BACKUP-RESTORE.md) - Data backup procedures
- [Plugin Developer Guide](../../plugins/README.md) - Creating plugins
- [Database Encryption](DATABASE_ENCRYPTION.md) - SQLCipher encryption architecture, .dbkey file management, and passphrase handling
- [Background Jobs Child Process](BACKGROUND_JOBS_CHILD.md) - Child process architecture, IPC protocol, per-database write partitioning, and handler audit
- [Roadmap](features/ROADMAP.md) - Planned features
