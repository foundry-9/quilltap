# Quilltap Changelog

## Recent Changes

### 4.9-dev

#### Changed: full-wipe memory deletion now goes through the memory-gate chokepoint

The replace-mode restore / delete-all-data path (`lib/backup/restore/delete-service.ts`) deleted
memories with per-row `repos.memories.delete` calls in a loop — the last remaining bypass of the
`deleteMemoriesWithUnlinkBatch` deletion chokepoint. It now collects every doomed memory id and makes
one batch call. In the full-wipe case the chokepoint's neighbour scrub is a no-op (every neighbour is
itself in the doomed set), so the change also collapses N per-row deletes into per-character bulk
deletes. Added a regression test asserting the direct repository delete is never hit.

#### Changed: refactor sweep over everything touched since 4.8.0 (checklist item 3)

Reviewed all 524 non-test TypeScript files changed since 4.8.0 for duplication, SRP, YAGNI, and
encapsulation leaks, then applied the confirmed findings. Behavior is preserved throughout — same
strings, status codes, wire bodies, and log lines. Highlights, grouped:

- **Route factories.** The byte-near-identical group/project scenario item routes (292/290 lines each)
  are now thin configs (48/46) over `lib/mount-index/scenario-item-route-factory.ts`; the four
  group/project wardrobe routes (671 lines combined) collapse to 154 over
  `mount-wardrobe-route-factory.ts`. The `?action=instructions` GET/POST pair, copy-pasted across four
  wardrobe routes, lives once in `lib/wardrobe/wardrobe-instructions-handlers.ts`. Scenario
  create/update/rename Zod schemas single-sourced in `scenarios-common.ts`; two wardrobe routes'
  local schemas replaced with the existing `createWardrobeSchema`.
- **Hooks.** `useProjectScenarios`/`useGeneralScenarios` (~200 duplicated lines) are now one
  `useScenarioMutator(basePath)`. `useChatSettings`'s ~23 copy-pasted PUT-and-mutate handlers share one
  `patchChatSettings` helper. New shared `useChatSettingsQuery`, `useRealtimeFallbackPoll`, and
  `useAutonomousRoomAction` hooks replace five ad-hoc settings-query types, three hand-rolled
  socket-down polls, and a duplicated optimistic mutation.
- **Wardrobe/tools.** Wear/take-off handlers share `finalizeWardrobeMutation`; equipped-slot rendering
  (with the hair "never report empty" rule), the shared-item refusal message, and the equipped-slot
  probe are single-sourced in `wardrobe-handler-shared.ts`; the photo handlers' triplicated vault guard
  is one helper. Generic cheap-LLM parsing (`stripCodeFences`, `parseLLMJson`) moved out of the
  1,400-line `ai-import.service.ts` into `lib/llm/llm-json.ts` (eight importers re-pointed);
  `sanitizePronouns` to `lib/characters/sanitize-pronouns.ts`.
- **Data layer.** `resolveDefaultOutfit` (three call sites, all reaching the same unreachable-fallback
  path) deleted in favor of the existing `buildDefaultOutfit`. New `classifySchemaColumns` and
  `requireMountIndexDb` helpers replace eleven and nine verbatim blocks across the repositories. The
  characters/store-backed `_create` overrides (~30 duplicated lines each) are now `toPersistedRow` +
  `createErrorMessage` hooks on the base repository. The dead `getPreserveIdsCreateOptions` became the
  real one, used at 14 import sites. Title cleanup and the help-chat/normal-chat title twins in
  `cheap-llm-tasks` collapsed into `cleanTitle` and two parameterized implementations.
- **Runtime.** Outfit description and appearance-resolution flattening deduped between the chat context
  manager, scene-state tracking, story-background, and image generation; job-dispatcher id probes fold
  into `job-topics.firstIdArg`; the SQLCipher key pragma is one `applySqlcipherKey` across six sites;
  tab-refetch asks `topic-map` for the character key triple; duplicate `getDbKeyPath` and the dead
  `enrichMany`/`unsetAllDefaults` middleware utilities deleted.
- **Components.** AI-wizard's four-times-repeated character-data shape is one `WizardCharacterData`;
  optimizer field maps, the field-hint key lookup, and the "Written as:" example render moved into
  their chokepoints; scenario option mapping, the wizard save-physical-description/save-scenarios
  blocks, and the size-only image-provider parameter markup deduped; wardrobe URL literals now go
  through `wardrobe-container`; the emoji/unicode picker wrappers deleted in favor of one
  `CharPickerToolbarButton`.
- **Plugins/packages.** `@quilltap/plugin-utils` 2.5.0 (needs `npm publish`): OpenAI-compatible
  send/stream now share one `buildRequestBody`. NanoGPT 1.1.1: base URL and image MIME list
  single-sourced (the bug-97 pattern). Ollama 1.0.46: think-parameter retry and request build deduped.
- Also: legacy `useMessageStreaming` hook deleted (pre-Salon leftover with duplicate types); routes
  now use `conflict()`/`created()` helpers instead of hand-rolled `NextResponse.json`; a scenarios
  route stopped bypassing middleware-supplied repositories (this also fixed a latent crash — the
  refactor pass's one live-bug catch: general-scenario POST referenced `repos` without destructuring
  it after an earlier edit).

