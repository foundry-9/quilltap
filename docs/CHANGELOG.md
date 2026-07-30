# Quilltap Changelog

## Recent Changes

### 4.8-dev

#### Finish the context-middleware rename and drop the vestigial auth surface

The `createAuthenticatedHandler` → `createContextHandler` rename was started back in 2.x, but it landed as a set of aliases and the call sites were never moved. 105 routes still used the old names. This finishes it and deletes the shim.

- `createAuthenticatedHandler` → `createContextHandler`, `createAuthenticatedParamsHandler` → `createContextParamsHandler`, `withAuth`/`withAuthParams` → `withContext`/`withContextParams`, and the `AuthenticatedContext` / `AuthenticatedHandler` / `AuthenticatedParamsHandler` types → `RequestContext` / `ContextHandler` / `ContextParamsHandler`. 201 files.
- `lib/api/middleware/auth.ts` is now `lib/api/middleware/context.ts`. It never did authentication — its own header comment already called it "Request Context Middleware." The legacy alias block at the bottom is gone, so the barrel exports one name per thing.
- `checkOwnership(entity, user.id)` → `exists(entity)` at 28 call sites. `checkOwnership` already ignored its `userId` argument, so this is a rename, not a behavior change.

That last point had a consequence worth recording. `lib/api/state-handlers.ts` carried a `useOwnershipCheck` config flag whose two branches were `checkOwnership(entity, userId)` and `entity != null` — identical, since the first ignored `userId`. The flag and its three call-site settings are removed and `authorize` is now `requireEntity`.

It also surfaced a test asserting behavior the app never had: the character-wardrobe DELETE suite claimed a character owned by another user 404s. Production never did that — the mock implemented real ownership semantics that `checkOwnership` did not. The test now pins what the route actually does (404 when the character is missing).

Dead single-user exports removed: `getRequiredSession`, `getCurrentUserId`, and `getRequiredUserId` (referenced only by each other and a jest mock), plus `isSingleUser` and the `UNAUTHENTICATED_USER_ID` / `getOrCreateUnauthenticatedUser` / `isUnauthenticatedUser` aliases. `lib/auth/session.ts` drops from 99 lines to 58. The migration script that appeared to use `UNAUTHENTICATED_USER_ID` declares its own local copy.

`/api/v1/session` stays. It reads like an auth endpoint but is really the client's server-readiness probe: `components/providers/session-provider.tsx` drives a 5-second retry loop off its 5xx responses so the UI recovers as soon as startup and pepper-vault setup finish. Removing it means replacing that probe first.

#### Route responses go through the shared helpers

Release-checklist pass over the API endpoint standard. No route moved and no response body changed.

The audit itself came up clean: every route outside `/api/v1/` is one of the three sanctioned exceptions (`/api/health`, `/api/plugin-routes/[...path]`, `/api/themes/*`), all 21 routes changed since 4.7.0 use the context middleware and dispatch non-CRUD verbs through `?action=`, and there are no synchronous `params` / `cookies()` / `headers()` reads left.

What did need fixing was response construction. Seven route files still called `NextResponse.json` by hand where a helper from `lib/api/responses` applies:

- `characters/[id]/wardrobe/[itemId]`, `messages`, `messages/[id]`, `mount-points`, `mount-points/[id]`, `embedding-profiles/[id]`, and `chats` now use `successResponse` / `created` / `conflict`.
- The swaps are byte-identical on the wire: `successResponse(data, status)` is `NextResponse.json(data, { status })` and `created(data)` is the 201 form, so no client sees a different payload.

The nine `FileOpError` responses in the two `mount-points` routes were deliberately left as raw `NextResponse.json`. They return `{ error, code }`, and `errorResponse` emits `{ error, details? }` — converting them would have silently dropped the `code` field that callers branch on.

Two test suites mocked `@/lib/api/responses` with only the helpers their route used at the time, so the new helpers were added to those factories, shaped to match the global `next/server` mock (payload on `.body`).

#### Deduplicate helpers across the release diff

Release-checklist refactor pass over the 171 non-test source files changed since 4.7.0. Behavior is unchanged; the point is to collapse copies that would drift.

- `extractErrorMessage` existed four times (`CustomToolRunDialog`, `WorkbenchEditor`, `ProvingBench`, `ComposeMailDialog`). Two read only `info.error`, two also read `info.message`. Now one `apiErrorMessage(err, fallback)` in `lib/query/fetcher.ts`, beside the `ApiFetchError` it unwraps; each caller keeps its own fallback sentence.
- `resolveUserCharacterParticipant` was byte-identical in `lib/background-jobs/handlers/memory-extraction.ts` and `app/api/v1/chats/[id]/actions/memories.ts`. Moved to `lib/services/chat-message/turn-transcript.ts`, which both already import and whose `userCharacter*` options are exactly what it returns.
- The Staff display-name table existed in `app/salon/[id]/components/system-message-labels.ts` and again in the new `lib/export/markdown-transcript.ts`. Now `lib/chat/staff-display-names.ts`. The `systemSender` enum is also extracted from `MessageEventSchema` into a named `SystemSenderEnum` / `SystemSender` in `lib/schemas/chat.types.ts`, so the authoritative list can be referenced instead of respelled.
- The default `TimestampConfig` literal gained a fifth copy in the Markdown exporter. `DEFAULT_TIMESTAMP_CONFIG` now lives in `lib/chat/timestamp-utils.ts` with its consumers; `components/settings/chat-settings/types.ts` re-exports it, so existing imports are unchanged.
- `tableExists` was duplicated in `lib/startup/reconcile-embedding-dimensions.ts` and `lib/embedding/reapply-profile.ts` — and `reapply-profile` had two further inline copies that shadowed its own function with a row object. All four now use `lib/database/backends/sqlite/introspection.ts`. The existing `sqliteTableExists` could not serve: it resolves the main database itself, and these need the mount-index handle.
- `withTimeout` was duplicated in `lib/pascal/llm-consult.ts` and `lib/services/chat-message/answer-confirmation.service.ts`. Now `lib/promise-timeout.ts`. It takes the whole message rather than a label, because Pascal's version is shown to a person reading a failed roll ("timed out after 30s") while the other two only reach the log ("after 30000ms") — composing from a label would have quietly changed user-visible text.
- The Workbench preview and audit handlers opened with the same parse-body / validate-definition / resolve-metadata triple and closed with the same `CustomToolRunError` to 422 catch. Both are now shared helpers in `app/api/v1/custom-tools/route.ts`.
- `occurredAt ?? createdAt` plus `Date.parse` was inlined in both recall multipliers in `lib/memory/recall-tags.ts`; folded into one helper.

Left alone deliberately: `resolveWhenPhrase` and `resolveDayReference` share an English day lexicon but resolve a point versus a window, in UTC versus server-local, against a message timestamp versus now — merging them would risk behavior for no correctness gain. The two same-named `collapseOneChat` functions do unrelated jobs. `getMessageAvatar` in `SalonView.tsx` respells the staff names in an eleven-branch chain and is a good candidate for the new table, but this diff did not touch it.

#### Test coverage for the eight untested API routes

Continues the release-checklist coverage pass. The `lib/` subset closed in the previous entry; this closes the API-route subset — the eight routes and route actions that the same coverage run found at 0%. All eight now sit at 100% statements and 100% branches, across 131 new tests in 8 new suites. The suite is 559 files / 9,223 tests.

| Route | Test file |
|---|---|
| `app/api/v1/chats/[id]/actions/export-markdown.ts` | `__tests__/unit/app/api/v1/chats/[id]/actions/export-markdown.test.ts` |
| `app/api/v1/chats/[id]/actions/merge.ts` | `__tests__/unit/app/api/v1/chats/[id]/actions/merge.test.ts` |
| `app/api/v1/chats/[id]/actions/recall-replay.ts` | `__tests__/unit/app/api/v1/chats/[id]/actions/recall-replay.test.ts` |
| `app/api/v1/chats/[id]/qtap-target/route.ts` | `__tests__/unit/app/api/v1/chats/[id]/qtap-target/route.test.ts` |
| `app/api/v1/chats/creation-progress/route.ts` | `__tests__/unit/app/api/v1/chats/creation-progress/route.test.ts` |
| `app/api/v1/documents/route.ts` | `__tests__/unit/app/api/v1/documents/route.test.ts` |
| `app/api/v1/settings/data-retention/route.ts` | `__tests__/unit/app/api/v1/settings/data-retention/route.test.ts` |
| `app/api/v1/system/home/route.ts` | `__tests__/unit/app/api/v1/system/home/route.test.ts` |

As before, the tests pin behavior that is easy to break silently rather than smoke-testing the happy path:

- `export-markdown` gathers character names from three sources — participants, custom announcers, and Carina answerers — and must exclude the Brahma sentinel, which is not a real character. Characters dropped by `findByIds` (broken vault) are absent from the name map rather than throwing, and a non-ASCII transcript filename is RFC 5987-encoded.
- `merge` rejects a self-merge and an explicitly empty allowlist before it touches a repository, and reports "already present" as a 400 no-op — the case where `applyChatMerge` posted no bubbles.
- `recall-replay` sanitizes its own body: a zero, negative, fractional, or string `turnIndex` is dropped rather than passed through, an oversized `limit` clamps to 100, and the cheap-LLM anchor falls back to the first available profile when the participant's profile is missing or deleted.
- `qtap-target` builds its resolver context from the chat's project and *deduped* participant character ids, dispatches between mount-backed and on-disk byte sources, and maps both `ENOENT` and `SOURCE_NOT_FOUND` to a 404 rather than a 500.
- `creation-progress` replays a buffered backlog to a late subscriber, closes immediately when that backlog already ends in `done`/`error`, arms the keep-alive only when the stream stays open, and tears its subscription down on both client abort and consumer cancel. These run against the real in-memory bus.
- `documents` keeps project-scoped rows out of the standalone picker (they have no project context to resolve against), de-duplicates on scope + mount + path so the same filename in two stores stays two entries, and treats both recent-history writes as best-effort — an open and a rename each still succeed when history tracking throws. Rename runs the real `computeRenameTarget`, so separator, traversal, and empty-title rejections are live.
- `data-retention` merges the request body over current settings instead of replacing them, so an empty body cannot silently reset the window to the schema default.

`data-retention`, `documents`, `merge`, and `export-markdown` exercise the real Zod schemas rather than stubs, so validation drift surfaces as a test failure.

No production code changed.

#### Test coverage for eight previously untested modules

Release-checklist coverage pass. A coverage run over the 95 source files added since 4.7.0 found 43 at 0% and 3 under 50%. This closes the `lib/` subset — eight modules, from 0%/low to 99.1% statements and 89.1% branches overall. 117 new tests; the suite is 551 files / 9,092 tests.

| Module | Was | Now | Test file |
|---|---|---|---|
| `lib/api/content-disposition.ts` | 33.3% | 100% | `__tests__/unit/lib/api/content-disposition.test.ts` |
| `lib/config/feature-flags.ts` | 0% | 100% | `__tests__/unit/lib/config/feature-flags.test.ts` |
| `lib/navigation/workspace-redirect.ts` | 0% | 100% | `__tests__/unit/lib/navigation/workspace-redirect.test.ts` |
| `lib/services/chat-message/request-helpers.ts` | 0% | 100% | `__tests__/unit/lib/services/chat-message/request-helpers.test.ts` |
| `lib/pascal/llm-consult.ts` | 47.7% | 100% | `__tests__/unit/lib/pascal/llm-consult.test.ts` |
| `lib/memory/recall-replay.ts` | 0% | 99.6% | `__tests__/unit/lib/memory/recall-replay.test.ts` |
| `lib/memory/fold-episode-pass.ts` | 24.6% | 99.1% | `__tests__/unit/lib/memory/fold-episode-pass.test.ts` |
| `lib/services/home-data.service.ts` | 0% | 97.3% | `__tests__/unit/lib/services/home-data.service.test.ts` |

The tests pin behaviour that is easy to break silently: the workspace flag opts out only on the exact string `'0'` (`'false'` and `''` leave it on); the redirect helper is a true no-op when the flag is off and drops empty params rather than emitting bare keys; `recall-replay` dates a replayed turn from that turn's own clock rather than wall-clock now, runs the old path with every episodic signal inert, and widens the head only for a retrospective turn; `fold-episode-pass` never throws into the fold on any failure path and its fragment linking is union-preserving on both sides; `llm-consult` converts every failure — no profiles, a thrown provider, a hung provider hitting the 60s timeout — into a reason rather than an exception, and reroutes only a dangerous chat; the home dashboard keeps help chats off, blends three activity clocks for project ordering, and sorts characters favourite-then-chat-count-then-name.

No production code changed.

#### Custom-tool definitions load through the canonical mount reader

`readToolFile` in `lib/pascal/custom-tools.ts` hand-rolled its own storage dispatch: `readDatabaseDocument` for database stores, a bare `fs.readFile(path.join(mount.basePath, relativePath))` for everything else. It now calls `readMountFileBytes` (`lib/mount-index/read-file.ts`), the canonical reader that already handles every storage shape — filesystem, Obsidian, database documents, database blobs.

Two effects beyond the deduplication: definition reads now go through `resolveFsAbsolute`, so a `.tool.json` path can no longer resolve outside its own store; and blob-stored definitions on database mounts are readable, where the old direct `readDatabaseDocument` call would have missed them. The list side is unchanged — `Tools/` is still enumerated live off disk on purpose, because edits inside a mount don't reliably touch the mount index.

The load loop's "deleted between list and read" race skip now also recognises `FileOpError` with code `SOURCE_NOT_FOUND`, the reader's equivalent of `ENOENT`.

Tests: the three Pascal suites that stubbed `readDatabaseDocument` now stub `readMountFileBytes`, and `custom-tools-discovery.test.ts` gains a filesystem-backed-store case plus a booby-trapped `fs.readFile` that fails loudly if definition reads ever go back to touching the disk directly.

#### A failed properties.json read no longer wipes a project's settings

On a real instance, a project lost `defaultAlertCharactersOfLanternImages`, `color`, `icon`, `defaultImageProfileId`, `defaultRoleplayTemplateId`, `defaultAgentModeEnabled`, `defaultAvatarGenerationEnabled`, and `storyBackgroundsEnabled` from its store. The visible symptom was that the Lantern generated backgrounds for a chat and never announced them: `isLanternImageAlertEnabled` walks chat → project → OFF, the chat's own override was null, and the project default was gone.

Root cause in `lib/database/document-store-overlay.ts` (the engine behind both the project and group stores): `readProperties` caught every error and returned `null`. Its two callers read `null` as "no file yet, seed from the raw row," and after the 4.7 cutover that row carries no property values at all. So a single transient store failure reset the whole settings bag to schema defaults — and because the no-default optionals then serialize to nothing, the damage was invisible in the file and compounded through every later write.

`readProperties` now returns `null` only for a genuinely absent `properties.json` (a `DatabaseStoreError` with code `NOT_FOUND`) and throws the entity's unavailability error when the file exists but is unreadable, malformed, or fails schema validation. It takes an optional entity id so failures name the project or group, and logs at `error` on both refusal paths.

Both callers get the safer behavior:

- `applyWriteOverlay` now propagates instead of writing a defaults-seeded bag, so a partial patch can never flatten the keys it didn't name.
- `backfillProjectStores` / `backfillGroupStores` route the throw to their existing per-entity catch, so a store they merely failed to read is counted as an error and skipped rather than "healed" by overwriting all four overlay files — the more destructive form of the same bug, since that path also blanks `description.md`, `instructions.md`, and `state.json`.

New tests in `__tests__/unit/lib/projects/project-store-write-overlay.test.ts`: untouched keys survive a single-key patch; unreadable, unparseable, and schema-invalid bodies all throw and write nothing; only a genuine `NOT_FOUND` seeds defaults; store-resident keys are stripped from the DB-bound patch.

#### Read-your-writes detector compares tables, not repositories

The job child's read-your-writes diagnostic warned once per autonomous-room turn about a condition that could not happen: `connections.findApiKeyByIdAndUserId` (a `SELECT` from `api_keys`) read after a buffered `connections.incrementTokenUsage` (a counter bump on `connection_profiles`). The detector's grouping key was the repository object, and the connections repository fronts both tables, so every turn that made more than one provider call logged a false positive — the first call buffers the counter bump, later calls re-resolve an API key.

The grouping key is now the table a method implies, via a `TABLE_GROUP_RESOLVERS` map in `lib/background-jobs/child/child-repositories-proxy.ts` (currently one entry: connections methods containing "ApiKey" resolve to `api_keys`, the rest to `connection_profiles`). Repositories without a resolver are treated as a single table, exactly as before. The warning message now reads "same table" and its context carries a `table` field. Add a resolver entry when a new repository fronts multiple tables.

No behavioural change beyond the log: the buffered counter bump has no in-job reader. The one genuine read-your-writes lag on that path — `llmLogs.getTotalTokenUsageForRun` reading a turn behind its own buffered `llmLogs.create` — is unrelated, still detected, and already compensated by the monotonic `Math.max` clamp in `autonomous-room-turn.ts`.

New tests in `__tests__/unit/background-jobs/child-repositories-proxy.test.ts`: cross-table silence, same-table warning on both of the connections tables, per-`(jobId, readMethod)` dedup, and unmapped-repo behaviour.

#### Export a chat as a readable Markdown transcript

New **Export Markdown** button in the chat sidebar's Organize drawer (`GET /api/v1/chats/[id]?action=export-markdown`). It renders the conversation as a single deterministic Markdown file — the readable record of what was said, not a data-interchange format. Included: the chat title, the opening scenario (with `{{char}}`/`{{user}}` expanded), every participant/user message (active swipe only), Pascal roll announcements, Carina answers (Brahma Console answers under the name "Brahma"), user-inserted announcements (Staff, character, or custom voice), the Host's continuation/merge notices linking the chat to conversations it continues or absorbed, and whispers (marked). Excluded: SYSTEM/TOOL messages, Staff housekeeping (memory whispers, image announcements, time marks), and anything sent to LLMs as prompts.

Each message renders under a `## Speaker — timestamp` heading. Timestamps use the chat's own clock: fictional time when the chat runs one (offset from `fictionalBaseRealTime`, falling back to the chat's creation time for configs that predate anchor stamping), in the chat's resolved timezone and configured format (DATE_ONLY/TIME_ONLY are promoted to FRIENDLY so the transcript keeps full timestamps). Output is deterministic — the same chat state produces a byte-identical file.

Supporting changes: `calculateTimestampAt` extracted from `calculateCurrentTimestamp` in `lib/chat/timestamp-utils.ts` (translate an arbitrary real instant onto the chat clock); `buildContentDisposition` deduplicated into `lib/api/content-disposition.ts` (was copy-pasted in two files routes); the sidebar button uses the Electron-aware `triggerUrlDownload`. New tests: `__tests__/unit/lib/export/markdown-transcript.test.ts` plus `calculateTimestampAt` cases in the timestamp-utils suite.

On a real instance, the jobs child logged a steady stream of `Query vector dimension mismatch` warnings (`storedDimensions: 1024, queryDimensions: 258`). Root cause: the corpus was embedded under an old TF-IDF profile (258-d vectors, most still in the legacy raw-Float32 blob format — 1032 bytes / 4 = the telltale 258), and switching the default to OpenAI text-embedding-3-large (1024-d) in July never triggered a re-embed. The re-embed trigger only fired when an *already-default* profile's provider or model was edited; making a *different* profile the default fired nothing. The measured damage: ~19.7k of ~27.6k memories (33 characters), 888 conversation chunks, and 27 mount chunks were invisible to vector search — every cosine scan silently skips mismatched entries — and the housekeeping merge pass, which searches with each stored entry's own vector, warned once per stale entry per sweep. `embedding_status` claimed 15k memories EMBEDDED because those rows dated from the old profile and nothing invalidated them.

Fixes, in layers:

- **Profile switch now forces the re-embed** (`app/api/v1/embedding-profiles/[id]/route.ts` PUT): a profile *becoming* the default, or a default profile's provider/model/dimensions changing, invalidates all embeddings and enqueues `EMBEDDING_REINDEX_ALL` (BUILTIN goes through refit as before). Changing only the Matryoshka truncation enqueues the local re-apply when narrowing, the full reindex when widening.
- **New startup self-heal** (`lib/startup/reconcile-embedding-dimensions.ts`, instrumentation Phase 3.7): every boot, checks every embedding-bearing table (`memories`, `vector_entries`, `vector_indices` meta, `conversation_chunks`, `help_docs`, `doc_mount_chunks`) against the default profile's target dimension. Non-conforming `vector_entries` are deleted outright (derived data, already invisible to search; the re-embed recreates them) and index meta is snapped to target. Non-conforming chunks on STALE chats are NULLed to the cold-tier state instead of re-embedded (the reopen path heals them on demand). Everything else recoverable enqueues a `mismatched-dim` reindex — deduped against one already pending, excluding rows FAILED for the default profile, excluding orphans (deleted chats, NULL characterId) so a row the reindex can't reach can't re-trigger the sweep every boot. COUNT-only on a conforming corpus. Skipped for BUILTIN defaults (their dimension is the fitted vocabulary size).
- **`EMBEDDING_REINDEX_ALL` coverage gaps closed** (`lib/background-jobs/handlers/embedding-reindex.ts`): a new Phase 4 re-embeds document mount chunks (enabled mounts) — previously the reindex never touched them. Character enumeration now uses `memories.findDistinctCharacterIds()` instead of the characters repository, whose vault-failure semantics silently drop characters and would leave their memories permanently stale. Stale chats are skipped in the chunk phase (both scopes) so a reindex can't re-embed the cold tier the maintenance sweep just cleared. `mismatched-dim` scope skips entities FAILED for the profile.
- **Housekeeping merge pass** (`lib/memory/housekeeping.ts`): entries whose stored vector doesn't match the index dimension are skipped quietly (counted, logged once) instead of warning per entry per sweep.
- `EMBEDDING_DIM_SQL` (format-aware blob-dimension SQL) moved into `lib/embedding/float32-conversion.ts` next to the byte layout it depends on; `reapply-profile.ts` imports it.

New tests: `__tests__/unit/lib/startup/reconcile-embedding-dimensions.test.ts` (real SQLite: raw + quantized legacy blobs deleted, meta snapped, NULL/FAILED/orphan counting, stale-chat NULLing, reindex dedupe, BUILTIN skip, clean-corpus no-op) and `lib/background-jobs/handlers/__tests__/embedding-reindex.test.ts` (mismatched-dim filtering, FAILED exclusion, stale-chat skip, mount-chunk phase, vault-independent character fan-out).

Note for existing instances: the first restart after this change will queue a re-embed of every stale row on the paid default profile (~20k rows on the measured instance — roughly cents to a few dollars with OpenAI embedding pricing, once).

#### Characters can recall what happened today

On a real instance, two characters could not recall a mission from the previous day, though every memory existed with correct embeddings and `occurredAt` values. The explicit `search` tool found them; only the automatic per-turn recall failed, and the models role-played the silence as amnesia. Two independent causes, fixed together.

First, the cheap-LLM turn distillation (`extractMemorySearchKeywords`) returned `retrospective: false, timeRange: null` for a turn where the user said "I mean the mission **today**". Its prompt examples were all "remember when we… / last week you said…", so a same-day reference read as present tense to a small model. With that flag false, the entire episodic recall path was inert — no temporal flip, no time window, no multi-probe.

- New pure module `lib/memory/day-references.ts` resolves the common English day references (`today`, `this morning`, `last night`, `yesterday`, `day before yesterday`, `N days ago` for N ≤ 14, `this week`, `last week`, plus future-pointing `tomorrow`/`next week`) against the **server-local** calendar. Timezone was the crux: the user spoke at 21:44 CDT July 28, which is 02:44 UTC July 29, and a UTC-day resolution of "today" contains none of the mission. Quilltap is self-hosted, so server-local is user-local; the module uses local `Date` accessors throughout and never `getUTC*`.
- `extractMemorySearchKeywords` (`lib/memory/cheap-llm-tasks/memory-tasks.ts`) merges the resolver's answer into the parsed LLM result, so all three consumers (proactive whisper, dynamic head, `recall-replay`) inherit it with no per-caller wiring. A past-pointing reference overrides any LLM-supplied range — the model's ranges carry the same UTC-day bias — and forces `retrospective: true`. A future-only reference changes nothing. The scan reads only the last 4 messages (the prompt still sees 20), and runs only on realtime timelines.
- The prompt's TODAY line rendered its date and weekday from UTC; it now renders from the local clock, so the model's own resolutions agree with the resolver's. The `retrospective` and `timeRange` instructions gained same-day examples.
- `occurredWithin` is no longer gated on the `retrospective` flag in `pre-compute.service.ts`, `context-manager.ts`, and `recall-replay.ts`: a resolved window is useful either way, and the two-stage filter in `searchMemoriesSemantic` (hard filter only when enough hits survive, else a bounded soft boost) makes it starvation-safe. The flag still gates the temporal flip, anti-repetition suspension, and the multi-probe block.

Second, even with detection working, recency carried almost no weight. The ranking blend is `0.75·cosine + 0.25·(importance × 0.5^(days/30))`, so a one-day-old memory outscores a twelve-day-old one by ~0.05 — far less than a single targeting-tag multiplier. Roughly 75% of the mission's memories were tagged `temporal: moment` (×0.7), while stale evergreen memories stacked `narrow✓ · ctx✓ · present↑` ≈ ×1.52 and took every whisper slot.

- New `freshEventMultiplier` in `lib/memory/recall-tags.ts`: a memory whose event time (`occurredAt ?? createdAt`) is within 24h takes ×1.6, within 48h ×1.35. Unconditional by design — it is the safety net for every turn the retrospective classifier misses, including non-English chats. Missing clock, missing/unparsable event time, and future event times all pass through at ×1.0.
- Echo guard: memories extracted from the *current* chat are skipped. They are already in the transcript, and boosting them floods the handful of whisper slots with restatements of the last few turns.
- `RecallContext` gains `currentChatId` and `nowMs`, populated at all three build sites. `recall-replay` uses the **replayed turn's** clock, not wall-clock now, so replaying an old turn reproduces what recall would have done then.
- The explicit `search` tool path (`search-scriptorium-handler.ts`) passes no `recallContext` and is untouched — it already worked.
- New tests: `lib/memory/__tests__/day-references.test.ts` (28 cases, written to pass in any host timezone since Jest copies `process.env` and TZ cannot be pinned per file), `lib/memory/cheap-llm-tasks/__tests__/memory-search-day-reference.test.ts` (9 merge cases including the exact live failure), fresh-boost cases in `lib/memory/__tests__/recall-tags.test.ts`, and window-forwarding cases in the pre-compute suite.

Constants are starting values in the tuning-expected tradition of `RECALL_MULTIPLIERS`; verify with `quilltap recall-replay <chatId> --turn N --char <id>` before tightening. Spec: `docs/developer/features/episodic-recall-day-references-and-fresh-boost.md`.

#### Embedding outcomes actually land in embedding_status, and permanently-failed chunks stop re-rendering every boot

On a real instance, the embedding pipeline logged 156 "marked failed" lines per boot and completed ~67k `EMBEDDING_GENERATE` jobs — yet `embedding_status` held zero FAILED rows and its EMBEDDED count never moved. The initial suspicion was the job child's write-buffering pipeline dropping the writes; that was wrong. The buffered `embeddingStatus.markAsFailed` / `markAsEmbedded` calls replayed fine on the parent — and then silently did nothing, because both methods were find-then-update: they looked up the row for `(entityType, entityId, profileId)` and returned `null` when it was missing. Nothing creates those rows anymore — the enqueue-time `upsertByEntity` calls were removed with the dead `scheduleEmbedding` helper and the reindex batch-insert refactor — and every surviving row on the measured instance referenced a *deleted* profileId, so every single mark call was a no-op. The chunk embedding BLOBs in the same write batch landed normally, which is what pointed the finger away from the IPC layer.

- `markAsEmbedded` and `markAsFailed` (`lib/database/repositories/embedding-status.repository.ts`) now upsert: they create the status row when none exists for the entity/profile pair. Both take a required `userId` (the schema requires one to mint a row); the `EMBEDDING_GENERATE` handler (`lib/background-jobs/handlers/embedding-generate.ts`) passes `job.userId` at all 13 call sites.
- With FAILED rows landing, the startup render/embed reconcile (`lib/startup/reconcile-conversation-rendering.ts`) can finally exclude permanently-unembeddable chunks. Its only guard was `LENGTH(content) BETWEEN 1 AND 131072`, but a chunk can sit under that transport cap and still exceed the embedding model's token context (>8,192 tokens ≈ ~31k chars for text-embedding-3-large) — those fail deterministically, so their chats re-rendered and re-attempted embedding on every boot (76 active chats / ~156 chunks on the measured instance). Condition (B) now also requires no FAILED `embedding_status` row for the profile a re-embed would actually use (default, else first — the same selection the render handler makes). No profile resolvable → the exclusion disarms and behavior is unchanged.
- New regression tests: `__tests__/unit/lib/database/repositories/embedding-status-mark-upsert.test.ts` (create-when-missing, update-when-present, and the different-profile-row case that masked the live failure) and three new cases in `__tests__/unit/lib/startup/reconcile-conversation-rendering.test.ts` (FAILED exclusion in the scan SQL, sentinel bind with no profile, exclusion disabled when profile resolution throws).

Verified read-only against a dogfood copy of the affected instance: the new scan SQL runs on the real schema, and simulating landed FAILED rows for the >31k-char chunks drops 75 chats from the incomplete set. This repo is the v5 port's behavioral oracle; the files changed are `lib/database/repositories/embedding-status.repository.ts`, `lib/background-jobs/handlers/embedding-generate.ts`, and `lib/startup/reconcile-conversation-rendering.ts`.

#### Startup no longer re-embeds every cold-tiered chat

Every boot, the startup render/embed reconcile (`lib/startup/reconcile-conversation-rendering.ts`) re-rendered and re-embedded the entire cold tier, and the next daily maintenance sweep threw the vectors away again. The two subsystems disagreed about what NULL means: the stale-chat cache collapse deliberately NULLs `renderedMarkdown` and chunk embeddings for chats with no played message inside the retention window (recovery is on-demand, when the chat is next opened), while the reconcile read exactly that state as pipeline damage. On a measured real instance the loop had embedded 8,762 chunks exactly six times each (worst chunk: 54 times), leaving 85% of `conversation_chunks` unembedded between swings — with the bill going to the paid default embedding profile on every restart, roughly $2 per boot at that instance's size.

- The reconcile now filters its scan through the same shared `isStale` gate and `resolveStaleChatDays()` window the maintenance sweeps use, and skips stale chats: for them, cold is the desired state. A chat whose staleness can't be determined is also skipped — the reopen path (`lib/scriptorium/cold-chunk-reembed.ts`) re-embeds any visited chat regardless, so skipping is recoverable while healing risks the loop.
- Active chats with genuinely missing embeddings (embedder outage mid-conversation, a killed render job) are still healed at boot exactly as before.
- `isStale` (`lib/background-jobs/maintenance/collapse-stale-chat-assets.ts`) takes `Pick<ChatMetadata, 'id' | 'updatedAt'>` now — the two fields it reads — so the raw-SQL scan can call it without hydrating full chat rows. No behavior change.
- The reconcile result and completion log gain a `skippedStale` count.
- New regression tests in `__tests__/unit/lib/startup/reconcile-conversation-rendering.test.ts`: a stale chat in the scan result is skipped, and a failed staleness check skips rather than heals.

Found by a quilltap-v5 dogfood measurement pass against a copy of real data. Full diagnosis (including why the DEAD-job population and the token-cap hypothesis were ruled out): `docs/developer/found-bugs.md`, Bug 6.

Follow-up, same family: reading a cold chat without playing a message re-embedded it on open, and the next sweep — still seeing no played activity — discarded those fresh embeddings, re-billing every read/sweep cycle. `clearEmbeddingsForChat` (`lib/database/repositories/conversation-chunks.repository.ts`) now takes an optional `olderThan` cutoff and the sweep passes its staleness cutoff: an embedding written inside the retention window (the reopen re-embed stamps `updatedAt`) survives, so a merely-read chat stays semantically searchable for a full window from the visit and is only cold-tiered again once it has gone unvisited that long. New tests in `__tests__/unit/lib/database/repositories/conversation-chunks-clear-embeddings.test.ts`; `help/data-retention.md` documents the warmth window.

#### A custom tool run from the composer rolls as your own character

Running a shared or global custom tool from the composer's Custom Tools button tested the **first participant's** fact sheet, not the character the operator is playing. In a chat created leading with an LLM character, a metadata-gated table therefore dealt someone else's branch — plausibly, with a well-formed result and no error. The only record of what was consulted was `pascalMeta.metadataTested`, which no screen shows.

- `handleList` in `app/api/v1/chats/[id]/custom-tools/route.ts` emits one row for a tool every participant resolves to the same file, and has to record a perspective on it because POST reads that character's fact sheet for `when.metadata` and their groups for `$state`. It took `sightings[0]` — `loadPerspectives` walks `chat.participants` in stored array order and did not prefer the operator's own `controlledBy: 'user'` character.
- New `preferOperator` picks the operator's own played character instead: the one named by `activeTypingParticipantId` first, then their remaining user-controlled participants in stored order. Removed participants are not candidates.
- When none of the operator's characters is a candidate — an all-LLM room, or a tool whose `availableWhen`/`withheldWhen` gate their character did not pass — the row falls back to stored order as before, but is now **labelled** with the character it will run as, using the same `characterLabel` the per-variant listing already uses. Silently succeeding as whoever passes a gate you failed was the sharpest edge of this bug. A one-character room stays unlabelled; there is nothing to disambiguate.
- POST's `asCharacterId`-less fallback uses the same preference. It consults no fact sheet either way (that path deliberately rolls against `{}`), so this only decides which definition of a shadowed name gets dealt.
- Unaffected, and deliberately unchanged: a character rolling mid-turn via `run_custom`, which reads `context.characterId`; and a tool that resolves differently per character, which still lists one labelled row per variant and runs as the character on its label.
- New: `__tests__/unit/app/api/v1/chats/custom-tools-perspective.test.ts` (10 cases). Checked against the pre-fix code: six of them fail there.

Found by a quilltap-v5 dogfood walk rather than by its differential harness — the harness could not have found it, because v5 ports the same logic line for line and both sides agree. v5 records it as finding #30 and must take the same change in the same round. Detail: `docs/developer/found-bugs.md`.

#### Import can read its own export of a document-store blob over 3 MB

Importing a `.qtap` export that carried a document-store attachment larger than `BLOB_CHUNK_BYTES` (3 MB) failed with `doc_mount_blob_chunk received without preceding doc_mount_blob`. The export was written by Quilltap itself and reported no error.

- The chunk accumulator in `lib/import/quilltap-import-stream.ts` is a pre-sized sparse array (`new Array(chunkCount)`), and the completion test used `Array.prototype.every`, which skips holes and therefore returned `true` as soon as the first chunk landed. The importer joined what it had — holes render as `''`, so the blob was silently truncated — pushed the result, and deleted the accumulator. The next chunk then arrived with nothing to join and threw.
- The completion test now counts arrivals against `chunkCount` instead. A genuinely short stream reaches the end-of-stream truncation error that already existed at the bottom of the function and was unreachable because of this bug; it names the blobs and the chunks received vs. expected.
- Blobs at or under 3 MB are a single chunk and were never affected.
- Reader-side only. The writer is untouched and its bytes do not change, so archives stay readable in both directions.
- `BLOB_CHUNK_BYTES` gains a comment recording why it must stay a multiple of 3: chunks are base64-encoded separately and rejoined encoded, so only the last may carry padding. The writer's module header said "~4 MB chunks" where it meant 3 MB raw; corrected.
- New: `__tests__/unit/lib/import/quilltap-import-stream-blobs.test.ts` (7 cases — multi-chunk reassembly, interleaved blobs, truncation reporting, and the two throws that must still fire).

Found by the same quilltap-v5 differential pass as the restore fix above; its `system_import_equivalence` case stops diverging and the `throw_ndjson_truncated_blob` entry comes off the expected-divergence list.

#### Restore actually restores files and document stores

Three defects in the restore path, all on the data-loss side, all fixed together — any one left standing keeps the others unobservable.

- **Mount points and file links were rejected wholesale.** `dumpMountIndexTable` (`lib/backup/backup-service.ts`) is a raw `SELECT *`, so the archive carries SQLite storage types: `includePatterns`/`excludePatterns` as JSON text and `enabled`/`allowEmbed`/`allowCharacterRead`/`allowCharacterWrite` as INTEGER 0/1. The repository schemas demand `string[]` and `boolean`, so every `doc_mount_points` and `doc_mount_file_links` row was refused. Failures were per-row warnings and the restore still reported success; the damage showed up later as unreachable character vaults, project stores and group stores. Fixed on the **restore** side (new `lib/backup/restore/mount-index-coercion.ts`, applied at steps 22a and 22d) so archives users already hold are repaired — a backup-side fix would leave every existing archive unrestorable. The coercion tolerates already-correct input: JSON parsed only when the value is a string, booleans coerced only when the value is a number.
- **The file lookup gated on `backupFormat === 2`.** The storageKey layout landed in format 2 and modern manifests declare 4, so every archive newer than the one that test was written for fell through to the pre-format-2 layout it does not use, and no file was found. The gate is a floor (`>= 2`) now, and the `triedPaths` diagnostic derives from the same predicate rather than restating it. No other `backupFormat ===` comparisons exist in the tree.
- **The files phase ran before anything could receive the bytes.** Files were step 5 of the dependency-ordered list. At that point a project-bound file has no project store (projects restore at 13) and a project-less file has no Quilltap Uploads mount (`deleteUserData` truncates `doc_mount_points`; the `instance_settings` pointer survives and dangles until 22a). The block now runs as step 22a-bis, immediately after the mount points are back. Ordering only — no write behavior changed, and the block's internals are byte-identical. The order was correct for an in-place restore over a populated instance, which is why this survived; it failed exactly on the fresh or wiped target that restore exists for.
- New: `__tests__/unit/lib/backup/mount-index-coercion.test.ts` and `__tests__/unit/lib/backup/restore-archive-file-lookup.test.ts`.

Found by the quilltap-v5 native port's differential harness, which runs every ported unit against v4's real `lib/` code. The v5 side asserts these divergences in both directions, so its `system_restore_state` differential will now report the upstream fix and needs its divergence entry retired. Plan, fix sites, and a known residual case for second-generation archives: `docs/developer/found-bugs.md`.

#### Docs: 4.8.0 release notes cover the work that landed after they were drafted

`docs/releases/4.8.0.md` was written on 2026-07-20; nineteen commits landed after it. One passage had become factually wrong and several user-visible features were missing.

- **Corrected:** the math section stated that single-dollar math is deliberately disabled, which the single-`$` promotion fix reversed. It now describes the marker test, the currency carve-out, and the bare-symbol rule.
- **Corrected:** "Upgrading from 4.7" enumerates migrations by name and was missing `add-episodic-memory-fields-v1` and `anchor-fictional-clock-base-v1`. Both are now documented with what they backfill.
- **Added:** the episodic recall overhaul (event time, narrative time, entities, episodic vs. semantic, the fold-time episode pass and dated Timeline, retrospective retrieval, recall-on-reference, the `search`/`read_conversation` additions, the anti-destruction policy changes, `recall-replay`) as a new subsection. The existing "Recalls More Aptly" subsection covers only the ranking rework and was the sole memory coverage.
- **Added:** the Story's Clock timeline switch plus the frozen fictional-clock and timezone fixes; Pascal's `availableWhen` / `withheldWhen` tool gating and the Workbench's gate control; the two-phase composer run dialog and the state-tinted roll announcement; per-character Starting Outfit defaults, `canChooseOutfit`, the full picker roster and the Play As restriction; the themeable thinking indicator with Madman's Box's small caps and button fix; the Self-Dressing / Outfit Creation persistence fix under Selected Fixes.
- **Framing:** the thesis paragraph now names four bodies of work with memory as the third; the frontmatter description, the closing paragraph, and the memory section header were updated to match.

