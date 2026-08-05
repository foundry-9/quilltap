# The Almanack — Capabilities Report Overhaul

**Status:** ✅ Complete — shipped 2026-08-05 as The Almanack (`lib/tools/almanack/`)
**Scope:** `lib/tools/capabilities-report.ts`, `app/api/v1/system/tools/route.ts`, `components/tools/capabilities-report-*.tsx`, `help/system-capabilities-report.md`, llm-logs logging call sites, one small llm-logs schema addition, a shared progress-bar UI component.

## 1. Summary

The capabilities report was last substantively overhauled in `630cae0d` (2026-03-26); its model of the system is the ~4.0 app. Since then the 4.4–4.9 cutovers moved character content, wardrobe, custom tools, photos, mail, and scenarios into the mount-index database — which the report **never opens**. This plan renames the feature, brings its coverage up to date (including the entire Scriptorium half of the app), adds new statistics sections (top characters, projects, groups, connection-profile usage, latency, cache hit/miss), and replaces the generation spinner with a named-phase progress bar.

## 2. New name

**Decided: "The Almanack"** (approved 2026-08-05) — with the period `k`, in the tradition of Whitaker's Almanack and Wisden. An almanack is precisely what this is: an annual compendium of facts, figures, and the state of the establishment, from the census of characters to the condition of the boilers. It sits comfortably beside The Commonplace Book and The Scriptorium in the glossary of named artifacts (as opposed to the personified staff).