Known tiny deviations, all judged harmless and noted in review: the four chat-title sites gain a
second trim (a title like `"My Title "` now cleans fully); two views' console-only error-log formats
unified; group scenario options' object key order shifts. Deliberately left alone: the two
image-description-profile handlers in `useChatSettings` (three-way deviation from the pattern),
`BrahmaConsoleSettings`/`DataRetentionSettings` (pre-existing twin, barely in the diff), the typeahead
insert helpers (docblock names a planned consumer), `validateProviderConfig`'s api-key default
disagreement (a behavior decision, not a refactor), and the plugin embedding-provider/image-entry
dedups (would grow plugin-utils' public API for two consumers each).

Verified: `npx tsc` clean; full unit suite green (725 suites / 11,237 tests, tool-schema snapshot
unchanged); `npm run lint` clean. Net: roughly 2,800 lines removed across 134 modified files, plus
the new shared modules.

#### Added: 4.9.0 release notes, and a documentation-freshness sweep (checklist item 13)

Walked the seven files checklist item 13 names, against the 67 commits of the 4.9 cycle
(`0cd769f3..HEAD`).

`docs/releases/4.9.0.md` did not exist and now does — the production release notes for 4.9.0, matching
the version in `package.json`, drafted from the CHANGELOG in the pattern of `docs/releases/4.8.0.md`.
It leads on realtime, the wardrobe work, archivable scenarios and garments, the Documents search chip,
mid-chat scenario changes, and prompt person consistency, and carries an Upgrading section covering the
three new migrations, the `PROMPT_CACHE_STRUCTURE_VERSION` 3 - 4 roll, the reverse-proxy requirement
for the WebSocket upgrade, and the new `NANOGPT` key type. **The human should review it before the
release** — `tag-for-release` asks whether the developer would rather write a minor release's notes
themselves, and this was drafted rather than asked.

Three genuine drifts in `docs/developer/API.md`, all found by diffing the documented paths against
`app/api/**/route.ts`:

- `GET /api/v1/embedding-profiles/models` is not a route. The three real actions
  (`?action=list-providers`, `?action=list-models`, `?action=fetch-models`) are now documented, including
  what `fetch-models` does for a provider whose plugin implements no `getAvailableModels`.
- `PATCH /api/v1/user/profile/avatar` is not a route either; it is `?action=set-avatar` on the profile
  route, the only action that verb accepts.
- `/api/v1/settings/brahma-console` (GET/PUT) was undocumented entirely.

Everything else matched: 131 of the 132 route files were already documented, and the only "documented
but missing" path left is `GET /api/v1/system/realtime/stream`, which is the realtime WebSocket and has
no `route.ts` by design.

Smaller fixes:

- `README.md` — the realtime interface and shared clock, the Documents search chip and where a result
  opens, mid-chat scenario changes, per-wardrobe dressing instructions and the all-container Wardrobe
  dialog, outfit-with-components transfers, archivable scenarios and garments, anti-chorus discipline,
  per-turn conversation summaries, and `describe_image` plus the two-question image transport check. The
  version badge was already current.
- `docs/developer/DEVELOPMENT.md` — `lib/realtime/` and `server.ts` added to the project structure, and
  the Linting section now documents `scripts/check-qt-classes.mjs` (the third `npm run lint` gate, added
  this cycle with bugs 100/102) and notes that `lint:fix` does not run it.
- `CLAUDE.md` — the same `qt-*` guard as a standing rule under Themes.
- `app/about/AboutView.tsx` — the provider list was missing DeepSeek, Z.AI, and NanoGPT; added, along
  with a Key Features bullet for the live interface. The version there reads from `package.json` and was
  already current.
- `.claude/commands/update-documentation.md` — two links pointed at `features/artifacts.md` and
  `features/qt-docs-auto-embed.md`, both of which moved into `features/complete/`. Every one of the 80
  document links in that file now resolves.

`docs/CHANGELOG.md` needed nothing: all 67 commits of the cycle are recorded, in plain voice. Its
`### 4.9-dev` heading is renamed to `### 4.9.0` by `tag-for-release` itself, so it is correct as it
stands on a dev branch. The help set needed nothing either — every user-visible commit this cycle
carried its `help/*.md` update, and all 120 help files have `url` frontmatter with a matching
`help_navigate(...)` (the seven apparent mismatches are the deliberate ones: `url: *` for the
everywhere-surfaces, `/salon/:id` for a pattern, and `/` for the two floating panels that are not routes).

#### Fixed: restore let the table DEFAULT decide two connection-profile settings (bug 103, checklist item 10)

Audited every data-model addition since 4.8.4 against backup and restore. All of them ride along
correctly, but the audit turned up a defect in the mechanism that makes that true.

Restore rebuilds a row by spreading the archive record, which is what lets a *new* column ride along
with no restore change — and is exactly why a column the archive is **older than** got no answer at
all. An absent key is absent from the INSERT column list, and SQLite fills it from the table DEFAULT.
`connection_profiles.multiCharacterPrefill DEFAULT 1` turned the `[Name]` prefill on for every profile
in a pre-4.9 backup, Anthropic included, where 4.6+ rejects an assistant tail and every multi-character
turn then 400s. `supportsImageUpload DEFAULT 0` did the mirror image to a pre-4.3 backup and stripped
vision from the profiles that had it. Both columns' migrations backfill thoughtfully, but a migration
runs on the upgrade path only.

New `lib/llm/connection-profile-legacy-fields.ts` seeds the columns an older archive cannot carry:
`supportsImageUpload` from the frozen historic provider map, `multiCharacterPrefill` as an explicit
`null` — the documented "never chosen" state — so `profileUsesNamePrefill()` resolves the provider
default. Both `restore.ts` and `import-profiles.ts` call it, so a backup ZIP and a `.qtap` bundle
carrying the same profile now land the same row; import's private copy of the provider set is gone.
A key the archive did carry is never touched, a stored `false` and a stored `null` included. The
provider set is matched case-insensitively — `ProviderEnum` is a plugin-supplied `z.string()`, not a
closed enum, so the exact-case check the inline version used would have missed a lowercased `openai`.

Tests: 16 cases for the helper, and a 4.9 block in `restore-field-fidelity.test.ts` (the three
seeding cases fail against the pre-fix restore, plus pass-through coverage for `multiCharacterPrefill`
and the `hair` slot in `chats.equippedOutfit`). Suite: 725 files, 11,234 tests, all passing
(was 724 / 11,213).

Docs: `docs/BACKUP-RESTORE.md`'s "What's Included" list was several cycles stale — it omitted document
stores, instance settings, chat settings, text replacement rules, Document Mode state and the whole
embedding family, and still advertised the `wardrobe_items` and `outfit_presets` tables dropped in 4.7
and 4.5. Rewritten, with the exclusions stated and their reasons. `help/system-backup-restore.md` and
`help/connection-profiles.md` gained the same corrections in the user's voice. DDL.md now documents
`Wardrobe/instructions.md` and the scenario `archived` frontmatter key, both added this cycle.

#### Verified: published packages and consistent installs (checklist item 9)

Audited every package under `packages/` that changed since 4.8.4 and confirmed each is
version-bumped, published to npm, and consistently referenced by everything that consumes it. No
code changed in this pass: the one defect it found, the OpenAI-Compatible plugin's undeclared
`@quilltap/plugin-types`, is recorded under checklist item 8 below, which landed the same fix.

- All four changed packages are bumped and published: `plugin-types` 2.5.8, `plugin-utils` 2.4.0,
  `theme-storybook` 1.0.64, and the `quilltap` CLI at 4.9.0-dev.75 (the CLI publishes automatically
  at release). Every bump landed in the same commit as its content change, so no package shipped
  source ahead of its version, and nothing awaits a manual `npm publish`.
- Root `package.json` is current, and after a clean install all 15 plugins resolve plugin-utils
  2.4.0 and plugin-types 2.5.8. The committed bundles already carry the current 2.3.0/2.4.0 APIs.
- The older caret ranges some plugins declare (`^2.2.20`, `^2.5.6`) are accurate floors — those
  plugins use no 2.3.0+ API — so they were left alone rather than tightened into a minimum they do
  not actually require.
- A full `npm run build:plugins` rewrites seven bundles, but every drifted section is third-party
  float: `openai` `^7.4.0` now resolving 7.5.0, plus `@openrouter/sdk` and an MCP URI-template
  dependency. No Quilltap package code differs, so the rebuild was left out. Plugins carry no
  lockfiles, so any rebuild picks up whatever the carets resolve to that day.
- `plugin-types` 2.5.8 and `theme-storybook` 1.0.64 are published with no CHANGELOG entry of their
  own; 2.5.8 ships new public API (`supportsThinking`, `thinksByDefault`, `ThinkingTurnRule`).

#### Removed: leftover debug logging (checklist item 6)

Swept every `.ts`/`.tsx` change since 4.8.4 for logging added during development and removed one
line: the per-publish `Realtime publish coalesced` debug print in `lib/realtime/bus.ts`.

It fired on every `publishRealtime` call that landed inside the 250 ms debounce window. Job status
transitions pump that path from `job-dispatcher.ts` and `activity-registry.ts`, so an
`EMBEDDING_REINDEX_ALL` sweep of 1000 jobs emitted one `publish queued`, 999 `publish coalesced` and
one `publish flushed`. The surviving `publish flushed` line already reports the same total once per
window, and with logs rolling every 2-3 MB the per-absorb copy only evicted real diagnostics. The
`coalesced` counter itself stays, since `flushed` reads it.

Nothing else was pruned. The remaining new debug logs are structured, guarded and bounded (once per
flush or per connection, not per publish), which is what the logging convention asks for. Every
`console.*` added since the release is in client paths at `error`/`warn` level, matching the
existing convention in 145 other files, so there was no backend `console.*` to convert.

#### Fixed: OpenAI-Compatible plugin declares the plugin-types it requires (checklist item 8)

`qtap-plugin-openai-compatible` shipped a bundle that emits a runtime
`require("@quilltap/plugin-types")`. The plugin's own source imports that package for types only, but
`@quilltap/plugin-utils` imports it for real, and esbuild marks it external — so the require survives
into the bundle. The plugin's `package.json` never listed it. It resolved anyway, but only because npm
pulls it in transitively through `@quilltap/plugin-utils` and hoists it somewhere Node's upward walk
reaches: the same luck-based resolution that broke Mistral installs. A strict (pnpm-style)
`node_modules` layout would have failed the load with MODULE_NOT_FOUND.
`qtap-plugin-default-system-prompts` externalizes the same package and declares it properly; this one
is now consistent with it. Dependency metadata only — no change to the bundle. Plugin 1.0.42.

Audited the other fourteen distributed plugins in the same pass. No reach-ins anywhere: no `@/lib`, no
`@/` alias, no relative path escaping a plugin directory, in sources, bundles or build configs. Every
`./types` barrel is a thin re-export of `@quilltap/plugin-types`. `@quilltap/plugin-utils` is bundled
by all fifteen (externalized by none). Cache-read tokens are excluded from `promptTokens`/`totalTokens`
in every provider that folds them into the prompt count, and correctly *not* excluded in Anthropic,
which reports `input_tokens` separately from `cache_read_input_tokens`. The Anthropic new-generation
model-ID prefix branch is intact. The remaining undeclared bare requires in other bundles
(`ajv`/`ajv-formats` under MCP, `google-auth-library` under Google, `zod` under OpenRouter) are
transitive dependencies of declared packages or app-provided externals, and are already accounted for
by the standalone tarball's `pruneRedundantPluginModules`.

#### Changed: qt-* theme utility sweep (checklist item 7)

Reviewed the 118 `.tsx` files changed since 4.8.4 for hard-coded Tailwind that themes cannot reach,
and converted 20 sites across 15 files.

Sixteen were solid semantic fills — `bg-destructive`, `bg-success`, `hover:bg-primary` — swapped to
their `qt-bg-*` equivalents. These read the same token either way, so nothing moved on screen; the
point is consistency, since `qt-` already carried the overwhelming majority of these call sites
(`bg-destructive` was 8 Tailwind against 62 qt). `ChatCard.tsx:268` and `TaskFilters.tsx:140` were
each the odd branch of a ternary whose siblings were already `qt-`.

Two were genuinely unthemeable and do shift slightly:

- `CharacterHeader.tsx:139` — the avatar placeholder was `bg-gray-300 dark:bg-slate-700`, a new
  inline copy of the pattern in `lib/avatar-styles.ts`. Now `qt-bg-muted`, matching
  `--qt-avatar-bg`, which is what every other avatar in the app already resolves to.
- `image-gallery.tsx:176` — `bg-black bg-opacity-0 group-hover:bg-opacity-50` became
  `qt-bg-overlay-medium`, matching `GenerateImageView.tsx:315`. The `bg-opacity` pair was redundant
  with the `opacity-0`/`group-hover:opacity-100` fade on the same element, hover alpha goes 0.5 to
  0.6, and the value is now theme-controllable via `--qt-overlay-medium-bg`.

Both checkboxes in `memory-recall-card.tsx` moved from raw `border-input text-primary
focus:ring-primary` to `qt-checkbox`, joining 40 existing adopters at the same rendered size.

Added `.hover\:qt-bg-primary` and `.hover\:qt-bg-success`, the missing solid-fill siblings of the
existing `.hover\:qt-bg-destructive`. Tailwind generates no variants for classes declared inside
`@layer utilities`, so each hover form has to be written by hand or it is inert. Mirrored into
`packages/theme-storybook` (1.0.65). The bundled themes need no edits — all six already define the
`primary` and `success` tokens these rules read.

`text-foreground` was left alone. It maps to the same token as `qt-text`, but Tailwind is the house
convention there by 376 uses to 73, so converting the seven in scope would only make them the
inconsistent ones.

Two pre-existing gaps are recorded but out of this item's scope, both unchanged since 4.8.4:
`lib/avatar-styles.ts` hard-codes the avatar chrome app-wide, and eleven more raw checkboxes remain
under `components/settings/chat-settings/`.

#### Fixed: CLI shell completions missed four documented flags (checklist item 12)

Audited the CLI's command surface against `--help`, [CLI.md](developer/CLI.md), the package README,
and the three completion templates. The command modules themselves are unchanged since 4.8.4 — only
`bin/quilltap.js` (native-module linking) and the completion templates moved this cycle — but four
flags that `--help` documents were reachable by typing and invisible to tab-completion:

- `docs docker-mounts --format args|json` — missing from bash, zsh, and fish. bash also needed it in
  `vf_docs`, its value-flag list, or `--format json <TAB>` would have read `json` as the verb.
- `docs --uri` and `docs --base64` — missing from fish.

`completion-coverage.test.js` guarded only the top-level subcommand surface, so none of this failed a
build. It now also asserts that every long flag named in a subcommand's own `--help` is offered by all
three templates, and cross-checks bash's `vf_*` value-flag lists against zsh's `:value:` specs. Removing
any one of the four flags again fails the suite.

Docs: the package README gained the `docs docker-mounts` verb (shipped in 4.8.4 with no README entry)
and a rewritten "What gets completed" section covering the flag-anywhere parsing and positional
store-name completion added in the bug 101 fix.

Both guards originally compared flags by substring, which passes for a flag that is not there when
another flag has it as a prefix — `--max` reads as present when only `--max-nodes` is listed. They now
match whole tokens, and the help-function pattern tolerates reformatting rather than asserting on
whitespace.

#### Removed: dead code sweep (checklist item 5)

Ran knip over the repo and removed 11 unused exports across 9 files. knip's raw output is mostly
intentional surface, so each candidate was scored by whole-repo reference count and then confirmed
by hand before deletion.

- `useAvatarDisplayContextOptional` (`components/providers/avatar-display-provider.tsx`) — the last
  of the `use*Optional` context hooks; the other three went in an earlier sweep.
- `readJsonFileOptional` (`lib/backup/restore/json-stream.ts`), `joinFolderPath`
  (`lib/files/folder-utils.ts`), `standaloneTabPayload` (`lib/documents/open-document-in-chat.ts`).
- `createApiLogger` and `createRepositoryLogger` (`lib/logging/create-logger.ts`) — the two members
  of the logger family with no callers; the other three are used 373 times between them.
- `databaseFolderHasContents` (`lib/mount-index/database-store.ts`) — no production caller; its only
  references were five `jest.mock` stubs, removed with it.
- `GROUP_WARDROBE_FOLDER` and `PROJECT_WARDROBE_FOLDER` — unused one-line aliases of
  `SHARED_WARDROBE_FOLDER`.
- `resolveSharedWardrobeTiersForProject` and `noSharedWardrobeTiers` (`lib/wardrobe/shared-tiers.ts`)
  — superseded by the per-character loop the module documents for that case.

Two flagged constants were deduplicated instead of deleted. `HAIR_PHYSICAL_BOUNDARY` and
`HAIR_PHYSICAL_DESCRIPTION_NOTE` (`lib/wardrobe/slot-guidance.ts`) were duplicated verbatim as inline
literals in `lib/services/character-field-semantics.ts` — the exact divergence that module exists to
prevent — so the semantics file now interpolates them. The strings are byte-identical, verified by
expanding the patched file back to literals and diffing against HEAD, so no prompt text changed and
no identity-stack version bump is owed.

Two knip "unused file" reports were false positives and are now handled in `knip.json`:
`jest.integration.config.ts` (invoked by two `package.json` scripts via `--config`) is listed as an
entry, and `__tests__/helpers/lexicalPluginHarness.tsx` (imported by four live suites) is ignored.

`docs/developer/DEAD-CODE-REPORT.md` records the full round, including the symbols kept with reasons.

#### Added: release-checklist test coverage (checklist item 2)

Audited every bug fixed since 4.8.4 (bugs 66-102, all 37) and all 55 source modules added in the
same range. 29 bugs already had regression tests; 50 of the new modules already had coverage.
Nine test files added, 70 cases:

- Regression tests for the four fixed bugs that had none: bug 77 (tool-execution notice pinned above
  the composer), bug 83 (V8 Sparkplug worker segfault), bug 94 (`attachmentResults` ledger never
  displayed), bug 99 (gallery modal controls painted over by the page toolbar).
- First coverage for five new modules: `lib/file-storage/digest-policy.ts`, `lib/realtime/ws.ts`,
  `lib/database/repositories/help-doc-chunks.repository.ts`, `app/aurora/shared/save-generated-wardrobe.ts`,
  and `components/chat/ChatScenarioControl.tsx`.

Two behaviour-neutral extractions were needed to make bugs 77 and 94 testable, both following the
pattern `resolveToolResultErrorText` already set in the same file: the tool-execution notice's state,
timer, and callbacks moved out of `useSSEStreaming.ts` into a new `useToolExecutionStatus.ts`, and the
failed-attachment toast sentence became an exported `buildFailedAttachmentWarning`. The hook's public
surface is unchanged.

Suite: 724 files, 11,213 tests, all passing (was 715 / 11,143).

Bugs 89 and 90 remain without unit tests by design — 89 lives in the CLI bin's native-module linking
and only misbehaves against a real install tree; 90 is guarded at build time by
`scripts/assert-standalone-portable.mjs`. Bugs 100 and 102 are guarded by `scripts/check-qt-classes.mjs`
in `npm run lint`.

#### Added: realtime interface updates (WebSocket push + shared clock)

Implements `docs/developer/features/complete/realtime-updates.md`. Two separate causes of a stale
screen, two separate mechanisms.

**Server state changing — push it.** A single multiplexed WebSocket at
`/api/v1/system/realtime/stream` carries invalidation hints (`{v, topic, id?, at}`, ~40 bytes) to every
open tab. Hints never carry data: the client maps a topic onto `queryClient.invalidateQueries`, so the
REST API stays the single source of truth and a reconnect is just "invalidate everything and refetch."

- `lib/realtime/bus.ts` — parent-process fan-out singleton (`globalThis`-backed, so it survives dev
  HMR) with a mandatory 250 ms trailing-edge debounce per topic+id. Verified live: 12 concurrent
  enqueues arrive as one frame. Publishing from the forked job child is a no-op; the child's changes
  reach the bus through the existing IPC.
- `lib/realtime/ws.ts` + a second branch in `server.ts`'s `upgrade` listener, anchored so Next's own
  HMR/dev-RSC upgrades still fall through. `scripts/build-standalone-overlay.mjs` emits the new handler
  alongside the terminal one so it exists in the tarball.
- Publish points: `enqueueJob` / `enqueueMemoryExtractionBatch` / `cancelJob`, successful
  `claimNextJob`, `markCompleted` / `markFailed`, activity-registry span start and end plus
  `applyChildActivityDelta`, the autonomous-room run-state transitions, and — for entity topics —
  `topicsForCompletedJob` on job completion and `topicsForWriteBatch` inside the dispatcher's
  post-commit `dispatchInvalidations`, which sees every background-job write after it lands.
- Client: `lib/realtime/client.ts` (one socket per tab, 1 s → 30 s jittered backoff, 30 s ping,
  visibility-aware), `lib/realtime/topic-map.ts` (topic → query-key prefixes; unknown topics ignored so
  an older tab survives a server upgrade), and `RealtimeProvider`, which invalidates every mapped
  prefix on connect as the catch-up for anything missed while disconnected.

**Polling is now the fallback, not the mechanism.** Every migrated site keeps its original cadence
wired but gated on socket health via `useRealtimeRefetchInterval` / `useRealtimeTopic`: toolbar queue
chips (now a TanStack query on `queryKeys.system.jobs`, adaptive 1.5 s/8 s retained as fallback),
autonomous-room badges and card, tasks queue, story background (both the 30 s passive sweep and the
3-minute active loop), the memory-backfill / memory-regenerate / summary-regenerate cards, the
character conversations tab's Scriptorium watch, and the Salon's avatar watch. `StartupProgress` and
`useHealthCheck` deliberately keep polling. Measured on a live instance: zero background fetches in a
10 s idle window that previously cost at least one.

**Auth hardening.** `lib/realtime/upgrade-auth.ts` is now the single gate for both WebSocket handlers:
live session, not locked, and same-origin. It replaces the terminal handler's "a session-ish cookie
exists" fallback, which proved nothing — Quilltap sets no session cookie, so it accepted any request
carrying any cookie. Browsers do not apply CORS to WebSocket upgrades, so the origin check is what
actually keeps another site from opening a socket against a localhost instance; a missing `Origin`
(non-browser clients) is still allowed.

**The clock advancing — tick it locally.** `hooks/useNow.ts` is a shared, boundary-aligned ticker: one
timer per granularity regardless of how many components subscribe, ticks just after each minute /
second / local-midnight boundary so every "4m ago" on screen flips together, inert during SSR, and
paused for sub-minute granularities while the tab is hidden. Adopted by the tasks queue, the merge
picker, `ChatCard` (day granularity, for the Today → Yesterday rollover), `StartupProgress`, and the
autonomous-room budget readout, which drops its bespoke 1 s interval. `StartupProgress`'s private
`formatRelativeAge` moved into `lib/format-time.ts`; `formatRelativeDate` and `formatChatListDate` take
an optional `nowMs`.

**User-visible change:** the tasks queue's "Auto-refresh (5s)" toggle is now "Fallback polling (5s)" —
same switch, honest name. Documented in `help/system-tasks-queue.md`.

#### Fixed: the toolbar activity chips now count the whole job

The **Mem / Emb / Sum / Dgr / Img** chips in the page toolbar only ever counted rows in the
`background_jobs` table, and only the job types someone had remembered to list. Everything else was
invisible. Three of the four image-generation paths are not jobs at all — the Lantern's
`generate_image` tool, the wardrobe avatar preview, and `POST /api/v1/images?action=generate` — so
those ran start to finish without **Img** moving. Nine job types belonged to no chip
(`MEMORY_HOUSEKEEPING`, `CARINA_MEMORY_EXTRACTION`, `EMBEDDING_REAPPLY_PROFILE`,
`CHARACTER_HEADSHOULDERS_BACKFILL`, `WARDROBE_OUTFIT_ANNOUNCEMENT`, and others). Per-message Concierge
classification and every inline embedding call showed up nowhere.

What changed:

- **Chip membership is now exhaustive by type.** `JOB_TYPE_ACTIVITY` in
  `lib/background-jobs/activity-kinds.ts` is a total `Record<BackgroundJobType, ActivityKind | null>`,
  so adding a job type without assigning it a chip is a compile error. Deliberate omissions are spelled
  `null`. The nine unassigned types now have chips.
- **Non-job work registers with an activity registry** (`lib/background-jobs/activity-registry.ts`).
  The three inline image paths, the Concierge classifier, the embedding service, the memory gate, and
  every cheap-LLM task now count for their full duration. A chip is lit from the first token of prompt
  crafting until the result lands or fails.
- **Reading an image counts as image work.** Vision calls — the wardrobe image analyzer, the character
  wizard's image description, the chat attachment describe-fallback, and the `describe-attachment`
  cheap-LLM task — light **Img**, the same as generating one.
- **Counting is re-entrant by kind.** A job handler is attributed to its own kind without adding a
  count, so inline work of the same kind collapses into the job row instead of doubling it. Work of a
  *different* kind still nests and counts: a Concierge check inside an image generation ticks **Dgr**
  up and back down inside the **Img** span.
- **Inline work inside job handlers counts too.** The forked job child mirrors its activity spans to
  the parent over a new `activity` IPC message. The mirror is zeroed when the child exits, so a crash
  mid-span cannot pin a chip above zero.
- **Polling is now a heartbeat.** The chips previously polled only after a client called
  `notifyQueueChange()` and stopped the moment counts hit zero, so server-initiated work (autonomous
  rooms, scheduled housekeeping, a wardrobe change enqueuing an avatar) never appeared. They now poll
  on their own — 1.5s while busy, 8s while idle. `notifyQueueChange()` remains as an instant kick but
  nothing depends on it.
- **Work that starts and finishes between two polls now blips.** The API returns a monotonic
  `startedByKind` counter and the chip pulses when it advances. Spans under 250ms (a cached
  classification) do not register, so the chips do not flicker.

Two hot-path queries were rewritten as indexed `COUNT(*)`s to make heartbeat polling affordable:
`getStats` read and Zod-validated *every* row in `background_jobs` (completed jobs inside the retention
window included), and the active-count query hauled every active row with its payload JSON. The new
`getActiveCountsByKind` runs one count per chip.

`GET /api/v1/system/jobs` now always returns `activeByKind` and `startedByKind`; the per-type
breakdown (`activeByType`) is opt-in via `?includeByType=true` since it costs a full read.


#### Added: the search bar searches every document store

The global search bar (⌘K) gained a **Documents** type, with its own filter chip alongside Chats,
Characters, Messages, Tags and Memories. It matches file names, relative paths, and extracted document
text across every enabled document store — character vaults included — and shows the store name, the
document's path, and a highlighted snippet of the match. One result per document: a file-name match
outranks a match buried in the text, and both outrank nothing. Implements
`docs/developer/features/complete/global-search-documents.md`.

Clicking a document result opens it in Document Mode, and where it opens depends on what you were doing.
If a Salon is focused, the document opens *in that conversation*, exactly as the composer's document
picker would — the Librarian announces the open and the chat sees later saves. Otherwise it opens in
standalone Document Mode, which is attached to no conversation and announces nothing, ever. A
middle-click or "open in new tab" always takes the silent standalone route, because that is what the
result's own link points at.

Details and limits:

- Vaults belonging to archived characters are never searched. An archived character is a tombstone, and
  surfacing its files would offer a way back into it.
- Documents marked `character_read: false` **are** searched. That flag hides a document from characters,
  not from you.
- Only documents Document Mode can open are searched (Markdown, text, JSON, JSONL), so every result is
  clickable. PDFs, Word files, images and other binaries are not searched, and neither is a file whose
  text extraction hasn't finished.
- The search is substring matching, like every other type in the bar — not semantic search. `%` and `_`
  typed into the box match themselves rather than acting as wildcards.
- The list of search types now lives in one place (`components/search/types.ts`) instead of three; the
  route, the filter chips, and the result groups all read it.

#### Added: archivable scenarios and wardrobe items

Scenarios and wardrobe items can now be archived instead of deleted. An archived entry disappears from
every list, dropdown, and picker by default; each listing surface gained a "Show archived" checkbox that
reveals it (badged) and still lets you select it. Archiving hides, it does not forbid — with one exception:
the outfit-selection LLM at chat start never receives archived garments, in any tier, with no parameter and
no override. Implements `docs/developer/features/archived-scenarios-and-wardrobe.md`.

Scenarios use an `archived: true` frontmatter key across all four scopes — general, project, group (files in
a `Scenarios/` folder) and character (vault `Scenarios/*.md`). The key is omitted entirely when a scenario is
active; a hand-written `archived: true` with nothing else works. An archived scenario can never win
default-conflict resolution or be auto-selected in the New Chat dialog, even when it is being listed.
Existing chats are unaffected: `resolveScenarioBody` ignores the flag, so a chat whose scenario was archived
mid-life keeps its scenario text.

Wardrobe archiving already existed in the persistence layer with no way to reach it. The four item routes
(character, general, project, group) now accept `archived: boolean`, translated to `archivedAt` by one shared
helper — archiving is idempotent and does not reset an existing timestamp — and `repos.wardrobe.unarchive`
finally has a caller. The four collection routes accept `?includeArchived=true`; project and group wardrobe
lists previously returned archived items unconditionally and filtered client-side. Archive/Restore is in the
Wardrobe dialog's per-item menu and on the project wardrobe card. A worn garment archived mid-chat stays worn.

Filtering is server-side throughout: the checkboxes change the fetch, not a client-side pass, so a picker that
never passes the parameter is safe by construction. The two client-side filters that existed (the wardrobe
dialog, the outfit composer) were removed rather than left as a second place for the rule to drift.

Other changes in the same work:

- Character scenario files now round-trip their `description` frontmatter. It was parsed on read but never
  written back, so the next vault projection silently dropped it.
- The New Chat dialog now passes group scenarios through to the form. `useNewChat` fetched them and
  `NewChatForm` accepted them, but nothing connected the two, so the Group Scenarios optgroup never appeared.
- `useProjectScenarios` and the character edit form's local `CharacterScenario` were duplicate declarations of
  shared types; both now alias the canonical ones, so a new field can't be added to one and missed on the other.
- The Almanack's Scriptorium table splits scenario counts into total and archived, matching what the wardrobe
  row already did.
- `qtap-export.schema.json` declares `WardrobeItem.archivedAt` and the character-scenario `archived` flag, both
  of which previously survived only via `additionalProperties: true`.

#### Added: feature plan for archivable scenarios and wardrobe items

New spec at `docs/developer/features/archived-scenarios-and-wardrobe.md`: an `archived: true/false`
frontmatter property on scenario and wardrobe-item files (absent = false). Archived entries are hidden
from every list, dropdown, and picker by default; each listing surface gets a "Show archived" checkbox
that reveals them and still lets the user pick them. The outfit-selection LLM at chat start never sees
archived garments (already true today; the plan pins it with tests). Wardrobe archiving is already
half-built in the persistence layer, so that half of the plan exposes existing plumbing (archive/unarchive
via the item routes, `?includeArchived=true` on the collection routes); scenarios get the property from
scratch across all four scopes. Docs only; no code changes yet.

#### Added: feature plan for a Documents chip in the global search

New spec at `docs/developer/features/global-search-documents.md`: extend the global search bar to
keyword-search all enabled document stores (file names, paths, and extracted text), add a "Documents"
filter chip, and open results in Document Mode — in the active Salon chat when one is focused (with the
usual Librarian announcement), otherwise in the standalone, chat-free document view. Docs only; no code
changes yet.

#### Added: per-wardrobe dressing instructions for "Let Character Choose"

Every wardrobe — a character's vault, a group's store, a project's store, and Quilltap General — can now
hold an optional `Wardrobe/instructions.md`: second-person guidance ("you prefer to wear…") that is read
when a character dresses themselves at chat start (or when joining a chat under the same mode). Resolution
is nearest-tier-first: character, then group, then project, then General; the first non-blank file wins and
the search stops there. The content is added to the outfit-selection prompt and influences nothing else.

Edited from a new collapsible "Dressing Instructions" panel under the container selector in the Wardrobe
dialog — and, for a character's own wardrobe, from the Wardrobe tab of their Aurora page — backed by
`?action=instructions` GET/POST on the four wardrobe collection routes. The file is
never treated as a garment: the shared wardrobe reader skips it by name (previously it would have been
parsed as an invalid item and logged a warning on every read), the wardrobe folder projection sweep
preserves it (previously any wardrobe write would have deleted it), a garment titled "Instructions"
projects to `instructions-1.md` instead of overwriting it, and the Almanack's garment counts exclude it.

#### Fixed: hover states across the app did nothing, and a lint guard so it can't happen again

Hovering a character card, a table row in the Scriptorium, a dropdown item, or a solid Delete button did
not change anything. `hover:qt-bg-muted` — the most-used state class in the app, on 73 elements — matched
no CSS rule, and neither did 33 other `hover:`/`focus:`/`disabled:` forms. Tailwind v4 generates variants
only for utilities it owns, and a class declared inside `@layer utilities` is not one of those, so
`hover:qt-bg-muted` is not "`qt-bg-muted`, on hover" — it is a class name nobody defined. The same applies
to opacity: `qt-bg-muted/50` (34 elements) is not `qt-bg-muted` at half strength. Every form the app uses
has to be written out by hand, and most of them never were: 82 class names over 493 call sites in 170
files.

`app/styles/qt-components/_utilities.css` now carries the missing opacity steps for the muted, card,
primary, destructive, success, warning, info and secondary backgrounds, the border and text opacity steps
to match, the two surface colors the markup asked for (`qt-bg-input`, `qt-bg-secondary`), and a rewritten
**STATE VARIANTS** section with all 34 state forms. Twenty-four places had invented a class name that was
never part of the vocabulary — `qt-text-error`, `qt-text-sm`, `qt-surface-alt` and friends — and those were
changed to the class that already existed rather than given a definition of their own.

The part that matters longer than this release is `scripts/check-qt-classes.mjs`, now run by
`npm run lint`. It holds every `qt-bg-*`/`qt-text-*`/`qt-border-*`/`qt-shadow-*` reference, and every
variant-prefixed `qt-*` reference, against the rules the stylesheets actually define, and fails the build
on one that resolves to nothing. Bugs 39, 100 and this one are the same defect found three times by three
accidents; the guard is what makes it a build error instead of a fourth. Filed as bug 102.

`@quilltap/theme-storybook` 1.0.63 mirrors all 79 new rules.

#### Fixed: shell completion stopped working once a flag was on the line

In zsh, `quilltap docs --instance Friday <TAB>` offered nothing at all — not the `docs` verbs, not even
the flags. Each subcommand looked its verb up with a hard-coded `(( CURRENT == 2 ))`, which only holds
when the verb sits immediately after the subcommand, so any flag typed first hid it. The top-level
`_arguments` made it worse by claiming `--instance Friday` as a global option even when it appeared
after `docs`, leaving the subcommand dispatch with an empty argument list.

Every zsh function now hands its options and its positionals to a single `_arguments -C` call and
branches on the parsed state, and the top-level positionals carry `(-)` so a flag typed after the
subcommand stays with that subcommand. Bash had a milder version of the same bug: its scanner only knew
that the *global* flags take a value, so `quilltap docs --limit 5 <TAB>` read `5` as the verb. It now
tracks value-taking flags per subcommand, which also fixes `-o` (the valueless global `--open`, but
themes' valued `--output`) and `memories -i` (`--ignore-case` there, not `--instance`).

Store names now complete wherever a verb takes one — `docs ls`, `docs read`, both ends of
`docs move`/`copy`/`link`, and `--mount` — in bash and zsh, and the lookup re-uses the `-i`/`-d`/
`--passphrase` already on the line, so `docs --instance V4test ls <TAB>` lists V4test's stores rather
than the default instance's. Names containing spaces or colons ("Project Files: The Estate") are quoted
correctly instead of being chopped into separate candidates. fish, whose completions already survived
flags, gains store names on `--mount` only.

The new completion test handed the zsh template to `zsh -n` unconditionally, which broke CI: GitHub's
ubuntu runner image has no zsh, so the check failed with `spawnSync zsh ENOENT`. The test now skips that
one assertion where zsh is not installed, and CI's test job installs zsh so the check still runs there.

#### Fixed: solid green and red buttons never set their own text color

`qt-text-success-foreground` and `qt-text-destructive-foreground` appeared on fifteen elements and were
defined in no stylesheet anywhere. They are the Tailwind utility names with a `qt-` prefix bolted on, so
they matched no rule and each element painted its fill and then left the text whatever color it had
inherited. The Set-as-avatar and Delete buttons on gallery thumbnails changed their background on hover
but not their glyph; the green **Avatar** badge, the solid Chat and Delete buttons in Aurora and Prospero,
and the file-delete confirmations all put a colored fill under unchanged text.

`app/styles/qt-components/_utilities.css` now carries the rest of the family `qt-text-on-accent` started —
`qt-text-on-primary`, `qt-text-on-success`, `qt-text-on-destructive` — plus the hover partners
`hover:qt-text-on-accent`, `-on-primary`, `-on-success` and `-on-destructive`. Tailwind v4 generates no
variants for classes declared inside `@layer utilities`, so each hover form has to be written out by hand;
one that was never written is simply inert. All fifteen call sites now use the real classes, and the
character gallery's new Download button moved from the raw `hover:text-primary-foreground` to
`hover:qt-text-on-primary`. Filed as bug 100.

`@quilltap/theme-storybook` 1.0.62 mirrors the eight new selectors and adds a "Foregrounds on filled
surfaces" section to the `Surfaces` story, showing all four fills with their foregrounds and spelling out
the naming trap: the classes are `-on-<fill>`, never `-<fill>-foreground`.

#### Fixed: a character's Photo Gallery had no reachable way to download a picture

The image detail view's top-right controls — Download, Copy, Save to my gallery, Close — were painted
behind the sticky page toolbar and could not be clicked. `.qt-workspace` sets `isolation: isolate`, so
everything a pane renders lives in that stacking context and the modal's `z-[60]` was no longer comparable
with the toolbar's `z-30` in an ancestor context. Nothing was clipped or mispositioned; the buttons were
laid out exactly where they belonged and `elementFromPoint()` at their centre returned the toolbar.
`ImageDetailModal` now renders through `createPortal(..., document.body)`, the same fix bug 40 applied to
the search dialog.

The character gallery's thumbnails also gained the hover **Download** button every other image grid
received in 4.9-dev; this grid was the one that was missed. It fetches the picture and hands it to
`lib/download-utils.ts`, so the desktop shell gets its native save dialog, and it stops propagation so
downloading doesn't also open the detail view. Filed as bug 99.

#### A chat's scenario can be changed mid-conversation

The Salon sidebar's Chat drawer gains a **Scenario** control. It offers the same four tiers the new-chat
dialog does — project, general, group, and (when a single LLM character is present) character scenarios —
plus a **Custom...** option that reveals a free-text box. Saving posts to the new
`POST /api/v1/chats/[id]?action=scenario`, which rewrites `chat.scenarioText`, recompiles every
participant's identity stack (the scene is baked into `{{scenario}}` there), and posts a Host announcement
worded as a revision so the chat-start scene-setting further up the transcript reads as superseded rather
than contradicted. Saving an empty custom scenario clears the scene; re-picking the scene already in force
is a no-op with no announcement. The original scene-setting message is left in place.

The control seeds itself from the chat's current scene: text matching a preset exactly preselects that
preset, and anything else opens on **Custom...** with the text loaded for editing.

Supporting changes:

- The scenario precedence chain (character ID > project path > group path > general path, with free text
  layered beneath whatever resolves) moved out of the chat-creation route into
  `lib/chat/scenario-selection.ts`, so both surfaces resolve a selection identically.
- The scenario dropdown itself moved into a shared `components/scenario/ScenarioSelect.tsx`; the option
  types and `<option value>` tokens now live in `components/scenario/types.ts` and are re-exported from
  `components/new-chat/types.ts`.
- `GET /api/v1/chats/[id]` now projects `scenarioText` (it previously didn't), so the picker can open on the
  chat's actual scene instead of always on **Custom...**.
- The Markdown transcript export includes `scenario-change` notices in the body. The header prints whatever
  scene is in force at export time, so without them a reader would see the story relocate unremarked.

Note on scenario defaults: the frontmatter key is `isDefault: true`. A scenario file marked `default: true`
is not recognized as a default, so no scenario pre-selects in the new-chat dialog and it opens on
**Custom...** — worth checking if a default you expected isn't taking effect.

#### Moving or copying an outfit can bring its components along

Transferring a composite outfit used to move just the outfit, leaving its component references pointing at
items that stayed behind — often unresolvable at the destination. The transfer dialog now prompts when the
item is an outfit: moving offers to move the components, copy them (originals stay), or leave them; copying
offers to copy them or not. The choice is all-or-nothing and covers nested composites transitively. Only
components living in the same source container travel (shared-tier pieces are already reachable and stay
put). When copies mint new IDs, the transferred outfit's `componentItemIds` (and those of any nested
composites that travelled) are rewritten to the new IDs, and a post-write verification confirms every
travelled reference resolves at the destination. Copying an outfit while moving its components is refused
(it would strand the original), and any destination ID collision rejects the whole transfer before anything
is written.

Verifying the ID contract surfaced a latent vault bug, also fixed: composite references are stored as title
slugs, and `buildSlugByItemIdMap` handed a colliding slug to whichever item came first in write order while
the reader resolved it in filename order — so two same-titled items in one container could silently rewire an
outfit's components on the next read. Ambiguous slugs are now assigned to nobody; every reference to a
colliding item is written as an exact UUID. The transfer endpoint's post-write verification reads the outfit
back from the destination and compares its component references against the plan, logging and reporting
`unresolvedComponentIds` on any mismatch.

#### The Wardrobe dialog browses and edits every wardrobe container

The dialog's top dropdown now lists every place a wardrobe item or outfit can live — each character, Quilltap
General, each project, and each group (the same roster the Move/Copy destination picker offers) — instead of
characters only. Selecting a shared container shows exactly its contents with the full `⋮` menu (Edit, star as
default, Duplicate, Move, Copy, Delete) and a `+ New Item` that creates directly in that container; the
character-only fitting room, Wear buttons, and Import-from-image hide in that mode. In a character's view the
old rule stands: items merged in from a shared tier elsewhere stay Move/Copy-only.

Supporting changes:

- New group wardrobe API (`/api/v1/groups/[id]/wardrobe` and `.../[itemId]`, GET/POST/PUT/DELETE), mirroring
  the project routes — previously the group tier had no CRUD endpoints at all, so group items could only be
  created by transfer.
- The transfers API accepts an explicit `source: { scope, id }` alongside the legacy `sourceCharacterId`
  probing, so moves/copies work when browsing a shared container; the transfer dialog also hides the item's
  known current home from the destination list.
- The item editor routes edits to the item's actual container. Previously any "shared" edit was sent to the
  Quilltap General endpoint, which would have misfiled a project or group item (unreachable in the UI before,
  latent bug regardless).
- Duplicating an item now also copies its Portrait Cue (`imagePrompt`), which was silently dropped before.

#### Creating a project with a blank description works again (bug 98)

The create dialogs send `description: null` when the field is left empty, but the create schema's bare
`.optional()` rejects null — so every name-only project create failed with a silent 400 (generic toast in
Prospero, nothing at all from the homepage quick action, no server log line). The schema (moved to
`app/api/v1/projects/schemas.ts`) now marks `description`/`instructions`/`color`/`icon` as
`.nullable().optional()`, matching the update schema, with a regression test pinning the null/absent/string
matrix. The homepage `QuickActionsRow` also gained the success/error toasts its Prospero twin already had.

#### Every image gallery can download the picture on display

An audit of the app's image viewers found several places where a full-size picture had no download affordance —
a real problem in the Electron shell, where right-click → Save Image isn't available. Fixed:

- The **My Photos** detail modal gained **Download** and **Copy** (copy-image-to-clipboard) buttons in its footer.
- The **avatar selector / character-wizard image grid** (`components/images/image-gallery.tsx`) gained a hover
  download button next to the existing delete button.
- The **Scriptorium file table's** expanded detail row gained a **Download** button beside "Open bytes",
  saving the file under its original name.
- The **Generate Image** page and the **wardrobe avatar preview** already had downloads, but both hand-rolled the
  anchor-click approach, bypassing `lib/download-utils.ts` — so in Electron they missed the native save dialog.
  Both now go through `triggerDownload`.
- The mount-point blob endpoint (`/api/v1/mount-points/[id]/blobs/[...path]`) now sends an inline
  `Content-Disposition` with the original filename, so browser saves from an "Open bytes" tab get a proper
  name instead of the path hash.

All other full-size viewers (chat `ImageModal`, chat gallery, character gallery `ImageDetailModal`, file preview
modal) already had download buttons wired through the shared Electron-aware helper; they're unchanged.

#### OpenRouter vision profiles send images again (bug 97)

OpenRouter's plugin declared `supportsAttachments: false` with no MIME types, a truthful statement when it was
written and stale since bug 45 taught `provider.ts` to serialise `image_url` content-parts for JPEG, PNG, GIF and
WebP. Bug 91 made that declaration load-bearing: `providerCanTransportImages` asks the plugin registry first, so in
production every OpenRouter vision profile routed its images to the describe-fallback, and the describer guard
refused an OpenRouter profile in the same sentence that recommended OpenRouter. Jest never saw it — with the
registry uninitialised the predicate reads the static map, which was correct.

`qtap-plugin-openrouter` 1.0.59 declares `supportsAttachments: true` and imports its MIME list from `provider.ts`'s
now-exported `SUPPORTED_IMAGE_MIME_TYPES`, so the declaration the registry reads and the bytes the provider sends
cannot drift apart again. The model-dependent caveat is unchanged and still the host's call: images only reach a
profile whose "Supports image attachments" flag is ticked.

New test `__tests__/unit/lib/llm/image-transport.test.ts` covers the registry-initialised branch that had no
coverage, and loads every bundled plugin's **built** `index.js` to assert its declaration gives the same answer as
the static map in `lib/llm/attachment-support.ts` — the drift that produced this bug now fails the suite. The
describer guard's provider list also gained NanoGPT, which has transported images since plugin 1.1.0.

#### Bug 97 filed: the OpenRouter registry entry denies the vision path its own provider implements

Docs only, plus a two-character comment correction. Bug 91's transport predicate correctly asks the plugin registry
first — and the registry's OpenRouter answer is stale: `qtap-plugin-openrouter/index.ts` still declares the
pre-vision conservative `supportsAttachments: false` while `provider.ts` has serialised `image_url` content-parts
for four MIME types since bug 45, and the client-safe static map agrees with the provider. In production (registry
initialised) the stale `false` wins: every OpenRouter vision profile silently routes to the describe-fallback, and
the bug-91 describer guard refuses OpenRouter profiles with a sentence that itself names OpenRouter as a provider
that forwards images. In jest the registry is uninitialised, the static map wins, and the suite is green over a
branch production never takes. Found by the quilltap-v5 port's differential, which runs the predicate in both
configurations. The bug file (`docs/developer/bugs/bug-97-openrouter-registry-denies-vision.md`) documents the fix
as a spec: flip the plugin's `attachmentSupport` to what `provider.ts` implements (comment-tied to
`SUPPORTED_IMAGE_MIME_TYPES`, the NanoGPT 1.1.0 keep-in-step precedent), keep the model-dependent caveat in prose,
and add a registry-initialised test so jest finally reads the production branch. Also corrected in passing: the
`lib/llm/moderation-finish-reason.ts` docblock mis-numbered itself "(bug 94)" — it is bug 93.

#### Chat titles and story backgrounds stopped working when the cheap model misspelled one key (bug 96)

A group chat kept the title "Group Chat (6 characters)" for seven interchanges and never produced a story background.
The cause was one JSON key. The title-consideration prompt asks for `suggestedTitle`; `deepseek-v4-flash` answered
`needsNewTitle: true` and put a perfectly good title under `suggestTitle`. Reading the canonical key returned
`undefined`, which was coerced to `null`, which the handler read as "no rename needed" — the same branch as a genuine
decline. That branch advances the checkpoint cursor, so the retry moved from interchange 7 to 10, where an identical
stumble would have burned that checkpoint too.

The story backgrounds were the same bug. Background generation is queued only after a successful rename, using the new
title as its scene context, so a rename that never lands takes the background with it. No
`STORY_BACKGROUND_GENERATION` job was ever enqueued for the chat.

Nothing about this was visible: the job reported COMPLETED, the LLM log held a well-formed response, the token spend
appeared in the system events, and the cursor advanced exactly as a real decline would. It was also intermittent — the
same model titled three other chats correctly the same afternoon.

Both title parsers (regular and help-chat) carried the same 25 duplicated lines and now share one
(`lib/memory/cheap-llm-tasks/title-verdict.ts`). It reads the canonical key first, then a short list of near-misses
(`suggestTitle`, `newTitle`, `proposedTitle`, `title`) with a case- and separator-insensitive second pass, and the
canonical key always wins when a model emits more than one. It logs a warning when it recovers a title from a
non-canonical key, and both the parser and the job handler warn when a rename is requested with no readable title
rather than burning the checkpoint silently. Unparseable output still resolves to "keep the current title".

Known and unchanged: a chat whose title is already good still gets no story background, because generation hangs off a
successful rename. That coupling is documented in the bug entry.

#### Characters can now look at images, and images actually reach vision models (bugs 91-95)

Five defects from one session, all downstream of an image a user shared that no character could see.

**Images were silently dropped for four providers (bug 91).** A profile's "Supports image attachments" checkbox says the
*model* can read pictures. It says nothing about whether the *plugin* can send them, and the NanoGPT, DeepSeek,
OpenAI-Compatible and Ollama plugins all stripped every attachment before the wire. Only the first question was being
asked, so ticking the box on a real vision model (`deepseek-v4-flash-vision-exp`, `zai-org/glm-4.6v`) turned off the
description fallback *and* handed the bytes to a plugin that discarded them. The model got nothing and wrote a
confident paragraph about the image anyway. Both questions are now asked, via a single predicate
(`lib/llm/image-transport.ts`) reading the plugin registry: when the model sees but the plugin cannot send, the request
routes to the description fallback instead of losing the image. The same check now guards describer selection — an
Ollama describer would have described a picture it never received. NanoGPT plugin 1.1.0 learned to serialize
`image_url`, so those profiles send images for real; DeepSeek, OpenAI-Compatible and Ollama route to the describer.

**New `describe_image` tool (bug 92).** Characters had three image tools and all three were custodial: `keep_image`
files a picture, `attach_image` shows it to the room, `list_images` reads the catalogue. None answers "what is in this
picture?", so models reached for `attach_image` and got told to file the image first. `describe_image(uuid)` serves the
description auto-describe already wrote at upload, or the generation prompt for a Quilltap-made image, or a fresh
vision call — and does not require the image to be in the caller's album. `attach_image` is unchanged in function; its
description and its not-found error now say plainly that it does not show the caller anything, and name
`describe_image`. The Librarian's upload announcement was rewritten to say the same.

**Provider refusals are reported as refusals (bug 93).** Z.AI returned `finish_reason: sensitive` with empty content —
a moderation refusal — and the Salon said "this is a known issue with some providers, please try resending", which
cannot work. Moderation finish reasons across Z.AI, OpenAI, Azure and Google are now recognized
(`lib/llm/moderation-finish-reason.ts`, literal matching, no substring guessing) and the message names the provider,
the model and the reason, and says resending will fail again.

**Dropped attachments are visible (bug 94).** Plugins reported failed attachments in `attachmentResults`, which rode
the SSE done event to a client that never read it. The Salon now raises a warning toast naming the plugin's own error.
This is why bug 91 lasted as long as it did.

**Attachments anchor to the user's message (bug 95).** Images were attached to the last `role: user` message, but staff
whispers format as `role: user`, so on a regenerate the image landed on a "your response model is now X" bubble or a
Prospero context memorandum — while the Librarian's announcement said the bytes rode with the user's message. After a
tool call nothing matched and the attachments were dropped entirely, without a log line. A new
`selectAttachmentAnchorIndex` prefers this turn's user input, then the last message whose source row was a genuine
human turn, then the old rule as a floor.

#### Standalone tarball is webpack-built again (bug 90)

**Critical, and self-inflicted by the previous commit.** 4.9.0-dev.52 could not start **anywhere** — the tarball, the
Electron shell, `npx quilltap`, and both Docker images. On macOS every SQLite connection failed with `slice is not valid
mach-o file`; in the arm64 Docker image the same file produced dlopen's misleading `cannot open shared object file: No
such file or directory` (the binary was present, but x86-64 on an aarch64 host). Both ended at "Migrations failed -
cannot start server."

The previous commit switched `release.yml` from `--webpack` to Turbopack to converge it with the other two `next build`
call sites. The two bundlers do not produce interchangeable standalone trees. Turbopack copies externalized packages
into `.next/node_modules/<pkg>-<contenthash>/` and rewrites requires to point at those copies; webpack's NFT output
uses `node_modules/<pkg>`. `build-standalone-tarball.mjs` strips platform binaries by name against
`<staging>/node_modules/<pkg>`, so it never saw the hashed copies — and the tarball stopped being platform-agnostic,
carrying whatever the build host compiled. `build-app` runs once on x86-64 ubuntu, so the published artifact carried a Linux x86-64
`better_sqlite3.node` and `pty.node` that won resolution over the correct binaries. Docker is hit for its own reason
worth stating: `Dockerfile.ci` copies that single artifact into **both** the amd64 and arm64 images, on the sound
premise that it is pure JS and each image rebuilds its own natives in `deps-prod`. Turbopack broke the premise, so the
arm64 image shipped an x86-64 binary shadowing the aarch64 one it had correctly built.

`--webpack` is now pinned at all three call sites (`release.yml`, `ci.yml`, `scripts/build-standalone-tarball.mjs`),
each with a comment saying it is load-bearing and pointing at bug 90 — "this flag looks stale" is the exact observation
that caused the regression. The `loadWebpackHook` failure that originally motivated Turbopack in `7cba1eb4` is handled
by `scripts/standalone-server-bootstrap.js` (added four days later), which is why every webpack-built release from 4.5
through 4.9.0-dev.51 ran correctly.

New guard: `scripts/assert-standalone-portable.mjs` enforces the actual invariant rather than trusting a flag — **no
native binary anywhere under `<standalone>/.next/`**, a bundler-internal subtree no consumer strips or replaces.
(`<standalone>/node_modules/` stays exempt; Docker replaces it wholesale and the tarball strips it by name.) It runs in
`build-app` before the artifact is uploaded, so it protects Docker and the tarball equally, and again before the tarball
is written. Verified against the real broken dev.52 artifact extracted from `foundry9/quilltap:dev`, which it rejects.

The strip has never covered the Turbopack layout, going back to `7cba1eb4` — local macOS builds hid it by compiling for
the platform they ran on. Using Turbopack here in future needs the strip extended to walk `.next/node_modules/` plus a
real build-on-Linux/run-on-macOS test, which nothing automated does today. Note that CI cannot catch this class of
failure at all: run 32614939380 went green in 11m45s and produced a tarball that could not start on any Mac.

#### CI/release pipeline cleanup, and the PDF rasteriser's missing native (bug 89)

**Bug 89 — PDF rendering was broken on the `npx quilltap` path.** `build-standalone-tarball.mjs` strips every
`@napi-rs/canvas-*` platform binary from the tarball, and `packages/quilltap` declares `@napi-rs/canvas` as a runtime
dependency so npm installs a correct one — but `linkNativeModules` never linked it into the standalone tree. That tree
lives in the download cache, far outside the npm package's `node_modules`, so Node's upward walk never reached the
installed copy. `linkNativeModules` now has one shared `linkScopedPlatformSiblings` helper serving both
`sharp`→`@img/sharp-*` and `@napi-rs/canvas`→`@napi-rs/canvas-*`; it walks back as many path segments as the wrapper's
own name has, so scoped and unscoped wrappers both resolve. Docker was never affected — it ships the full production
`node_modules`.

**Releases were built with the wrong bundler.** `7cba1eb4` moved the standalone build off `--webpack` because its
tracer misses `next/dist/compiled/webpack-lib`, which broke the Electron shell's embedded server. That fix lived only
in the tarball script, which CI invokes with `--skip-build` — so every release since still shipped a webpack-traced
tree while local builds and CI validated a Turbopack-traced one. `release.yml` now builds with Turbopack, matching
`ci.yml` and the script.

**A tag that disagrees with `package.json` is now a build failure.** The standalone tarball is named from
`package.json`'s version, but the published CLI builds its download URL from the git tag. Diverge them and the release
still goes green (the asset upload uses a glob) while every `npx quilltap` first run 404s. `build-app` now checks both,
having absorbed the old `validate-tag` job — which was a whole runner spin-up for one regex.

**Other pipeline changes:**

- `lint`, `build`, and `test` no longer chain. Gating build and test behind lint bought nothing but latency; they now
  run in parallel and return the complete picture in one round trip.
- Both workflows get a `concurrency` group. Superseded PR runs cancel; branch pushes and releases never do.
- `create-release` downloaded *every* artifact — including `app-build`, the whole traced standalone tree — to use four
  files. It now pulls only the release assets.
- `build-standalone-tarball.ts` and `build-rootfs.ts` are now plain `.mjs`. The release jobs that run them never
  `npm ci`, so they were fetching an unpinned `tsx` from the registry mid-release.
- The platform→Dockerfile-target mapping was stated in both `build-rootfs.ts` and the release matrix, with nothing
  keeping them honest. It now lives only in `build-rootfs.mjs`, which the workflow queries with `--print-target`.
- New composite actions `.github/actions/setup` (Node + `npm ci`, the one place the CI Node version is pinned) and
  `.github/actions/discord-notify` (the ~45-line curl/jq block that was duplicated across both workflows).
- Docker builds now use the GitHub Actions layer cache, scoped per arch, so `npm ci --omit=dev && npm rebuild` — which
  compiles every native module from source — is not repeated from scratch each release.
- Both workflows declare `permissions: contents: read`, with `create-release` escalating for itself. `release.yml`
  previously granted `contents: write` workflow-wide.
- Removed the dead "check if tests exist" guard and its four dependent conditional steps (the repo has 613 unit test
  files). A green suite that produces no coverage summary is now a failure rather than a warning, since it means the
  jest config is broken.

#### NanoGPT prompt caching (plugin 1.0.3)

The NanoGPT plugin now supports NanoGPT's prompt caching (https://docs.nano-gpt.com/api-reference/miscellaneous/prompt-caching).

- New per-profile options under "Prompt Caching": **Enable Prompt Caching** (default off) and **Cache Duration** (5m default / 1h). When enabled, the request carries NanoGPT's body-level `promptCaching: { enabled, ttl }` helper, which auto-places `cache_control` breakpoints for Anthropic-routed (Claude) models. Other routes ignore the flag — OpenAI/Gemini upstreams already cache implicitly with no opt-in.
- Cache usage is now extracted from responses in both dialects NanoGPT reports (Anthropic-style `cache_read_input_tokens`/`cache_creation_input_tokens`, OpenAI-style `prompt_tokens_details.cached_tokens`) and normalized into `cacheUsage`. Cache-read tokens are excluded from `promptTokens`/`totalTokens` per the house rule, so cached input is not charged against budgets; previously the plugin ignored cache counters entirely, so even implicit-cache hits were counted (and budgeted) as full-price input. The streaming final chunk also carries `rawProviderUsage` for cache-instrumentation diagnostics, matching the other provider plugins.
- Audited the rest of NanoGPT's API-specifics docs against the plugin: extended thinking (`reasoning_effort` values, `delta.reasoning` with `reasoning_content` legacy fallback) and the streaming protocol (`stream_options.include_usage`, tool-call delta accumulation) already match the documented contract; no changes needed there.
- Help: NanoGPT section of `help/connection-profiles.md` documents the new options.
- Tests (`__tests__/unit/plugins/nanogpt-reasoning.test.ts`): the helper rides the body with the right TTL (and the option keys never leak verbatim), both cache-counter dialects normalize with reads excluded, and no-cache responses report no `cacheUsage`.

#### The system prompt addresses the character consistently (person consistency)

Implements `docs/developer/features/complete/prompt-person-consistency.md`. The assembled system prompt mixed grammatical person — the identity preamble says "You are {{char}}" while the aliases, pronouns, and physical-appearance blocks spoke *about* the character in the third person, and the pronouns block literally instructed the character to use its own pronouns "when referring to this character." All blocks whose referent is the speaking character are now second person, and author-carried fields get referent-fixing wrappers.

- **Wording** (`lib/chat/context/system-prompt-builder.ts`, mirrored in `lib/help-chat/system-prompt-builder.ts`): aliases ("You also go by…"), pronouns ("Your pronouns are… Use them whenever you refer to yourself in narration"), physical appearance ("This is how you look — …", wrapper only; the body stays noun phrases because it is shared with the image pipelines), plus wrappers on manifesto ("The following you hold as true about yourself, without question."), personality ("The following is what you know about yourself. Others do not see it unless you show them."), and example dialogues ("This is how you speak."). Outward-facing renderers (public identity card, other-participants info, Host whispers) stay third person — their referent is someone other than the reader.
- **Cache invalidation for old chats:** `chats.compiledIdentityStacks` is now a stamped envelope `{ version, stacks }` keyed to a new `IDENTITY_STACK_BUILDER_VERSION` constant colocated with `buildIdentityStack`. Reads require strict version equality; legacy bare maps, older, and newer stamps all read as stale and rebuild lazily through the existing read-through path (no migration). A stale map is discarded on merge, never blended into. A golden-hash table in `__tests__/unit/cache-determinism/system-prompt.test.ts` (`IDENTITY_STACK_GOLDENS`) makes forgetting the bump impossible in both directions. Shipped as version 1 (stamp only, output-neutral) then version 2 (this wording).
- **No `PROMPT_CACHE_STRUCTURE_VERSION` bump** — wording within existing blocks, no layout change (per the bump policy in `lib/llm/cache-key.ts`).
- **Generators:** `lib/services/character-field-semantics.ts` bucket definitions now each state who the field addresses, with worked examples (and the stray "unless she shares it" is now "unless they share it"); the AI Wizard's `FIELD_PROMPTS`, Summon From Lore's `CHARACTER_BASICS_PROMPT`, and the Character Optimizer's shared suggestion rules close their per-service gaps — the optimizer is explicitly told never to flip a field's form of address while rewording it.
- **UI:** new shared `PromptFieldLabel` component (`components/prompt-fields/PromptFieldLabel.tsx`) with single-sourced hint copy (`components/prompt-fields/field-hints.ts`, the client mirror of `character-field-semantics.ts`). Character create/edit forms, the system-prompts editor, physical-description prompts, project and group instructions, roleplay templates, and the AI review panes (Wizard, Summon From Lore, Optimizer) all show a per-field "Written as: …" worked example in the field's correct form of address. This also converges the create/edit forms' previously divergent helper wording.
- Both prompt goldens updated (`7517f7d9b496d20b` → `937ea8197a65d022`, `74c9b488b4a1517c` → `bc37032e92411263`) with reasons recorded inline; the new sentences are pinned by named assertions.
- Deferred, filed separately: field-aware guidance for in-chat vault writes to managed fields (`docs/developer/features/vault-managed-field-write-guidance.md`).

#### Tool reinforcement addresses the character directly (and stops saying "they CALLS them")

The final block of the system prompt was written in the third person ("When Ariadne uses workspace tools, *she* CALLS them"), sitting immediately after several sections that address the character as "you" — including the identity preamble that opens the prompt. It is now second person: "When you use workspace tools, you CALL them."

- The third person was inherited, not chosen. The block went in (`3f4d7a78a`) with literal `his/her` / `he/she` placeholders; the follow-up fix (`11c4d6c2d`) replaced them with the character's real pronouns, addressing the generic-pronoun problem rather than the person — and added the second-person identity preamble in the same commit, creating the disagreement.
- Removing the pronoun lookup fixes a live grammar bug: `character.pronouns?.subject || 'they'` rendered "they CALLS them — they does not merely describe calling them" for every character with no pronouns recorded. Second person needs no pronoun.
- Applied in both copies: `lib/chat/context/system-prompt-builder.ts` and `lib/help-chat/system-prompt-builder.ts`.
- No `PROMPT_CACHE_STRUCTURE_VERSION` bump — wording change, no layout change (per the bump policy in `lib/llm/cache-key.ts`), and the block is a per-turn addition rather than part of the cached `compiledIdentityStacks`.
- Both cache-determinism goldens updated (`bd27b1ca407d9901` → `7517f7d9b496d20b`, `911204033cd41164` → `74c9b488b4a1517c`) with the reason recorded inline. The sentence is now pinned by its own named assertion as well, so a regression to third person fails readably instead of only as a digest mismatch.
- Plan for the remaining person inconsistencies: `docs/developer/features/complete/prompt-person-consistency.md`.

#### Project and group instructions are standing prompts in the system prompt

Projects and groups each have an optional `instructions` field ("the prompt"); it is now injected into the stable, cacheable part of the system prompt instead of riding along in whispers (projects) or going nowhere at all (groups, whose field existed but had zero consumers).

- New `lib/chat/context/standing-instructions.ts` resolves the chat's project instructions plus the instructions of every group the *responding character* belongs to (per-character, mirroring the group document-store tier), renders them as a `[STANDING INSTRUCTIONS]` section, and hands the string to `buildSystemPrompt`, which places it between the Taboo section and the tool instructions — inside cacheable system block 1. Empty emits nothing, byte-for-byte; group sources sort by name for cache determinism; every lookup fails soft. The section is template-processed (`{{char}}`/`{{user}}`).
- Carina one-off queries mirror the insertion (after the scenario, before "Reference Query"), keyed to the answerer's groups and the chat's project. Help and Brahma chats are structurally excluded (separate prompt builders). `self_inventory`'s prompt reconstruction includes the section.
- The Prospero project-context whisper no longer carries `instructions` (description and the store roster remain) — it would have duplicated the system-prompt copy every reinjection interval.
- Groups gain the missing plumbing: `instructions` accepted by `POST /api/v1/groups` and `PUT /api/v1/groups/[id]` (it was declared in `GroupSchema` and persisted as `instructions.md` but rejected by the request validators), and the group editor gets a "Group Instructions" Markdown (Lexical) editor matching the project settings card. Projects already had the editor.
- `PROMPT_CACHE_STRUCTURE_VERSION` bumped 3 → 4 (structural prompt change; all provider caches roll cold once).
- Tests: `standing-instructions.test.ts` (resolver, renderer, builder placement, empty-inert byte-identity); golden prompt hash unchanged. Docs: PROMPT_ARCHITECTURE.md §2/§4/§8/§13, help `groups.md` and `project-settings.md`.

#### NanoGPT: suppress the gateway's reasoning echo (plugin 1.0.2, bug 87)

On some routed paths NanoGPT re-emits the entire answer down the reasoning channel after the content stream ends, so a turn rendered its whole reply a second time inside a thinking fold anchored at the end of the message. Intermittent and gateway-side: identical requests minutes apart streamed clean, and token accounting shows the echo was never billed as model output. The plugin now holds post-prose reasoning while it remains a verbatim prefix of the streamed prose — if it diverges it's real thinking and commits in full; if it still mirrors the prose at stream end it's the echo and is dropped (from live chunks, the final chunk, and the raw response). Non-streaming responses drop `message.reasoning` when it equals the content exactly. Genuine pre-content reasoning is untouched. Tests added to `nanogpt-reasoning.test.ts`.

#### NanoGPT gains thinking options (plugin 1.0.1)

- New connection-profile options schema with **Reasoning Effort** (none / minimal / low / medium / high / xhigh), forwarded as NanoGPT's `reasoning_effort` parameter. Any value other than `none` requests reasoning; blank defers to the model.
- `thinkingTurnRule` declared on the plugin so multi-character turns on a thinking profile anchor in prose instead of the `[Name]` prefill (bug 85's rule), with `anthropic/claude-sonnet-5:thinking` catalogued as thinks-by-default; uncatalogued `:thinking` picks rely on the explicit effort setting.
- Fixed reasoning display: NanoGPT's main endpoint carries reasoning in `delta.reasoning` / `message.reasoning`, not the legacy `reasoning_content` the plugin was reading (which is now the fallback). Without this the thinking fold stayed empty for most routed reasoning models.
- Tests: `nanogpt-reasoning.test.ts` (rule/schema partition, catalogue habits, both wire dialects); NanoGPT joins the options-schema snapshot test.

#### NanoGPT is a bundled provider (chat, images, embeddings)

New bundled plugin `qtap-plugin-nanogpt` (1.0.0) adds NanoGPT (nano-gpt.com), a pay-as-you-go gateway fronting 600+ chat models, 200+ image models, and two dozen embedding models behind one OpenAI-compatible API and a single new `NANOGPT` API key type.

- **Chat:** OpenAI-compatible Chat Completions at `nano-gpt.com/api/v1` with streaming, tool calling, JSON response formats, and reasoning display — routed thinking models' `reasoning_content` streams into the Salon's thinking fold. Model list merges the live `/models` endpoint with a small curated static catalog (NanoGPT's `auto-model*` routers plus current flagships).
- **Images:** the OpenAI-compatible images route with `b64_json` pinned (plus a URL-download fallback), following the honest Fetch Models contract: without a key you get the curated list; with a key the dedicated `/image-models` listing is queried and filtered to models whose capability flags say they generate images (edit-only and upscale-only entries excluded), and transport failures throw so the route can label the fallback. Provider-level orientation constraints (832x1248 / 1248x832 / 1024x1024), a parameters panel with common sizes, and provider badge/icon/fallback entries in the image-profile UI.
- **Embeddings:** OpenAI-compatible `/embeddings` with live model discovery via `/embedding-models`. `NANOGPT` joins the embedding profile provider enum (schema, export JSON schema, UI types/metadata/badges, first-startup seed type). New `.qt-badge-provider-nanogpt` badge class; the whole `qt-badge-provider-*` family was mirrored into theme-storybook (1.0.61), which previously lacked it.
- Tests: NanoGPT joins the image-orientation contract's provider-level list; new `nanogpt-image-provider-models.test.ts` covers the model-listing contract, b64 passthrough, and URL-download fallback.

#### Image profiles can fetch models from the provider, honestly

The image-profile editor gains a "Fetch Models" button (parity with connection profiles). Before, four of the five image-capable plugins "implemented" model listing by returning their hardcoded list even when handed an API key — only OpenRouter actually asked its API — and the form auto-fetched silently with no indication of where the list came from.

- Each image provider now genuinely queries its provider when given an API key, filtered to models that actually produce images: OpenAI filters `/v1/models` to the `dall-e-*`/`gpt-image-*` Images-API families; Google pages the Gemini models list and keeps imagen models exposing `predict` plus gemini models with image output (video/text/embedding models excluded); Grok uses xAI's dedicated `GET /v1/image-generation-models` endpoint; Z.AI filters its `/models` list by the image-model pattern (unioned with the documented CogView/GLM-Image set, since that endpoint under-reports). Without a key, the plugin's curated list is returned unchanged.
- On live-fetch failure the providers now throw instead of silently substituting the static list, so `?action=list-models` can label its response `source: 'provider'` or `'builtin'` (with the fetch error attached). The form shows which one you're looking at. Only genuinely live-fetched lists are cached in `provider_models`.
- Google's Gemini-vs-Imagen routing now treats any `gemini*` model as a generateContent model, so live-fetched IDs (e.g. preview image models) don't fall through to the Imagen predict endpoint.
- Providers that cannot produce images (Anthropic, DeepSeek, Ollama, OpenAI-compatible) are unchanged and stay out of the image-provider list.

#### Z.AI is a first-class image provider

The Z.AI plugin already shipped an image provider (CogView-4, GLM-Image), but the UI never wired it up and generation was broken end-to-end: Z.AI returns image URLs, while every Quilltap consumer reads only base64, so a generated image evaporated. The provider now downloads the URL and returns base64. The image-profile UI gains a Z.AI provider badge/icon, a parameters panel with Z.AI's recommended sizes, and a fallback provider entry. Help doc updated to list the providers Quilltap actually supports (and to stop claiming Midjourney/Stable Diffusion/ComfyUI support it never had).

Plugin versions: openai 1.0.59, google 1.1.47, grok 1.0.51, z-ai 1.1.23, openrouter 1.0.58.

#### The DeepSeek plugin can tell when it is thinking (bug 86)

`isThinkingEnabled(body)` decided whether an outgoing request was a thinking request by looking for `thinking: { type: 'enabled' }` in the body it was about to send. That answers "what did we ask for?" when the question is "what will the model do?" — the V4 models reason with `parameters: {}`, which is the default state, so a profile that had never touched the thinking option was judged not to be thinking. `stripThinkingIncompatibleParams` never ran, and `temperature`, `top_p`, `frequency_penalty`, and `presence_penalty` were sent into a request that ignores them. DeepSeek discards them silently, so nothing errored.

`willRunThinkingTurn(body)` replaces it and asks the two questions in the order the host's `evaluateThinkingTurn` asks them: the profile's explicit `thinking: enabled` / `disabled` first, then the model's own habit from `STATIC_MODELS.thinksByDefault`. No signature change was needed — both call sites already pass a body carrying `model`. The model lookup is an exact id match, matching the host, so a model DeepSeek serves that the static catalogue does not list contributes no habit and behaves as before.

The plugin README claimed thinking mode was a `deepseek-v4-pro` feature reached through profile parameters, which is the belief that produced the predicate. It now says both V4 models reason by default and that `thinking` exists mainly to turn reasoning off, with a "Thinks by default" column in the model table. The connection-profile editor's own help text carried the same misapprehension and was corrected with it: "(model default)" means thinking is ON.

Also added the migration test that should have shipped with bug 85: `retire-prefill-on-thinking-profiles-v1` now has coverage for what it clears (thinking-active DeepSeek and Ollama rows) and, more importantly, what it leaves alone — thinking-off profiles, uncatalogued models, other providers, rows already at 0, stored nulls, and unparseable `parameters`.

#### DeepSeek thinking models stop 400ing on every character turn (bug 85)

A chat on a DeepSeek profile using `deepseek-v4-flash` greeted you and then died on every turn after, with HTTP 400: "The `reasoning_content` in the thinking mode must be passed back to the API". The error text points at history; the cause is the trailing `[Name]` prefill.

In a multi-character chat each reply is anchored to one character, either by appending an assistant message containing `[Character Name]` or by appending a prose instruction to the system prompt. `isMultiCharacterChat` counts one LLM seat as multi-character, so a plain one-character chat takes the anchor too. DeepSeek's thinking mode reads a request ending on an assistant message as a turn to continue and demands the `reasoning_content` that produced it — which a synthetic prefill has none of. The greeting escapes because `lib/chat/initial-greeting.ts` applies no anchor at all.

The predicate deciding which anchor to use was provider-shaped (`PREFILL_HOSTILE_PROVIDERS`, holding `ANTHROPIC`) when the property is model-shaped. Two of the three known hostilities are thinking failures, not provider quirks: Ollama's chat template never opens the reasoning block behind a prefilled turn (bug 68), and DeepSeek 400s (this bug). Only Anthropic's is genuinely structural, so that one stays a provider rule.

The prefill default now also asks whether the profile will run a thinking turn:

- `ModelInfo` gained `supportsThinking` and `thinksByDefault`. The two are separate because providers differ — `deepseek-v4-flash` reasons with `parameters: {}`, while Anthropic and Ollama thinking is opt-in per profile.
- `TextProviderPlugin` gained `thinkingTurnRule`, naming the `parameters` key that switches reasoning on or off and which values mean which. It is declarative rather than a predicate function because the connection-profile editor needs the same answer in the browser, where a server-side plugin closure can't be called; it serialises out through `/api/v1/providers`. DeepSeek and Ollama declare one; no other provider's behaviour changes.
- `lib/llm/thinking-turn.ts` holds the one pure evaluator both sides run — an explicit profile choice wins, else the model's `thinksByDefault`, else no. `providerRegistry.profileRunsThinkingTurn()` joins it to the plugin table server-side.
- `defaultMultiCharacterPrefill(provider, runsThinkingTurn)` returns false for a thinking profile. `profileUsesNamePrefill` is unchanged in spirit: a stored boolean still outranks every default, so ticking the box back on is honoured.
- The profile editor re-seeds the checkbox when the model changes, corrects a stored-null row once the model list loads, and warns when the box is ticked on a thinking profile.
- Migration `retire-prefill-on-thinking-profiles-v1` clears the stored `1` on existing DeepSeek and Ollama profiles that are running a thinking turn. Those rows got their `1` from the old provider default at creation, not from a user choice, and it outranks any default fix. Rows already at `0`, and profiles not running a thinking turn, are untouched. The migration carries a frozen copy of the two plugins' rules, because migrations run before the plugin registry is up.

A non-thinking DeepSeek or Ollama profile keeps the prefill, which is the stronger anchor and what weak models need most — that was bug 68's stated objection to a blanket provider rule, and it is preserved rather than re-incurred.

Two adjacent DeepSeek plugin defects found while investigating were filed separately as [bug 86](developer/bugs/fixed/bug-86-deepseek-thinking-detection.md) and are fixed below. Neither caused the 400.

#### A failed image generation says what actually went wrong (bug 84)

When `generate_image` failed, the notice above the composer read `Failed to generate image` and the toast read `Image generation failed: Unknown error` — every time, no matter the cause. Asking for an image in a chat with no image profile resolved is the common case, and the remedy is right there in the server's own sentence: `Image generation is not enabled for this chat`.

The server had been sending that sentence all along. The SSE tool-result frame carries it in `error`, a sibling of `result`, specifically because `result` is null on failure. The Salon looked for it one level down at `result.error`, found nothing, and fell back to its generic strings — so the field had no reader anywhere in the app.

The failure text is now resolved through one helper, `resolveToolResultErrorText`, which prefers the sibling `error`, keeps the old nested read as a fallback, and strips the executor's leading `Error: ` so the toast doesn't read "failed: Error: ...". Both the notice and the toast render the same resolved sentence.

#### The intermittent jest worker segfault was V8's, not SQLCipher's (bug 83)

For months, roughly one full `npm run test:unit` run in five ended with `A jest worker process ... was terminated by another process: signal=SIGSEGV` failing one arbitrary suite while every actual test passed, and a rerun always went green. It was assumed to be the known native-SQLCipher teardown flake fixed in June. A macOS crash report proved otherwise: the dying worker had no `better_sqlite3.node` loaded at all, and the faulting stack matched [nodejs/node#62393](https://github.com/nodejs/node/issues/62393) frame-for-frame — a V8 13.6 (Node 24) GC race where a mark-compact triggered inside Sparkplug's baseline prologue dereferences a junk frame slot. Upstream still reproduces it on Node 26, so the fix is the thread's proven workaround: disable the Sparkplug baseline compiler for test runs. The five jest scripts in `package.json` now launch `node --no-sparkplug node_modules/jest/bin/jest.js` (the flag isn't allowed in `NODE_OPTIONS`), and `jest.global-setup.js` appends `--no-sparkplug` to `process.execArgv` before any worker forks, so ad-hoc `npx jest` runs get protected workers too — jest-worker inherits the parent's `execArgv`. The integration config now shares that globalSetup, which also gives it the native-ABI self-heal. Nine consecutive full runs (half with a cleared transform cache) produced zero crashes; upstream's matrices report the same at larger sample sizes with no measurable wall-time cost. Also tightened while in there: `quantize-embeddings.test.ts` now closes its per-test in-memory database like every other real-binding suite. Filed as [bug 83](developer/bugs/fixed/bug-83-v8-sparkplug-worker-segfault.md).

#### Group scenes stop turning into committee meetings

In a multi-character chat, especially on weaker models, every character's turn converged on the same shape: open with a roll-call recap of what the previous speakers said, endorse all of it, claim "the one thing nobody has named yet," repeat the cast's coined phrases verbatim, and close by restating the group's action list. One observed chat had three characters in a row ending consecutive turns with the identical sentence. Three changes attack the loop:

- **Group-scene discipline rules** now ride in the system prompt on every multi-character turn (both the `[Name]`-prefill and prose anchor routes). They forbid opening with a recap of other speakers, agree-then-add replies, reusing another character's metaphors or coined phrases, and restating the plan; they tell the character to speak only when it changes something, and to vary length instead of defaulting to a speech. The previous anchor only pinned *who* was speaking and said nothing about content, so the strongest style signal in context was the preceding chorus itself.
- **The turn-skip note counts an echo as nothing to say.** The "you may pass" note now states that a reply which mostly restates, endorses, or rephrases what has already been said — even in the character's own voice — is not substantive, and the character should pass.
- **"Recently addressed" now means directly addressed.** `isRecentlyAddressed` used to fire on any name mention since the character last spoke. Because every chorus turn named most of the cast in its recap, every character was permanently "addressed," so every turn note carried the "answer rather than pass" caution and nobody ever passed — the recap ritual and the skip mechanism fed each other. The check now requires a vocative position (name at a clause boundary followed by address punctuation: "Marion, …", "Greg?", "Amy —"), an `@`-mention, or a targeted whisper; possessives and mid-sentence citations ("Marion's point", "if Greg is ready") no longer count.

#### The Commonplace Book can consult past conversations on every turn

A character's vault holds a summary of every conversation it has taken part in, and the Commonplace Book searches that shelf to build the "Relevant Past Conversations" list a character sees. Until now that list was refreshed on three cadences only: the opening recap (chat start or character join), each summary fold, and retrospective turns that reference the past explicitly. Between folds the list stood still, so the conversation could wander several turns away from the past dialogues the character was still being pointed at.

A new instance-wide setting — Settings → Memory → Recall Relevance → **Consult past conversations every turn** — re-runs that search on every turn and folds the fresh list into the consolidated whisper. It is off by default.

The reason it can run per turn at all is that it costs no extra embedding call. `searchMemoriesSemantic` now reports the vector it embedded for the turn's memory search through a `captureQueryEmbedding` hook, and `searchVaultConversationSummaries` accepts that vector via `precomputedEmbedding` instead of embedding the same sentence again. The proactive pre-search path threads its vector through `runPreContextPreCompute` → `buildMessageContext` → `buildContext`, so the reuse holds on both memory paths. When no vector is available (memories skipped, no embedding profile, a failed embedding, or the degraded text-search fallback), the cadence sits the turn out rather than paying for a call of its own.

The per-turn search is skipped on the turn the opening recap runs — the recap already carries its own freshly-searched list, and a second one would repeat it inside a single whisper. Otherwise the per-turn list is deduplicated against the standing fold-posted `relevant-conversations` whisper, and the retrospective mini-recap is now deduplicated against both — one conversation UUID is never listed twice to the same character in the same turn. List length ramps with the connection profile's context window (3 entries at 4K, 10 at 32K), the same ramp the fold cadence uses; the constants now live in `lib/memory/conversation-summary-search.ts` so the two cadences cannot drift apart.

There is no chat-, project-, or character-level override: the setting is on for every conversation or off for every conversation.

#### Local models with strict chat templates stop failing on every turn after the first (bug 82)

A chat on a local Ollama or OpenAI-compatible server running a Qwen model would greet you and then never answer again. Every turn after the opening died with `Jinja Exception: System message must be at the beginning`, and because the failure was an HTTP 500 from the endpoint rather than an empty reply, it showed up as a toast and a server-log entry and nothing else.

The context builder emits the head of a turn as up to three consecutive system messages on purpose: the persona prefix, the identity reinforcement, and the compressed-history summary, kept separate so a cache breakpoint on the first isn't invalidated by churn in the others. Hosted providers accept that. A local runtime doesn't answer for itself — it applies the model's own chat template, and the Qwen family (plus several Llama- and Gemma-derived templates) raises an exception on any system message after index 0, rejecting the whole request before a token is generated. The greeting sends one system message, which is why it worked.

The leading run is now folded into a single message at request-build time, in the Ollama and OpenAI-compatible builders only, joined with blank lines so nothing is lost from the prompt. `@quilltap/plugin-utils` gained `collapseLeadingSystemMessages`, and `OpenAICompatibleProvider` gained an `acceptsRepeatedSystemMessages` flag that defaults to true — so hosted providers, including DeepSeek and every other subclass, send exactly the bytes they sent before, and their cache breakpoints land where they always did.

#### An OpenAI-Compatible profile can hold an API key (bug 81)

Pointing an OpenAI-Compatible profile at a hosted service — Together, Fireworks, Groq, DeepInfra, a vLLM behind auth, a corporate gateway — was impossible: the profile form showed no API Key field for that provider, and Settings → API Keys → Add New API Key didn't offer OpenAI-Compatible at all, so no such key could be created. The request went out unauthenticated and the endpoint returned 401.

One flag, `requiresApiKey`, was answering two different questions: must this provider have a key, and may it have one? For every other provider those answers match. OpenAI-Compatible is the one that spans both worlds — an unauthenticated llama.cpp on localhost and a hosted endpoint behind a bearer token — so `false` was the only workable value, and `false` removed the provider from both key surfaces.

Providers can now declare `acceptsApiKey` alongside `requiresApiKey`. Omitted, it means the same answer as `requiresApiKey`, so no existing plugin changes behavior; Ollama still offers no key field. OpenAI-Compatible declares `false`/`true`: the key field appears, unstarred and optional, and an OpenAI-Compatible key can be created in Settings → API Keys.

The server side needed the same split. The chat, Brahma Console and help-chat paths all gated the key lookup on `requiresApiKey`, so even a key attached to an OpenAI-Compatible profile was dropped before the request left. They now go through one resolver that requires a key where a key is required and forwards one wherever a key is accepted; a profile naming a key that has since been deleted fails loudly instead of silently going out bare.

#### Story background prompts stop concealing nudity when the image provider doesn't require it

The story-background prompt crafter carries a "depicting intimate or unclothed states" section that teaches it to translate narrative nudity into cinematic concealment — a sheet draped where it's needed, a silhouette, foreground occlusion, a bath at a discreet level. That exists to get a prompt past image-provider moderation, and it was unconditional: baked into the system prompt constant, applied to every story background regardless of where the image was going.

So a chat marked dangerous with a Concierge uncensored image profile configured got accurate per-character appearance text ("nude" — appearance sanitization already steps aside for exactly this case) fed into a crafter that then draped a sheet over it. The concealment was being applied to clear moderation the target provider does not perform.

The intimacy guidance is now selected per call. `StoryBackgroundPromptContext` gains `uncensoredImageTarget`, and the crafter's system prompt is assembled from a shared head/tail plus one of two intimacy blocks: cinematic concealment (the default, unchanged wording) or candid depiction. The candid variant keeps every background-framing rule — figures toward the edges, environment primary, wide atmospheric shot, never an anatomical close-up — and both variants still refuse to re-dress a character the narrative undressed.

The handler passes `isDangerousChat && hasUncensoredImageProvider`, the same signal `sanitizeAppearancesIfNeeded` already uses, so the two layers now agree. The empty-response retry that swaps in the uncensored text profile carries the flag through, instead of re-sending the concealment instructions to an uncensored model.

Third case: when a standard provider accepts the prompt and then rejects the finished image on moderation grounds, the Concierge reroutes to the uncensored image profile — and that path was resending the already-concealed prompt verbatim. It now re-crafts the prompt candidly for the reroute target first. Best-effort: a failed re-craft keeps the existing prompt so the reroute still produces an image.

Unchanged: the `generate_image` tool's prompt crafter, which never had concealment language; the avatar prompt builder, whose bare-chest handling is a framing constraint (crop at the collarbone) rather than prompt prose; and concealment as the default everywhere a moderated provider is the target.

#### A project's story background follows its display-mode setting again (bug 80)

A project set to "Latest chat background" (or "Project background", or a static upload) showed the theme's Prospero image instead. The setting saved correctly and the API returned the right image — only the page never painted it.

The tabbed workspace replaced each view's own background layer with a single arbitrated backdrop, so two panes in a split can't paint over each other. Views report their background to it, and the old per-view layer is suppressed inside the workspace. The project detail view was never converted: it still set the CSS variable for a layer that is now hidden, and reported nothing. What painted instead was the projects list's subsystem background, which stayed registered under the tab even after you drilled into a project.

The project detail now reports its background to the backdrop, falling back to the Prospero image when the project's mode is "Theme colors". The list's subsystem background moved into its own component that unmounts while a project is open, so exactly one background is registered per tab — which also fixes the deep-link case (opening a project straight into a new tab), where the two competing reporters used to resolve the wrong way.

#### Avatar generation no longer crashes on chats older than the hair slot (bug 78)

`equippedOutfit` is unconstrained JSON, and the hair slot was added without a migration: every slot key defaults to an empty array, so a chat row written before the slot existed is supposed to read back with `hair: []`. That held everywhere the value passed through the schema, and `getEquippedOutfit` was the one place it did not — it returned the stored object through a raw cast. The outfit resolver then indexed the missing key and handed `undefined` to `expandComposites`, which threw `rootIds is not iterable` and killed the avatar job.

This hit any chat created before the hair slot that has something equipped — in practice every long-lived instance, since only chats made after the feature write all five keys. Two more readers behind the same call degrade quietly instead of crashing: the scene-state tracker and the context manager's live-outfit override both sit behind their own try/catch, so the model simply stopped being told what the character was wearing.

Stored slot bags are now normalized in one place (`normalizeEquippedSlots` in `lib/schemas/wardrobe.types.ts`) on the way out of the column, which fixes the crash and the two silent readers together. A bag the schema refuses outright — a bad id in one slot — is salvaged key by key rather than discarded, so a repair never costs you clothing that was still legible. The resolver keeps an `?? []` of its own for callers that pass a slot bag directly, and the wardrobe-create tool now reads the post-equip state through the repository instead of off the chat row by hand.

#### Import says so when it can't read the destination (bug 79)

Repository reads answer a failure with a fallback value — `null`, `[]`, `false` — which is the right default when the alternative is a blank screen. The importers were consuming those values as facts about the destination ("no such row", "no collision") and committing writes on the strength of them. On a database that fails individual reads — a corrupt page, a missing table after a bad migration, a competing writer — an entity that *existed* read as *absent*, the import took the wrong branch and produced duplicates or skipped merges, and it reported success with nothing in its warnings.

Import and import preview now run with those fallbacks suspended: a read that fails stays a failure, lands in the importer's per-item handler, and is reported by name. Partial progress still works the way it did — one unreadable entity is skipped rather than aborting the run — but the summary now names what was skipped and why.

Five importers (tags, roleplay templates, and the three profile types) were only writing failures to the log, never to the warnings you see. They now report them like the others. So does the preserve-ids preflight, which refuses the whole import before anything is written and had been returning failure with no explanation at all — including when a character rehydrate uses it, which previously reported "unknown import error".

#### Workspace tabs refresh their data when you navigate back to them

The workspace keeps every open tab mounted (that's what lets a streaming Salon survive tab switches), which meant a tab you returned to still showed whatever it had loaded when you left — rename a character in their detail tab and the characters list behind it kept the old name until a full page reload.

Now a tab refreshes its data sources every time it becomes the active tab again. The Home tab reloads its dashboard (recent chats, active projects, characters); the characters, chats, projects, Scriptorium, Files, Photos, Scenarios, Pascal's Workbench, Wardrobe, Profile, Generate Image, and Settings tabs all refetch what they display, including in-place detail views (a project or document store you've drilled into). Refreshes are silent — the current content stays on screen while fresh data loads, so nothing flickers back to a loading screen.

Mechanics: each tab's subtree now knows its own visibility (`useOnTabActivated` in `components/workspace/workspace-tab-context.tsx`). TanStack Query reads are invalidated centrally from a per-tab-kind map (`lib/workspace/tab-refetch.ts`); views still fetching outside TanStack Query re-run their loads through the same hook with a new `silent` option so loading flags don't flip. Live surfaces (Salon conversations, terminals, Document Mode) and editors with unsaved state (character edit, the settings wizard, standalone documents) are deliberately left alone.

#### An API key no longer follows a connection profile onto another provider (bug 76)

Changing a connection profile's provider left the previously selected API key in form state, and the form sent it regardless. On a keyless provider (Ollama, OpenAI-Compatible) the API Key select isn't rendered at all, so saving failed with `API key provider does not match profile provider` — a message about a field that isn't on screen, with no way to clear it. On a different hosted provider the select re-rendered blank, because its options are filtered to the current provider, while Connect / Fetch Models / Test Message kept sending the old provider's key.

The form now sends only a key the select could currently display: nothing when the provider requires no key, and nothing when the stored id isn't among the options listed for the current provider. This is the same `outboundBaseUrl` chokepoint bug 73 added, one field over (`outboundApiKeyId` in `useProfileForm`). Connect's own validation judges the same value, so a blank select reports "API Key is required for this provider" instead of probing with a hidden key. The save body always sends the field, `null` when nothing may leave, so a profile already saved with a mismatched key clears it on the next save instead of being refused forever.

Two lists are treated as "not loaded" rather than as evidence: an unknown provider keeps its stored key, and an API-key list that hasn't arrived yet skips the displayability check entirely. The provider dropdown still doesn't clear the field, so switching back to the original provider restores the selection.

#### New "hair" wardrobe slot

The wardrobe gains a fifth slot, `hair`, alongside top/bottom/footwear/accessories. It holds a *hairdo*, not hair: braids, an updo, marcel waves, a severe bun, the occasional wig. A character's natural hair — colour, length, texture — stays in the physical description, where it has always lived. The distinction is stated the same way in every prompt that draws the wardrobe/physical line.

Hair is threaded through every surface that knows about slots: the wardrobe tools (`wardrobe_create`, `wardrobe_update`, `wardrobe_wear`, `wardrobe_take_off`, `wardrobe_list`), the outfit-choosing LLM at chat start, all three AI character generators, the Character Optimizer, wardrobe-from-image analysis, avatar and Lantern scene prompts, the wardrobe dialogs and the Green Room preview (rose badge), and `.qtap` exports.

Hair is deliberately not clothing:

- **An empty hair slot is never reported.** Slots now carry a `reportWhenEmpty` property. Garment slots announce their vacancies ("topless", "barefoot") because a missing shoe is information; hair does not, because an empty hair slot means unstyled hair, not a bald character. Nothing — Aurora's announcements, scene state, image prompts, or wardrobe tool results — says anything about hair when the slot is blank.
- **Nudity semantics ignore hair.** "Completely naked and unadorned", the "naked" collapse, and the deliberately-unclothed detector are all computed over clothing slots only. A naked character keeps their braids, and an outfit of nothing but a hairdo still counts as "chose nothing to wear".
- **Avatars carry the hairdo** on both the dressed and bare-top branches.
- **Undressing keeps the hairstyle** in the scene-state clothing summary unless the narrative explicitly takes it down.

Hats remain accessories — a hat is worn over a coiffure.

Two upgrade notes. Every chat's cached clothing summary is re-derived once after upgrade (the equipped-outfit hash now includes the hair key), a one-time cheap-LLM call per active chat. And a `.qtap` export containing hair items imports into *older* Quilltap builds with those items silently skipped; everything else comes through.

No migration and no schema change: `equippedOutfit` is unconstrained JSON and every slot defaults to an empty array, so existing rows parse with `hair: []`.

Internally, the duplicated slot lists are gone. `lib/schemas/wardrobe.types.ts` now holds one ordered slot list plus a metadata registry (`WARDROBE_SLOT_META`) carrying each slot's labels, badge class, clothing flag, and empty-reporting rule; the four UI label/badge maps, three local `SLOT_KEYS` copies, two `cloneSlots` copies, and five independent `validTypes` sets all read from it.

#### Docs: removed the outfit-preset endpoints and fixed the equipped-outfit shape

`docs/developer/API.md` documented six `/api/v1/characters/[id]/wardrobe/presets*` endpoints (list, create, read, update, delete, `?action=apply`) that no longer exist — outfit presets were retired when composite wardrobe items replaced them, and there is no `presets` route under `app/api/v1/characters/[id]/wardrobe/`. The section is now marked as removed and carries a mapping table from each old preset call to its current equivalent (the ordinary wardrobe routes, plus `POST /api/v1/chats/[id]?action=equip` for applying one), along with a pointer to the legacy-preset folding that import and backup restore still perform.

The same region showed the pre-4.5 equipped shape — one UUID per slot, `null` when empty. Every slot has been an array of ids since 4.5 (slots layer; composites are stored as their own id and expanded at read time). The `GET /api/v1/chats/[id]?action=outfit` example now shows arrays and names `EquippedSlotsSchema` in `lib/schemas/wardrobe.types.ts` as the source of truth.

`help/character-editing.md` still described a vault `Outfits/` folder of saved presets with a four-slot `slots` map; `vault-readers.ts` has not read that folder since the rework. The vault-folder paragraph now covers what `buildWardrobeItemFile` actually writes, including the previously undocumented `imagePrompt` and `componentItems` frontmatter keys and the composite `replace` flag, plus the cycle and unknown-reference handling. Both files were reconciled with the new `hair` slot on merge.

#### The three character-generation systems now know every character bucket

The AI Wizard, Summon From Lore, and the Character Optimizer ("Refine from Memories") previously shared only a partial map of the character data model — the vantage-point preamble covering manifesto/identity/description/personality/title — and each had its own blind spots beyond that. `lib/services/character-field-semantics.ts` now carries the complete taxonomy: new prose blocks for system prompts (`PROMPT_SEMANTICS`), properties/pronouns/aliases (`PROPERTIES_SEMANTICS`), the physical description (nothing removable), and the wardrobe (slots, imagePrompt vs description, composites, defaults), plus a composed `FULL_FIELD_SEMANTICS`. All three systems consume the shared blocks instead of ad-hoc wording.

**AI Wizard** gains two new generatable fields: Properties (pronouns + aliases, with the same no-placeholder rule Summon uses) and First Message. Its context prompt now shows existing example dialogues, system prompt, first message, pronouns, and aliases (previously omitted even when present). Two bugs fixed: `wardrobeItems` was missing from the server-side request schema, so "Select all" failed the whole request with a validation error; and the wardrobe checkbox was absent from the field-selection step, making it unreachable. Generated properties persist via character PUT (staged into form state in the edit view); the generation preview renders wardrobe and properties results.

**Wardrobe generation** (Wizard + Summon, shared in new `lib/wardrobe/generated-items.ts`) now produces items with `imagePrompt` visual cues, marks the everyday set `isDefault` so a summoned character starts dressed, and generates 1–2 composite outfits whose components are referenced by title and resolved to real item ids at persistence time (leaf items created first).

**Summon From Lore**'s pronouns step now also extracts aliases; the review screen shows aliases and the wardrobe counts it previously omitted, and the step matrix includes the wardrobe step that was already running but never reported.

**Character Optimizer** now sees the whole character: title, pronouns, aliases, first message, and the full wardrobe inventory join its context, so suggestions stop colliding with what's already on record. Two new suggestion passes: Wardrobe (add a memory-established garment as a proper structured item, or refine an existing item's description — never bodily features, never deletions) and Aliases (additions only, one per suggestion; pronouns are read-only). The apply flow persists both through the wardrobe endpoints and the character PUT, and the suggestions-file dossier groups them under their own headings.

Help docs updated (`ai-character-import.md`, `character-optimizer.md`, `character-creation.md`); new unit coverage for the shared wardrobe helpers, composite assembly, and the new prompts.

#### The Salon's image-generation notice now clears itself (bug 77)

The `Generating image...` / `Successfully generated 1 image!` banner above the Salon composer had exactly one teardown — a detached `setTimeout` at the end of `sendMessage`'s terminal `onDone` — so any turn that finished another way (continue mode, an intermediate turn in a tool chain, an error) left it pinned above the composer for the rest of the session, with no way to close it. The notice now owns its own lifetime: a settled success/error status auto-dismisses after 6 seconds (timer held in a ref, superseded on each new status, cleared on unmount), turn boundaries drop only a `pending` status whose result never arrived, and the alert has a close button. Stopping a turn clears it immediately.

#### Importing a `.qtap` no longer breaks composite outfits (bug 75)

`importCharacterWardrobeItems` re-mints every wardrobe item id on import but passed `componentItemIds` through verbatim, so every composite outfit in an imported character kept references to ids that exist only in the export — equipping it cleared its slots and put nothing on, silently. The importer now pre-assigns the new ids, remaps composite references through the old→new map (dropping unresolvable ones with an import warning), creates leaf items before the composites that bundle them, and passes the pre-assigned id to `wardrobe.create`.

#### Three MODERN sample prompts for high-context models

The default-system-prompts plugin (1.1.17) gains three model-agnostic sample prompts written for modern 128K+ context models: `MODERN_GENERAL` (relationship-neutral — the character definition and story decide the dynamic), `MODERN_ROMANTIC` (romance-forward, with pacing discipline and guardrails against love-bombing and purple drift), and `MODERN_PLATONIC` (a companion prompt whose anti-romance guardrail is framed as character identity rather than a prohibition list, which holds up better over long contexts). All three lean on what current models do well — long-range callbacks, in-character refusal — and name the failure modes they drift into (assistant bleed, therapy-speak, echoing, uniform rhythm). The manifest's stale `promptCount` (10) was corrected to 21. `help/prompts.md` now describes the three groups of samples (MODERN, model-specific, GENERIC) and when to pick each.

#### Model-specific sample prompts modernized

The 16 model-specific prompts (CLAUDE / GPT5 / GPT4O / GEMINI / GROK / DEEPSEEK / MISTRAL / OLLAMA, companion + romantic) were rewritten around each family's dominant current failure mode rather than a shared anti-pattern list: Claude gets its assistant reflexes named as reflexes to override (caregiver swerve, tidy wrap-ups); GPT-5 gets an explicit output contract (no document structure, no closing offers, permission to be inefficient in the romantic register); GPT-4o gets anti-sycophancy discipline; Gemini gets a style governor against overwriting, "not X but Y" constructions, and long-context phrase looping; Grok gets wit calibration (sincerity without irony allowed); DeepSeek gets an escalation governor (pacing, metaphor budget, emotional continuity); Mistral gets pushed the opposite direction — initiative and interiority over flat economy; Ollama's stay short and imperative with a loop guard and updated sampler guidance. Every file now carries the never-write-{{user}} rule (previously missing from several), long-context callback guidance, and each model's structural dialect (XML tags for Claude/Gemini, `###` sections for DeepSeek). The GENERIC pair is unchanged; MODERN supersedes it for new characters.

#### Connection profiles can be tagged (bug 74)

Tagging a connection profile has never worked. `TagEditor` maps an entity type to an API base path, and the `profile` branch returned `/api/v1/profiles/<id>` — connection profiles are served from `/api/v1/connection-profiles`, and there has never been an `/api/v1/profiles` route. Every read and write 404'd. The read fails silently (the loader checks `res.ok` and simply doesn't set state), so the Tags section always looked empty; adding a tag created the tag but failed to attach it, with a generic "Failed to add tag" toast that gave no hint the URL was wrong.