`pubDate` and the sign-off date are left at 2026-07-20 — that is a release-timing decision. Not written up: the lint-rule tightening, debug-log prune, dead-code sweep, DRY refactors, docs-freshness passes, Workbench backdrop theming, and the `.qtap` ephemeral-state strip (all internal or release hygiene), and the workspace deep-link commit (the notes already promised that behavior; the commit made it true). Docs-only; no code changed.

#### Pascal's announcement bar carries the outcome's state

A roll's `state` (`success` / `partial` / `failure` / `info`) tinted the outcome bubble but not the bar above it, which showed the generic importance dot — and Pascal's importance tier is `high`, so a successful roll wore the same red dot as a deleted file.

- The bar (and, defensively, a collapsed chip) now takes the `qt-pascal-result` / `qt-pascal-result--<state>` accent already used by the Workbench's outcome rows and the proving bench's preview, so one outcome reads the same wherever it is shown.
- The importance dot is replaced by a state dot filled with the solid `--qt-alert-*-fg` token; the alpha-thin `-border` tints used for the leading edge disappear at 8px. The state is also announced as visually-hidden text, so it is not carried by colour alone.
- Keyed off the presence of a usable `pascalMeta.state`, not the `systemKind`: a roll record predating the field, or a state a future build introduces, falls back to the importance dot. Prospero's `custom-tool-error` chip carries no roll record and is untouched.
- New in `_chat.css`: four `.qt-chat-announcement-dot-outcome-*` classes, plus compound `.qt-chat-system-bar.qt-pascal-result*` / `.qt-chat-announcement-chip.qt-pascal-result*` selectors that restate the existing accent at a specificity the wrappers' `border`/`padding` shorthands can't overwrite. No new tokens; bundled themes need no change.
- **`@quilltap/theme-storybook` 1.0.49 → 1.0.50.** Its `qt-components.css` had no Staff-announcement block at all, so mirroring the accent meant filling the pre-existing hole first: the `--qt-chat-system-bar-*` and `--qt-chat-announcement-dot-*` tokens (light and dark), the `.qt-chat-system-bar*` / `.qt-chat-announcement-*` classes, and then the new outcome dots and compound accents. `Chat.tsx` gains two showcase sections — **Staff Announcements** (bar, packed chip row, three importance dots) and **Pascal Roll Outcomes** (all four states, bar and bubble together), the latter being the first time the storybook showed `qt-pascal-result` at all.

#### Custom tools can be gated on the invoking character's metadata

Outcome tables could already branch on `when.metadata`. A definition can now decide whether a character is offered the tool at all, via two new optional top-level keys — at most one per file.

```json
"availableWhen": { "metadata": { "toolAbilities": { "contains": "programmable" } } }
```

- **`availableWhen`** offers the tool only to an invoker whose `metadata.json` passes every test; **`withheldWhen`** withholds it from one that passes. Tests are written exactly as an outcome's `metadata` clause, and AND together.
- **Metadata is the only subject, and operands must be literals.** A gate is evaluated before the roll, so there are no resolved parameters and no consult; `$param` and `$state` operands are load-time rejections here.
- **Enforced at roster resolution**, so a withheld tool is absent from the `run_custom` description, absent from `GET /api/v1/chats/[id]/custom-tools`, and unrunnable by name through either entrance.
- **Fail-soft, so the two clauses are not complements.** A key the character lacks never matches: an empty fact sheet fails every `availableWhen` and satisfies no `withheldWhen`. `withheldWhen: {x: {eq: true}}` and `availableWhen: {x: {neq: true}}` differ precisely on the character with no `x`.
- **A gated-out definition does not claim its name** — not even as a `disabled` tombstone — so a farther tier may still supply one. A character-vault variant gated to qualifying characters plus a General-store fallback is now a working arrangement. The gate is evaluated before `disabled` for this reason.
- Declaring both clauses is rejected at load: they are not complements, and the Workbench's single control cannot represent both.

New modules: `lib/pascal/tool-gate.ts` (the evaluator, client-safe) and `lib/pascal/metadata-match.ts` — the fail-soft comparison table, now shared by the outcome evaluator and the gate rather than implemented twice. `RosterContext` gains `metadata`; all three callers pass the sheet they already hold, and a caller that doesn't triggers a lazy vault read only when a gated definition actually turns up.

**Pascal's Workbench** gains a **Who may reach for it** section at the top of the recipe (Anyone / Only show if… / Do not show if…), a `gated` badge in the library, and a proving-bench line reporting whether the loaded fact sheet would have been dealt the tool — computed live for a hand-typed sheet, returned with the roll for a character's real one. The bench still deals either way: a gate decides who is offered a tool, not whether its author may test one.

`collectToolVocabulary` now reports a gate's metadata keys alongside the table's, so the run dialog names what a tool reads without naming what opens the door.

#### The composer's custom-tools popup is now a two-phase dialog

The wand button in the composer gutter opened a 288px-wide upward popover with every tool's parameter form nested inside an accordion. Filling one out was cramped, and any click outside dismissed it. It now opens a cancellable modal (`components/chat/CustomToolRunDialog.tsx`).

- **Two phases.** Phase one lists the roster — description, source store and path, a wrench to open the file on Pascal's Workbench, and a search box once there are more than six tools. Selecting a tool replaces the dialog body with that tool's form; "Choose another tool" returns to the list.
- **What it remembers is unchanged in kind and wider in scope.** Parameter values and the privacy toggle are still held per tool for as long as the composer stays mounted; the selected tool is now remembered too, so reopening lands on the last tool used with its values intact. The selection is *derived* from the roster rather than stored, so a tool that is renamed, disabled, or shadowed between opens drops the dialog back to the picker instead of stranding it.
- **New reference panel: "What this tool can quote."** Lists the placeholders the selected tool *actually uses* — every row is an occurrence in the definition's own outcome messages or oracle prompt, not merely something the format permits. A dice-form tool that never writes `{{dice}}` isn't offered it; a declared parameter appears only if some message quotes it back; a tool that quotes nothing gets no panel. It states explicitly that these belong to the definition's own messages and are *not* substituted into what the operator types, which is sent verbatim.
- `GET /api/v1/chats/[id]/custom-tools` listings gain `references: { value, roll, dice, llm, params, metadata, state }`, derived by the new `collectToolVocabulary` (`lib/pascal/tool-vocabulary.ts`) from outcome messages, the `llm` prompt, `when.metadata` keys, and `$state` references anywhere in the definition. This is vocabulary, not odds: it names what a tool reads and says, never what it concludes. Roll specs and outcome tables remain withheld.
- `CustomToolParamsForm` gains `layout="stacked"` — label, description, and declared bounds on their own lines. String parameters render as an auto-growing textarea (fits its content from one line to 224px, then scrolls) rather than a single-line input: nothing in the definition format declares an expected length, so the field sizes itself instead of guessing. Numbers keep a narrow number input. The default `inline` layout is unchanged, so the Workbench's proving bench is untouched.
- Section panels in the dialog are explicit padded cards. They had been `border-t qt-border`, and since `.qt-border` sets all four sides that rendered as a box with no internal padding — text flush against the frame.
- Panel order is form → **Roll privately** → reference panel: the privacy toggle is the last decision about the run, and the panel below it is reading matter rather than a control.
- `CustomToolsDropdown.tsx` is replaced by `CustomToolsButton.tsx` (button + dialog). The now-unused `.qt-composer-gutter-dropdown` positioning class is removed from `_chat.css`.

#### Fictional story clocks were frozen, and read the base in the wrong timezone

Two bugs in `lib/chat/timestamp-utils.ts`, both visible as the Host announcing the same in-story moment on every turn.

**The clock never advanced.** Fictional time runs 1:1 with the wall clock, measured from `timestampConfig.fictionalBaseRealTime`. Nothing ever wrote that field — its only writer, `initializeFictionalTime`, had no callers outside its own unit test. `calculateCurrentTimestamp` fell back to `new Date()`, measured ~0ms elapsed, and re-reported the configured base instant forever. Every fictional-time chat ever created was affected.

- `ensureFictionalBaseRealTime(config, anchor?)` replaces the uncalled `initializeFictionalTime`. It stamps the anchor only when the clock is fictional, has a base, and is not already anchored — re-stamping a live chat would reset it to the base.
- `POST /api/v1/chats` runs the resolved config through it. Chat creation is where a config stops being a default and starts being a running clock; Salon- and character-level defaults are deliberately left unanchored, since a default saved months ago carries no meaningful anchor.
- Migration `anchor-fictional-clock-base-v1` backfills existing chats from each chat's own `createdAt` — the instant its base was chosen, so story time resumes where 1:1 tracking from chat creation would have put it rather than lurching. Only touches rows with fictional time on, a base set, and no anchor; unparseable configs are skipped rather than rewritten.

**The base was read in the server's timezone.** `fictionalBaseTimestamp` is a zone-less `datetime-local` string, so `new Date("1550-07-25T10:15")` resolved it against the server's zone before rendering it in the story's. A base of 10:15 set for `Europe/Istanbul` displayed as 6:01 PM on an `America/Chicago` host — the two 1550 LMT offsets differing by ~7h46m. New `parseTimestampInTimezone(value, timezone)` anchors zone-less strings as wall-clock readings in the target zone, resolving iteratively because the offset depends on the instant being solved for (DST, and pre-standardisation LMT offsets carrying seconds). Strings with an explicit zone (`…Z`, `…+05:30`) pass through untouched.

Known limitation, pre-existing and left alone: `CalculatedTimestamp.isoValue` truncates the UTC offset to whole minutes, so it is off by up to 59s for pre-standardisation timezones. Display formatting is unaffected.

Both misleading strings in `TimestampConfigCard` are corrected — the card promised the clock "advances with each message" and would "advance based on message activity", neither of which it has ever done.

#### Lint: the project-name misspelling rule now checks identifiers and comments

`quilltap/no-quilltap-misspelling` only visited string literals and template chunks, so a misspelled *identifier* was invisible to it. It now also visits identifiers, private identifiers, JSX names, JSX text, and comments. `eslint-quilltap-plugin.js` is exempted from its own rule in `eslint.config.mjs` — the implementation has to spell the forbidden word in order to match it — which replaces the two inline disable comments that no longer covered enough of the file.

The gap had been hiding a real test bug. Two "simulate restart" blocks in `__tests__/unit/lib/startup/dbkey.test.ts` deleted a misspelled variant of the `__quilltapDbKeyState` global, so they cleared nothing and left the previous state in place; the assertions passed, but not via the restart path they described. Both now delete the real global.

#### Deep links that used to escape the tabbed workspace now open as tabs

Several routes still rendered the legacy full-page shell when reached by direct URL (bookmark, address bar, or an unintercepted link), instead of redirecting into the tabbed workspace like `/salon/[id]`, `/aurora`, and the other cut-over routes:

- **`/salon` (the all-chats list)** had no workspace representation at all — a new `salon-list` tab kind renders `SalonListView`, and the left rail's "Chats" item and the home page's "View all" link now open it as a tab instead of navigating away (which unmounted the workspace and killed any streaming conversation).
- **`/prospero/[id]`, `/scriptorium/[id]`, `/aurora/groups/[id]`** now redirect into their singleton list tab drilled into the target detail. The list tabs accept an optional payload (`projectId` / `storeId` / `groupId`); in-workspace links to those paths are intercepted the same way.
- **`/aurora/[id]/view`** now redirects into a `character-view` tab (the kind existed but the intent layer never accepted it), carrying the `?tab=` sub-tab and popping the new-chat modal for `?action=chat`. Bare `/aurora/[id]` became a server-side redirect to `/view` (was a client-side flash).
- **`/salon/new`** redirects into the workspace and pops the new-chat modal (project/character/autonomous params preserved) instead of rendering the full-page form.
- **`/salon/[id]/terminal/[sessionId]`** redirects into the workspace, opening the conversation's Salon tab plus a child terminal tab (the Salon is the portal source for the live PTY, so the terminal tab is never an empty husk).

All the old pages still render when the workspace is disabled (`NEXT_PUBLIC_WORKSPACE_TABS=0`); the affected client pages were split into server redirect wrappers plus `*PageClient` bodies.

#### The streaming quill is now a themeable icon

`QuillAnimation` — the quill that rocks while a reply is awaited, while tokens stream, and while a tool call is outstanding — hard-coded `<Image src="/quill.svg">` and defined its keyframes in a styled-jsx `global` block, so themes could change neither the glyph nor the motion. It now renders `<Icon name="thinking">` and carries the new `.qt-thinking-indicator` class.

- **New icon: `thinking`** (registry entry #85), mask mode, default asset `public/images/icons/thinking.svg` — a new 24×24 line-art quill in the existing icon style, replacing the 125 KB full-colour brand illustration at this call site. Deliberately a separate name from `brand`: a theme that swaps the brand mark for a wordmark should not find that wordmark rocking in the Salon.
- **Mask mode means it tints.** The indicator now inherits `currentColor`, so the `qt-text-secondary` classes already present at three call sites — and the composer status strip's per-stage colours — reach it for the first time.
- **New class `.qt-thinking-indicator`** (`_chat.css`) owns the motion, parameterized by `--qt-thinking-duration`, `--qt-thinking-easing`, `--qt-thinking-origin`, `--qt-thinking-angle-rest`, and `--qt-thinking-angle-lean`. Themes can retune those or re-declare the class for a different animation entirely.
- **The quill now pivots on its nib rather than its centre.** `--qt-thinking-origin` defaults to `12.5% 87.5%` — (3,21) of the glyph's 24×24 viewBox, the point that would be touching the page — so the nib holds still and the feather swings above it, instead of the whole quill wobbling around its middle. At the upright extreme the tip paints ~8px above the 48px indicator's layout box; nothing clips it, and no call site needed adjusting. A theme overriding the glyph must move the origin to that glyph's own nib.
- Added a `prefers-reduced-motion: reduce` branch, which the old animation lacked.
- The wrapper element changed `<div>` → `<span>`, valid where the small variant renders inline inside streamed prose.
- `QuillAnimation` gained a `label` prop (default `"Writing…"`, matching the old `alt`); the composer status strip and the pending-tool-call summary now pass `label={null}`, since both sit inside already-labelled regions and were being announced twice.
- `@quilltap/theme-storybook` 1.0.49 lists `thinking` in its Icons story. `ICON_INVENTORY.md` gains a section on the two hooks; `THEME_PLUGIN_DEVELOPMENT.md` documents the override recipe.

**Madman's Box (1.1.7) is the first theme to use both hooks.** It maps `thinking` to `icons/brand.svg` — its own quill inside a circle that never quite closes, the same drawing as the brand mark — and replaces the rock with a slow 6s linear full revolution, resetting `--qt-thinking-origin` to `center center` because that glyph's ring is centred on the box rather than pivoting from a nib. The theme's existing global reduced-motion rule already covers the new animation.

#### Madman's Box: small-caps headings, and buttons that stop shouting

Headings (`h1`–`h3`) used `text-transform: uppercase`, which flattened capitals and lowercase into identical glyphs — "Charles Sebold" was indistinguishable from "CHARLES SEBOLD". They now use `font-variant-caps: small-caps`, so capitals keep their full height and lowercase renders as small capitals. Raleway ships no `smcp` table (its only OpenType features are `liga`, `kern`, and `lnum`), so browsers synthesize the small caps; heading weight went 300 → 400 because synthesized small caps read light next to full-size capitals. Heading letter spacing tightened from 0.14em to 0.1em to suit the narrower glyphs.

The theme's button rule was keyed to the `button` element, but most buttons in the app are `<Link>`s wearing `.qt-button`. The rule therefore uppercased only the few real `<button>` elements and left their neighbors untouched, which was visibly inconsistent within a single row — the homepage quick actions rendered "NEW PROJECT" beside "Start a Chat", and "Continue Last" would have flipped to uppercase in its disabled state. The rule is now keyed to `.qt-button` and no longer uppercases, so buttons throughout the theme render their labels as written. Theme bumped to 1.1.6.

#### Salon: timeline-mode switch in the chat sidebar ("The Story's Clock")

The per-chat `timelineMode` flag from the episodic recall overhaul ('realtime' | 'narrative', NULL reads as realtime) previously had no UI and could only be set via the API or CLI. The chat sidebar's Chat card now has a "The Story's Clock" selector with Real time / Story time options, persisted through the existing chat PUT route (`timelineMode` was added to `updateChatSchema`). Updated `help/episodic-memory.md`, which said a switch was on its way.

#### Episodic recall overhaul: memories learn when and where things happened

Characters could not answer "remember that place we visited last week?" — the memory system had no concept of an episode. This overhaul adds one, end to end:

- **Episodic spine (schema).** Memories gain `occurredAt` (ISO event time, distinct from the write clock), `narrativeTime` (free-text in-story time for fictional timelines), `entities` (proper nouns of the episode), and `kind` (`semantic` | `episodic`). Chats gain `timelineMode` (`realtime` | `narrative`). Migration `add-episodic-memory-fields-v1` adds the columns, indexes `occurredAt`, and backfills event time from each memory's source message (falling back to the memory's own `createdAt`). All new fields ride `.qtap` export/import.
- **Extraction knows the clock.** The per-turn extractor now receives the current date/time and the chat's timeline mode, can emit EVENT memories (`kind: "episodic"` with `when` + `entities`, earning one extra candidate slot), and relative phrases like "last spring" are resolved server-side against the turn's timestamp. A deterministic date/proper-noun fallback fills anchors the model omits. Reinforcement can now upgrade an episodic memory's anchors when a retelling supplies better ones.
- **Fold-time episode pass.** On the existing summary-fold cadence, a cheap-LLM pass consolidates the folded window into 0–2 coherent, dated episode records per present character, linked to that window's per-turn fragment memories for one-hop expansion. The fold summary itself gains an append-only, dated **Timeline** section (capped ~30 lines, oldest coarsened first), turning vault conversation summaries into a dated episodic archive.
- **Time- and entity-aware retrieval.** The per-turn recall distillation additionally emits `retrospective`, an absolute `timeRange`, and `entities` (all inert on parse failure). Retrieval consumes them: a two-stage event-time window (filter first, bounded ×1.3 boost fallback — never fewer results than before), literal entity anchoring into the candidate pool, and up-to-3-probe embedding union on retrospective turns. On retrospective turns the `temporal: past` multiplier flips from 0.85 to 1.15, `moment` stops being penalized, and the anti-repetition penalty is suspended (an immediate re-ask no longer buries the memory being asked about). Vault conversation-summary search now reads `firstMessageAt`/`lastMessageAt` from frontmatter, filters/boosts by time range, and renderers print conversation dates.
- **Recall-on-reference (fourth cadence).** A retrospective turn gets an enlarged dynamic head (600 tokens / 10 entries, up from 200/5) and a scoped mini-recap whisper (`retrospective-recall`): a dated Relevant Past Conversations list with `read_conversation` UUIDs, spam-guarded by a signature ring buffer and deduped against the standing on-fold list. Dynamic-head entries now carry `[3 days ago]`-style age labels computed from event time, plus in-story time when present.
- **Deep-dive tools.** Removed the dead `memory-search` tool that shadowed the canonical Scriptorium `search` name. `search` gains `since`/`until` (applied to memories via `occurredAt ?? createdAt` and to conversation hits via chat timestamps) and `aboutCharacter`; memory results now return `occurredAt`, `narrativeTime`, `kind`, and the source `conversationId`. `read_conversation` gains `interchange_start`/`interchange_end` for slicing long transcripts. Tool instructions now state the anti-confabulation norm: search, then read the conversation, and say "I don't recall" rather than inventing specifics.
- **Stop destroying episodes.** The memory-compression prompt no longer instructs dropping exact dates (it now preserves dates attached to events). The memory gate embeds a `(when: … · place: …)` anchor line and downgrades near-duplicate/reinforce decisions to insert-related when event times differ by more than 7 days — distinct occasions both persist; housekeeping's `mergeSimilar` honors the same guard. Episodic rows get a +0.10 housekeeping protection bonus.
- **Replay harness.** New `quilltap recall-replay <chatId> [--turn N]` CLI (wrapping `POST /api/v1/chats/[id]?action=recall-replay`) replays a turn's recall and prints the full candidate table — cosine, blend, every multiplier fired, final score, head selection — old path vs. new path side by side, resolving the clock against the replayed turn's own date.
- Also: jest now runs inside Claude Code agent worktrees (the worktree-exclusion patterns are skipped when the root itself is a worktree), and stale comments describing the old 0.4/0.6 ranking blend and pre-overhaul gate thresholds were corrected.