(Alternates considered and rejected: The Domesday Book — apt but "doomsday" reads ominously on a diagnostics button; The Estate Survey / The Butler's Inventory — literal but less distinctive.)

Naming mechanics:

- UI strings, card title, and help doc become "The Almanack (System Report)" — keep a parenthetical so users searching "capabilities report" still find it.
- Report filenames: `almanack-<timestamp>.md` (new reports); old `capabilities-report-*.md` files continue to list fine since listing keys off the `files` row, not the filename.
- **API action names stay as-is** (`capabilities-report-generate` etc.). Renaming actions buys nothing and breaks nothing-but-ourselves; the glossary maps the name to the route. Add the new name to the CLAUDE.md glossary table.
- Help doc: help docs are keyed publicly by filename slug (see memory: help doc slug identity). Create `help/the-almanack.md` as the new canonical doc, reduce `help/system-capabilities-report.md` to a short "this feature is now The Almanack" pointer (keeping its slug alive for old links), and update `help/system-tools.md` / `help/settings.md` cross-references.

## 3. Bugs to fix while we're in there

These are pre-existing defects found during exploration; fix them in Phase 0 before building on top.

1. **Download 404 on fresh reports.** `generateAndSaveReport` (`lib/tools/capabilities-report.ts:1704`) mints a throwaway `crypto.randomUUID()` as `reportId`, but list/get/delete key off the `repos.files` row id created in the route (`app/api/v1/system/tools/route.ts:925`). The card feeds the generate-response id straight into the dialog (`capabilities-report-card.tsx:62-66`), whose Download link (`capabilities-report-dialog.tsx:183`) then 404s. Fix: return the files-row id as `reportId`; drop the UUID.
2. **Dead legacy action.** `GET ?action=capabilities-report` (`route.ts:877-912`) returns a hardcoded fake object and has no UI callers. Delete it.
3. **`customTools` mislabeled.** Rendered under `### Pascal the Croupier (RNG)` (`capabilities-report.ts:1598-1601`); custom tools are Pascal's Workbench, a separate subsystem. Give it its own heading (and a real inventory — §5.7).
4. **Slow memory counting.** `collectEnhancedDatabaseStats` loops `findByCharacterId(...).length` per character (`capabilities-report.ts:1083-1086`). Replace with one `SELECT characterId, COUNT(*) FROM memories GROUP BY characterId` (also feeds the top-ten section).
5. **Latent `usage != NULL` bug.** `getTotalTokenUsage` (`llm-logs.repository.ts:440,447`) uses `$ne: null`, which the SQLite translator emits as `usage != NULL` (always unknown). The in-repo comment at `:529-535` documents it. Verify empirically and fix — the report calls exactly this method today.
6. **Two-database blind spots.** `databaseSecurity` and `backupStatus` are hardcoded to main + llm-logs. The mount-index DB has its own size, its own `.dbkey`, and its own backups (`physical-backup.ts` already parses `quilltap-mount-index-*` filenames at `:37,126,454-463`). Both sections become three rows.

## 4. Schema and logging additions (llm-logs)

Per-profile statistics are the one thing the data model cannot answer today: **no table records which connection profile or image profile served a request** — not `chat_messages`, not `llm_logs` (`LogLLMCallParams`, `lib/services/llm-logging.service.ts:35-71`, has no profile field). Historical attribution can only be approximated by joining on `(provider, modelName)`, which is ambiguous when two profiles share a pair.

Changes:

1. **Add nullable `connectionProfileId` and `imageProfileId` TEXT columns to `llm_logs`** (`LLMLogSchema`, `lib/schemas/llm-log.types.ts:132-182` — the physical DDL is generated from this Zod schema via `generateDDL()`, so the schema change is the source of truth; verify how llm-logs handles column additions on existing DBs, in the manner of `alignDocMountPointsSchema` for the mount-index DB, and add an alignment step if none exists).
2. **Thread the ids through `LogLLMCallParams` and the call sites:**
   - `streaming.service.ts:442-455` — has `connectionProfile` in hand; pass its id.
   - Cheap-LLM shared path `lib/memory/cheap-llm-tasks/core-execution.ts:178` — pass profile id **and start passing `durationMs`** (this path covers MEMORY_EXTRACTION, TITLE_GENERATION, SUMMARIZATION, CONTEXT_COMPRESSION, SCENE_STATE_TRACKING, IMAGE_PROMPT_CRAFTING — a large share of all rows currently has NULL duration).
   - Image generation sites — `image-generation-handler.ts:392-503`, `story-background.ts:637-748`, `character-avatar.ts:245-361` — pass `imageProfileId` (including the reroute pair's fallback profile id).
   - `auto-configure.service.ts:216,256`, `gatekeeper.service.ts:279,396` — add `durationMs`.
   - `character-optimizer.service.ts:717,841` — currently hardcodes `durationMs: 0`, which poisons averages. Measure or pass null.
3. **Docs:** update `docs/developer/DDL.md` llm-logs section. Check `.qtap` export/backup surface: llm-logs are not part of `.qtap` exports, but physical backups copy the whole DB file, so no export-schema change expected — confirm at implementation time.

Everything downstream degrades gracefully: rows predating the columns join on `(provider, modelName)` and are labeled "approximate" in the report.

Side benefit: the LLM inspector UIs (`LLMInspectorEntry.tsx`, `LLMLogViewerModal.tsx`, `llm-logs-card.tsx`) currently display `provider/modelName` — flattened copies taken from the profile at call time — which *looks* like profile attribution but cannot distinguish two profiles sharing the same provider and model. Once `connectionProfileId` lands, those views can resolve and show the actual profile name (nice-to-have, same change family).

## 5. Coverage overhaul — new and expanded sections

The collector pipeline is reorganized into **seven named phases** (which double as the progress-bar segments, §7). Section list below; anchors into today's code: types at `capabilities-report.ts:43-239`, collectors `:245-1221`, assembly `generateReportData:1230`, renderer `generateMarkdownReport:1314`.

### Phase 1 — "Taking the measure of the premises" (system)

Existing runtime env + database/security + backups, extended:

- Mount-index DB as a third row in DB sizes and backup status (§3.6).
- Migration state: last applied migration id and `quilltapVersion` from `migrations_state`/`migrations_metadata`; `quilltap_meta.highest_app_version` (the field exists in the type but is never populated — populate it).

### Phase 2 — "Cataloguing the machinery" (plugins, providers, themes)

Existing sections, extended:

- Plugins broken down by capability kind (provider / theme / tool / etc.) and npm-installed vs bundled (`getNpmPluginsDir` vs `getPluginsDir`, `lib/paths.ts:429-440`); `plugin_configs` and `character_plugin_data` row counts.
- `provider_models` cache: row counts per provider + newest `updatedAt` (staleness — cf. the OpenRouter discovery regression).
- `api_keys`: count per provider and `lastUsed` (the column exists, `DDL.md:206`); flag keys never used.
- Themes: add icon-override stats (`LoadedThemeIcon[]`, `theme-registry.ts:56-119,703-742`) — themes shipping icon bundles, total overrides, overrides naming a non-existent `IconName`.

### Phase 3 — "Auditing the ledgers" (main DB)

Existing DB/chat/feature-config stats, extended:

- **Chats by `chatType`** (salon / help / autonomous / brahma); participant-count histogram (group-chat sizes); paused chats; document-mode chats (`chat_documents` count, multi-doc chats); chats with `equippedOutfit`; `pendingOutfitNotifications` backlog.
- **Autonomous rooms:** counts by `runState`, scheduled rooms (and overdue `scheduleNextRunAt`), budget configuration summary, `runDestructiveToolsAllowed` count, `runVisibility` distribution.
- **Memories (episodic recall era):** split by `kind` (semantic/episodic), `source` (AUTO/MANUAL), non-null `occurredAt`/`narrativeTime` counts, `witnessedContext` breakdown, reinforcement totals; chats in narrative `timelineMode`.
- **Characters:** vault-linked vs not; NPC count; personas (`controlledBy='user'`); Carina answerers (`canBeCarina`); wardrobe/transparency override counts.
- **Feature config additions:** coreWhisper, thinkingDisplay, answerConfirmationSettings, autonomousRoomSettings defaults, autoHousekeepingSettings, textReplacementsEnabled (+ `text_replacement_rules` counts), composerSpellcheck, imageDescriptionProfileId / uncensoredImageDescriptionProfileId.
- **Instance settings:** `dataRetention.staleChatDays` (+ derived "chats eligible for next sweep" via `resolveStaleChatDays` + shared `isStale`), `maxConcurrentJobs`, `memoryRecall`, `memoryExtractionLimits`, `lastMaintenanceSweepAt`.
- **Background jobs:** counts by `status` and `type`, failed jobs with `lastError`, exhausted-attempts count, oldest PENDING `scheduledAt`.
- **Embeddings pipeline:** `embedding_status` by status per entityType (PERMANENTLY_FAILED highlighted), `conversation_chunks` total + unembedded, `help_docs` total + unembedded + stale `contentHash`, embedding dimensionality/bytes-per-vector in use vs active profile dims (mismatch flagged).
- **Terminal (Ariel):** total sessions, live sessions, non-zero exit codes, distinct shells.
- **Storage:** keep the legacy `files` walk but label it "Legacy file ledger"; real bytes now live in the Scriptorium phase. Add `fileStatus != 'ok'` count and generated-image counts by `generationModel`.

### Phase 4 — "Touring the Scriptorium" (mount-index DB — entirely new)

- `doc_mount_points` by `mountType` and `storeType`; enabled counts; `scanStatus`/`lastScanError` and `conversionStatus` error counts (stores wedged mid-convert are exactly what a diagnostic should surface); sums of `fileCount`, `chunkCount`, `totalSizeBytes`; the three well-known global mounts resolved by id.
- Content totals: `doc_mount_files` rows and text bytes, `doc_mount_blobs` count and bytes by `storedMimeType` (blobs are now the biggest disk consumer and appear nowhere today), `doc_mount_chunks` count + unembedded + token totals.
- Links: link-vs-file dedup ratio, hard-link group count (`linkGroupId`), extraction/conversion error counts, and per-document policy counts (`allowEmbed` / `allowCharacterRead` / `allowCharacterWrite` = 0).
- Character-vault health: vaults failing the keystone read (`CharacterVaultUnavailableError` — a hard 503 for that character), characters with `metadata.json`.
- Wardrobe by tier (character / project / group / general) + archived counts.
- **Custom tools (Pascal's Workbench) inventory:** discovered `Tools/*.tool.json` count by store, with presets, with llm-consult, with side effects, metadata-gated, and **parse failures** (a shipped bug class).
- Post Office: total letters, undelivered/unread, characters with a mailbox.
- Photos: counts and bytes per character vault + user gallery.
- Scenarios by tier; state-cascade coverage (chats/projects/groups with non-empty state).

### Phase 5 — "Assembling the dramatis personae" (characters, projects, groups — new)

**Top ten characters** — table: name, chats participated in, memories, storage. Implementation:

- Chats: **one** pass — `SELECT c.value ->> '$.characterId' AS cid, COUNT(*) FROM chats, json_each(chats.participants) c GROUP BY cid` (there is no participants table; the per-character `findByCharacterId` filter is a full scan each, per the repo's own comment at `chats.repository.ts:176-178`). Exclude `chatType IN ('help','brahma')`; count participants regardless of `status='removed'` but note the choice in the section footer (open question §9.1).
- Memories: one `GROUP BY characterId` (also replaces the slow loop, §3.4).
- Storage: `characters.characterDocumentMountPointId → doc_mount_points.totalSizeBytes` (cached, refreshed by scans — cheap and close enough; note "as of last scan"). Optionally add memory bytes (`SUM(LENGTH(content)+LENGTH(summary)+LENGTH(embedding))`). Caveat: mount files are content-addressed and hard-linked across vaults, so per-character sums can over-count shared bytes; footnote it rather than amortizing.
- Rank by chat count; ties by memories.

**Projects** — list every project: name, linked document stores (`project_doc_mount_links`), chat count, file/document counts, non-empty state flag.

**Groups** — list every group: name, **member characters by name** (`group_character_members` joined to `characters`), linked stores (`group_doc_mount_links`), whether `officialMountPointId` is present (missing = provisioning gap worth flagging).

### Phase 6 — "Reading the wire records" (llm-logs — heavily expanded)

All aggregates via `getRawLLMLogsDatabase().prepare(...)` (`llm-logs-client.ts:141`) — **not** `manager.rawQuery`, which targets the main DB — guarded by `isLLMLogsDegraded()`, either inline in the collector or as new methods on `LLMLogsRepository` + the user-scoped wrapper (both files must change; there are currently zero GROUP BY methods and the existing sum-in-JS helpers won't scale).

- **Requests by `type`** (20-value enum) with token totals and avg `durationMs`.
- **Connection-profile usage:**
  - Lifetime counters straight off `connection_profiles` (`totalTokens`, `totalPromptTokens`, `totalCompletionTokens`, `messageCount` — `DDL.md:818-821`); `updatedAt` as a rough last-activity proxy (no `lastUsedAt` exists).
  - Windowed stats from llm-logs: per-profile request counts, tokens, **avg/median `durationMs`** — by `connectionProfileId` where present (post-§4), falling back to `(provider, modelName)` join for older rows, labeled approximate. Latency lines always carry a denominator: "avg over N of M measured requests" (NULL and the optimizer's zero rows excluded).
- **Image-profile stats:** `type='IMAGE_GENERATION'` grouped the same way — request count, avg `durationMs`, failure rate via `json_extract(response,'$.error') IS NOT NULL`. Caveat rendered in the section: Concierge reroutes log a second row under the fallback profile, so naive counts double-count rerouted generations.
- **Cache hit/miss:** from `cacheUsage` JSON (`cacheCreationInputTokens`, `cacheReadInputTokens`) — populated essentially only on `CHAT_MESSAGE` rows (the streaming path is the sole writer). Report per provider and per profile:
  - request-level: rows with `cacheReadInputTokens > 0` vs rows carrying any `cacheUsage` (there is no boolean; this is the derivation),
  - token-level: cacheRead vs cacheCreation vs uncached prompt tokens, and the resulting hit ratio.
- **The retention banner.** This section's usefulness is bounded by logging settings. Render an explicit note at the top of the section — and mirror it in the card UI and help doc: *"These figures are drawn from the LLM logs. Enable LLM logging and lengthen the retention window (Settings → Chat → LLM Logging) and the Almanack's arithmetic grows correspondingly richer."* Include current `enabled`/`retentionDays` inline so the reader sees why their numbers are thin.

### Phase 7 — "Binding the volume"

Markdown render + save (unchanged mechanics: `writeUserUploadToMountStore` → Uploads mount `diagnostics/`, plus the `repos.files` row — but return the files-row id, §3.1).

## 6. Privacy note

The report is documented as safe to share publicly. The new sections add **user-created names**: character names (top ten), project/group names, profile names (already present today via cheapLLM). Update the help doc's "What IS in reports" list accordingly so nobody is surprised; continue excluding URLs, keys, file contents, and message contents. Mail/photo sections report counts and bytes only, never titles or filenames.

## 7. Progress bar with named phases

### Server side

Reuse the **Green Room creation-progress bus** pattern (`lib/chat/creation-progress.ts`) — it is purpose-built for "blocking POST + live progress side-channel," buffers events (replayed to late subscribers, 60s terminal TTL), and its emitter is a no-op when no progressId is supplied. Two options:

- **Recommended:** generalize it into `lib/progress/operation-progress.ts` (channel map keyed by client-supplied `progressId`, same event vocabulary plus `phase` events) and re-export for the chat-creation call sites, so both features share one bus.
- Alternative: a parallel `lib/tools/report-progress.ts` clone (faster, but a second copy of the buffer logic — prefer the shared module per DRY).

Wire-up:

- `capabilities-report-generate` POST accepts optional `progressId: z.uuid()` (mirror `app/api/v1/chats/route.ts:148`).
- New GET action `capabilities-report-progress?id=` in the same route file, SSE via the existing `sseStreamResponse`/`safeEnqueue` helpers (the `ai-import-stream` action at `route.ts:1210-1240` is the in-file precedent, but use the buffered bus so a collapsed/remounted card can re-attach without losing state — the card lives inside a `CollapsibleCard`).
- `generateReportData` is restructured from one flat 17-way `Promise.all` into the seven phase groups above; each phase runs its collectors in parallel internally, phases run sequentially, and the pipeline publishes `{ phase: key, index, total, label }` on entry plus a final `done`/`error`.

Sequential phases cost a little wall-clock versus the flat `Promise.all`; that is the price of a truthful phase bar and acceptable for a diagnostic run. (Model fetching — the slowest collector when caches are cold — sits in Phase 2 and stays parallel within it.)

### Client side

- **Lift the character optimizer's segmented bar** (`components/characters/optimizer/components/ProgressBar.tsx` — the only real task-progress bar in the app, already named-phase segmented) into `components/ui/ProgressBar.tsx` with `segments: {key,label,estimatedDurationMs}[]` as a prop; optimizer becomes the second consumer.
- **New `qt-progress` class family**, specified to cover *every* bar-shaped construct in the app, not just this one. A full sweep found three today, each styled differently and two using raw Tailwind colors:
  1. Optimizer `ProgressBar.tsx:108` — segmented task bar; track `qt-bg-muted`, fills raw `bg-primary` / `bg-green-500`.
  2. Pascal's Proving Bench outcome-share meters (`components/custom-tools/ProvingBench.tsx:479`) — track `qt-bg-muted`, fill color per outcome state via `--qt-alert-<state>-border`.
  3. Search-results importance meter (`components/search/search-results.tsx:229`) — raw `bg-border` track, raw `bg-destructive` fill; not themeable at all today.

  Required abilities, derived from those uses: determinate fill (width-percentage), segmented multi-phase layout, static value-meter mode, active vs done state colors, caller-overridable fill color, two heights, and an indeterminate mode for the moment before the first phase event arrives. Concretely:
  - `qt-progress` (track: `var(--qt-progress-track)`, rounded, overflow hidden, default h-2) and `qt-progress-sm` (h-1.5);
  - `qt-progress-fill` (fill: `var(--qt-progress-indicator)`, width transition) with state modifiers `qt-progress-fill-success` / `qt-progress-fill-danger`; arbitrary colors (Pascal's per-state bars) set `--qt-progress-indicator` inline rather than a bespoke background;
  - `qt-progress-indeterminate` (sliding animation on the fill);
  - vars `--qt-progress-track` / `--qt-progress-indicator` in `_variables.css` (defaulting to the muted/primary tokens), mirroring the `qt-spinner` precedent (`_variables.css:625` area).
- **Migrate all three existing call sites to the family in the same change**: optimizer bar (drops `bg-primary`/`bg-green-500`), Proving Bench (keeps its state colors via the indicator var), search-results importance meter (gains theming). This keeps the family honest — if a rule can't express one of these, fix the rule, not the call site.
- **Standing rule:** mirror the entire new `qt-*` family into `packages/theme-storybook/src/css/qt-components.css` (de-Tailwinded), bump that package's patch version, and **stop for the human `npm publish` gate** before committing. Also consider create-quilltap-theme and the bundled themes.
- Card: replace the inline spin-SVG "Generating Report…" button state with the bar; subscribe via the same manual `fetch`+`getReader()` SSE parse used by `creation-progress-provider.tsx:168-216`. Convert the card's raw fetches to `useMutation` + `invalidateQueries(queryKeys.system.capabilitiesReports)` while touched.
- Phase labels are user-facing → steampunk voice. Proposed set (finalize with the section keys):
  1. *Taking the measure of the premises…*
  2. *Cataloguing the machinery…*
  3. *Auditing the ledgers…*
  4. *Touring the Scriptorium…*
  5. *Assembling the dramatis personae…*
  6. *Reading the wire records…*
  7. *Binding the volume…*

## 8. Work plan

| Phase | Deliverable | Main files |
|---|---|---|
| **0. Rename + bug fixes** | New name everywhere; §3 fixes 1–6 | `capabilities-report.ts`, `route.ts`, both card/dialog components, `llm-logs.repository.ts`, help docs, CLAUDE.md glossary |
| **1. Logging schema** | `connectionProfileId`/`imageProfileId` on `llm_logs`; `durationMs` at missing call sites; DDL.md | `llm-log.types.ts`, `llm-logging.service.ts`, streaming/cheap-LLM/image/gatekeeper/auto-configure/optimizer call sites |
| **2. Collector overhaul** | Seven-phase pipeline; all §5 sections; new repo aggregate methods | `capabilities-report.ts` (likely split into `lib/tools/almanack/` collector modules — the file is ~1,750 lines already), `llm-logs.repository.ts` + `user-scoped.ts`, mount-index repos |
| **3. Progress plumbing** | Shared progress bus + SSE action + phase events | `lib/progress/operation-progress.ts`, `route.ts`, `lib/chat/creation-progress.ts` re-export |
| **4. UI** | Shared ProgressBar, `qt-progress` classes + storybook mirror (publish gate), migrate all three existing bar call sites, card mutations, dialog fix | `components/ui/ProgressBar.tsx`, `_utilities.css`/`_variables.css`, `packages/theme-storybook` (version bump + **stop for npm publish**), optimizer `ProgressBar.tsx`, `ProvingBench.tsx`, `search-results.tsx`, card/dialog |
| **5. Docs + tests** | Help docs (incl. retention tip + privacy update), CHANGELOG, DDL.md, update-documentation list; unit tests for collectors (mock repos), markdown-section snapshot, progress-bus tests, jest `@jest-environment node` for any real-binding suites | `help/*.md`, `docs/CHANGELOG.md`, `docs/developer/DDL.md`, `__tests__` |

Phases 0–1 are independent of 2–4 and can land separately. Phase 2 is the bulk of the work and is highly delegable per-collector once the phase pipeline skeleton exists.

## 9. Open questions — resolved

1. **Removed participants:** counted, with the footnote, per the plan. The switch is `COUNT_REMOVED_PARTICIPANTS` in `phase5-personae.ts`; flipping it flips the rendered footnote too.
2. **Top-ten ranking criterion:** chat count, ties broken by memories, with all three columns shown.
3. **llm-logs column alignment:** no align helper exists and none was added — the llm-logs DB already handles added columns the way its three predecessors did, with a one-off `ALTER TABLE` migration (`add-llm-logs-autonomous-run-id-column-v1` and friends). `add-llm-logs-profile-columns-v1` follows that pattern: `shouldRun` returns false on a fresh install (the Zod-derived DDL creates the columns) and true only when an existing table is missing one.
4. **`lib/tools/almanack/` split:** done. `capabilities-report.ts` is deleted; the collectors live in one module per phase, plus `types.ts`, `render.ts`, `db.ts` and `phases.ts`.

## 10. Related but out of scope

- `docs/developer/features/usage-tracking.md` — provider credit-balance tracking proposal that wants to surface in this report; the seven-phase pipeline gives it a natural future home (Phase 2), but no provider-billing calls are part of this work.
- Denormalizing `chats.participants` into a join table (the chats repo's own suggestion) — the single-pass GROUP BY sidesteps the need for now.