Two further layers were only visible once the path was corrected.

The connection-profile GET had no `get-tags` action. It ignored the parameter and returned `{ profile: … }`, so `TagEditor` read `data.tags` as `undefined` and still showed nothing — with no error. It is now a real action returning `{ tags }`, and the GET refuses an unrecognised action with a 400 instead of falling through to the profile body. That leniency is exactly what hid this: a caller asking for something the route didn't implement got a 200 and the wrong shape. The POST on the same route was already strict.

And `ProfileCard` rendered the wrong shape. `enrichWithTags` — used by the collection endpoint the card renders from — returns `{ tagId, tag }` envelopes, but the card read `tag.id` and `tag.name` straight off them, so both were `undefined` and a tagged profile drew an empty pill. `ConnectionProfile.tags` was typed `Tag[]`, which is not what the wire carries; `fetchJson<any>` meant nothing checked. The client type now declares the envelope and the card unwraps it.

The last two are the same confusion twice: two tag shapes with no owner. Entity payloads carry `{ tagId, tag }`; `?action=get-tags` answers flat `{ id, name, visualStyle }` because that is what `TagEditor` and `TagBadge` consume. New `resolveEditorTags` in `lib/api/middleware/enrichment.ts` owns the flat projection, built on `enrichWithTags` so the batching and the "preserve the entity's own order" rule are stated once. The character route's `get-tags` moved onto it as well — those are the two answers `TagEditor` must read interchangeably — which also drops an N+1 there.

