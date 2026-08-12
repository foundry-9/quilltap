# Project: Quilltap - Self-Hosted AI Workspace

This document provides a high-level overview of the Quilltap project, its architecture, and key development conventions.

## 1. Project Overview

Quilltap is a comprehensive, self-hosted AI workspace built with Next.js 16 (App Router). It's designed as a platform for creating and interacting with AI collaborators ("characters") that have persistent memory and can connect to a wide array of LLM providers. The project's core philosophy is user ownership of data, privacy, and extensibility.

### Core Features:

*   **Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query, and an encrypted SQLite database.
*   **Custom Server (`server.ts`):** A custom Node.js server wraps Next.js to handle WebSocket connections for the integrated terminal feature.
*   **Robust Startup Process (`instrumentation.ts`):** A critical, multi-stage startup sequence handles data migration, DB encryption, schema migrations, version validation, plugin loading, and background job scheduling.
*   **Plugin System:** An extensive plugin system allows for easy extension of core functionalities like LLM providers, themes, and AI tools.
*   **Encrypted Local Data:** All user data is stored locally in an SQLite database encrypted with SQLCipher. Data access is managed via a repository pattern.

## 2. Key Architectural Principles

### API Architecture

New API routes are built under `/api/v1/` and use an `?action=` query parameter dispatch pattern instead of creating separate routes for each action. This is managed by middleware helpers in `lib/api/middleware`.

*   **Example:** `POST /api/v1/characters/[id]?action=favorite`
*   **Implementation:** Use `createContextHandler` and `withActionDispatch` from `@/lib/api/middleware`.
*   **Responses:** Use standardized response helpers like `successResponse`, `errorResponse`, etc., from `@/lib/api/responses`.

### Client Data Fetching (TanStack Query)

Client-side server state is managed exclusively by TanStack Query v5.

*   **Query Keys:** Always use the key factory in `lib/query/keys.ts` (e.g., `queryKeys.characters.all`). Do not use raw strings or array keys. This ensures prefix invalidation works correctly.
*   **Query Function:** Use the `apiFetch<T>(url, init?)` wrapper from `lib/query/fetcher.ts` as the `queryFn`.

### Background Job Processing

Background jobs run in a forked child process to avoid blocking the main server.

*   **DB Access:** The main parent process is the *only* database writer. The child process has a read-only connection.
*   **IPC for Writes:** Write operations from a job are buffered in the child process and sent to the parent via IPC to be executed and committed.
*   **No Read-Your-Writes:** Do not assume you can read a value that was just written within the same job, as the write is asynchronous and handled by the parent process.

## 3. Building and Running

*   **Development:** `npm run dev` (runs `tsx server.ts`)
*   **Production Build:** `npm run build`
*   **Production Start:** `npm run start`
*   **Testing:**
    *   `npm test` (runs all tests)
    *   `npm run test:unit` (Jest unit tests)
    *   `npm run test:integration` (Jest integration tests)
    *   `npm run test:e2e` (Playwright E2E tests)
*   **Linting:** `npm run lint`

## 4. Development Conventions

### General

*   **Code Style:** ESLint with a flat config (`eslint.config.mjs`) is used.
*   **Path Aliases:** The `@/*` alias points to the project root (`./*`).
*   **Modularity:** Backend logic resides in `lib/`, frontend components in `components/`, and routes in `app/`.

### Critical "Gotchas" & Chokepoints

*   **Memory Deletion:** Never delete memories by calling `repos.memories.delete*` directly. Always use `deleteMemoryWithUnlink(id)` or `deleteMemoriesWithUnlinkBatch(ids)` from `lib/memory/memory-gate.ts` to ensure relationship integrity.
*   **Tool Definitions:** When creating or editing AI tools in `lib/tools/`, the Zod schema (`*ToolInputSchema`) is the single source of truth. The `parameters` object for the AI must be derived from it using `zodToOpenAISchema(...)`. Do not hand-write the parameters JSON schema.
*   **`<img>` vs. `<Image>`:** The project intentionally uses the standard HTML `<img>` tag in many places, especially for images whose sources are dynamic or come from APIs that Next.js cannot resolve at build time. Do not replace these with the Next.js `<Image>` component.
*   **Database Driver Alias:** The project uses `better-sqlite3-multiple-ciphers` for encrypted database access, but it is **aliased as `better-sqlite3`** in the root `package.json`. Always `require('better-sqlite3')` in code, not the full package name.

### Database Migrations

*   **Location:** Migration scripts are located in `migrations/scripts/`.
*   **User-Facing Labels:** Every migration must have a corresponding user-friendly "pretty label" defined in `lib/startup/prettify.ts`. This is shown on the loading screen during startup.
*   **Progress Reporting:** For migrations that loop over large datasets, you must call `reportProgress(...)` from `migrations/lib/progress.ts` inside the loop to provide feedback to the UI.

## 5. Project Glossary

The project uses a set of themed names for its various features and subsystems.

| Name | Description | UI Route / Setting |
|---|---|---|
| **The Salon** | The core chat interface. | `/salon` |
| **Aurora** | The characters UI and roleplay template settings. | `/aurora`, `/settings?tab=templates` |
| **Prospero** | Agentic systems, tool-use, and system settings. | `/prospero`, `/settings?tab=system` |
| **The Scriptorium**| External document stores and mountable knowledge bases. | `/scriptorium` |
| **The Foundry** | The overall architecture, plugins, and packages settings. | `/settings` |
| **Calliope** | UI/UX, appearance, and theme settings. | `/settings?tab=appearance` |
| **The Commonplace Book**| The character memory system (self-managed RAG). | `/settings?tab=memory` |
| **The Lantern** | Image generation subsystem. | `/settings?tab=images` |
| **The Concierge** | Dangerous content tracking and rerouting system. | `/settings?tab=chat` |
| **The Librarian** | A synthetic author for Document Mode file events. | (In-chat messages) |
| **The Host** | A synthetic author for chat participation events. | (In-chat messages) |