#### New Chat: smarter per-character Starting Outfit defaults

Characters gained a `canChooseOutfit` boolean in their vault `properties.json` (absent means false). It drives the default Starting Outfit selection in the New Chat dialog, which is now decided per character instead of using one blanket default:

- Continuation chats still default every character to "Same as last conversation" (unchanged).
- An LLM-controlled character with `canChooseOutfit: true` now defaults to "Let character choose".
- Otherwise the character defaults to "Use defaults" only when they actually have a usable default outfit (at least one non-archived default wardrobe item). A character with no default outfit configured instead defaults to "Compose outfit" and opens with its section expanded.

Each character's collapsed "Starting Outfit" header now shows the selected option ("Defaults", "Composed", "Dress Themselves", "Undressed", or "Same as Last") next to the name, so the choice is legible without expanding the section.

`canChooseOutfit` is editable from the character's Wardrobe tab on the Aurora page (both the detail view and the edit view), as a checkbox just above the "Open wardrobe" button. It saves immediately to the vault. The character PUT route (`PUT /api/v1/characters/[id]`) now accepts the field in its request schema.

#### Fix: Self-Dressing and Outfit Creation character toggles now persist

The Aurora character editor's "Self-Dressing" and "Outfit Creation" dropdowns (the `canDressThemselves` and `canCreateOutfits` wardrobe-permission flags) silently failed to save. The character PUT handler validates the request body with a Zod schema that strips undeclared keys, and those two fields were never added to the schema, so their values were dropped before reaching the database — even though the UI showed a success toast. Both fields are now declared in the update schema and flow through to the character row. They are real DB columns, not vault-managed fields, so no migration or vault change was needed. The other tri-state values (`null` = inherit the global default, `true`/`false` = per-character override) are preserved.

#### New Chat: full character roster in the picker; Play As limited to the cast

The "Select Characters" list in the New Chat dialog now shows every character, including default-user (user-playable-by-default) personas that were previously hidden from it. The "Play As (Optional)" dropdown in Character Customization now offers only characters that are in the cast, instead of also pulling in default-user personas that were not added. To play as a persona, add it to the cast from the picker first, then select it in Play As. Reverting a persona back to "Chat as yourself" now keeps that character in the cast under LLM control (it is no longer removed).

#### Docs: API.md now covers every v1 route; README documents the workspace and Pascal

Release documentation-freshness pass. `docs/developer/API.md` was missing sections for a number of live `/api/v1/` routes; all are now documented, and the table of contents was updated to match. New sections: Groups (full CRUD, membership, and store-linking — previously only Group State was covered), a tiered Scenarios section (general/project/group), Character Photos, the user Photo Gallery, chat-scoped message send/stream plus the `[messageId]` actions, Text Replacement Rules, project mount-points and wardrobe, the `chats/[id]/qtap-target` streamer, and six System endpoints (home, autonomous-rooms, browse-directory, conversation-summaries, image-aesthetics, startup-status). Also documented the item endpoints for plugins, themes, and help-docs, and the wardrobe avatar-preview/transfer routes. `README.md` gained a Workspace section (the tabbed two-pane shell) and Pascal the Croupier / custom-tools coverage in the Gaming section. Docs-only; no code changed.

#### Docs: Documented the `file-verify` subcommand in the CLI package README

Release CLI docs pass. `packages/quilltap/README.md` was missing a section for the `file-verify` subcommand (it was the only subcommand absent from the package README; `CLI.md` and all three shell-completion scripts already covered it). Added a File Verification section describing the command, its `--all` / `--stall-ms` / `--json` flags, the top-level-only scope, and the macOS-only caveat. Docs-only; no code or CLI behavior changed this cycle.

#### Fix: .qtap export no longer carries ephemeral Commonplace Book state

Release backup/export completeness pass. The `.qtap` chat export spread the whole chat row, which pulled in two ephemeral per-chat fields: `commonplaceRecallHistory` (the Commonplace Book recall anti-repetition ring buffer) and `commonplaceSceneCache` (the per-target scene-state emission cache). Both are instance-local, regenerable UX state that should not travel between instances; `commonplaceRecallHistory`'s schema contract already declared it out of scope, and `commonplaceSceneCache` is now documented the same way. Both are stripped at the export writer. Instance backup/restore is unaffected and still preserves both fields. No schema change: `qtap-export.schema.json` never listed either field, and the export now matches.

#### Maintenance: Themed the Pascal's Workbench dialog backdrops

Release `qt-*` theme-class pass. The Workbench's destination picker and save-conflict dialog used a hard-coded `bg-black/40` backdrop; both now use the standard `qt-dialog-overlay` class, so themes control the backdrop color (and the dialogs sit at the standard dialog z-index). No new `qt-*` utilities were needed; all other components changed since 4.7.0 already use themed classes.

#### Maintenance: Pruned release-scaffolding debug logging

Release debug-logging pass. Removed 47 ceremonial `logger.debug` calls added during 4.8 development — happy-path "did X" narration (roster resolved, standalone document opened/saved/renamed/deleted, creation-progress stream lifecycle, merge started, home-dashboard payload build, `state.json` seeded/written, etc.) across 24 backend files in the chat, API-route, Pascal, services, and mount-index paths. Kept the ~23 diagnostic debug logs that fire in non-obvious branches (refusals, missing config/state, "did not match", dropped writes). Dropped the now-unused `logger` imports in five files and removed four empty blocks / unused vars left behind. No behavior change.

#### Maintenance: Dead-code sweep — removed superseded qtap:// link chain

Release dead-code pass (knip). Removed the original `qtap://` document-link renderer `QtapDocLink` and its private support chain (`QtapDocContext`/`useQtapDoc`, plus the `qtapDocOpener` memo and `QtapDocContext.Provider` in the Salon view). It was fully superseded by `QtapLink`/`QtapLinkContext`/`QtapLinkProvider`, which is what the message renderer already uses. No behavior change. Updated `knip.json` to ignore the transitive test-only `@anthropic-ai/sdk` dependency and the legitimate `ps`/`tasklist`/`du` runtime binaries. Kept the two in-progress SVAR file-manager files flagged by knip (pre-built ahead of their wiring phase).

Behavior-preserving DRY/single-source refactors across the backend, no functional change:

- `rng` tool bounds now import the shared dice constants from `lib/pascal/dice-notation.ts` instead of restating the literals.
- `lib/memory/memory-weighting.ts` extracts `referenceTimeMs()`, sharing the `max(createdAt, lastReinforcedAt)` decay-reference calculation across its three call sites.
- `isVisibleConversationalTurn` is exported once from `core-whisper-trigger.ts`; the byte-identical copy in `skip-signal.ts` was removed (both stay client-safe).
- Wardrobe tool handlers share `findEquippedSlots`, `notifyWardrobeChanged`, `wardrobeItemNotFoundMessage`, and `formatWardrobeMutationResults` via `wardrobe-handler-shared.ts` instead of per-handler copies.
- `image-generation-handler.ts` shares `buildCheapLLMConfigFromSettings` across its three cheap-LLM config blocks.
- `message-formatter.ts` extracts `buildNamePrefixedContent`; `cheap-llm.ts` extracts `selectionFromProfile` for its three identical selection blocks.
- `turn-manager/state.ts` extracts `advanceSpokenThisCycle`, shared by the after-message and after-skip cycle updates.
- `vault-overlay/parsers.ts` extracts a generic `parseJsonVaultFile<T>`; the four JSON parsers delegate to it.
- `database-store.ts` imports `detectNativeText` from `path-utils.ts` instead of keeping a duplicate file-type detector.
- `whisper-handler.ts` resolves each participant's character once instead of re-querying to build the available-names list.
- Chat participant action handlers share `resolveParticipantCharacterName` from `helpers.ts` instead of six copy-pasted lookups.

#### Fix: Single-dollar math from models now renders

Models routinely ignore the system-prompt steering toward `$$...$$` and emit standard single-`$` inline math (`$\mathcal{P}$`, `$T_{CMB}$`), which the renderer dropped as literal text because single-dollar parsing is disabled to protect dollar-amount prose. `normalizeMathDelimiters` (shared by the client and server renderers, `lib/markdown/math.ts`) now promotes a single-`$...$` span to `$$...$$` when — and only when — its interior carries a LaTeX marker (a backslash-command, a `_`/`^` script, or braces). Currency amounts and paired prose amounts (`He slid $50 ... then $20`) carry no such marker and are left untouched; the promotion runs inside the existing code/`$$`-region skip, and a rejected pair releases its closing `$` so a leading currency amount can't consume a following formula's opening delimiter. A bare single token (`$K$`) carries no marker of its own and is promoted only when a marker span shares its line — so a symbol renders alongside the formula it belongs with, while a bare token standing alone stays literal (letter-anchored, so a lone `$5$` never qualifies). The system-prompt note (below) stays as belt-and-suspenders steering.

#### Maintenance: OpenRouter plugin on @openrouter/sdk 0.13

Bumped the OpenRouter provider plugin (`qtap-plugin-openrouter`) from `@openrouter/sdk` 0.12.79 to 0.13.66, matching the root. Updated `getAvailableModels` for 0.13's paginated `models.list()` (models now under `page.result.data`, iterated across pages) and narrowed the non-streaming `chat.send()` result to `ChatResult` for the new union return type. The `chat.send`/`fromChatMessages`/streaming surfaces are otherwise unchanged.

#### Maintenance: Dependency updates

Ran `npm update` across the root project, all packages, and all distributed plugins. Notable in-range bumps: `openai` 6.44 → 6.48, Next.js 16.2.9 → 16.2.10, TanStack Query 5.101.0 → 5.101.2, Storybook 10.4.6 → 10.5.2, plus patch bumps to katex, jsonrepair, tar, ws, tsx, eslint, postcss, playwright, and others. All 14 plugins rebuilt.

`@openrouter/sdk` moved 0.12.79 → 0.13.66 (used only by the pricing fetcher). Its `models.list()` now returns a paginated async-iterable with models under `page.result.data` (was `response.data`); `fetchOpenRouterPricing` was updated to iterate pages.

#### Improvement: Characters are told how to write math

Every character's system prompt now carries a universal math-notation note (appended in `buildSystemPrompt`, independent of the selected roleplay template) telling the model to wrap LaTeX in double-dollar `$$...$$` — the only delimiter the renderer recognizes — and not to use single-dollar `$x$`, quotes, or backticks. Without it, models defaulted to single-`$`/quote habits and their formulas rendered as literal text. The cache-determinism golden hash was updated for the new prompt content.

#### Feature: Cascading state — chat → project → group → general