Not fixed, deliberately: `TagEditor`'s `chat` branch has the same missing `get-tags` action on the chats route. Nothing in the codebase passes `entityType="chat"`, so building it would be speculative; the requirement is recorded in the bug file instead.

#### A base URL no longer follows the profile onto a provider that hides it (bug 73)

Selecting Ollama or OpenAI-Compatible in the profile editor fills the Base URL box with that provider's default. Selecting a hosted provider next hid the box but kept the value, and all four outbound sites sent it whenever it was truthy rather than when the provider takes one. The result was a profile that could not connect — Connect returned `Failed to validate connection to OpenAI` with a valid key, Fetch Models failed, and the save wrote `http://localhost:11434` onto the row — with the offending value not rendered anywhere on the provider it broke, and no gesture to clear it. Merely browsing the provider dropdown was enough to trigger it.

`outboundBaseUrl()` in `useProfileForm.ts` is now the one answer to what may leave the form: `''` for a provider the list says takes none, the field's value otherwise. `handleConnect`, `handleFetchModels` and `handleTestMessage` read it instead of `formData.baseUrl`. A provider missing from the list is not evidence of anything — it hasn't loaded, or its fetch failed — so the stored value is kept there rather than clearing a working profile on a failed fetch.

`buildRequestBody` drops its `if (baseUrl)` guard and always sends the key, carrying `''` for a provider that takes none. This is deliberate: the update handler gates on `baseUrl !== undefined`, so omitting the key would leave every already-poisoned row untouched. An empty string maps to NULL on both the create and the update path, which makes the next ordinary save the cure for a profile broken before this fix.

Two further reads judged a provider by a base URL it may not own and were gated the same way — the edit-time model fetch (a stored row can still carry a stale URL until its first save) and the `supportsMimeType` / `getAttachmentSupportDescription` pair, which infer vision and attachment support partly from the endpoint.

`handleProviderChange` is unchanged. The value stays in form state, so switching back to a provider that shows the field restores it; the stale URL is inert rather than destructive, and no rule is needed about whether a typed URL outranks an auto-filled one.

Covered by `__tests__/unit/components/settings/profile-modal-base-url.test.tsx` — the real modal over the real hook, driven through the dropdown with `fetchJson` captured.

#### Clearing a numeric provider option leaves it clear (bug 72)

Every numeric field in the provider-options panel — Ollama's Request Timeout, the whole Sampling group, the OpenAI-compatible endpoint options — snapped back to its schema default the instant it was emptied, with the caret left after the restored value. Clearing `300` and typing `5` produced `3005`, and `3005` was stored and sent. The three behaviors were individually correct: an empty input emits `undefined`, `setParameter` treats `undefined` as delete-the-key, and `fieldValue` falls back to `field.default` when the key is absent. Clearing the field was self-canceling.

`NumberField` now holds its own draft string and renders that. A half-typed number isn't a value the parameter bag can hold — `1.` and `-` both arrive as `''` — so an input that re-derives its display from what the host stored will fight the person typing. A `syncedFrom` companion records the prop the draft was last reconciled against and is set on every write-through to the value the host will hand back, so the component can tell its own echo from the parameter genuinely moving underneath it (a different profile, a schema swap). The simpler re-sync-when-the-prop-changes spelling reintroduces the bug for any field that had a stored value before the clear.