Persistent state (Pascal's subsystem) extends from two tiers to a four-tier cascade. Merge is shallow, top-level, narrowest-wins: `{ ...general, ...group, ...project, ...chat }`.

- **General (instance-wide) state** is new: a `state.json` document at the root of the "Quilltap General" mount (`instance_settings.generalMountPointId`), seeded idempotently at startup (`ensureGeneralStateFile`, instrumentation PHASE 3.4b — creates `{}` when absent, never heals edited content). Accessors `readGeneralState`/`writeGeneralState` in `lib/mount-index/general-state.ts` (`{}`-graceful, warn-on-corrupt). No migration.
- **Group state** now has an API, tool access, and UI (it already persisted via the group store overlay but was wired into nothing).
- New shared resolver `lib/state/state-cascade.ts` (`resolveStateCascade` + `resolveGroupForContext`), replacing the two duplicated `mergeState` helpers. The group tier merges only when exactly one group applies; with 2+ it reports `ambiguous` and is skipped from the merged view (reachable only by naming a group). Group scope is the responding character's memberships for the LLM/Pascal paths and the union across active character participants for the API/UI view. Pure path helpers extracted to `lib/state/state-paths.ts`.
- **`state` tool** gains `context: 'group' | 'general'` and an optional `group` (name or id) parameter. Fetch with no context returns the merged cascade; set/delete default to chat. Underscore user-only guard applies uniformly across all tiers.
- **API:** chat `get-state` gains `groupState?`, `generalState?`, `groupTier`; new group `get-state`/`set-state`/`reset-state` actions; new `GET/PUT/DELETE /api/v1/settings/general-state`.
- **UI:** `StateEditorModal` handles `chat | project | group | general`, shows inherited group/general layers and an ambiguous-groups notice; "Group State" button in the Aurora group editor; "General State" card in Settings → Chat.
- **Pascal `$state`:** custom tools can reference persistent state via `{ "$state": "path", "fallback": <literal> }` (fallback required — types the ref at load, guarantees run-time resolution never fails) in roll fields, comparator operands, and parameter defaults, plus `{{state.path}}` in messages and the `llm` prompt. Resolved per-entrance from the merged cascade (character scope for `run_custom` and the manual popup when a character is named; a mock `state` object in the Workbench preview/audit and proving bench). `persist` (writing state back) stays deferred.

#### Feature: LaTeX math rendering (KaTeX)

Chat messages, help documents, and Scriptorium/file Markdown previews now typeset LaTeX math with KaTeX, on both the client renderer and the server pre-render pipeline (kept in sync). Supported delimiters: `$$...$$` inline and block, plus the `\(...\)` / `\[...\]` forms LLMs commonly emit, which are normalized to `$$` form before parsing (in a shared `lib/markdown/math.ts` helper) because CommonMark strips `\(` as a character escape. Single-dollar math (`$x$`) is deliberately disabled so prose with dollar amounts ("He slid $50 across the table") is never mangled into equations. Math inside code spans and fenced code blocks is left alone; invalid LaTeX renders the raw source in red rather than failing the message. Wide display equations scroll horizontally inside the message instead of stretching it. Server-side roleplay pattern post-processing skips KaTeX subtrees so patterns like `{thoughts}` or `*action*` can't corrupt rendered math markup; those HTML post-processing functions moved to an import-safe `lib/services/markdown-postprocess.ts` (re-exported from the service) so the new behavior is unit-testable.

#### Feature: Custom-tool outcomes can test substrings with `contains`/`ncontains`

Custom-tool `when` tests gain two comparator keys, `contains` and `ncontains`, testing whether a string holds (or lacks) a substring. The substring is a non-empty string literal or a `$param` reference to a string parameter, so one input can be searched for inside another (e.g. whether the LLM consult's answer mentions `params.searchTerm`). Valid on `params` (string parameters only, both sides checked at load), `metadata`, and `llm` subjects; rejected on the bare value and `roll`, which are always numbers. Matching follows each context's `eq` precedent: exact and case-sensitive on `params`/`metadata` (fail-soft on metadata — a key that is absent or holds a non-string declines the row, including under `ncontains`), trimmed and case-insensitive on the consult's answer. Pascal's Workbench offers the two comparators on string-capable subjects with a text-only operand widget; the published JSON Schema, reference specimen, roster description (`run_custom` renders them as "contains" / "does not contain"), and help docs are updated.

Pascal the Croupier joins the Staff tab of the Insert Announcement dialog, so an operator can post a bubble in Pascal's name and avatar. Added to the client staff list, the `StaffSender` type in the announcer writer, and the server-side `staffId` enum. (Suparṇā was already selectable but missing from the help doc's roster; corrected.)

#### Feature: Custom tools can ask an LLM for a generated result

Custom-tool definitions gain an optional `llm` block: a prompt template (same placeholder families as outcome messages — value, roll, dice, params, metadata), a required author-written `errorMessage`, and an optional `maxOutput`. When present, every run renders the prompt and poses it to the instance's cheap utility model after the roll and before the outcome table. The result is a pair `{ ok, output }`: the model's trimmed answer on success (capped at `maxOutput` characters, default 8,000, up to 100,000 — the call's token budget scales with the cap so long-form consults aren't starved; `errorMessage` is never truncated), or the author's `errorMessage` on any failure (provider error, 60-second timeout, empty answer, no model configured). A failed consult never fails the run — the outcome table branches on it instead.

- New `when.llm` test subject: the six comparators against the answer (eq/neq compare trimmed and case-insensitive, trailing `.`/`!` forgiven; ordering comparators apply when the answer parses as a number and decline the row fail-soft otherwise) plus an `ok` boolean key testing whether the consult succeeded. Load-time validation rejects `llm` tests on a tool with no `llm` block.
- New `{{llm}}` message placeholder rendering the output (the answer, or the errorMessage after a failure).
- The consult resolves the standard cheap-LLM selection per call (including Concierge uncensored rerouting for dangerous chats) via a new `lib/pascal/llm-consult.ts`, injected into `executeCustomTool` (now async) as an `llmInvoke` seam. Logs under a new `CUSTOM_TOOL_CONSULT` LLM-log type. Job-child safe, so autonomous-room rolls consult too.
- `pascalMeta.llm` records the rendered prompt, `ok`, `output`, the technical failure `reason`, and provider/model. Row schema, export schema, and DDL updated.
- Pascal's Workbench: a "consulted oracle" form section (prompt + error line, both required while enabled, plus an optional answer-cap field), consult-answer and consult-succeeded condition chips, `{{llm}}` in the message insert menu, an oracle card on the proving bench (scripted answer / silence / live single-roll consult; the audit never calls live and deals against the scripted answer or silence), consult details on the test-roll debug line, and an "oracle" badge in the library.
- The published JSON Schema mirrors the new block and subject (with the documented cross-item divergence: it cannot see that an `llm` test requires an `llm` block); the annotated reference specimen demonstrates both.
- `run_custom`'s roster preamble tells models some tools consult a separate model server-side; revealed odds render `llm` clauses, and a tool with a consult is flagged — the prompt itself is never shown to scene models.

#### Feature: Pascal's Workbench — a visual editor for custom tools

Custom tools were hand-authored `Tools/*.tool.json` files with no UI. Pascal's Workbench (`/custom-tools`, also a workspace tab, left-rail entry, and links from Settings → Chat → Custom tools, the composer popup, and Scriptorium file rows) adds:

- A library view listing every definition in every enabled store — valid or broken — with store/attachment badges (General, project, group, character vault, unattached), state chips, cross-store name-collision advisories, and open/duplicate/delete actions. Broken files show the loader's own rejection reason and open straight into repair mode.
- A form builder that can only produce schema-valid output: identifier-coerced name field with title slug suggestion, parameter cards (rename rewrites all references atomically; delete lists reference sites and breaks loudly), range/dice roll forms with literal-vs-`$param` toggles and a live range readout, and an ordered outcome cascade with a pinned catch-all row, AND-composed condition chips over value/raw-roll/params/metadata subjects, duplicate subject+comparator blocking, and a message editor with a placeholder insert menu (unknown placeholders warn without blocking; `{{metadata.*}}` is never flagged).
- A proving bench: single test rolls and a 10,000-draw outcome audit, both executed server-side through the same `executeCustomTool`/`matchesWhen` core live chats use, plus a fact-sheet card (pick a character or hand-type a JSON object) for metadata-gated rows and a live JSON preview of the exact bytes a save would write.
- A JSON mode with debounced validation and unknown-top-level-key passthrough (`persist` etc. round-trip untouched), and a repair mode that can save a still-invalid file back to itself after an explicit confirm.
- A save flow using the existing mount-points file routes (no second write path): destination picker grouped by attachment with per-store duplicate-name blocking, `Tools/<name>.tool.json` naming with an optional write-then-delete file rename when a tool's name changes, and mtime conflict detection with reload-theirs/overwrite-mine resolution.
- New API resource `/api/v1/custom-tools`: GET library, GET `?action=destinations`, POST `?action=preview`, POST `?action=audit`. The chat roster GET now includes `mountPointId` per tool. New server helpers `listAllCustomTools`, `simulateOutcomes`, and `lib/pascal/workbench.ts`; `loadToolsFromMount` is exported.
- Refactors: dice-notation parsing split into `lib/pascal/dice-notation.ts` (pure, no `crypto`) so the tool schema is client-safe and the browser validates with the same Zod schema the loader uses; the composer popup's parameter form extracted to a shared `CustomToolParamsForm` used by both the popup and the bench.
- Help: new `help/pascals-workbench.md`; `help/custom-tools.md` cross-links it.

#### Fix: mount-index case-repair test loaded the SQLite mock in CI

The new `mount-index-case-repair` unit suite tried the real SQLite binding via a nested `packages/quilltap/node_modules` copy that only exists after a full local install. In CI that path is absent, so the loader fell through to a bare `require('better-sqlite3-multiple-ciphers')`, which the Jest `moduleNameMapper` redirects to the no-op mock — every query returned empty and 8 tests failed. It now requires the root `better-sqlite3` alias by absolute path (bypassing the mapper), matching the `quantize-embeddings` suite. Test-only change.

#### Docs: Pascal's Workbench spec covers the metadata test subject

The custom-tool builder spec (`docs/developer/features/custom-tool-builder.md`) was written before character `metadata.json` shipped. Updated it to cover the fourth outcome-test subject: a Metadata condition chip with a free-text key input, all six comparators (ordering ones noted as fail-soft at run time), metadata placeholders in the message editor's insert menu (never warning-underlined as unknown), a fact-sheet card on the proving bench (pick a character or hand-type a JSON object) with a `metadata` field on the preview/audit request bodies, fail-soft rules in the implementer checklist, and metadata comparators in the serialization bijection tests.

#### Docs: Pascal custom-tools spec absorbs the metadata test subject

The parent custom-tools spec (`docs/developer/features/pascal-custom-tools.md`) now documents the `when.metadata` test subject, the `{{metadata.<key>}}` template family, `pascalMeta.metadataTested`, the fail-soft run-time rules, and the roster secrecy rule — all shipped earlier by the character `metadata.json` feature but never woven into the parent spec. Its stale "not yet implemented" status line was corrected to shipped. Both annotated reference specimens (`docs/developer/CUSTOM_TOOL_SPEC.json` and `CUSTOM_TOOL_SPEC_DICE.json`) gained outcome rows demonstrating metadata tests: a boolean `eq`, a numeric ordering comparator, the fall-through for characters lacking a key, and verbatim rendering of placeholders for missing keys.

#### Docs: character `metadata.json` spec marked complete

The spec moved from `docs/developer/features/` to `features/complete/`, with its status line updated to implemented (shipped).

#### Fix: document-store names and paths are one case-insensitive namespace

Database-backed vaults compared paths case-insensitively when reading but enforced uniqueness case-sensitively when writing, so `Lore` and `lore` could exist as sibling folders (and `Notes.md` beside `notes.md`), with readers silently resolving one and shadowing the other. Store names had no uniqueness at all — two stores could share the exact same name.

- Sibling folders and files in database-backed stores can no longer differ only by casing: the unique indexes on `doc_mount_folders` and `doc_mount_file_links` are now `COLLATE NOCASE`. A repair pass runs at every startup — not just once — so collisions introduced by editing the database out-of-band are also caught: the newer of two colliding rows is renamed with a ` (2)` suffix (subtree paths and links repaired with it) and the rename is logged. The pass also verifies the indexes' actual definitions (a same-named non-unique stand-in is replaced) and catches non-ASCII case-collisions that SQLite's ASCII-only NOCASE tolerates.
- Folder resolution is case-preserving: writing to `lore/new.md` when `Lore` exists reuses `Lore` and files under it, instead of minting a second folder. Re-writing an existing document under a different casing updates it in place and keeps its stored name. Filesystem-backed stores still adopt on-disk casing.
- Case-only renames (`notes.md` → `Notes.md`, `lore` → `Lore`) now work everywhere — they used to be rejected as "destination already exists" on some paths.
- Fixed a hazard where force-copying a file onto a case-variant of its own path deleted the source before copying.
- Store names are now unique case-insensitively. Creating or renaming a store to a name a peer already holds (in any casing) returns a 409; auto-provisioned stores and character vaults suffix ` (N)` instead. Existing duplicate names are suffixed at startup (oldest keeps the name). Characters that share a name now get distinct vault names.

#### Feature: `metadata.json` — a per-character fact sheet, and custom tools that can test it

Every character vault gains an optional `metadata.json` at its root, alongside `properties.json`: one JSON object of arbitrary user-authored keys with any JSON value.

```json
{ "hasAnsibleAccess": true, "clearanceLevel": 3, "faction": "Ordo Aurum" }
```

- **The file.** Keys are the user's own — no reserved names, no schema, no size limit beyond the usual document-store ones. The only requirement is that the file hold an object, not an array or a scalar. It hydrates onto the character as `character.metadata`, so any code path holding a hydrated character can read `character.metadata?.["key"]`.
- **Not a keystone, and no migration script.** An absent file hydrates as `{}`; so does an unparseable one, with a warning to the log. Only `properties.json` can declare a vault broken. New vaults are seeded with `{}`, and the startup character-vault backfill seeds an empty `metadata.json` into every already-linked vault that lacks one — an existence check, not a parse, so a file holding invalid JSON is never "healed" into an empty one. Managed-field projection writes the file only when the character actually carries `metadata`; a caller without it (like the backfill's repopulate path, which reads raw rows that have no such column) leaves the file alone rather than clobbering a real fact sheet with `{}`.
- **Writable managed field.** `metadata` joins `MANAGED_FIELDS`, so repository and API writes route to the vault file like `pronouns` or `title`; there is no `characters` column and no DDL change. A patch **replaces** the whole object rather than merging keys — one field owns one file, so PUT-the-object is the coherent semantics, and a merge would make deleting a key impossible. `properties.json` merges only because five fields share it.
- **User-driven, and only user-driven.** No generation system reads or writes it: not character creation, not summon-from-lore, not the optimizer. It is never injected into a system prompt or character context. A character with `systemTransparency: true` can read and edit the file through the ordinary `doc_*` tools, like any other vault document; an opaque character cannot see it. No new access machinery.
- **The file manager is the editing surface.** There is no form for it in the Aurora editor; the plumbing for one exists.

Custom tools are the first consumer. Both additions are backward compatible.

- **`when.metadata`** — a fourth outcome-test subject, symmetric to `params`: `{ "gt": 0.60, "metadata": { "hasAnsibleAccess": { "eq": true } } }`. Same six comparators, ANDed the same way, `$param` operands included, so `{ "metadata": { "clearanceLevel": { "gte": { "$param": "required" } } } }` is an opposed check against what the character carries. Keys are any non-empty string, not the `params` identifier grammar — `metadata.json` is hand-authored and `hasAnsibleAccess` is an ordinary key there.
- **Missing keys fail soft, and never throw.** A metadata comparator whose key is absent, holds a non-primitive, or holds a type the comparator can't sustain simply does not match: the row is passed over and evaluation falls through to the mandatory catch-all, with a debug log. This is the deliberate difference from `params`, whose keys are declared in the file and so can be validated at load. Metadata keys name something on a character the file has never met, so load-time validation checks only the comparator's shape and its `$param` operands. A table branching on a key must still deal sensibly to the character who lacks it. Note that absence is not inequality — `neq` on an absent key does not match either — and `{ "eq": null }` is not expressible.
- **`{{metadata.key}}`** — a fourth template family in outcome messages, rendering primitives the way `{{params.name}}` does. An absent key, or one holding a list or object, is left verbatim as the placeholder, like any unknown placeholder.
- **The roster never enumerates metadata.** The `run_custom` description gains one sentence saying tables *may* consult the invoking character's metadata, and nothing more — keys and values are per-character and often the point of the table. Tables with `revealOdds: true` render their `when` clauses as they always have, metadata clauses included; `revealOdds: false` is how an author keeps a condition secret.
- **Who rolled.** The LLM path loads the rolling character's hydrated sheet; a broken vault lands on the existing Prospero error bubble. The manual popup rolls with the sheet of the character the run names, which the popup always does. A run naming nobody rolls against an empty sheet and lands on the catch-all.
- **`pascalMeta.metadataTested`** records the keys the winning outcome consulted and their values at roll time — only those keys, primitives only, so the transcript shows what the table saw without publishing the whole sheet. Additive JSON in an existing nullable column; no migration.

Export/import round-trips `metadata` both as an `ExportedCharacter` field and as the vault document itself, with the existing managed-field precedence. SillyTavern export omits it; it is Quilltap-native. Both published JSON Schemas (`qtap-custom-tool.schema.json`, `qtap-export.schema.json`) are updated, and the Zod/JSON-Schema agreement test covers the new grammar.

#### Fix: Staff whispers to characters honor the All Whispers toggle again

The custom pseudo-tools work (`61ec90bd`) exempted every `systemSender` message from the Salon's whisper filter so that Pascal's private rolls would stay visible to the operator. That was too broad: it also unhid every other Staff whisper addressed to a character, so the Commonplace Book's memory-recall whispers, Carina's answers, and the Librarian's and Host's targeted messages all rendered whether or not All Whispers was on.

- The exemption is now limited to `pascal` and `prospero` — private rolls and private Run Tool results, which exist for the person running the table and are excluded from every character's context either way.
- Every other Staff whisper follows the same rule as a character-to-character whisper: hidden unless All Whispers is on, or the human is its author or one of its targets.
- The filter moved out of `SalonView` into `app/salon/[id]/whisper-visibility.ts` and has unit tests, including one that pins the Commonplace Book case that regressed.
- Display only. What a character can see was always decided server-side from `targetParticipantIds`; showing or hiding a message here never changed anyone's context.

#### Feature: custom tools get a display title, and outcomes can test more than the value

Two additions to the `Tools/*.tool.json` format. Both are backward compatible — existing definitions load and behave exactly as before.

- **`title`** — an optional display name, max 80 characters. Pascal announces it, the composer popup lists it, and the roster sorts on it, so `scan_hawking_radiation` reads as "Scan Hawking Radiation". Omit it and the title is derived from the name (underscores and hyphens to spaces, each word capitalized); write one when that derivation isn't what you'd have said. The model never sees the title — it still calls tools by `name`, so there is no second string for it to pass by mistake. `pascalMeta.tool` still records `name`, and because the title is interpolated when the message is posted, editing a title later does not rewrite past announcements.
- **Multi-subject `when`** — an outcome test may now name three subjects, all of which must hold: bare comparators still test the final value, `roll` tests the raw pre-transform draw, and `params` tests what the tool was called with. So `value > 1 && params.scale > 12` is `{ "gt": 1, "params": { "scale": { "gt": 12 } } }`. Comparator operands may also be a `{ "$param": "difficulty" }` reference instead of a literal, which is the opposed check. `eq`/`neq` on a `params` subject accept strings and booleans; ordering comparators still require numbers on both sides. Still no OR, no nesting, and no expression grammar — the evaluator stays eval-free.
- **`roll`** earns its keep when a multiplier or offset has moved the value away from what was drawn: a raw draw in the bottom 2% is a fumble whatever it was later scaled by, and no test on the value could say so.
- **Stricter, and more legible, load errors.** Nested objects in a definition (`when`, comparators, outcome entries, the roll range, `$param` refs) now reject unknown keys instead of dropping them, so a misspelled comparator like `gt3` is a load-time rejection rather than a test that silently never fires. Unknown **top-level** keys are still tolerated, which is what reserves room for future keys. An outcome that tests an undeclared parameter, orders a string, or compares a parameter against the wrong type is likewise rejected at load. Rejection messages for `when` and `roll` used to read `Invalid input` — Zod reports that at a union and buries the real complaint in its branches — and now name the actual problem.
- The published JSON Schema at `public/schemas/qtap-custom-tool.schema.json` is hand-synced with the Zod schema and had no drift guard. A test now checks both against one corpus and asserts they agree; the one intentional divergence (JSON Schema cannot express the trailing catch-all rule, or that a `$param` resolves) is asserted explicitly. Both annotated specimens in `docs/developer/` cover the new keys, and every outcome in them was verified reachable by execution.

#### Change: a custom-tool outcome is now just the result — no croupier's voice, no roll, no trace of who ran it

Pascal's announcement is the tool's title and whatever the `.tool.json` says to display, and nothing else:

> 🎲 **Scan Hawking Radiation** — The detector registers a faint whisper of something.

- **The croupier's narration is gone.** A manual run used to read "At *name*'s behest, Pascal spins the wheel: …". A manual run's announcement is now byte-identical to the one a character's roll produces, so nothing in the transcript records that the operator was the one who reached for the tool. (`pascalMeta.invokedBy` still does, for audit.)
- **The italic `*(rolled 14)*` suffix is gone.** What a roll says is the author's to decide: put `{{value}}` or `{{dice}}` in the outcome message to have the number read out. Nothing is lost — the full roll record (raw draw, dice faces, transform, matched outcome) still persists in `pascalMeta`, and the rolling model still receives `value` and `state` from `run_custom`.
- **A manual run no longer publishes the parameters you chose.** It used to post a second message in your voice — "*I ran `unlock` (scale: 1).*" — listing any parameter moved off its default. That put the operator's hand on the scale into every character's context, where a model could read what you set to arrange the outcome. `?action=run` now returns `messages: [pascalMessage]`.
- **`opaqueContent` is once again identical to `content`.** The separate neutral body existed to keep the name "Pascal" out of an opaque character's context; with the framing gone there is no persona to strip, which is the position Suparṇā and Carina are already in. Both bodies are still populated in lockstep.
- **The message bar names the tool.** The header chip read "● PASCAL · ROLL OUTCOME" — the machinery, and something random happening. It now reads "● PASCAL · SCAN HAWKING RADIATION": the tool's display title, or its name when the roll predates the new `pascalMeta.toolTitle` field. This is a Salon label only; `systemKind` never reaches a model's context.

#### Fix: custom tools were invisible — missing from the tool list, and load errors were unreachable

Two gaps that together made a custom tool impossible to find or diagnose.

- **`run_custom` was missing from `GET /api/v1/tools`**, the hand-maintained catalogue behind the per-chat tool toggles, so the tool never appeared in any tool list. Now registered under `utility`. Note this catalogue is hand-maintained with no drift guard — it lists 40 of the 58 registered tool definitions, the rest being deliberately non-toggleable (agent/console-only tools like `run_sql`, `terminal_*`, `memory_search`).
- **The composer gutter button only rendered when at least one tool loaded successfully**, but load errors ride in the same payload. A user whose only `Tools/*.tool.json` was malformed therefore got no button, no error badge, and no sign the file had been seen — the diagnostic was hidden exactly when it was needed. The button now shows when there is a runnable tool *or* a failed definition, and the dropdown distinguishes an empty table from a broken one before listing the file and the reason.

Reminder of the rules that reject a definition, since all three are easy to hit at once: `outcomes` must be an **array**; `name` must be lowercase (`^[a-z][a-z0-9_-]{0,63}$`); every outcome needs a `state`.

#### Feature: custom pseudo-tools — Pascal's table (`run_custom`)

User-defined chance mechanics. A custom tool is a single JSON document matching `Tools/*.tool.json` at the root of any document store: a named action with parameters, a random roll, and an ordered table of outcomes mapping the roll to a message and a semantic state. Both the LLM (via one `run_custom` tool) and the user (via a composer popup) can run them. Spec: `docs/developer/features/pascal-custom-tools.md`.

- **Tamper-evident by construction.** The roll executes server-side with crypto-strength randomness and the outcome persists as a message the model did not author (new `systemSender: 'pascal'` — the Croupier's first synthetic messages). A model cannot narrate a failure into a success, and regenerating a reply does not re-roll. The full roll record — raw value, transform, dice faces, which outcome matched — is kept in a new `pascalMeta` column.
- **Two roll forms.** A numeric range with an optional transform (`value = raw * multiplier + offset`, rounded last), or dice notation (`3d6+2`, `1d20`, `2d10-1`). Numeric fields accept a `{ "$param": "name" }` reference to a declared parameter; run-time values are clamped to declared bounds before use.
- **No expression evaluation anywhere.** Outcome tests are AND-composed comparator objects (`{ "gte": 0.3, "lte": 0.6 }`), not strings — there is no grammar to parse and nothing to inject. The last outcome must be a `true` catch-all, checked at load time, so a coverage gap is structurally impossible rather than a run-time surprise; an earlier catch-all is rejected as unreachable.
- **Tiers and shadowing.** Definitions resolve through the existing five-tier pool (character → participant → group → project → global); the nearest tier wins on a name collision, `"disabled": true` suppresses an inherited tool, and a same-tier collision resolves deterministically by mount id. Tools are read from both database-backed and on-disk stores.
- **Resolved per call, never cached across turns.** A `.tool.json` added, edited, or deleted mid-chat takes effect on the next LLM call and the next popup open; a new chat gets its full roster on turn one with no initialization step.
- **Whispered rolls.** A private run is whispered to the rolling character alone via `targetParticipantIds`; a private manual run hides the outcome from every character. Relatedly, **any message with a `systemSender` now always renders for the human user** regardless of the "show all whispers" toggle — this instance is single-user and the operator is never the one being surprised. Commonplace Book recall whispers benefit from the same fix.
- `revealOdds: false` hides the roll spec and outcome table from the model's tool roster, but the `.tool.json` remains an ordinary document a character with read access can open. For genuinely secret odds, put the file in a store the character cannot read.
- Failures are reported by Prospero (`systemKind: 'custom-tool-error'`), never by Pascal — Pascal only announces genuine outcomes. New setting Settings → Chat → "Custom tools" (default on). Published JSON Schema at `public/schemas/qtap-custom-tool.schema.json` for editor completion. Docs: `help/custom-tools.md`.

#### Fix: the Help Guide is browseable again

Every category in Help → Guide showed `(0)` topics and could not be opened, and no document would load. When help docs moved into the database, their IDs became UUIDs, but the Guide's category lists, the `Related Pages` links between documents, and the welcome card all identify documents by the slug derived from the filename (`character-creation`). Nothing matched, so every category resolved to an empty list and the reader's fetch 404'd.

The slug is now a first-class field on a help document, derived from its path in one place (`lib/help/help-doc-slug.ts`) rather than computed and discarded in the sync. `/api/v1/help-docs` returns it alongside the database ID, and `/api/v1/help-docs/[id]` accepts either identifier, so existing callers that hold a UUID keep working.

#### Fix: help docs added after the first sync now reach the database

A help doc written after the initial sync never appeared in the Guide. `ensureHelpDocsSynced()` only ran when the `help_docs` table was completely empty, and the only other sync trigger is a full embedding reindex, so eleven docs that shipped in the repo — including `answer-confirmation`, `brahma-console`, `custom-tools`, and `post-office` — had no row at all. It now also syncs when a Markdown file on disk has no row yet, which costs a directory scan rather than a read of every file; `syncHelpDocs()` already skips unchanged docs by content hash. Edits to an already-synced doc are still picked up only by a full `syncHelpDocs()` call.

#### Fix: help docs deleted from disk are pruned, and new ones get embedded

Two gaps left by the sync fix above.

A doc removed from `help/` kept its database row and stayed in the Guide forever, because the sync only ever added and updated. Rows whose file is gone are now deleted, along with their embedding-status rows. The sync trigger scans for divergence in both directions — a file with no row, or a row with no file — since a deletion on its own would otherwise never start a sync and the prune would be unreachable. Both directions come out of the same directory listing, so the trigger still reads no file contents.

Separately, nothing enqueued a `HELP_DOC` embedding outside a full reindex, so a newly synced doc appeared in the Guide but stayed invisible to `help_search`. Any doc without an embedding is now queued through the normal pipeline after a sync; per-entity dedup keeps this from duplicating a reindex's jobs. The sync also reads the table once and indexes by path instead of issuing a `findByPath` per file, which the prune needed anyway.

#### Fix: writing a help doc could corrupt its embedding

Updating any `help_docs` row could silently destroy its embedding and make the doc vanish from help entirely. `lib/database/manager.ts` registers the known embedding BLOB columns when it builds a backend, "regardless of which repository is accessed first" — but `help_docs` was not on that list. It alone relied on `HelpDocsRepository` registering the column lazily and then remembering it on the instance. A repository outlives the backend it first ran against (a reconnect, or a dev-server reload), so the stale flag left the fresh backend with no blob handling for `help_docs`, and both directions broke without an error:

- **Writes:** `documentToRow` only converts a `Float32Array` to a `Buffer` for a registered blob column. Unregistered, the embedding reached `JSON.stringify` and persisted as an index-keyed object (`{"0":..,"1":..}`) of TEXT.
- **Reads:** `hydrateRow` only applies `parseLegacyEmbeddingText` to a registered blob column, so those rows then failed Zod validation and were dropped from `findAll()` — the doc disappeared from the Guide and from help search.

This is where the "legacy" JSON-text embeddings came from. They were not legacy: an unregistered blob column was minting them on every write, and the previous fix (read-side recovery plus the every-boot repair in `lib/startup/repair-text-embeddings.ts`) treated the symptom, which is why the corruption kept coming back and looked historical. `help_docs` is now registered at backend init alongside `memories`, `vector_entries`, and `conversation_chunks`, and the repository re-asserts registration on every `getCollection()` instead of caching it — merging an already-registered column is a no-op. Existing mis-stored rows still convert losslessly to BLOB at the next startup, with no re-embedding needed. Regression test: `__tests__/unit/lib/database/repositories/help-docs-blob-registration.test.ts`.

#### Docs: annotated custom-tool reference specimens

Two valid, copy-pasteable `Tools/*.tool.json` templates in `docs/developer/`, linked from `help/custom-tools.md`.

- `CUSTOM_TOOL_SPEC.json` exercises every key of the range roll form: all four parameter types with bounds and defaults, `$param` references on `multiplier` and `offset`, the multiply/offset/round transform, all six comparators including an AND band, all four outcome states, the `{{value}}`/`{{roll}}`/`{{params.*}}` placeholders, and the mandatory trailing catch-all. Each field's `description` explains what it demonstrates.
- `CUSTOM_TOOL_SPEC_DICE.json` covers what the other structurally cannot, since `roll` is either a range object or a dice string but never both: dice notation, the `{{dice}}` breakdown, `revealOdds: false`, and `defaultVisibility: "whisper"`.

Both are validated against the live Zod schema, and every outcome in each is verified reachable.

#### Fix: tools now accept numbers the model quoted

Models often send tool arguments as strings — `{"type": "6"}` rather than `{"type": 6}`. Every tool rejected that outright, so the call simply failed and the character was told its perfectly sensible request was invalid. All 28 numeric arguments across the 18 tools that take one now accept a numeric-looking string: `rng` (`type`, `rolls`, `modifier`), `memory_search`, `search_scriptorium`, `web_search`, `run_sql`, `help_search`, `image_generation`, `list_images`, `submit_final_response`, `terminal_read`, `upsert_annotation`, `delete_annotation`, and the `doc_*` family.

Only strings are converted, and only when they parse to a finite number. Bounds still apply afterward, so a quoted `"1001"` fails a 1000 maximum exactly as `1001` does, and `"6.5"` fails an integer check exactly as `6.5` does. `true`, `null`, `[]`, and `""` are still rejected rather than coerced — the standard `z.coerce.number()` would silently turn them into 1 or 0, trading a rejected call for a wrong result, which is the worse failure. Floats (`confidence`, `minImportance`) and negatives (`terminal_read`'s `start`/`end`) work as before. String enums such as `flip_coin` are unaffected.

The published tool schemas are byte-identical — models are still told `integer`, with the same bounds and defaults. This is a runtime leniency only; it forgives a model for not having listened. Helper: `lib/tools/llm-number.ts`.

#### Fix: dice notation now honors its modifier

Typing `3d6+2` or `2d10-1` in a message previously rolled the dice and silently discarded the modifier — the only dice pattern in the codebase captured count and sides and nothing else. Dice parsing and rolling now live in one shared module (`lib/pascal/dice.ts`), used by the `rng` tool, the prose auto-detector, and Pascal's custom tools alike.

- The `rng` tool gained an optional `modifier` parameter, so a model can roll `3d6+2` directly. Its result line only changes when a modifier is present.
- The prose auto-detector honors a modifier written closed-up (`3d6+2`). Spacing still disambiguates: `2d6 - 1 apple` remains a plain 2d6 roll next to unrelated prose, as before.
- Bounds are unchanged (2–1000 sides, 1–100 dice; modifier within ±1000), and out-of-range notation is still skipped rather than clamped.

#### Docs: spec for custom pseudo-tools (Pascal the Croupier)

New feature spec at `docs/developer/features/pascal-custom-tools.md`. Users will be able to define chance-based pseudo-tools as `Tools/*.tool.json` documents at any document-store tier (character/participant/group/project/global, nearest tier wins); each defines parameters, a random roll (numeric range or dice notation reusing the existing dice roller), and an ordered outcome table mapping the roll to a message and a semantic state. A single `run_custom` LLM tool and a composer popup both execute them server-side; outcomes post as tamper-evident synthetic messages from a new `systemSender: 'pascal'`, with optional whispered (hidden) rolls. Roster is re-resolved on every LLM call so mid-chat definition changes take effect immediately. Spec only — no code changes yet.

#### Fix: strip a trailing "nothing to add" line from an otherwise real turn

Weak models sometimes narrate a genuine turn — a gesture, an observation, a real contribution — and then append `[NOTHING TO ADD]` as a final line. That is not a pass, so the message is kept, but the dangling sentinel line should not survive into the transcript.

`detectSkipSentinel` (`lib/chat/turn-manager/skip-signal.ts`) now checks the last non-empty line in addition to the first. When the first line is real prose and the message ends with a lone sentinel line, it returns `{ skip: false, cleaned }` with that trailing line removed, exactly as it already did for a sentinel-plus-prose message led by the sentinel. The orchestrator's existing `detection.cleaned` path carries the stripped text through to display, persistence, and memory, so the `[NOTHING TO ADD]` line never reaches any of them. A bare sentinel (a real pass) and a mid-sentence mention of the phrase are unaffected.

#### Feature: database size reduction — stale-chat tidying, cold-tier embeddings, int8 quantization

Three coordinated changes shrink the main database (spec: `docs/developer/features/db-size-reduction-spec.md`) without discarding anything needed to re-read a conversation or re-run memory extraction. Message text, attachments, memories, and summaries are never touched.

- **Configurable stale-chat retention window.** New instance setting `dataRetention.staleChatDays` (1–3650 days, default 30) with a "Data Retention" card on Settings → Chat and a `GET/PUT /api/v1/settings/data-retention` route. A chat is stale when it has had no *played* message (user or character; Staff whispers don't count) for that many days. The existing generated-image collapse and both new sweeps below all resolve staleness through the same `resolveStaleChatDays()`, so they can never disagree.
- **Stale-chat cache collapse.** The daily maintenance sweep now NULLs regenerable/discardable columns on stale chats: `chats.compressionCache` and `chats.renderedMarkdown`, plus `chat_messages.rawResponse`, `reasoningContent`, `reasoningSegments`, `renderedHtml`, and `debugMemoryLogs`. All UPDATEs are guarded (`IS NOT NULL`) so re-runs are no-ops, and raw SQL is used so `updatedAt` is never bumped. `content`, `opaqueContent`, `thoughtSignature`, `attachments`, `contextSummary`, and `chats.state` are never touched. New module `lib/background-jobs/maintenance/collapse-stale-chat-caches.ts`.
- **Cold-tier conversation-chunk embeddings.** The same sweep NULLs `conversation_chunks.embedding` on stale chats (chunk `content` is kept, so keyword search still works). Opening a cold chat automatically re-enqueues per-chunk `EMBEDDING_GENERATE` jobs through the standard pipeline (`lib/scriptorium/cold-chunk-reembed.ts`; debounced in-process, deduped per entity in the queue). The chat-card Scriptorium badge remains the manual full re-render/re-embed. While cold, a chat won't surface in semantic search until re-indexed — documented in the new `help/data-retention.md`.
- **int8 embedding quantization.** Embedding BLOBs (`memories`, `conversation_chunks`, `vector_entries`; also new writes to `help_docs` and `doc_mount_chunks`) now use a self-describing quantized format (magic `0xEB`, versioned, int8-symmetric with a per-vector scale; float16 supported as a documented fallback) — roughly 4× smaller than raw Float32. The codec (`lib/embedding/float32-conversion.ts`) is header-aware on read, so legacy raw-Float32 blobs stay readable forever; all search code consumes hydrated arrays and is unchanged. One-time batched migration `quantize-embeddings-v1` re-packs existing rows (idempotent, resumable, progress-reported). Codec tests assert per-element error ≤ scale, mean cosine ≥ 0.999 (int8) / ≥ 0.9999 (f16), and top-10 retrieval overlap ≥ 0.95 on a clustered synthetic corpus.
- Deletes and NULLs free pages inside the file; run `npx quilltap db optimize` (server stopped) to actually shrink it. **Take a backup before upgrading across `quantize-embeddings-v1`** — quantization is one-way (exact Float32 recovery requires re-embedding).

#### Change: nudging a character is now a persisted Host announcement

Nudging a character to speak previously showed a client-only "_Name_ was asked to speak" note that lived in React state and vanished on reload. It is now a real Host announcement (`systemSender: 'host'`, `systemKind: 'nudge'`, `hostEvent.participantId`) posted server-side when the summoned turn begins and surfaced live over SSE, so the invitation is a permanent part of the transcript and the characters see it in context.

- The Host posts "The Host turns to _Name_ … and invites them to take the floor"; an opaque-room variant carries persona-free steering so the summoned voice knows the floor is theirs.
- The announcement renders as an amber (`medium`) announcement chip labeled "invited to speak", with content-inference fallback for any row missing the `systemKind` column.
- Removed the now-orphaned ephemeral-message subsystem — the nudge was its only remaining user. Deleted `EphemeralMessage`/`EphemeralMessages` and their state plumbing across the Salon view, streaming, and turn-management hooks.

#### Fix: answer-confirmation amendments now stay in the current conversation

When the answer-confirmation check flagged a character's reply and the character's own model was asked to correct it, the correction pass received only the draft reply plus the reference material (recalled memories and lookup results). It had no view of the actual conversation. When the reference material quoted an older conversation the character had read via `read_conversation`, the model would treat that old exchange as the live scene and rewrite its reply into it — producing an amendment that answered the wrong conversation.

The re-affirmation pass is now given a compact transcript of the recent live conversation (`buildRecentConversationContext` in `answer-confirmation.service.ts`) plus the character's name, and the prompt is rewritten to require a minimal, in-scene correction: same addressee, same moment, same tone, changing only the details that conflict with the facts. The reference block is now explicitly labeled background knowledge rather than the conversation. The transcript filters out Staff/system-sender whispers, tool bubbles, and silent messages, and the pass degrades gracefully when there is no prior dialogue.

#### Feature: characters can pass a turn when they have nothing to add

In group chats, every LLM character is now given a per-turn option to pass instead of being forced to reply with filler. On any turn except the very first character turn of the chat, a character may respond with the single line `[NOTHING TO ADD]`; the Host then posts a short "nothing to add" note and the rotation moves on to the next speaker. If a character has been addressed or mentioned since it last spoke, its turn note warns it to answer rather than pass.

- Scope: the feature applies only to genuine group scenes — chats with more than two active character participants, or with at least two LLM-driven characters. A one-on-one (a lone human plus a single character) is excluded entirely.
- New per-chat toggle **Turn Skipping** in the Chat Sidebar's Visibility drawer (shown only in qualifying group chats). Default is on; `turnSkippingEnabled` is a nullable chat column where NULL/true = on.
- A pass is recorded as a Host message (`systemKind: 'turn-pass'`, `hostEvent.participantId`) — no new message-sender or state columns. Turn-state, the stall guard, and the client all recompute passes from history.
- Stall guard: when every other active character has passed since the last substantive message, the next speaker is forced to speak (the skip option is withheld). The same rule powers the human case — the Salon **Skip** button now posts a Host "nothing to add" note, and is hidden (and refused server-side with a 400) when everyone else has already passed.
- Nudged or queued characters are never offered the skip option (they were explicitly summoned); the Continue button's algorithm-picked speaker is.
- Applies to autonomous rooms: a pass consumes a turn from the run budget (already the case — every job counts as a turn), and the stall guard bounds all-skip loops.
- New migration `add-turn-skipping-field-v1`. `.qtap` export/import round-trips `turnSkippingEnabled` and the turn-pass Host messages.

#### Feature: copy a conversation's UUID from the header or the Organize drawer

The header of a Salon chat now has a small copy button just after the conversation title that puts the chat's UUID on the clipboard, and the title itself is now a direct link to the conversation's Salon URL. The Chat Sidebar's Organize drawer has the same copy button at the top, before Rename. Both buttons flash a check-mark for a moment after copying. New shared component `components/chat/CopyChatIdButton.tsx` (inline icon variant for the header, full palette-button variant for the sidebar), built on the existing `useCopyToClipboard` hook.

#### Feature: a status dialog while a new conversation is assembled ("The Green Room")

Starting a fresh conversation — or continuing one elsewhere — fires a single blocking `POST /api/v1/chats` and then navigates into the Salon. That request quietly does a lot of slow work before it returns: resolving the cast, running a per-character LLM "choose what to wear" step, compiling identity stacks, backfilling continuation history, and seeding the opening scene. The wardrobe step is usually the longest part (one cheap-LLM call per character set to "have them choose"), and until now none of it was visible — the app just sat there.

A blocking, non-dismissable status dialog now appears the moment creation begins. It shows a live status line, and for each character choosing an outfit via LLM it shows a "consulting the wardrobe for _Name_" panel that resolves into the decided four-slot outfit (top / bottom / footwear / accessories). A scrolling activity log runs beneath. The dialog can't be dismissed while creation runs; it closes on its own once the conversation is ready for input. Only on failure does it offer a Close button.

- Progress travels on a side-channel so the create request keeps returning JSON as before. The client sends a correlation id (`progressId`) with the POST; the handler publishes milestones and wardrobe results to an in-memory bus (`lib/chat/creation-progress.ts`) keyed by that id; the dialog subscribes over SSE at `GET /api/v1/chats/creation-progress?id=…`. The bus buffers events per id and replays them on connect, so a subscriber that attaches a beat late loses nothing. Fully backward compatible: with no `progressId`, creation behaves exactly as before.
- Scope: fresh starts and "Continue Elsewhere" only (both go through the create endpoint). Autonomous-room creation and per-message turns are unaffected — the per-turn window already narrates itself inline in the composer.

#### Fix: character replies no longer block for minutes describing a generated image

When a character responds on a non-vision model (e.g. DeepSeek) and a recently generated image is in context — a fresh avatar, a story background, or a `generate_image` result — the orchestrator has to turn that image into text the model can read. It did this by sending the image to the configured vision profile on every turn, inline, with no caching. On the first turn after an avatar was generated this added minutes of latency: in one observed case a `glm-4.6v-flashx` description call blocked a reply for nearly three minutes while the actual response model needed only eleven seconds.

Images Quilltap generated already carry the exact prompt that produced them (`FileEntry.generationPrompt` / `generationRevisedPrompt`), which is the most faithful description available. The fallback now reuses that persisted text (and a stored `description` for already-described uploads) and skips the vision call entirely. The vision model is only invoked for genuinely unknown images — user uploads that haven't been described yet. This takes the whole vision round-trip off the reply path for self-generated images.

- The image-description fallback call is now recorded in `llm_logs` as an `IMAGE_DESCRIPTION` entry (it was previously invisible, so its latency and token use couldn't be diagnosed), runs under a 60-second hard timeout (a slow or degraded describer can no longer wedge a reply), and downsizes the image to the description provider's size limit before sending. All logging is best-effort and never blocks description generation.

#### Fix: bare-topped character avatars crop at the collarbone instead of tripping image moderation

A character with a bare upper body (e.g. an "Active Nudist" wardrobe) could not get an avatar generated on a SFW image provider: the head-and-shoulders prompt emitted "topless" wardrobe wording and cropped low enough to put a bare chest in frame, so the provider rejected it on content moderation. Avatar prompts for a bare-topped character now crop tighter — a close-up headshot at the collarbone with bare shoulders, chest and torso out of frame — and omit the "topless"/"naked" wording entirely (the same way lower-body slots are already omitted for portraits). Bare shoulders and neck are unremarkable to image providers; a bare chest is what gets refused, and the tighter framing keeps it out of the picture. Above-the-collar accessories are still described; clothed characters are unaffected.

#### Improvement: Document Mode change diffs are now real, minimal unified diffs

The diff shown when a Document Mode file is edited (the Librarian's save announcement in chat, and the diffs the `doc_*` edit tools attach to their notes) is now a proper git-style unified diff instead of a homegrown approximation. The old algorithm walked both versions with a fixed 3-line lookahead window, so any change that shifted or re-aligned content further than three lines apart was reported as a wholesale block of removals followed by a block of additions, and hunks carried no surrounding context — the result read nothing like an actual `diff`.

The Myers shortest-edit-script diff now lives in a shared `lib/doc-edit/line-diff.ts` primitive. `generateUnifiedDiff` in `lib/doc-edit/unified-diff.ts` builds on it, grouping the edits into hunks with up to three lines of unchanged context on each side, coalescing nearby edits into one hunk and splitting distant ones apart — exactly as `git diff` does. Unchanged lines stay as ` ` context, only genuinely changed lines get `-`/`+`, hunk headers report correct `@@ -start,count +start,count @@` ranges, and truly-empty content is treated as zero lines (so creating or emptying a file no longer churns a phantom blank line). A safety fallback emits a coarse whole-file hunk for pathologically large, wholly-dissimilar inputs. The exported function signatures and output contract are unchanged, so callers and the autosave notification format are unaffected.

The in-editor change gutter (the thin bars beside edited blocks in Document Mode) now shares the same treatment. It previously compared blocks by position — baseline block *N* against current block *N* — so inserting or deleting a paragraph near the top shifted every block below it and lit the entire remainder of the document as "changed." It now derives the marked blocks from the shared line diff (via `changedBlockIndices`), so only blocks that are genuinely new or modified are flagged; blocks that merely shifted position stay unmarked, and a deletion marks nothing (it has no counterpart block to sit on, just like a unified diff's `-` line).

#### Fix: stale-chat image cleanup now ignores Staff announcements

The daily maintenance sweep that collapses a stale chat's superseded story-background and avatar images decided "stale" from the chat's `lastMessageAt` (falling back to `updatedAt`). But personified-feature / Staff messages (Lantern, Aurora, Host, Prospero, Carina, Concierge, Commonplace Book, Ariel, Suparṇā, Librarian) persist as `type: 'message'` rows and also bump `lastMessageAt`, so a whisper into an otherwise-quiet chat (e.g. a Suparṇā mail-delivery announcement) reset the 30-day staleness clock and kept dead images around indefinitely. Staleness is now keyed off the last *played* message — one authored by a participant character or the human user — via the new `chats.getLastPlayedMessageAt(chatId)`, which excludes any message carrying a `systemSender`. It falls back to `updatedAt` only when a chat has no played messages at all. No backfill needed: the sweep recomputes staleness from live data on each run.

- New repository method `getLastPlayedMessageAt` does an indexed single-row lookup (`type = 'message' AND systemSender IS NULL`, newest first) so the daily sweep doesn't load and validate every chat's full transcript.

#### Fix: renaming a Document Mode file now updates the recent-documents list

Renaming a file while editing it in Document Mode now keeps the recent-documents history in sync in both entry points. Previously, standalone Document Mode (opened from the left sidebar, no chat) renamed the file on disk but left its `chat_documents` tracking row pointing at the old path, so the renamed file showed the old name in the Open Document picker's recents and 404'd when reopened. The standalone rename handler now updates the tracking row. The Salon rename path, which already updated its own chat's row, additionally sweeps any other chats' (or the standalone) rows that still reference the old path, so the shared recent list stays consistent everywhere.

- Both paths reuse `chatDocuments.renameFilePathInStore(scope, mountPoint, oldPath, newPath, newDisplayTitle)` — the same chokepoint the `doc_move_file` tool uses. Updates are best-effort: the rename has already succeeded on disk, so a tracking failure is logged and never fails the request.

#### Fix: run_sql handler tests no longer pick up the Jest SQLite mock in CI

The `run-sql-handler` unit suite (a real-binding suite) broke in CI after `better-sqlite3-multiple-ciphers` was added to the unit Jest `moduleNameMapper`: its driver loader's bare `require('better-sqlite3-multiple-ciphers')` fallback started silently returning the mock, whose statements never report `readonly: true`, so the handler's fail-closed guard rejected every query (16 failures). The loader now prefers path-based requires (which bypass `moduleNameMapper`), probes each candidate with a prepared `SELECT 1` to confirm it is a real binding, and throws a clear error instead of silently running against the mock.

Documents opened from the left sidebar's Document Mode (no chat) are now tracked in the recent-documents history, so they appear in the Open Document picker's recents like chat-opened documents do. Previously these opens recorded nothing, so they never showed up as recent.

- Standalone opens now write a `chat_documents` row under a reserved sentinel `chatId` (`STANDALONE_CHAT_ID`), which the cross-chat recents query already reads. Reopening the same file reactivates and bumps its existing row. Tracking failures are logged and do not block the open.

#### Feature: standalone Document Mode from the left sidebar

The left sidebar now has a Document Mode button (file-plus icon, above Settings) that opens the Open Document dialog without a chat. Selected documents open as standalone workspace tabs with the full Document Mode editor — no Librarian announcements and no conversation is notified of edits. (Opens are recorded in recent-documents history under a sentinel chatId; see the 4.8-dev fix above.)

- The picker in chat-less mode always "looks everywhere" (every enabled store; the toggle is hidden), hides the project-library shortcut, and lists recent documents across all chats (project-scoped recents are omitted since there is no project context to resolve them).
- New `document-standalone` workspace tab kind. Reopening the same file focuses its existing tab; tabs persist across reloads and reopen their file. Blank documents update their tab payload once the server names them so reloads don't mint duplicates.
- Outside the workspace, the button funnels through `/workspace?open=document-standalone&…`.
- New chat-less API route `/api/v1/documents` with actions: `accessible-stores` (GET), `recent-documents`, `open-document`, `read-document`, `write-document`, `rename-document`, `delete-document`.
- Refactor: extracted the chat-agnostic document mechanics (operator path resolution, existence probe, untitled-name picking, mtime-checked read/write, rename/delete file moves, store listing) from the chat document actions into `lib/documents/operator-doc-actions.ts`; the chat route now delegates to it and keeps only chat-specific concerns (chat_documents rows, documentMode flag, Librarian announcements).

#### Docs: new GEMINI.md for AI agent context

Added `GEMINI.md` to the project root. This file provides a comprehensive overview of the project's architecture, key conventions, and terminology, tailored for use by AI developer assistants. It is generated by analyzing the codebase and incorporates key details from `README.md` and `CLAUDE.md` to provide deep, actionable context.

#### Fix: surfaced `qtap://` URLs now open reliably across chat content and announcements

`qtap://` links are now clickable and interactive wherever chat markdown/text surfaces them, including staff announcements (Librarian, Lantern, Aurora, etc.).

- Added shared `qtap://` link handling that resolves target type and opens text documents in Document Mode, images in the fullscreen image viewer, and shows a warning toast for unsupported file types.
- Added linkification of bare `qtap://` literals in chat-rendered markdown/text (not only pre-marked markdown links), with inline/fenced code excluded.
- Fixed a no-op click path where `open-document` returned `200` server-side but the UI did not surface/focus the opened document; the client now reconciles and focuses the opened document row/tab immediately.
- Replaced the qtap link emoji prefix with the built-in themeable icon system (`Icon name="file"`).

#### Fix: unit tests no longer load native SQLite bindings

Stabilized the Jest split between unit and integration coverage so native SQLite/SQLCipher bindings are only loaded by integration tests.

- Unit Jest now mocks both module specifiers: `better-sqlite3` and `better-sqlite3-multiple-ciphers`.
- Native-binding suites were reclassified to `*.integration.test.*` and excluded from unit discovery.
- Integration Jest now includes those reclassified suites explicitly.

#### Feature: Document Mode now shows and copies each document's qtap URL

In Salon Document Mode, the header area now includes a short URL line between the title/actions row and the editor toolbar. It shows the current `qtap://` URI for the open document and updates automatically when the document is renamed.

- Added a compact `qtap://` URL row under the document header controls.
- Added a copy icon button that writes the current URL to the clipboard.
- Added a green success toast when URL copy succeeds.

#### Feature: Document Mode rich Markdown now shows YAML frontmatter as metadata

In Salon Document Mode, Markdown files with YAML frontmatter now render that frontmatter as a read-only "Document Info" key/value table in rich mode instead of showing raw `---` delimiters and YAML lines inside the editor surface.

- Rich mode now edits only the Markdown body content.
- Source mode still shows and edits the full raw document bytes, including frontmatter.
- Array-like frontmatter values render as individual chips for clearer scanning.
- Frontmatter values render as plain text in the table (no Markdown formatting inside metadata values).

#### Fix: Lexical editors now render with solid (non-transparent) backgrounds

Applied an explicit opaque background to shared Lexical editing surfaces so editor panes no longer show transparency in any theme.

- Chat composer Lexical contenteditable now paints an explicit base background.
- Document Mode's Lexical editor area now paints an explicit base background.
- Source-mode textareas used alongside Lexical editors (Document Mode and reusable markdown Lexical editor) now use the same opaque base background.

#### Fix: non-Salon footer now uses the header background and stays opaque on Home

Updated the shared app footer styling so non-Salon pages render the footer with the same background treatment as the page toolbar/header, and pinned its stacking context above fixed homepage background overlays. This prevents the Home page background image layer from visually bleeding through the footer in themes that use transparent main containers.

#### Feature: wardrobe item move/copy across General, projects, groups, and users

Added `Move` and `Copy` actions to the wardrobe row menu in the Wardrobe dialog.

- `Move` and `Copy` now open a destination picker with General, all projects, all groups, and all users (character wardrobes).
- `Copy` always generates a new wardrobe item UUID in the destination.
- `Move` preserves the existing item UUID and removes the source item after a successful write.
- Added a new transfer API at `/api/v1/wardrobe/transfers` for destination discovery and move/copy execution.
- Fixed a 400 regression where project/group destinations were incorrectly rejected as `Invalid destination`.

#### Fix: character wardrobe item deletion always failed with "not found"

The character-scoped wardrobe DELETE route still checked item existence against the `wardrobe_items` SQL table, which was emptied when wardrobe storage moved to the vault. Every delete attempt failed with "Wardrobe item not found" even though the item was still listed (list/GET/PUT already read the vault correctly). The existence check now uses the same vault-aware lookup as GET/PUT.

#### Fix: Lexical markdown editors no longer auto-escape markdown punctuation on export/save

Lexical markdown export paths were writing escaped punctuation (for example `\*`, `\_`, `\~`, and `\``) even when the author intended normal markdown delimiters. This changed bytes in saved drafts/documents and in imperative markdown reads.

- The shared Lexical markdown bridge now strips those export-time escapes by default.
- Applies to asterisks, underscores, backticks, and tildes.
- Covers Document Mode, markdown-form editors that use the shared bridge, and chat-composer markdown export paths (including draft persistence and imperative `getMarkdown()` reads).

#### Fix: forward profile provider parameters (e.g. DeepSeek thinking mode) uniformly

Extended the previous fix so *every* text-LLM call in `lib/` — cheap-LLM and direct — forwards its selected profile's provider parameters on `sendMessage` / `streamMessage`. Previously, several utility flows built minimal requests and silently dropped `thinking` / `reasoning_effort` from the chosen profile, causing reasoning models to burn their token budget on hidden reasoning and return empty content.

- `profileParams(profile)` is now a shared exported helper in `lib/llm/cheap-llm.ts`.
- Fixed direct-call paths: Concierge gatekeeper (danger classification), image-description fallback, wardrobe image analysis, character-voiced announcer, auto-configure (both the analysis call and its cheap-LLM JSON cleanup), character wizard (all field generation + physical descriptions + wardrobe items + vision), character optimizer, AI import, external-prompt generator, initial greeting.
- Outfit-appropriateness chooser (`chooseLLMOutfit`) was already routed through the shared harness and picks up the fix automatically.
- Main chat / regenerate / swipe path was already forwarding these — unchanged.

#### Fix: cheap-LLM tasks now forward provider parameters (e.g. DeepSeek thinking mode)

Cheap-LLM tasks (memory extraction, summaries, titles, answer confirmation, etc.) built a minimal request in `sendToProvider` and never forwarded the selected profile's provider-specific parameters. So a profile set to DeepSeek **Thinking Mode = Disabled** still reasoned: DeepSeek fell back to its model default (reasoning on for `deepseek-v4-flash`), which spent the whole completion budget thinking and returned empty content — surfacing as failed/blank cheap-LLM results (e.g. answer-confirmation checks resolving to "Unvetted").

- `CheapLLMSelection` now carries `profileParameters`, populated from the chosen profile at every selection site (user-defined, global default, cheap-flagged, Ollama, and the uncensored/re-affirmation paths).
- `sendToProvider` forwards `profileParameters` on every `provider.sendMessage` call, so `thinking` / `reasoning_effort` (and other allowlisted provider extras) take effect. The task pipeline still controls temperature and max-tokens at the top level; providers only apply their allowlisted extras, so this doesn't override the cheap-task sampling settings.

#### Feature: answer confirmation (Salon consistency check + re-affirmation)

Before a character's tool-using Salon reply is saved, an optional cheap-LLM consistency check compares the reply against what the character was told this turn (its last Commonplace Book whisper) and what it looked up (in-scope read-tool results: `search`, `read_conversation`, and the `doc_*` content-read family). The check only runs when there is something to check — a whisper and/or an in-scope read-tool result.

- Consistent → the reply is saved with `confirmed: true`.
- Inconsistent → the character's own model is shown the discrepancies and asked to stand by the reply (`confirmed: false`) or rewrite it. A rewrite is saved as the shown reply (`confirmed: true`, `confirmationRevised: true`); the original text is kept in `confirmationOriginalContent` for the logs.
- Check errored/timed out, or the turn was user-driven (impersonation) → `confirmed: null` (could-not-verify).
- Feature off / nothing to check → no confirmation fields written.

The Salon status bar shows `Confirming…` during the check and `Requesting affirmation of questionable results…` during the re-affirmation. Each checked message carries a small badge (Vouched / Amended / Stood by / Unvetted) that reveals the discrepancy notes on hover. The first reply streams live and is replaced in place if the re-affirmation rewrites it (a deliberate, visible transparency swap).

- Gate: global default OFF, with per-project and per-chat overrides. A project set to ON enables its chats automatically; a chat's own override always wins. Global toggle in Settings → Chat; per-project toggle in the Prospero project's Model Behavior card; per-chat toggle in the Salon sidebar's Visibility section.
- New columns: `chat_messages.{confirmed, confirmationChecked, confirmationRevised, confirmationNotes, confirmationOriginalContent}`, `chats.answerConfirmationOverride`, `chat_settings.answerConfirmationSettings` (migration `add-answer-confirmation-columns-v2`). Per-project override rides in the project's `properties.json`. All fields ride in `.qtap` exports.
- Scope: normal Salon chats only — not help chats, the Brahma Console, or Carina calls. Silent turns are skipped. The re-affirmation runs at most once (no loop). The regenerate/swipe path is not yet covered.

#### Fix: the workspace header now tracks the active (focused) tab

The contextual header (Salon project link, character avatars, chat title, cost summary) did not update when switching tabs: with several chat tabs kept alive at once, all of them wrote to the single global header and the last one to mount won, so the header showed stale content and never changed on tab activation. Switching to a non-Salon tab left the previous Salon header in place.

- Each tab's injected toolbar content is now isolated in a per-tab registry (`TabToolbarProvider` wraps every mounted tab view), so kept-alive tabs no longer clobber each other.
- A new `WorkspaceToolbarBridge` surfaces the *focused* pane's active tab's content into the single global header. Activating a different tab regenerates the header; a tab that injects nothing (e.g. Home) clears it; in a split, the header follows whichever pane has focus.
- Removed the never-wired per-pane `PaneToolbar` (and its dead `.qt-pane-toolbar` styles) that this replaces.

#### Fix: an unknown tab kind no longer discards the entire saved workspace layout

The persisted workspace validator rejected the whole saved state if any single tab had a `kind` not in its allow-list, silently wiping the user's tab layout on reload. The allow-list was also missing several real tab kinds (`profile`, `about`, `generate-image`, `character-new`, `character-edit`, `settings-wizard`), so having any of those open at reload triggered the wipe.

- The allow-list (`TAB_KINDS` in `lib/workspace/workspace-persistence.ts`) now covers every `TabKind`, guarded by a compile-time exhaustiveness check so a future kind can't be forgotten.
- Deserialization is now resilient: a malformed or unknown-kind tab drops only itself (dangling pane references are cleaned up by the existing prune step) instead of failing the whole parse. Layouts from a newer/older build survive a reload with just the unrecognized tabs removed.

#### Fix: clicking a character name in the Salon header now opens a workspace tab

Clicking a character's name in the Salon conversation header navigated the whole browser to the full-page character view, tearing down the workspace (and any streaming conversation) instead of opening the detail view as a tab.

- `/aurora/<id>/view` (and legacy `/characters/<id>/view`) now maps to a new `character-view` workspace tab kind, so the workspace link interceptor opens it in place rather than routing away. The tab is keyed by character id (each character gets its own detail tab) and persists across reloads. Its "back" action closes the tab.
- `CharacterDetailView` accepts an `initialTab` so the header's `?tab=conversations` deep-link still selects the Conversations sub-tab when opened as a tab (where the URL param isn't available).

#### Fix: thinking output silently empty on claude-sonnet-5 (and Opus 4.7+/Fable/Mythos)

After fixing the two 400 errors below, extended thinking on Sonnet 5 stopped showing up in the Salon at all — no error, just nothing. Adaptive thinking on this model family defaults `thinking.display` to `"omitted"`: the response still includes thinking blocks, but their text comes back empty unless the request explicitly asks for `display: "summarized"`.

- `qtap-plugin-anthropic` now sends `thinking: {type: 'adaptive', display: 'summarized'}` for the new-generation model family, in both `sendMessage` and `streamMessage`, so `reasoningContent` capture works again. Older models (fixed-budget thinking) are unaffected.

#### Fix: claude-sonnet-5 (and Opus 4.7+/Fable/Mythos) chats failed with two separate 400s

Selecting `claude-sonnet-5` as a chat's model failed every message with a 400 from Anthropic. Two breaking API changes on the new model generation, both unhandled by the provider plugin:

- `` `temperature` is deprecated for this model `` — the plugin always sent a `temperature` (or `top_p`) value unless extended thinking was enabled, but Sonnet 5, Opus 4.7+, and Fable/Mythos reject sampling parameters (`temperature`/`top_p`/`top_k`) outright, independent of thinking.
- `` "thinking.type.enabled" is not supported for this model `` (hit after turning on extended thinking) — the plugin always sent fixed-budget thinking (`{type: 'enabled', budget_tokens}`), but the same model family removed it; they require `{type: 'adaptive'}` instead, which has no token budget to set.

`qtap-plugin-anthropic` now detects the new-generation model family (Sonnet 5, Opus 4.7, Opus 4.8, Fable 5, Mythos 5, Mythos Preview) by ID prefix and, for those models, omits `temperature`/`top_p` entirely and switches extended thinking to `{type: 'adaptive'}` — in both `sendMessage` and `streamMessage`. Bumped `qtap-plugin-anthropic` to 1.0.45 and rebuilt.

#### Fix: token-budgeted autonomous rooms now pace their run across turns

A `chatType: 'autonomous'` room with a per-run token budget (`budgetMaxTokens`) used to spend most of that budget on a single turn. Context compaction sized each turn against the *model's* context window (often very large), so one turn could carry ~200k+ tokens of history — nearly the whole run budget — and the run exhausted after a turn or two. The per-run budget was resetting to zero correctly at run start; the problem was that nothing connected that budget to how much context each turn was allowed to build.

- The autonomous turn handler now derives a per-turn context cap from the run budget — `remaining_run_budget / turns_left` — and passes it down through the message pipeline. The context manager clamps its model-derived `maxAvailable` to that cap before computing the history and memory fold targets, so the whole context budget shrinks proportionally and the run spreads across multiple turns.
- `turns_left` reuses `budgetMaxTurns` when the room also sets a turn budget (the two budgets cooperate); otherwise it targets a default of 6 turns per run. The cap is floored at 16k tokens so a nearly-spent run still ships a usable final turn instead of a starved one.
- No effect on regular Salon chats, regenerate/swipe, or autonomous rooms without a token budget — the cap is only set for token-budgeted autonomous turns.
- New helper `computeAutonomousContextCap` (`lib/background-jobs/handlers/autonomous-room-turn.ts`), threaded via `SendMessageOptions.autonomousContextCap` → `buildMessageContext` → `buildContext`. Covered by new unit tests.

#### Fix: tag-prefix / line-prefix roleplay chips no longer collapse paragraphs

A roleplay template whose lines are tagged with a speaker prefix (e.g. `[WIFE] …`, the "Covenant RP" template) rendered every paragraph as one continuous run with no blank-line separation. The line-scoped `tagPrefix`/`linePrefix` rules apply a roleplay chip class (`qt-roleplay-1`, `qt-chat-ooc`, etc.) directly to the block element (`<p>`/`<li>`/heading) by design, but the shared chip geometry forced `display: inline` — written assuming those classes only ever land on inline narration spans. On a block that collapsed all the paragraphs into a single inline run, erasing the paragraph breaks.

- Block-level elements carrying a roleplay chip class now keep normal block flow (`display: block`; list items keep `display: list-item`), so paragraph breaks survive. Inline narration/dialogue/monologue spans are unchanged.
- Fixed in both chip families: `qt-roleplay-1..4` / semantic chips (`app/styles/qt-components/_roleplay.css`) and the legacy `qt-chat-narration` / `qt-chat-ooc` / `qt-chat-inner-monologue` classes (`app/styles/qt-components/_chat.css`).
- CSS-only; affects both the client renderer (`MessageContent.tsx`) and the server pre-renderer (`markdown-renderer.service.ts`) uniformly, since both land the line class on the block element.

#### Dev: export autonomous-room budget functions for the Rust port harness

Exported `checkBudget`, `computeBudgetProgress`, and their result/binding types (`BudgetCheckResult`, `BudgetVerdict`, `BudgetExhausted`, `MilestoneBinding`) from `lib/background-jobs/handlers/autonomous-room-turn.ts`. The quilltap-v5 differential port harness imports the real budget-math functions to check the Rust port for equivalence. The exports carry `@port-oracle-export` comments so a dead-code or unused-export sweep won't strip them — they have no importer within this repo. No behavior change.

#### Fix: editing/deleting a message no longer scans the whole account

The per-message endpoints (`PUT`/`DELETE`/`POST ?action=reattribute` on `/api/v1/messages/[id]`) located a message by loading and re-validating **every message in every chat** the user owns, then saved by deleting all of the target chat's messages and re-inserting them one at a time. On a large instance (hundreds of chats, tens of thousands of messages) backed by a slow or network-mounted database, a single edit could take many seconds, time out, or fail with a bare "Failed to update message" and nothing useful logged.

- Messages are now located with a single indexed lookup on the message id (`chats.findChatIdForMessage`) plus an ownership check, instead of an account-wide scan.
- Edit and re-attribute now update the one affected row via `updateMessage`; delete removes only the targeted ids via `deleteMessagesByIds`.
- This also fixes a latent data-loss bug: the old clear-and-rewrite path rebuilt the chat from the *validated* message set, so editing or deleting any message in a chat that contained a separately-corrupted message would silently drop the corrupted row.
- Salon UI: after a successful edit the message now shows the new text immediately. The save handler read `content` off the top level of the `{ message: … }` response (always `undefined`), so the edited bubble blanked until a full reload; it now reads `message.content` (falling back to the submitted text) and maps over the current message list instead of a stale closure.

#### Docs: refresh BACKGROUND_JOBS_CHILD.md to match current handlers

Brought `docs/developer/BACKGROUND_JOBS_CHILD.md` back in line with the code after the 4.6 autonomous-room work and the configurable-concurrency change. Handler count corrected from 18 to 24; added audit rows for `autonomous-room-turn`, `autonomous-run-start`, `autonomous-room-schedule-tick`, `autonomous-room-announce`, and `regenerate-conversation-summaries`; renamed the `wardrobe-announcement` row. Documented the `shutdown-ack` IPC message and the three added host-RPC methods (`writeConversationSummaryToVaults`, `removeConversationSummariesFromVaults`, `startScheduledAutonomousRun`). Corrected the concurrency section: the global cap is read live from the `maxConcurrentJobs` instance setting (4 is only the fallback default), not a fixed value. Docs only — no code change.

#### Z.AI plugin: Reasoning Effort option, glm-5.2 defaults to `high`

Added a **Reasoning Effort** connection-profile option to the Z.AI (GLM) plugin, mapping to Z.AI's `reasoning_effort` request parameter. It only takes effect on glm-5.2 (and newer generations — glm-5.3, glm-6, revisioned ids like `glm-5.2-0626`); it is never sent to glm-5.1, glm-5, glm-5-turbo, the 4.x line, or vision models.

- The editor exposes only the distinct levels — `(model default)`, Minimal, High, Max — because Z.AI's scale is coarse (low/medium fold up to high; xhigh folds to max).
- **glm-5.2 now defaults to `high` effort instead of the API default `max`.** GLM-5.2 thinks compulsorily (thinking defaults to enabled server-side), so a profile left at "(model default)" was previously burning output tokens at the most expensive `max` setting. The plugin now sends `reasoning_effort: 'high'` whenever thinking is not explicitly disabled and no explicit effort is set, curbing runaway thinking-token usage out of the box. Choosing Disabled thinking, or an explicit effort, overrides the default.
- Note: effort is not a hard token cap — reasoning still counts against `max_tokens`, and hitting the ceiling yields `finish_reason: "length"`. Pair a lower effort with a sane `max_tokens` for the robust fix.
- Plugin `qtap-plugin-z-ai` bumped to 1.1.14.

#### Any participant can be switched between user-typed and an LLM

The connection-profile dropdown now appears on every participant card in the Salon sidebar, including the seat you are currently typing as ("You"). Previously the active user seat showed only a "You" badge with no control, so you couldn't hand it off to an LLM without first switching your "Speaking As" selection to another character. The dropdown's "User (you type)" option still reclaims any LLM-driven character for manual control. Switching your only user-controlled seat to an LLM leaves an all-LLM chat (still supported; you can rejoin by impersonating). No data-model change — this was a UI gate; the `controlledBy` field and all turn/impersonation logic already supported the transition.

#### Consistent message-send options across both send endpoints

The two POST endpoints that drive the Salon — `/api/v1/messages?chatId=` (main composer) and `/api/v1/chats/[id]/messages` (whisper dialog) — now build their `handleSendMessage` options from one shared helper, so the forwarded payload fields can't drift apart.

- `/api/v1/messages?chatId=` previously dropped `targetParticipantIds` (whisper targeting) and the scrubbed browser `User-Agent` (used by character tools like curl). Both are now forwarded, matching the other endpoint.
- `speakingAsParticipantId` now reaches the orchestrator uniformly from both routes in both send and continue mode (previously the whisper route omitted it in continue mode).
- Option-building and the SSE response wrapper are centralized in `lib/services/chat-message/request-helpers.ts`; future fields added to `sendMessageSchema` only need wiring in one place.

#### Regenerate now replaces in place and keeps the right character

Reworked message Regenerate (swipe), which was a legacy path that bypassed the chat engine and broke in multi-character scenes.

- The regenerated response is now attributed to the **same character** whose message you regenerated. Previously the new variant was saved with no participant, so it showed the wrong character's name and avatar (and in a chat with multiple user-controlled characters, often the first one).
- Regenerate now runs through the same context engine as a normal turn, so the new response gets the character's real system prompt, multi-character attribution, and memory — instead of a stripped-down raw prompt.
- The new version replaces the old one **in place** as a swipe variant, with the original kept one swipe away. Previously the original's swipe grouping was never saved, so the regeneration showed up as a separate, stray message rather than an alternative.
- A swipe group now shows its newest variant by default (the original stays accessible via the swipe arrows).
- Regenerate is correctly limited to character messages — Staff/system announcements (the Host, Prospero, the Lantern, etc.) can no longer be "regenerated."

#### "Speaking As" is now honored when you have two user-controlled characters

Fixed a multi-character attribution bug: when a chat had more than one user-controlled character, a message you typed was always attributed to the *first* user-controlled participant, ignoring the "Speaking As" selector. The wrong character's name and avatar showed on the message, and the responding AI was told the wrong character had spoken.

- The send path now resolves the human speaker from the active "Speaking As" selection (with the first user-controlled participant as the fallback), instead of always taking the first one. This is applied consistently across message attribution (who the message is saved as), the responder's system-prompt identity (who it thinks it's talking to), and the new-message label in the AI's context.
- The composer now sends the active speaker explicitly with each message and regenerate, so attribution no longer depends on a separately-persisted chat field landing first.
- The optimistic message bubble is attributed to the selected speaker immediately, so it renders with the right name and avatar before the server round-trip.
- Private whispers now honor "Speaking As" too — a whisper sent while playing a second user-controlled character is attributed to that character, not the first one.
- New shared helper `findActiveUserParticipant` replaces ad-hoc "first user-controlled participant" lookups in the three server resolvers; the deprecated `findUserParticipant` is no longer used on the send path.

#### Commonplace Book recall is more on-topic

Reworked the ranking math behind the per-turn "relevant memories" whisper so recall actually tracks what the scene is about, instead of resurfacing the same few high-importance memories every turn.

- Relevance now leads the ranking. Candidates are scored `0.75·cosine + 0.25·rawWeight` (was `0.4·cosine + 0.6·effectiveWeight`), and the importance/recency term decays with age instead of being pinned to a permanent 70% floor. A stale "important" memory no longer outranks a genuinely on-topic one. The blend coefficients are centralized in `lib/memory/memory-weighting.ts` (`computeRankingBlend`) so all four ranking sites stay in sync. The 70% floor still governs housekeeping/protection — only retrieval ranking changed.
- Added a real relevance floor. When nothing in memory clears a minimum cosine, the whisper now says nothing rather than emitting filler. The floor is provider-aware: a lower default for the local TF-IDF profile, a higher one for neural embedding profiles.
- The per-turn search query is now sentence-shaped: a short recent-conversation window instead of a single one-line message, and when cheap-LLM distillation is on, a natural-language paraphrase of the moment instead of a bare keyword bag.
- Added light anti-repetition: a memory whispered in the last few turns takes a bounded penalty so the same entry doesn't read as a stuck record. Tracked per chat in a new `chats.commonplaceRecallHistory` column (ephemeral; not exported).
- A dimension-mismatch between the search profile and a character's stored index — which silently degrades recall to keyword text search — now logs a one-time actionable warning instead of failing over silently.

#### Merge a conversation into another

The Salon's Organize sidebar has a new "Merge In…" button — the inverse of "Continue Elsewhere." It folds another conversation's characters and summary into the current chat at the latest point, instead of forking forward into a new one.

- Pick a recent conversation from a list showing who was involved and when it was last active (the latest user/character message time). Autonomous rooms and the current chat are excluded; the button is hidden inside autonomous rooms.
- A confirm dialog lists the incoming characters with a per-character "Who joins" checkbox (all on by default) so you can gate exactly who comes across — not just rely on de-duplication — plus the same starting-outfit options as the new-chat/continuation flow (defaulting to "Same as last conversation"). Characters already present in the current chat are excluded automatically.
- On merge, each incoming character joins as an LLM-driven participant (the source's user-controlled character is brought in as LLM-driven; the current chat keeps its own user character). The Host posts a recap at the latest point linking back to the source chat and carrying its summary, plus a back-link bubble in the source chat. Existing turns are not replayed.
- New API action: `POST /api/v1/chats/[id]?action=merge-conversation` with `{ sourceChatId, characterIds?, outfitSelections }` (`characterIds` is the optional allowlist of who to bring across).

#### Multiple open documents in Document Mode

In the tabbed workspace, a chat can now keep several documents open at once, each in its own tab.

- The composer's "Open Document" button no longer disappears once a document is open — use it to open additional documents. Each open document gets its own workspace tab (a child of the Salon tab), tracks its own unsaved changes, and autosaves independently.
- Reopening a chat restores every document that was open (skipping any whose file was deleted). The set of open documents is tracked server-side in `chat_documents` (multiple `isActive` rows per chat are now allowed; previously only one).
- The split/focus "maximize" toggle is hidden inside the workspace (a document is already its own maximizable tab); it remains on the legacy `/salon/[id]` route.
- LLM document tools target a specific open document: `doc_focus` and `doc_close_document` take an optional `path` (with `scope`/`mount_point`) to name which document to act on, defaulting to the most recently opened. `doc_focus` results carry the target document's identity so the correct pane scrolls.
- The legacy single-pane `/salon/[id]` route still shows one document (the focused one).

#### Groundwork: Tabbed workspace (Phase 0 scaffold)

Started the tabbed workspace feature (a two-pane shell of kept-alive tabs; see `docs/developer/features/tabbed-workspace.md`). These early phases add no user-visible behavior.

- **Phase 0 (state scaffold).** Introduced the client state model and store: a pure reducer (`lib/workspace/`) for the open-tab set, pane assignment, active tab per pane, focused pane, and split ratio; localStorage persistence with shape validation and dead-tab pruning on hydrate; a `WorkspaceProvider`/`useWorkspace` store; and a development-only `/workspace` route that renders a single home tab. Gated behind a `WORKSPACE_TABS_ENABLED` flag (off by default) so nothing else in the app changes yet. Covered by 38 reducer/persistence unit tests.
- **Phase 1 (view extraction).** Extracted each primary surface's page body into a reusable, props-driven view component (`HomeView`, `SalonView`, `AuroraView`, `ProsperoView`, `ScriptoriumView`, `SettingsView`, `FilesView`, `PhotosView`, `ScenariosView`, `SalonListView`) so the workspace can render them as kept-alive tabs. The existing routes now render these views through thin wrappers, so navigation and behavior are unchanged. The Salon's SSE streaming hooks and virtualized message list were not touched — only the component's entry signature (`chatId` prop instead of route params).
- **Phase 2 (per-tab toolbar).** The previously global page toolbar can now be scoped per tab: a workspace-level registry tracks each tab's injected toolbar content, a `TabToolbarProvider` supplies the same context per mounted tab (so `usePageToolbar()` call sites are unchanged), and each pane renders its active tab's toolbar. The legacy global toolbar is untouched for the old routes.
- **Phase 3 (two-pane host).** The `/workspace` route now renders the real two-pane tab host: every open tab is rendered at once as a flat, always-mounted list positioned by CSS grid column and hidden (never unmounted) when inactive — so a streaming Salon survives tab switches and the split untouched. Tabs can be selected, closed (closing the last resets to a single home tab), reordered, dragged between panes, and dropped onto a center zone to split; a draggable, keyboard-nudgeable divider resizes the panes. Added the `qt-workspace`/`qt-tab-strip`/`qt-workspace-divider` style family, a `/api/v1/system/home` endpoint (backed by a shared `home-data` service so the home tab and the `/` route compute identical data), and a keep-alive integration test that asserts no view remounts across tab switches or a split.
- **Phase 4 (Terminal & Document tabs).** In the workspace, a conversation's Terminal Mode (Ariel) and Document Mode (the Librarian) open as their own tabs linked to the parent Salon tab, instead of splitting inside the chat. The live PTY and editor stay mounted inside the kept-alive Salon view and are portaled into their tabs, so they survive tab switches and can sit in the other pane beside the chat. Opening a mode spawns its tab; turning it off closes the tab; closing the tab turns the mode off; closing the Salon tab closes both children. The old in-chat `SplitLayout` is unchanged and still used by the legacy `/salon/[id]` route.
- **Phase 5 (Brahma + Wardrobe tabs).** The Brahma Console and the Wardrobe can now open as workspace tabs, reusing their existing dialog bodies (an `asTab` rendering mode), so the logic isn't duplicated. The Wardrobe tab is the left-rail, browse/edit path (no "wearing now"); the chat-scoped Wardrobe keeps its dialog so it can still change what a character is actively wearing. Help stays a modal. (The narrow-pane Chat Sidebar auto-collapse is deferred to the polish phase.)
- **Phase 6 (old-route redirects + app-level store, flag-gated).** When the workspace is enabled, it is the post-login landing surface and the workspace store lives in the root layout (which never unmounts across navigation). In-app navigation — the left rail and home-page recent-chat links — opens or focuses a tab in place rather than navigating, so the workspace and its live tabs are never torn down. Deep links and bookmarks to the legacy routes (`/`, `/aurora`, `/prospero`, `/scriptorium`, `/settings` with its `?tab=`/`&section=`, `/files`, `/photos`, `/scenarios`, `/salon/[id]`) still work: they redirect into `/workspace` with a transient `?open=` intent that the workspace applies after hydrating its saved layout (so the restored layout never clobbers the requested tab) and then strips. While the `WORKSPACE_TABS_ENABLED` flag is off (the default), everything renders exactly as before, so making the workspace the primary shell is a single flag flip once it has been reviewed.
- **Workspace chrome + backgrounds.** Styled the workspace surfaces with the `qt-tab*`/`qt-workspace-*` class families using each theme's `--color-*` tokens, so the strip, divider, drop-zones, and panes read correctly across all themes; the active tab carries an accent border and top bar. Replaced the per-pane story/subsystem background layers (which, being viewport-fixed, overlapped in a split) with a single arbitrated workspace backdrop: a conversation with a background fills the screen; otherwise the active tab's background does; in a split, each pane's background dominates its side and crossfades across the divider. The Salon keeps its own original background treatment on its side. Help docs and the in-flight `WorkspaceProvider`/backdrop registries are covered; a reporter-loop regression test guards the backdrop registry.
- **Phase 7 (theming pass).** Reworked the workspace accent so every accented surface (active tab, pane divider, split drop-zone) derives from one master token, `--qt-workspace-accent` (it falls back to `--color-primary`). Each of the six bundled themes now sets that single token to its own signature color — Madman's Box cyan, Art Deco and Great Estate gold, Earl Grey and Rains blue, Old School slate — and the previously hard-coded Madman's Box teal override was removed from app CSS in favor of the theme bundle. Added a Workspace story (and supporting CSS) to `@quilltap/theme-storybook` and documented the new hook in the `create-quilltap-theme` bundle template, so theme authors can preview and customize the workspace. Bumped the six bundled theme versions plus the two author-tooling packages.
- **Phase 8 (polish).** Added keyboard shortcuts for the workspace, all namespaced under Ctrl/Cmd+Alt and inert while typing: next/previous tab (arrows, wrapping), jump to the nth tab (1–9), close the active tab (W), and toggle split (\\). The tab strip now scrolls the active tab into view when many tabs overflow a narrow pane, and a defensive empty-pane affordance covers any state where a pane has no resolvable view.
- **Chat Sidebar narrow-pane overlay.** In a narrow split pane the Salon's chat sidebar no longer squeezes the conversation: it measures its container and, below a width threshold, defaults to the mini-avatar strip and expands as a click-away overlay (dismissed by an outside click or Escape) instead of an inline panel. Wide/full panes (and the legacy route) behave exactly as before. Completes the deferred Phase 5 item.
- **Keep-alive navigation fixes.** Opening a tab from inside the workspace no longer reloads the whole workspace and interrupts a streaming Salon. Previously only the left rail and home recent-chat links opened tabs in place; every other in-app link to a tab-equivalent surface (the Settings button in the sidebar footer, autonomous-room badges, "continue last," chat cards, in-help links, etc.) hard-navigated to the old route, which redirected back and remounted everything. Added a single document-level link interceptor (`WorkspaceLinkInterceptor`) that catches any anchor whose href maps to a tab and opens it in place; it bails when a link already handled its own click, so the rail/recent-chat paths are unaffected. Added a `useWorkspaceNavigate` hook for programmatic navigations and used it for chat cards (which used `router.push`). The sidebar footer's Brahma Console and Wardrobe buttons now open their workspace tabs instead of dialogs when in the workspace (the in-chat Wardrobe stays a dialog).
- **Detail-in-view drill-down.** Inside the Aurora, Prospero, and Scriptorium tabs, opening a character, project, document store, or character group now renders its detail in place (state-driven) instead of navigating to the detail route, so the workspace and a streaming Salon in the other pane stay mounted. Each detail page body was extracted into a shared, props-driven view (`CharacterDetailView`, `ProjectDetailView`, `DocumentStoreDetailView`, `GroupDetailView`) that the route still renders (with a router-based back) and the list view renders in place (with a state-based back); the detail views are lazy-loaded so the list bundles stay lean. The legacy routes are unchanged.
- **New-chat opens a tab.** Creating a chat from within the workspace (a character's Chat button, the Aurora character chat action, continuation/change-of-venue) now opens the new conversation as a tab in place rather than navigating to it, so another pane's stream survives. The `useNewChat` post-create navigation routes through `useWorkspaceNavigate`.
- **In-workspace new-chat modal.** The generic "Start a chat" / "New chat" entry points (home quick actions, project headers, empty states) no longer navigate to the full-page `/salon/new` form, which would leave the workspace. A new app-level `NewChatProvider` (mounted inside the workspace providers so its create flow opens a tab) renders the new-chat experience as a modal, and the link interceptor opens it for any `/salon/new` link in place. Autonomous-room creation still routes (no modal flow for it yet).
- **Dialogs hover over the whole workspace (stacking fix).** A `fixed` dialog opened from inside a split pane (e.g. the Salon's "Continue Elsewhere" / New Chat modal) was trapped in that pane's stacking context, so the other pane painted over its far half. The content pane no longer establishes a stacking context (it keeps `position: relative` but drops its `z-index`), so such overlays escape to the workspace root and cover the entire viewport, as dialogs should — this fixes every dialog rendered inside a tab, not just new-chat. The New Chat modal is additionally portaled to the document root as belt-and-suspenders.
- **Tabbed workspace is now the default (Phase 6 cutover).** The `WORKSPACE_TABS_ENABLED` flag now defaults on: the workspace is the post-login landing surface, its store lives app-level, and the legacy per-surface routes redirect into it carrying a `?open=` intent. Added redirects for the newer tab-equivalent routes (character edit/new, image generation, Profile, About, the provider wizard) and taught the intent handler to open those kinds (the character editor with its character id and sub-tab), so deep links and bookmarks land on the right tab. Bare detail URLs still render standalone (they have no tab kind and drill down in place). Set `NEXT_PUBLIC_WORKSPACE_TABS=0` to opt back out — everything then renders via the old per-surface routes, exactly as before.
- **Remaining keep-alive navigation holes closed.** Several surfaces still hard-navigated out of the workspace — remounting it and interrupting a streaming Salon. Added workspace tab kinds for the character editor, the create-character form, the standalone image generator, the Profile and About pages, and the provider setup wizard, and mapped their routes (including the legacy `/characters/[id]/edit`) so the existing link interceptor opens them in place. A bare character-detail URL intentionally stays uninterceptable — it renders in place inside the Aurora tab. Made the remaining programmatic navigations keep-alive-aware too: the sidebar Profile/About menu, the in-app Help links (Guide and Ask), and the inline terminal's "pop out" button (now opens a Terminal tab parented to its conversation). Editor/creator tabs de-dupe per character, and finishing one (the character editor's Save/Cancel, the new-character form, the wizard) closes its own tab and returns focus to the kept-alive tab it was opened from — typically the Aurora grid or the character detail, still showing exactly where you left it. Autonomous-room creation now opens the new-chat modal in autonomous mode (≥2 LLM cast, no user character) instead of routing to the full-page form. The legacy routes are unchanged.