`fieldValue` now returns `undefined` rather than `field.default` for number fields, and `NumberField` renders the default as the input's placeholder. An unset numeric option therefore shows an empty box with the default behind it in grey, instead of the default sitting in the box as though someone had chosen it. That closes the bug's second consequence: absent and explicitly-default no longer look identical, "leave blank for the default" is a state the user can see themselves reach, and a blank field round-trips as absent — so a later change to a plugin's default still reaches profiles that never set one. Every other control keeps the fallback as a real value; `EnumField` relies on it to preselect.

Covered by five cases in `__tests__/unit/components/settings/provider-options-panel.test.tsx`, driven through a host that reproduces `ProfileModal`'s delete-on-`undefined` `setParameter`.

#### Local providers send the profile's parameters, and OpenAI-compatible endpoints can call tools (bug 71)

`connection_profiles.parameters` is free-form JSON: any key saves and reloads cleanly. Ollama read three of them and hardcoded the rest of its `options` object; the OpenAI-compatible provider never read the blob at all and declared no options schema. Everything else was dropped on the way to the wire without a log line, so no local model could be run at the sampling settings its own publisher specifies, and `reasoning_effort` — exposed on DeepSeek and Z.AI — was unreachable on the two providers where wall-clock control matters most.

`applyProfileParameters(body, params, allowlist, normalize?)` in `@quilltap/plugin-utils` 2.3.0 is now the one mechanism. It is an exported function rather than a base-class method because only DeepSeek extends `OpenAICompatibleProvider` — Z.AI, OpenRouter and Ollama implement their providers directly and reach it by composition. Keys are allow-listed, never spread, so `model`, `messages`, `stream` and `tools` stay unreachable from a profile; `undefined`, `null` and the empty string omit the key. `OpenAICompatibleProvider` gained `profileParamAllowlist` (empty by default, so every subclass is byte-identical on the wire until it opts in) and an overridable `normalizeProfileParam`. DeepSeek and Z.AI dropped their hand-rolled copies of the same loop.

**OpenAI-compatible** (plugin 1.0.40) gets its first provider options schema: Reasoning Effort, Top K, Min P, Repeat Penalty, Presence Penalty, Frequency Penalty, Seed, Reuse Cached Prompt. Reasoning Effort is **not** sent as a top-level key — it is folded into `chat_template_kwargs`, which is how `llama-server` reaches a Jinja template's arguments; a flat key parses fine and is never seen by the template.

**Ollama** (plugin 1.0.43) widens `options` to `top_k`, `min_p`, `repeat_penalty`, `presence_penalty`, `frequency_penalty`, `seed` and the mirostat trio, and gains two top-level settings. **Keep Model Loaded** sets `keep_alive` per profile, so a large chat model can stay resident while a small utility model unloads at once; it defaults to sending nothing at all, which leaves any `OLLAMA_KEEP_ALIVE` on the server in charge. **Thinking Effort** appears when Enable Thinking is on and sends `think` as a level rather than a boolean. Both were measured against a live Ollama 0.32.1 rather than assumed: an unknown think level is rejected outright by the server, and `keep_alive: "-1"` is rejected as a duration while the number `-1` is honoured, so the numeric sentinels go out as numbers. `num_ctx` and the existing thinking/timeout keys now route through the same table, so there is one answer to what a profile may set.

Separately, the OpenAI-compatible provider could never call a tool: its capability is `false` *and* its request bodies had no `tools` key. The capability stays `false` — an arbitrary endpoint is the conservative case — but it is now a default rather than a ceiling. It seeds a new profile's "Allow tool use" checkbox, which was already editable, and the provider now sends `tools`/`tool_choice` when the caller supplies tools and parses `tool_calls` back on both paths (index-keyed accumulation of streamed argument fragments). An endpoint that does not in fact support tools fails visibly rather than falling back silently.

No migration and no export-schema change: `parameters` was already free-form JSON and already round-trips.

#### Max Tokens and Top P from the profile are actually sent

A connection profile stores its sampling knobs under the keys the editor writes: `temperature`, `max_tokens`, `top_p`. The Salon's streaming path read `modelParams.maxTokens` and `modelParams.topP` — camelCase names that do not exist in that blob — so two of the three came out `undefined` on every turn and the provider fell back to its own defaults. On Ollama that meant `num_predict: 4096` and `top_p: 1` regardless of what the profile said, and the profile card in Settings displayed figures that were never used.

Regenerate/swipe read the same blob correctly, so the two paths disagreed: the original reply used the provider defaults and a regeneration of that same reply used the profile. The greeting path had the camelCase bug too, on both its normal and its Concierge-uncensored branch.

`resolveSamplingParams` (`lib/llm/sampling-params.ts`) is now the one place that maps a parameters blob to the three `LLMParams` fields — canonical snake_case first, camelCase tolerated for a hand-edited or imported blob, absent knobs left undefined so nothing is invented. The streaming service, regenerate/swipe, the greeting path, and the image-description fallback all go through it. Do not read `parameters.max_tokens` at a call site again.

Not to be confused with `resolveMaxTokens` in `model-context-data.ts`, which deliberately ignores `parameters.max_tokens`: that one sizes the context budget's response reserve, this one is the per-request generation cap on the wire.

Covered by `lib/llm/__tests__/sampling-params.test.ts`. One consequence worth knowing: a profile carrying a large Max Tokens has been ignored until now and will be honoured from here on.

#### Ollama profiles can set their own request timeout

An Ollama turn was bounded by the shared 5-minute default in `@quilltap/plugin-utils` with nothing in the UI to change it. On a streaming call that budget covers only the wait for the first token — but loading a large model off disk and evaluating a long prompt both happen inside that silence. A 27B model on a 20k-token prompt, roused cold on a busy machine, ran 220–295 seconds per turn against a 300-second ceiling; the turn that finally crossed it died with `AbortError: This operation was aborted` and left no assistant message in the chat at all.

The Ollama plugin (1.0.42) gains a **Request Timeout (seconds)** field on the connection profile, stored as `request_timeout_seconds` and applied by `resolveProfileTimeoutMs` to both the streaming first-byte timer and the non-streaming whole-request signal. Blank, absent, or unparseable falls through to 300, so nothing changes for a profile that never touches it. A caller-supplied `LLMParams.requestTimeoutMs` still wins, keeping the cheap-LLM task deadlines a hard ceiling.

#### The context budget honors the profile's Max Context (bug 70)

A profile whose model name isn't in Quilltap's lookup tables — any `hf.co/...` Ollama tag, any custom OpenAI-compatible endpoint — was budgeted at 8192 tokens no matter what Max Context said. Conversation history was trimmed to fit that figure on every turn, silently, and the only signal was a "Conversation is getting long" warning that fires exclusively when history has just been dropped.

The window was resolved two different ways in the same function. `calculateContextBudget` used a model-name lookup (`getModelContextLimit`), which falls through to the 8192 OLLAMA/OPENAI_COMPATIBLE default for an unknown name; `calculateMaxAvailable`, 270 lines later, read `profile.maxContext` and saw the real value. One live turn resolved 8192 and 65536 seconds apart. The small figure won everywhere it did damage: it drove `systemPromptBudget`, `recentMessagesBudget`, and the remaining-budget math that feeds `selectRecentMessages`. Compression, working from the correct number, rightly did nothing — so the logs paired an apparent overage with `compressionApplied: false`, which reads like a compression failure and isn't one. The pre-send validation warning derived its limit from the same corrupt figure, so it confirmed the bad number instead of catching it.

`resolveContextWindow(provider, modelName, profile)` in `lib/llm/model-context-data.ts` is now the single source of truth: the profile's `maxContext` wins, the name lookup is the fallback, and a zero or negative column falls through rather than producing a zero-token budget. `getRecommendedContextAllocation`, `getSafeInputLimit`, and `calculateMaxAvailable` all route through it, `calculateContextBudget` takes the profile, and `buildContext` passes `options.connectionProfile`. `external-prompt-generator.service.ts` had the same blind spot on the character-prompt path and now passes its profile too.

For the reported 65536-token profile the budget goes from 8192 to 65536, the history allowance from roughly 1.5k tokens to 32768, and the spurious warning stops.

Two adjacent gaps in the same accounting were fixed alongside it.

**The builder and the validator now use one ceiling.** The builder filled to `totalLimit − responseReserve` while the pre-send check warned above `totalLimit − responseReserve − 10%`, so a context packed exactly as instructed could be reported as an overage. `computeSafeInputLimit` owns that formula now; `ContextBudget` carries `safeInputLimit` and `safetyMargin`, the builder's `remainingBudget` derives from it, and the orchestrator reads it instead of recomputing.

**The budget now counts the whole payload.** Tool schemas ride alongside the message array and were never counted at all — thousands of tokens on a full roster, and on a small window more than the conversation. Agent-mode instructions and the tool-change notice were spliced in after the budget had been spent. All three are known before the context is built, so new `lib/services/chat-message/turn-extras.ts` builds and measures them in one place: the total is passed to the builder as `reservedOutgoingTokens` and held back from the message budget, the tool schemas are added to the pre-send estimate, and the same strings it built are spliced in rather than reconstructed at the splice site. `countToolSchemaTokens` measures the serialized form, so it works for both provider tool shapes, and returns 0 instead of throwing on a definition that won't serialize.

One consequence: with the reservation subtracted, a large character on a small window can leave no room for history at all. That case now warns by name instead of silently sending a character with no memory of the exchange.

#### Archived characters can be rehydrated again (bug 69)

Rehydrating an archived character failed with "the bundle's decrypted content does not match its recorded digest — the bundle is corrupt". The bundle was fine; its database row was not.

An archive bundle is written encrypted, but its `files` row records the digest of the *decrypted* content — that is the digest that survives a passphrase change and actually verifies the contents. The filesystem watcher knew nothing of that: it re-derives `sha256` and `size` from disk for any file that changes, and it saw the bundle land seconds after the row was created. From then on the row held the digest of the encrypted bytes, and the verification on rehydrate could never pass again. Archiving was effectively one-way. The boot reconciliation had the same hole on its size-mismatch path, which is exactly the case a re-encryption produces.

Which rows may have their digest re-derived from disk is now decided in one place, `lib/file-storage/digest-policy.ts`, and both the watcher and the reconciliation ask it; archive rows keep their digest and still get their size corrected. For bundles already spoiled, rehydration self-heals: if the recorded digest is exactly the digest of the file as stored, the bytes are intact and the row is the damaged part — it is repaired, a warning is reported, and the rehydrate proceeds. Any other mismatch is still refused as corrupt.

Verified live: archive → rehydrate now round-trips cleanly, and a row clobbered by the old code rehydrates with the repair warning.

#### A send from the composer's raw-Markdown view no longer discards the edits (bug 67)

The Salon composer's source toggle swaps a plain `<textarea>` in front of the Lexical editor, which stays mounted but hidden with its sync bridge suspended. The submit path read the editor handle unconditionally, so a message sent from the source view shipped the editor's pre-toggle document and every source edit was silently dropped — no error, and the composer cleared as though the send had worked.

Which surface is authoritative now lives in one place, `app/salon/[id]/composer-source-mode.ts`. `resolveComposerSubmitText` sends the textarea's text while the source view is showing and the editor handle otherwise; `resolveComposerHasContent` gates the Send button on the same visible surface, instead of on a presence flag the suspended editor is no longer updating. Post-send clearing already covered both surfaces.

Two adjacent gaps are unchanged and were not part of this fix: Ctrl/Cmd+Enter does nothing in the source textarea (the keyboard send lives in the hidden editor's plugin, so the Send button is the only send route there), and source-view edits are outside draft persistence, which is fed by the editor.

Covered by `__tests__/unit/app/salon/composer-source-mode.test.ts`.

#### The Archived badge shows on a chat's first load (bug 66)

A chat seating an archived character showed no **Archived** badge in the participant sidebar. Two enrichment paths project the same character, and the character-archive work extended only one: the chat GET that the sidebar renders from goes through `getCharacterDetail`, which never carried `archivedAt`. It now does, on both of its return paths — including the chat-avatar-override return an archived seat with a wardrobe-generated avatar takes — and the enriched type declares the field so it cannot be dropped silently again.

Verifying against a live instance turned up a second link in the same chain: `useParticipants` rebuilds each participant's character field by field for the sidebar card and dropped the tombstone again, so the badge could not light on any path, not just a fresh load. Both projections now carry it. The archived seat took no turns either way; the badge was the only casualty.

#### Multi-character `[Name]` prefill is now a per-profile setting (bug 68)

In a multi-character chat, every reply is anchored to the character whose turn it is by one of two routes: an assistant message prefilled with `[Character Name]` (the model structurally continues only that line; the tag is stripped downstream), or a prose instruction appended to the system prompt. Until now the route was hardcoded by provider — Anthropic got the prose branch because 4.6+ rejects a request ending on an assistant message, and everything else got the prefill.

That was wrong for Ollama. Ollama's `think` support is implemented in the model's chat template, which opens the thinking block at the *start* of the assistant turn — so a prefill means the block is never opened and `message.thinking` comes back empty however the profile's **Enable Thinking** box is set. Reproduced against `localhost:11434` on `hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL`: identical request, no prefill → 470 thinking characters, with prefill → 0. The 8B shows the uglier variant — it reasons anyway, the opening tag is gone, and an orphan `</think>` leaks into the reply (caught by the think-parser's swallowed-tag rule). Other providers are unaffected because their reasoning arrives in a protocol field rather than a template artifact; in one instance's history, DeepSeek carried reasoning on 1742 of 5689 multi-character turns while Ollama managed 0 of 12.

Connection profiles gain a `multiCharacterPrefill` column and an **Announce the speaker in multi-character scenes ([Name] prefill)** checkbox. Migration `add-profile-multi-character-prefill-field-v1` backfills existing rows to preserve today's behaviour exactly: Anthropic profiles off, everything else on. New profiles seed from the provider default, and switching provider on an unsaved profile re-seeds it. The hardcoded Anthropic branch in `context-builder.service.ts` is gone; the anchor is now applied by `applyMultiCharacterTurnAnchor`, and the setting is resolved through the single chokepoint `profileUsesNamePrefill` (`lib/llm/multi-character-prefill.ts`) — never read the column directly, because NULL means "never chosen" (a pre-migration row, or a profile imported from a pre-4.9 bundle) and resolves to the provider default. Ticking the box on an Anthropic profile is allowed but warned about in the editor, since it will 400 on every multi-character turn.

The `finalizeMessageResponse()` truncation at the first foreign speaker tag remains the structural backstop on both routes, and single-character chats use neither.

#### Generated opening greetings keep their reasoning

`generateGreetingMessage` consumed the provider's stream reading `chunk.content` and nothing else, so a thinking model's reasoning while composing a greeting was discarded — one observed greeting cost 3620 characters of reasoning and rendered no thinking fold. The chunk loop now tracks `reasoningContent` (cumulative, so assignment rather than concatenation, matching the Salon's streaming contract), `GreetingResult` and `autoGenerateFirstMessage` carry it through all four generation attempts, and it is persisted onto the greeting message. Display only, like every other stored reasoning.

#### Logs: background-job child debug lines no longer appear as info

The parent process re-emits every log record the forked job child sends it, so all output lands in one `combined.log` with a single writer. That relay only handled `error`, `warn`, and `info`, and sent everything else — `debug` and `trace` — through `log.info`. Since most of the image pipeline, memory extraction, and autonomous turns run in the child, a large share of the file's `"level":"info"` lines were actually debug output, making level-based triage unreliable. The relay now maps `trace` and `debug` to their own levels and re-emits anything unrecognized at debug rather than info. Log volume is unchanged: the child inherits `LOG_LEVEL` through `fork` and already filters before sending.

#### Ollama: Enable Thinking profile option, and `<think>` blocks routed to the thinking display

The Ollama plugin (1.0.41) gains an **Enable Thinking** checkbox in the connection profile's provider options, default off. The setting maps to Ollama's top-level `think` request parameter on both streaming and non-streaming calls: off asks thinking-capable models (Qwen3, DeepSeek-R1, etc.) to answer directly — the clean-output mode you want for JSON-shaped work — and on lets them reason first. Older Ollama servers ignore the unknown field. If a model rejects the parameter outright (some cannot disable thinking), the request is retried once without it instead of failing.

Reasoning now reaches the Salon's thinking fold from both channels Ollama uses. When the server parses the model's template, reasoning arrives on the separate `message.thinking` field, which the plugin previously dropped on the floor; it now streams into `reasoningContent` cumulatively, the same way DeepSeek's does. When the server *can't* parse the template — common with community GGUF imports — the raw `<think>...</think>` block leaks straight into the content stream; a new stateful splitter (`think-parser.ts`) recognizes those blocks even when a tag straddles streaming chunk boundaries, routes their text to the thinking display, and keeps them out of the visible message, the stored content, and tool-call parsing. Responses with no think blocks pass through byte-for-byte. An unterminated block at end-of-stream counts as reasoning.

The splitter also handles the swallowed-opening-tag pattern, live-reproduced against `hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M`: in no-think mode that model reasons anyway, and Ollama eats the opening `<think>`, so the content arrives as untagged reasoning followed by an orphan `</think>` and then the real answer — which was corrupting cheap-LLM JSON tasks (memory extraction, summarization) pointed at it. A closing tag encountered before any think block and before any visible output now reclassifies everything ahead of it as reasoning, fully cleaning the non-streaming path cheap-LLM tasks use. Once real content has been emitted (or a real think block was seen), a stray closing tag stays in the content; mid-stream, content already emitted before the orphan tag arrives cannot be recalled.

Covered by a new unit suite (`ollama-thinking.test.ts`: parser chop tests at several chunk sizes, native-channel streaming, the retry fallback, non-streaming extraction, the swallowed-open reproduction), and the Ollama schema joins the provider-options snapshot test.

#### Ollama: Max Context now drives the server's context window, and the provider declares tool support

Two follow-ups in the same plugin release (still 1.0.41):

**`num_ctx` from Max Context.** An Ollama server allocates its own default context window (typically 4k–32k) unless the request carries `options.num_ctx` — the Modelfile rarely sets it. Quilltap, meanwhile, budgeted prompts against the profile's Max Context, so a profile set to 262144 against a server loading 32768 meant every long chat was silently middle-truncated by the server with no error anywhere. Verified live: the Qwen3.8-27B GGUF loaded at 32768 despite the model supporting 262144. Now `profileParams()` (`lib/llm/cheap-llm.ts`) injects `num_ctx` from the profile's Max Context for Ollama profiles, and the plugin forwards it on both streaming and non-streaming calls — the window Quilltap budgets against is the window the server actually allocates. An explicit `num_ctx` already in the parameters blob wins; profiles with no Max Context keep the server default, exactly as before. The eight call sites that built `profileParameters` inline from `profile.parameters` (Salon orchestrator, regenerate-swipe, greeting, answer-confirmation, image-description fallback, wardrobe analysis, uncensored extraction, announcer) were converted to the shared helper, so the injection — and any future per-provider parameter — applies uniformly. Note: changing Max Context on an Ollama profile now triggers a model reload on the next call (context size is a load-time property), and Max Context should be sized to fit RAM — the KV cache scales linearly with it.

**Tool capability.** The plugin's `capabilities.toolUse` flips false → true. The provider has long forwarded native tool definitions and normalized `tool_calls`, and modern local models handle them (verified live on both Qwen3 GGUFs, including with thinking enabled). The flag's only effect is the profile editor's default for the *Allow tool use* checkbox on newly created Ollama profiles — it now defaults ticked; the checkbox remains the per-profile gate either way, and existing profiles keep their saved setting.

#### Help search now matches sections, and the Guide's search box now reads the text

Two separate reasons a search of the built-in help came back empty.

**The Guide tab's search box only ever matched titles.** `HelpGuideTab` filtered the topic list on `doc.title.toLowerCase().includes(query)` and never touched the document body — the index shipped to the client carries titles and URLs only. Any term living in the prose ("describe", "uncensored", "timeout") returned nothing at all. Document content is far too large to ship with the index, so the match now runs server-side: `GET /api/v1/help-docs?action=search&q=…` does a case-insensitive substring pass over titles and content and returns matching slugs with a ~180-character snippet centred on the hit. The client debounces at 200 ms, keeps its instant title-only filter for the first keystroke, and shows the snippet under each topic so a body-text match explains itself. Results are tagged with the query that produced them, so a stale response can't leak into a newer query's filter.

**`help_search` scored whole documents.** Help docs were embedded one vector per file. For a 700-line page spanning a dozen subsystems, that single vector is a smear that matches no specific question strongly, and the tool then handed the model the *first* 1000 characters of the file — a table of contents, never the answer. Both halves are fixed:

- A new `help_doc_chunks` table holds section-level slices, rebuilt from disk whenever a doc's content hash changes (migration `create-help-doc-chunks-table-v1`). The slicing reuses the Scriptorium's Markdown-aware chunker at smaller targets (400–700 tokens, 100 overlap); each chunk is embedded with its document title and nearest heading prefixed, so "Uncensored fallback profile" carries the context of the page around it.
- Chunk vectors are written by the same `HELP_DOC` embedding job that writes the whole-document one. That was deliberate: the reindex enqueue, the `embedding_status` bookkeeping, and the dimension reconcile all still count `help_docs` rows, and a chunk can never carry a dimension its parent doesn't. Chunks that already hold a vector are skipped, so a retried job is cheap; a single chunk's failure is logged and skipped rather than failing a job whose main work succeeded.
- `HelpSearch.search` scores every chunk, keeps the best per document, and ranks each document by `max(docScore, bestSectionScore)` — the whole-document score stays in play so a broadly on-topic page isn't buried by an unlucky slicing, and docs with no chunks yet still rank. Results carry a `matchedSection`, and `formatHelpSearchResults` now leads with that section (1500 chars) followed by a shorter document excerpt (600) instead of 1000 characters from the top of the file.
- Section scoring is wrapped so any failure — missing table, unreadable rows — falls back to whole-document scoring with a warning rather than breaking help search.

`help_doc_chunks` joins the embedding sweeps that walk tables by name: `reapply-profile`'s `MAIN_DB_TABLES`, `repair-text-embeddings`' table list, and a full reindex's up-front embedding clear.

Existing instances needed a backfill after all, which runtime verification caught: `ensureHelpDocsSynced` only re-syncs when the *set of paths* on disk diverges from the table, so an upgraded instance has every content hash matching, skips every file, and would have left the chunk table empty forever — section search silently never engaging. `backfillHelpDocChunks` now slices any already-synced document when the chunk table is empty (one count query per boot thereafter, not a scan — chunk rows carry embedding BLOBs) and enqueues the `HELP_DOC` jobs that fill the vectors, since the documents' own embeddings are already present and would otherwise enqueue nothing. Measured on a real instance: 588 chunks across 120 documents, embedded within a minute.

While extracting the shared enqueue helper, `enqueueMissingHelpDocEmbeddings` briefly lost the try/catch around its repository lookup; restored, with its own log line.

#### Docs: rewrote the image-description help, which was wrong on two points and silent on a third

`help/chat-settings.md`'s "Image Description Settings" section described a version of the feature that no longer exists. It called the dropdown "Image Description Provider" (the UI says "Primary image description profile"), it claimed the blank option disabled image descriptions entirely (blank means auto-select, preferring a profile marked Cheap), and it never mentioned the uncensored fallback profile at all — a second dropdown in the same settings card, with real behavior behind it.

The section now covers: what triggers the fallback path (the responding profile's vision checkbox being unticked, not the provider's identity); the reuse chain that skips the vision call entirely for generated images and for uploads that already carry a description; what the auto-select actually picks; the uncensored fallback and the refusal heuristic that invokes it; the `IMAGE_DESCRIPTION` entry in the LLM logs; and the one-minute timeout. The "Image descriptions missing" troubleshooting entry was rewritten to match, and now covers refusals and timeouts rather than only missing configuration.

Also corrected the Cheap LLM section, which listed "Image descriptions" among the operations the cheap profile drives. Image description never consults `cheapLLMSettings` — it only prefers a profile marked Cheap when auto-selecting a describer.

`help/help-chat.md` documents the Guide search box now reading document text rather than titles alone.
