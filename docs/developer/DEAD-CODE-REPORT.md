# Dead Code Analysis Report

**Last Updated**: 2026-07-30
**Tool Used**: knip
**Codebase**: Quilltap v4.8.0-dev.124

---

## Executive Summary

Dead code analysis is performed periodically using knip. A knip configuration file (`knip.json`) is now in place to filter out known false positives.

| Category | Status |
|----------|--------|
| Unused Files | 2 remaining as of 2026-07-30, both kept-with-reason (in-progress SVAR file-manager surface — see below). 2026-07-20 removed the superseded `QtapDocLink` Document-Mode chain. Prior cleanups: 2026-05-28 (clothing-records/physical-descriptions), 2026-05-17 (terminal/embedded-gallery/restore/search-replace/connection-profiles barrels + dead modals/sidebars) |
| Unused Dependencies | None flagged as of 2026-07-30 (`tar` false-positive added to `ignoreDependencies`; `@anthropic-ai/sdk` transitive-in-test added 2026-07-20). Prior removals: @lexical/clipboard, @lexical/history, @quilltap/theme-storybook, jsdom (2026-05-17); @aws-sdk/client-s3, svgo (2026-03-05); bcrypt, qrcode, ts-jest (2026-01-30) |
| Unused Exports | 1169 (2026-07-30, from 1173); remainder are intentional barrel/plugin/registry/lifecycle/schema surface |
| Unused Exported Types | 737 (2026-07-30, from 741); most are intentional plugin contracts and Zod `z.infer` data-model surface |
| Unused Enum Members | 3 in ErrorCode (preserved for future use) |
| Duplicate Exports | 54 (named + default pattern, low priority) |

---

## 2026-07-30 — v4.8 release sweep, second pass (knip)

knip flagged **2 unused files** (both the same kept-with-reason SVAR pair as 2026-07-20), **1 unused dependency** (a false positive — see below), **1173 unused exports**, and **741 unused exported types**.

Because the exports/types lists are dominated by intentional surface, this round used the same method as 2026-06-03: a whole-repo identifier reference count over all 3,010 source files (`.ts/.tsx/.js/.mjs/.json/.md/.css`, `node_modules` excluded), scoring each of the 1,914 flagged symbols by references **outside** its defining file. That isolated **77 symbols referenced nowhere at all** and **13 more referenced only by their own tests**; both sets were then checked by hand. Everything else has a real consumer somewhere knip does not follow (a barrel, a test, `packages/`, `plugins/`).

Verified with `npx tsc` (clean), `npm run lint` (clean), and the full `npm run test:unit` suite (559 suites / 9,219 tests passing). Re-running knip confirms the reductions with no new unused files.

### Removed — functions / consts

| File | Removed |
|------|---------|
| `lib/chat/message-navigation.ts` | `highlightMessage` (+ its 4 tests in `__tests__/unit/lib/chat/message-navigation.test.ts`) |
| `lib/llm/pricing-fetcher.ts` | `findCheapestAvailableModel` |
| `lib/paths.ts` | `getThemeBundleCacheDir` (+ the stale key in the `@/lib/paths` mock in `bundle-loader.test.ts`) |
| `components/ui/icons/icon-registry.ts` | `ICON_NAMES` |

Notes:

- **`highlightMessage`** was dead *and* wrong: it added the class `memory-source-highlight`, which does not exist in any stylesheet — the live `scrollToMessage` uses `qt-memory-source-highlight` (`app/styles/qt-components/_chat.css:2963`). Its three siblings stay. `getPendingMessageNavigation` and `scrollToMessage` are wired in `app/salon/[id]/SalonView.tsx`; `navigateToMessage` is the writer half of the same sessionStorage pair and is kept under the lifecycle-pair rule below.
- **`findCheapestAvailableModel`** joins `getAllModelsSortedByCost` / `clearPricingCache` / `isCacheFresh`, removed from the same file in the 2026-02-20 sweep. Its in-file helpers `getPricingCache` and `sortByCost` remain live.
- **`getThemeBundleCacheDir`** built `<base>/themes/.cache`, a directory nothing reads or writes; `lib/themes/bundle-loader.ts` does not import it. Its only reference was a vestigial key in a jest mock factory.
- **`ICON_NAMES`** was a speculative "for storybook / soft validation" array with no consumer in the app, `packages/`, `plugins/`, the bundled themes, or the docs. `ICON_REGISTRY` (exported) and `isIconName` are the live surface of the themeable-icon registry, and the array is a one-liner to reinstate if the icon storybook ever needs it.

### Removed — types (unused, no references anywhere)

| File | Removed |
|------|---------|
| `lib/database/interfaces.ts` | `DatabaseBackendFactory` (`BackendRegistry` went from this file in the 2026-06-03 sweep for the same reason) |
| `lib/export/types.ts` | `MemoryCollection` |
| `lib/background-jobs/queue-service.ts` | `RegenerateConversationSummariesPayload` (`Record<string, never>` — `enqueueRegenerateConversationSummaries` takes no payload) |
| `lib/mount-index/ensure-official-store.ts` | `AdoptableStore` (its siblings `OfficialStoreEntityRow` / `EnsureOfficialStoreConfig` are live) |

### knip.json — silenced a legitimate false positive

- **`tar`** added to `ignoreDependencies`. knip 6.29 reports it as an unused dependency, but `lib/plugins/registry-client.ts:17` does `import * as tar from 'tar'`, and that module is live: `installPackageFromRegistry` is called by `lib/plugins/installer.ts` and `getLatestVersion` by `lib/plugins/version-checker.ts`. Removing the dependency would break plugin install and update checks. (knip does not flag `registry-client.ts` itself as unused, so the miss is in its resolution of the `tar` package's `exports` map, not in reachability.)

### Investigated but KEPT (intentional surface / false positives)

Beyond the standing categories from prior rounds (Zod `z.infer` schema surface, `*ToolInputSchema` types, plugin SDK contracts, registry accessors, theme validation API, lifecycle `start`/`stop` pairs, barrel re-exports), this round specifically cleared:

- **`components/files/svar/index.ts` and `components/files/svar/SvarFilePicker.tsx`** — unchanged from 2026-07-20. Still the in-progress SVAR file-manager surface (`docs/developer/features/svar-file-manager-implementation-plan.md`): the barrel is the documented runtime-free public API, and `SvarFilePicker` is the Phase 4 light costume awaiting page wiring. The Phase 3 `SvarFileManager` sibling **is** wired, dynamic-imported by `app/scriptorium/[id]/DocumentStoreDetailView.tsx` behind the "New file manager (beta)" toggle. `SvarAction` (`svar-types.ts`) is kept with them as part of the same quarantined type surface.
- **`navigateToMessage`** (`lib/chat/message-navigation.ts`) — the only writer of the `scrollToMessageId` / `highlightMessageId` sessionStorage keys, whose reader is live in `SalonView`. Kept as the write half of a wired pair, same rule as the `start*`/`stop*` lifecycle pairs; note the memory-provenance feature currently has no UI entry point calling it.
- **`invalidateFrozenArchive`** (`lib/memory/frozen-archive-cache.ts`) — the cache-invalidation half of a live cache (`getOrComputeFrozenArchive`). **Worth a follow-up:** nothing in production calls it, so the cache only refreshes when a character's compaction generation changes. The out-of-band edits its doc comment names (manual deletion, housekeeping sweep, import) leave a stale frozen archive in place until the next compaction. That is a behavior gap, not dead code — removing the function would only make it harder to fix.
- **`findExclusiveChatsForCharacter` / `findExclusiveImagesForChats`** (`lib/cascade-delete.ts`), **`loadParticipantMemories` / `loadProjectContext`** (`lib/chat/first-message-context.ts`), and **`buildRecoverySystemPrompt` / `buildRecoveryUserMessage` / `buildStaticFallbackMessage`** (`lib/services/chat-message/recovery.service.ts`) — flagged as referenced only by tests, but each is called in-file by the module's live entry point (`getCascadeDeletePreview`, `buildFirstMessageContext`, and the recovery flow respectively). Exported for direct unit testing.
- **`SearchScriptoriumBrahmaToolInput`** and the self-inventory `VaultSubSection` / `VaultAccessSubSection` / `ContextSubSection` types — tool input/section surface, kept under the single-source-of-truth tool convention in CLAUDE.md alongside `QuilltapSubSection`.
- **~50 exported helpers used only inside their own module** (e.g. `getSingleUserName`/`getSingleUserEmail`, `buildCarinaErrorContent`, `collectMetadataTested`, `resolveReplyInSenderMailbox`, `generateReportData`). Un-exporting them is pure churn with real merge cost against in-flight work, and several are the natural seam for a future test. Left as-is deliberately.
- **52 symbols whose only external reference is a barrel re-export** — concentrated in `lib/tools/index.ts` (10), `lib/background-jobs/index.ts` (9), `lib/database/backends/sqlite/index.ts` (9), and `lib/plugins/index.ts` (9). These are the documented plugin/tool API surface; see the 2026-04-29 section.

---

## 2026-07-20 — v4.8 release sweep (knip)

knip flagged **3 unused files**, **1 unlisted dependency**, and **3 unlisted binaries**. The exports/types lists are the same intentional barrel/plugin/registry/schema surface documented in prior rounds (verified unchanged in character). Verified with `npx tsc --noEmit` (clean) and the full `npm run test:unit` suite (524 suites / 8717 tests passing).

### Removed — superseded `QtapDocLink` Document-Mode chain

`components/chat/QtapDocLink.tsx` was the original `qtap://` link renderer. It has been fully superseded by `QtapLink` (`components/qtap/QtapLink.tsx`) + `QtapLinkContext` + `QtapLinkProvider` (wired in `app-layout.tsx`), which is what `MessageContent`'s `a()` renderer actually uses. Removing the dead component orphaned its entire private support chain, all removed together:

| File / location | Removed |
|-----------------|---------|
| `components/chat/QtapDocLink.tsx` | whole file (no importer; only a stale comment referenced it) |
| `components/chat/QtapDocContext.tsx` | whole file — `QtapDocContext`, `useQtapDoc`, `QtapDocOpener` (only consumer was `QtapDocLink`) |
| `app/salon/[id]/SalonView.tsx` | `qtapDocOpener` `useMemo`, `qtapExistsCacheRef`, the `QtapDocContext.Provider` wrapper, and the now-orphaned `QtapDocContext` / `QtapUriParts` / `resolveDocumentExistsForChat` imports |

`resolveDocumentExistsForChat` (in `app/salon/[id]/hooks/documentModeApi.ts`) stays — it's still used by the live `QtapLinkProvider`. `components/chat/__tests__/QtapDocLink.test.tsx` was left in place: despite its filename it tests the live `QtapLink`, not the removed component. A stale comment in `MessageContent.tsx` was updated to name `QtapLink`.

### knip.json — silenced legitimate false positives

- **`@anthropic-ai/sdk`** added to `ignoreDependencies`. It's a transitive dependency (pulled in by the bundled Anthropic plugin) imported only by `__tests__/unit/plugins/anthropic-model-family-params.test.ts`; there is no direct root-`package.json` entry to flag. Same rationale as the existing `better-sqlite3-multiple-ciphers` entry.
- **`ps`, `tasklist`, `du`** added to `ignoreBinaries`. These are legitimate OS binaries invoked at runtime: `ps`/`tasklist` for cross-platform liveness checks in `lib/database/backends/sqlite/instance-lock.ts`, `du` for size reporting in `scripts/build-standalone-tarball.ts`.

### Investigated but KEPT — in-progress SVAR file-manager surface

Both remaining flagged files belong to the actively-in-development SVAR file-manager migration (`docs/developer/features/svar-file-manager-implementation-plan.md`). They are pre-built ahead of the phase that wires them, not dead:

- **`components/files/svar/SvarFilePicker.tsx`** — the Phase 4 "light costume" attach-a-file picker (replaces `FolderPicker.tsx` / `DocumentPickerModal.tsx`). Its support function `wirePickerSelection` is already exercised by `createSvarAdapter.test.ts`; only the page wiring (Phase 4) is outstanding. The Phase 3 `SvarFileManager` sibling **is** already wired (dynamic-imported by `app/scriptorium/[id]/DocumentStoreDetailView.tsx`).
- **`components/files/svar/index.ts`** — the documented runtime-free public surface (barrel) of the SVAR adapter. Consumers and tests currently import the submodules directly, so nothing imports the barrel yet, but it is intentional API for the feature.

---

## 2026-06-03 — Dead-function and dead-type sweep (knip)

knip reported **0 unused files** and **0 unused/unlisted dependencies** — the file- and dependency-level surface is clean. The actionable work this round was inside the `Unused exports` / `Unused exported types` lists. Of 1991 flagged symbols, a reference-count pass isolated 164 with **zero references anywhere outside their own definition and zero in-file usage**. Each was investigated individually (whole-repo `rg` including `packages/`, `plugins/`, tests, configs, dynamic-import-by-path, string dispatch). Genuinely-dead symbols were removed; intentional API surface was kept.

**Net change: 56 files, 6 insertions, 1,627 deletions (−1,621 lines).** Verified with `npx tsc --noEmit` (clean), the full `npm run test:unit` suite (passing), and `eslint` on the changed files (clean). A re-run of knip confirmed the reductions with **no new unused files**.

### Functions / consts / components removed

| File | Removed |
|------|---------|
| `lib/llm/cheap-llm.ts` | `getCheapLLMProviderWithPricing` (+ private `CheapLLMSelectionWithPricing` and now-orphaned `./pricing` / `./pricing-fetcher` imports) |
| `lib/services/llm-logging.service.ts` | `getLogsForMessage`, `getLogsForChat`, `getLogsForCharacter`, `getRecentLogs`, `countLogsForUser`, `getLogsByType`, `getStandaloneLogs` (API routes call `repos.llmLogs.*` directly) |
| `lib/memory/memory-service.ts` | `findSimilarMemories`, `findSimilarMemoriesWithEmbedding` |
| `lib/memory/housekeeping-outcome-cache.ts` | `_clearHousekeepingOutcomesForTest` (no test referenced it) |
| `lib/chat/annotations.ts` | `insertFormat`, `getAnnotationTooltip` (+ private `InsertableFormat`) |
| `lib/chat/context-summary.ts` | `chatNeedsSummary`, `clearContextSummary` (+ orphaned token/model-context imports) |
| `lib/chat/tool-executor.ts` | `executeToolCall` (legacy back-compat signature) |
| `lib/llm/plugin-factory.ts` | `getAllAvailableEmbeddingProviders` |
| `lib/tokens/token-counter.ts` | `calculateAvailableResponseTokens`, `quickEstimateTokens`, `exceedsTokenLimit` |
| `lib/services/system-events.service.ts` | `createSummarizationEvent`, `createImagePromptCraftingEvent` |
| `lib/services/file-content-extractor.ts` | `extractMultipleFileContents` |
| `lib/services/commonplace-notifications/writer.ts` | `voiceCommonplaceContent` (deprecated) |
| `lib/services/host-notifications/writer.ts` | `postHostRosterAnnouncement` (+ private `HostRosterAnnouncement`) |
| `lib/files/folder-utils.ts` | `buildFolderTree`, `isInFolder`, `isInFolderRecursive` (+ private `FolderTreeNode`) |
| `lib/database/backends/sqlite/json-columns.ts` | `jsonArrayPush`, `jsonArrayPull`, `buildJsonCondition` |
| `lib/database/repositories/chats.repository.ts` | `chatsRepository` singleton (class reached via repositories container) |
| `lib/database/repositories/files.repository.ts` | `filesRepository` singleton (class reached via repositories container) |
| `lib/images-v2.ts` | `deleteImageById` (+ private `deleteFile`) |
| `lib/mount-index/file-ops.ts` | `pathExistsInMount`, `readSha256` |
| `lib/mount-index/watcher.ts` | `getWatchedMountPointIds` (test helper, unused) |
| `lib/paths.ts` | `getMountIndexDbKeyPath` |
| `lib/photos/resolve-character-avatar.ts` | `resolveCharacterAvatars` (batched variant; singular `resolveCharacterAvatar` stays) |
| `lib/background-jobs/processor.ts` | `getMemoryExtractionConcurrencyOverride` (setter stays) |
| `lib/backup/temporary-storage.ts` | `hasTemporaryBackup`, `getTemporaryBackupCount` |
| `lib/instance-settings/index.ts` | `setGeneralMountPointId`, `setUserUploadsMountPointId`, `setLanternBackgroundsMountPointId`, `InstanceSettingsKeys` (getters stay; migrations set these via raw SQL) |
| `lib/startup/index.ts` | `initializeAllServices`, `initializeFileStorageIfNeeded` (+ private `ServiceInitializationResult`); `instrumentation.ts` initializes plugins + file storage directly |
| `lib/startup/prettify.ts` | `hasPrettyEntry`, `curatedKeys` |
| `lib/plugins/site-plugins.ts` | `getSitePluginsConfig` (+ private `SitePluginsConfig`); `isSitePluginEnabled` stays |
| `lib/env.ts` | `isProduction` (`isDevelopment`/`isTest` stay) |
| `lib/host-rewrite.ts` | `_resetGatewayCache` |
| `lib/api/responses.ts` | `serviceUnavailable` |
| `lib/schemas/wardrobe.types.ts` | `buildCoverageSummary` (+ orphaned `describeOutfit` import) |
| `lib/sillytavern/multi-char-parser.ts` | `buildSpeakerEntityMap` |
| `lib/sillytavern/persona.ts` | `isMultiPersonaBackup`, `convertMultiPersonaBackup` (+ private `MultiPersonaBackup`, `PersonaDescription`) |
| `lib/tools/destructive-tools.ts` | `isDestructiveTool` (the `DESTRUCTIVE_TOOL_NAMES` set it wrapped stays) |
| `lib/tools/index.ts` | dead re-export aliases `docDeleteBlobTool`, `docListBlobsTool`, `docMoveFolderTool`, `docReadBlobTool`, `docWriteBlobTool` (the `*Definition` exports stay) |
| `lib/wardrobe/resolve-equipped.ts` | `flattenLeafItems` |
| `components/dashboard/nav-user-menu-theme.tsx` | `ThemeIcon` |
| `components/files/FilePreview/types.ts` | `getPreviewTypeLabel` (`getPreviewType` stays) |
| `components/providers/session-provider.tsx` | `useSessionOptional` |
| `components/providers/sidebar-provider.tsx` | `useSidebarOptional`, `MAX_SIDEBAR_WIDTH`, `MIN_SIDEBAR_WIDTH` |
| `components/settings/ai-import/types.ts` | `OPTIONAL_STEPS` (`CORE_STEPS` stays) |
| `components/setup-wizard/wizard-api.ts` | `fetchEmbeddingProviders`, `fetchImageProviders` |
| `hooks/useAvatarDisplay.ts` | `useAvatarDisplayOptional` |

### Types removed (unused, file-local)

| File | Removed |
|------|---------|
| `lib/llm/base.ts` | `AttachmentResults`, `CacheUsage`, `JSONSchemaDefinition`, `ResponseFormat` (unused re-exports of `@quilltap/plugin-types`) |
| `lib/database/interfaces.ts` | `BackendRegistry` |
| `lib/database/repositories/background-jobs.repository.ts` | `CreateJobOptions` |
| `lib/background-jobs/queue-service.ts` | `AutonomousRoomScheduleTickPayload` |
| `lib/services/help-chat/types.ts` | `HelpChatCreateOptions`, `HelpChatEligibilityResult`, `HelpChatUpdateContextOptions` |
| `lib/sillytavern/multi-char-parser.ts` | `ImportMappingConfig` |
| `lib/tools/capabilities-report.ts` | `DatabaseStats` (`EnhancedDatabaseStats` is the live one) |
| `lib/api/responses.ts` | `SuccessResponse` |
| `components/characters/optimizer/types.ts` | `OptimizerState` |
| `components/chat/lexical/plugins/MarkdownBridgePlugin.tsx` | `MarkdownBridgeRef` |
| `components/files/FilePreview/types.ts` | `FileMetadataPanelProps` |
| `components/images/image-detail/types.ts` | `TagActionParams` |
| `components/settings/appearance/types.ts` | `ThemePreviewSwatchesProps` |
| `components/tools/restore/types.ts` | `RestoreActions` |
| `components/ui/ProfileCard.tsx` | `ProfileCardAction`, `ProfileCardDeleteConfig` (+ now-unused `SettingsCard*` imports) |

### Investigated but KEPT (intentional surface / false positives)

These were flagged by the same reference-count pass but deliberately retained:

- **`ChatProvider`** (`components/providers/chat-context.tsx`) — knip flags it as unused, but the file's sibling export `useChatContext` is consumed by `app/salon/[id]/page.tsx`. The provider/consumer pair is entangled; removing it (initially over-removed by the sweep) broke `tsc` and was reverted.
- **Lifecycle pairs** — `stopWatcher`, `stopMountWatchers`, `stopAutonomousRoomsScheduler`/`isAutonomousRoomsSchedulerRunning`, `stopHousekeepingScheduler`/`isHousekeepingSchedulerRunning`, `closeReadonlyChildSQLiteClient`, `isReadonlyChildSQLiteConnected`. Their `start*`/`schedule*`/`get*Client` counterparts are wired in `instrumentation.ts`; the stop/status halves belong to the same lifecycle API.
- **Plugin SDK contracts** — all `lib/plugins/interfaces/*` types (moderation/scoring/provider interfaces), `ImageGenerationModelInfo` (used by the Google/OpenRouter plugins), `createToolLogger`. Plugins implement these structurally; knip cannot see `packages/`/`plugins/` consumers.
- **Registry accessors** — `lib/plugins/moderation-provider-registry.ts` (8 accessors) and `provider-registry.ts` (3 accessors). The registry modules are live (imported by installer/gatekeeper/plugin-init); their symmetric `get*`/`has*`/`register*` API is retained for plugin self-registration and diagnostics.
- **Theme crypto / validation** — `signJSON`, `verifyJSONSignature` (`lib/themes/crypto.ts`) and the `validateTheme*`/`safeValidate*`/`createDefaultThemePreference` family (`lib/themes/types.ts`). Security-sensitive Ed25519 signing and the documented public theme-validation API.
- **Auth helpers** — `getCurrentUserId`, `getRequiredUserId`, `getOrCreateUnauthenticatedUser`, `isUnauthenticatedUser`. Security-sensitive single-user/back-compat surface; retained pending a deliberate auth review.
- **Zod schema surface** — every `lib/schemas/*` schema and its `z.infer` type (plugin-manifest, settings, terminal, file, text-replacement, etc.), plus tool type surface (`MemorySearchToolOutput`, `ProjectFileInfo`, `QuilltapSubSection`, `CreateWardrobeItemSlotType`) and all `*ToolInputSchema` exports (single-source-of-truth convention per CLAUDE.md, consumed in-file by `zodToOpenAISchema` and by the tool-definitions snapshot test).

---

## 2026-05-28 — Remove retired clothing/descriptions components

### Unused Files Removed

| File | Reason |
|------|--------|
| `components/clothing-records/clothing-record-card.tsx` | Dead internal display component; only consumed by retired `clothing-record-list.tsx` |
| `components/clothing-records/clothing-record-editor.tsx` | Dead internal editor component; only consumed by retired `clothing-record-list.tsx` |
| `components/clothing-records/clothing-record-list.tsx` | Retired feature surface; no importers in app |
| `components/clothing-records/index.ts` | Barrel with no importers |
| `components/physical-descriptions/physical-description-card.tsx` | Dead internal display component; only consumed by retired `physical-description-list.tsx` |
| `components/physical-descriptions/physical-description-editor.tsx` | Dead internal editor component; only consumed by retired `physical-description-list.tsx` |
| `components/physical-descriptions/physical-description-list.tsx` | Retired feature surface; no importers in app |
| `components/physical-descriptions/index.ts` | Barrel with no importers |

### Verification

- Before cleanup: `Unused files (8)`, `Unlisted dependencies (4)`
- After cleanup: no `Unused files` section, no `Unlisted dependencies` section
- Remaining major findings unchanged: `Unused exports (1215)`, `Unused exported enum members (3)`, `Duplicate exports (44)`, `Configuration hints (2)`

### knip.json Updates

- Updated `$schema` from `knip@5` to `knip@6` (installed version is 6.14.2)
- Added `better-sqlite3-multiple-ciphers` to `ignoreDependencies`; 4 test files import it as the documented fallback when the root `better-sqlite3` alias is unavailable (see CLAUDE.md). Knip cannot see the conditional require, so it flags it as unlisted.

## 2026-05-17 — Barrel slim-down and dependency cleanup

### Unused Files Removed

| File | Reason |
|------|--------|
| `components/terminal/index.ts` | Barrel never imported; `Terminal` and `TerminalEmbed` are imported directly |
| `components/files/FolderManagement/MoveFileModal.tsx` | Dead modal component; not referenced anywhere |
| `components/files/FolderManagement/RenameModal.tsx` | Dead modal component; not referenced anywhere |
| `components/images/embedded-gallery/hooks/index.ts` | Hook barrel; `useGalleryData` imported directly by `EmbeddedPhotoGallery` |
| `components/tools/restore/hooks/index.ts` | Hook barrel; `useRestoreData` imported directly by `RestoreDialog` |
| `components/tools/search-replace/hooks/index.ts` | Hook barrel; `useSearchReplace` imported directly by `SearchReplaceModal` |
| `components/settings/connection-profiles/hooks/index.ts` | Hook barrel; hooks imported directly by tab component |
| `components/layout/left-sidebar/sidebar-item.tsx` | Dead component; `SidebarItem` + `ViewAllLink` only re-exported by index, never used |
| `components/layout/left-sidebar/sidebar-section.tsx` | Dead component; `SidebarSection` only re-exported by index, never used |
| `components/settings/connection-profiles/ProfileForm.tsx` | Dead component; only re-exported via barrel, no consumers |
| `components/settings/embedding-profiles/ProfileForm.tsx` | Dead component; only re-exported via barrel, no consumers |

### Barrel Re-exports Trimmed

Reduced unused re-exports in 15 barrel files to only what consumers actually import:

| Barrel | What Remains |
|--------|--------------|
| `components/files/FolderManagement/index.ts` | `CreateFolderModal` |
| `components/images/embedded-gallery/index.ts` | `EmbeddedPhotoGallery` |
| `components/tools/restore/index.ts` | `RestoreDialog` |
| `components/clothing-records/index.ts` | `ClothingRecordList` |
| `components/physical-descriptions/index.ts` | `PhysicalDescriptionList` |
| `components/homepage/index.ts` | Section components + types (dropped `RecentChatItem`, `ProjectItem`, `CharacterCard`) |
| `components/wardrobe/index.ts` | `OutfitSelector` + `OutfitSelection`/`PreviousOutfitSummary` types |
| `components/files/FilePreview/index.ts` | `FilePreviewModal` |
| `components/tools/search-replace/index.ts` | `SearchReplaceModal` |
| `components/tools/tool-settings/index.ts` | `ToolSettingsContent`, `ProjectToolSettingsModal`, `AvailableTool` |
| `components/characters/ai-wizard/index.ts` | `AIWizardModal` + `* from './types'` |
| `components/tools/import-export/components/index.ts` | Dropped unused `SearchInput` re-export |
| `components/settings/connection-profiles/index.tsx` | Dropped all named re-exports; only default export remains |
| `components/settings/embedding-profiles/index.tsx` | Dropped all named re-exports; only default export remains |
| `components/layout/left-sidebar/index.tsx` | Only `LeftSidebar`; convenience re-exports removed |

### Dependencies Removed

| Dependency | Reason |
|------------|--------|
| `@lexical/clipboard` | Transitive dep of `@lexical/plain-text`, `@lexical/rich-text`, `@lexical/table`; no direct import |
| `@lexical/history` | Transitive dep of `@lexical/react`; no direct import |
| `@quilltap/theme-storybook` | Not imported by app; lives as separate published Storybook addon in `packages/theme-storybook/` |
| `jsdom` | Transitive dep of `jest-environment-jsdom`; no direct import |

### knip.json Updates

- Added `lib/background-jobs/child/child-entry.ts` to `ignore` (dynamically forked via `child_process.fork` by `processor-host.ts`; knip can't detect runtime fork)
- Added `create-quilltap-theme` to `ignoreDependencies` (invoked via `npx create-quilltap-theme` from `packages/quilltap/lib/theme-commands.js`)
- Added `esbuild` to `ignoreDependencies` (invoked via `npx esbuild` in `scripts/build-standalone-overlay.mjs`)

---

## 2026-05-06 — Wardrobe UX overhaul cleanup

`components/wardrobe/wardrobe-item-card.tsx` and `components/wardrobe/wardrobe-item-list.tsx` were retired together with the Aurora-page Wardrobe-tab move. Both components were the inline wardrobe-management surface on the character edit and view pages; they have been superseded by the global wardrobe dialog (`useWardrobeDialog().open({ characterId })`), which is reachable from a Wardrobe tab on each Aurora page (and from anywhere via the sidebar). Their barrel exports were dropped from `components/wardrobe/index.ts` in the same change. Knip confirmed neither was referenced outside the barrel after the Aurora pages were rewired.

---

## Current Findings (2026-04-29)

### Unused Exported Types

#### Intentional: Plugin/Barrel Re-exports in `lib/tools/index.ts`

These types are re-exported from the tools barrel file to form the public API surface for plugins and external consumers. They should be preserved.

The barrel has expanded significantly since the last report. All types re-exported via `lib/tools/index.ts` should be treated as intentional plugin API, including (but not limited to):

- **Project info tool**: `ProjectInfoAction`, `ProjectInfoToolInput`, `ProjectInfoToolOutput`, `ProjectInfoResult`, `ProjectInstructionsSection`, `ProjectInfoToolContext`
- **Request full context tool**: `RequestFullContextToolInput`, `RequestFullContextToolOutput`, `RequestFullContextToolContext`
- **Help tools**: `HelpSearchToolInput`, `HelpSearchToolOutput`, `HelpSearchResult`, `HelpSearchToolContext`, `HelpSettingsCategory`, `HelpSettingsToolInput`, `HelpSettingsToolOutput`, `HelpSettingsToolContext`, `HelpNavigateToolInput`, `HelpNavigateToolOutput`, `HelpNavigateToolContext`
- **RNG tool**: `RngType`, `RngToolInput`, `RngToolOutput`, `RngResult`, `RngToolContext`
- **Whisper tool**: `WhisperToolInput`, `WhisperToolOutput`, `WhisperToolContext`
- **State tool**: `StateOperation`, `StateContext`, `StateToolInput`, `StateToolOutput`, `StateToolContext`
- **Self-inventory tool**: `SelfInventoryToolInput`, `SelfInventoryToolOutput`, `SelfInventoryVaultFile`, `SelfInventoryVaultSection`, `SelfInventoryMemorySection`, `SelfInventoryChatSection`, `SelfInventoryPromptSection`, `SelfInventoryLastTurnSource`, `SelfInventoryLastTurnSection`, `SelfInventoryToolContext`
- **Shell tools**: `ShellToolName`, `ShellToolContext`, `ShellToolOutput`, `ShellCommandResult`, `ShellAsyncCommandResult`, `ShellSessionState`
- **Wardrobe tools**: `WardrobeListToolInput`, `WardrobeListToolOutput`, `WardrobeListItemResult`, `WardrobeListToolContext`, `WardrobeUpdateOutfitToolInput`, `WardrobeUpdateOutfitToolOutput`, `WardrobeUpdateOutfitToolContext`, `WardrobeCreateItemToolInput`, `WardrobeCreateItemToolOutput`, `WardrobeCreateItemToolContext`
- **Annotation tools**: `ReadConversationToolInput`, `ReadConversationToolOutput`, `UpsertAnnotationToolInput`, `UpsertAnnotationToolOutput`, `DeleteAnnotationToolInput`, `DeleteAnnotationToolOutput`
- **Scriptorium search**: `SearchScriptoriumToolInput`, `SearchScriptoriumToolOutput`, `SearchScriptoriumResult`, `SearchScriptoriumToolContext`
- **Plugin tool builder**: `BuildToolsOptions`
- **Text block parser**: `ParsedTextBlock`
- **Scriptorium doc editing tools**: `DocReadFileInput`, `DocReadFileOutput`, `DocWriteFileInput`, `DocWriteFileOutput`, `DocStrReplaceInput`, `DocStrReplaceOutput`, `DocInsertTextInput`, `DocInsertTextOutput`, `DocGrepInput`, `DocGrepOutput`, `DocGrepMatch`, `DocListFilesInput`, `DocListFilesOutput`, `DocFileInfo`, `DocReadFrontmatterInput`, `DocReadFrontmatterOutput`, `DocUpdateFrontmatterInput`, `DocUpdateFrontmatterOutput`, `DocReadHeadingInput`, `DocReadHeadingOutput`, `DocUpdateHeadingInput`, `DocUpdateHeadingOutput`, `DocMoveFileInput`, `DocMoveFileOutput`, `DocCopyFileInput`, `DocCopyFileOutput`, `DocDeleteFileInput`, `DocDeleteFileOutput`, `DocCreateFolderInput`, `DocCreateFolderOutput`, `DocDeleteFolderInput`, `DocDeleteFolderOutput`, `DocMoveFolderInput`, `DocMoveFolderOutput`, `DocWriteBlobInput`, `DocWriteBlobOutput`, `DocReadBlobInput`, `DocReadBlobOutput`, `DocListBlobsInput`, `DocListBlobsOutput`, `DocBlobSummary`, `DocDeleteBlobInput`, `DocDeleteBlobOutput`, `DocOpenDocumentInput`, `DocOpenDocumentOutput`, `DocCloseDocumentInput`, `DocCloseDocumentOutput`, `DocFocusInput`, `DocFocusOutput`, `DocEditToolContext`

**Status**: Intentional. All are plugin/barrel re-exports forming the public tool API.

#### Intentional: Source-Level Exports (used internally or for type safety)

| Type | Location | Reason to Keep |
|------|----------|----------------|
| `ToolDefinition` | `lib/tools/registry.ts:16` | Core tool registry interface, used by `ToolRegistry` class |
| `ToolContext` | `lib/tools/registry.ts:26` | Core tool registry interface, referenced by `ToolDefinition.handler` |
| `DisplacementRepos` | `lib/wardrobe/outfit-displacement.ts:20` | Used as parameter type in two functions in same file; exported for testability |
| `RequestFullContextToolInput` | `lib/tools/request-full-context-tool.ts:14` | Tool input type; follows tool type convention |
| `MemorySearchToolInput` | `lib/tools/memory-search-tool.ts:13` | Used internally as type guard parameter; exported for testability |
| `MemorySearchResult` | `lib/tools/memory-search-tool.ts:22` | Used internally in `MemorySearchToolOutput`; exported for testability |
| `MemorySearchToolOutput` | `lib/tools/memory-search-tool.ts:36` | Tool output type; exported following tool type convention |
| `ProjectFileInfo` | `lib/tools/project-info-tool.ts:41` | Used as return type within the file; exported for testability |
| `SelfInventorySemanticMemoryItem` | `lib/tools/self-inventory-tool.ts:61` | Used in `SelfInventoryLoadedMemoriesSection` within the same file |
| `SelfInventoryInterCharacterMemoryItem` | `lib/tools/self-inventory-tool.ts:68` | Used in `SelfInventoryLoadedMemoriesSection` within the same file |
| `ProposedWardrobeItem` | `lib/wardrobe/image-analysis.ts:29` | Used as parameter/return type within the file; exported for testability |
| `ImageAnalysisResult` | `lib/wardrobe/image-analysis.ts:39` | Return type of `analyzeImageForWardrobe()`; exported for testability |
| `ImageAnalysisParams` | `lib/wardrobe/image-analysis.ts:48` | Parameter type; exported for testability |
| `OutfitSlotValues` | `lib/wardrobe/outfit-description.ts:18` | Used via dynamic import qualifier in `lib/image-gen/appearance-resolution.ts:101`; knip cannot detect dynamic import usage |
| `ShellToolOutput` (shell-handler.ts) | `lib/tools/shell/shell-handler.ts:58` | Duplicate definition alongside barrel re-export; intentional for handler-local type safety |
| `ShellCommandRequest` (shell-session.types.ts) | `lib/tools/shell/shell-session.types.ts:48` | Imported by `shell-handler.ts`; re-exported from shell barrel |
| `AsyncProcessRecord` | `lib/tools/shell/index.ts:12` | Part of shell session types barrel; available to plugins |

### Unused Enum Members (3)

Three `ErrorCode` enum values in `lib/errors.ts` are not currently referenced but are preserved for future error handling:

| Member | Line |
|--------|------|
| `ENCRYPTION_ERROR` | 28 |
| `DATABASE_ERROR` | 29 |
| `EXTERNAL_API_ERROR` | 30 |

**Status**: Intentional. These are standard error categories likely to be needed as error handling matures.

### Duplicate Exports (~39)

Knip flags ~39 components/modules that have both named and default exports. This is a common React pattern (named export for testing, default export for lazy loading). Examples include various components across `components/`.

**Status**: Low priority. The named + default pattern is intentional and widely used in the codebase.

The context-middleware and single-user legacy aliases that used to appear here are gone as of 4.8: `lib/api/middleware/auth.ts` is now `context.ts` and exports only the `withContext*` / `createContext*` names plus `exists`, and `lib/auth/single-user.ts` no longer carries the `*Unauthenticated*` aliases.

### Configuration Hints (2)

Knip suggests removing `packages/**` and `plugins/**` from `knip.json` ignore list. These directories contain independently published npm packages and dynamically loaded plugins respectively, and must remain ignored.

**Status**: No action needed. These are correctly configured false-positive exclusions.

---

## Cleanup Completed (2026-04-29)

### Local-Only Types Unexported

| Location | Item | Reason |
|----------|------|--------|
| `lib/help-guide/categories.ts` | `HelpCategory` | Only used to type `HELP_CATEGORIES` within the same file; no external consumer references it |
| `lib/file-storage/project-store-bridge.ts` | `ProjectStoreTarget` | Only used as the local return type of `getProjectDocumentStore()` |
| `lib/file-storage/project-store-bridge.ts` | `WriteProjectFileInput` | Only used as the local parameter type of `writeProjectFileToMountStore()` |
| `lib/file-storage/project-store-bridge.ts` | `WriteProjectFileResult` | Only used as the local return type of `writeProjectFileToMountStore()` |

### Barrel Exports Removed

| Location | Item | Reason |
|----------|------|--------|
| `components/wardrobe/index.ts` | `GiftWardrobeItemModal` | Re-export was unused; consumers import the component directly from `gift-wardrobe-item-modal.tsx` |
| `components/wardrobe/index.ts` | `ImportFromImageModal` | Re-export was unused; consumers import the component directly from `import-from-image-modal.tsx` |

---

## Cleanup Completed (2026-04-27)

### Functions Removed

| Location | Item | Reason |
|----------|------|--------|
| `lib/services/chat-message/recovery.service.ts` | `attemptTokenLimitRecovery` (deprecated alias) | Never imported anywhere; only `attemptRequestLimitRecovery` is used |

### Types Unexported (kept as internal)

| Location | Item | Reason |
|----------|------|--------|
| `lib/tools/text-block-parser.ts` | `ToolCallRequest` | Only used locally within the file as the return type of `convertTextBlockToToolCallRequest`; no external consumer needed the type directly |

---

## Cleanup Completed (2026-04-02)

### Files Removed

| File | Reason |
|------|--------|
| `lib/image-gen/base.ts` | Unused abstract base class; image providers implement `ImageProvider` from `@quilltap/plugin-types` directly |

### Dependencies Removed

| Dependency | Reason |
|------------|--------|
| `@quilltap/theme-storybook` | Listed in root package.json but never imported by the app; no `.storybook` directory exists |

### API Conformance Fixes

Replaced `NextResponse.json()` with response helpers from `@/lib/api/responses` in 9 route files for consistency:
- `characters/[id]/descriptions/route.ts` and `[descId]/route.ts`
- `characters/[id]/prompts/route.ts` and `[promptId]/route.ts`
- `model-classes/route.ts`
- `connection-profiles/route.ts`
- `plugins/route.ts`
- `system/plugins/initialize/route.ts` and `upgrades/route.ts`

---

## Cleanup Completed (2026-03-24)

### Files Removed

| File | Reason |
|------|--------|
| `docs/developer/example-usage.ts` | Documentation-only file, never imported |

### Duplicates Consolidated

| Functions | Kept In | Removed From |
|-----------|---------|-------------|
| `getExtension()` | `lib/images-v2.ts` | `lib/chat-files-v2.ts` (duplicate helper) |

### Stubs Implemented

| Location | Function | Change |
|----------|----------|--------|
| `lib/images-v2.ts` | `getImageDimensions()` | Replaced no-op stub with real `sharp`-based implementation; uploaded images now have accurate width/height metadata |

---

## Cleanup Completed (2026-03-05)

### Files Removed

| File | Reason |
|------|--------|
| `components/settings/ai-import/index.tsx` | Barrel file never imported; consumers import sub-modules directly |

### Dependencies Removed

| Dependency | Reason |
|------------|--------|
| `@aws-sdk/client-s3` | Never imported; S3 functionality is in plugins |
| `svgo` | Never imported |

### Configuration Changes

- Removed stale `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` mock mappings from `jest.config.ts`

### Known False Positives (Current)

None currently tracked (Electron infrastructure moved to quilltap-shell repo).

---

## Cleanup Completed (2026-02-20)

### Files Removed

| File | Reason |
|------|--------|
| `components/layout/left-sidebar/characters-section.tsx` | Never imported; superseded by homepage version |
| `components/layout/left-sidebar/chats-section.tsx` | Never imported; superseded by homepage/prospero versions |
| `components/layout/left-sidebar/files-section.tsx` | Never imported |
| `components/layout/left-sidebar/projects-section.tsx` | Never imported; superseded by homepage version |
| `components/settings/chat-settings-tab.tsx` | Deprecated re-export shim; never imported |
| `components/settings/chat-settings/index.tsx` | Default export `ChatSettingsTab` unused; sub-modules imported directly |
| `components/ui/brand-logo.tsx` | `BrandLogo` component never imported |

### Functions Removed

| Location | Function | Reason |
|----------|----------|--------|
| `lib/toast.tsx` | `removeToast()` | Never imported or called |
| `lib/toast.tsx` | `clearToasts()` | Never imported or called |
| `components/characters/TemplateHighlighter.tsx` | `replaceTemplatesWithNames()` | Never imported |
| `components/providers/theme-style-injector.tsx` | `generateThemeCSS()` | Never imported |
| `components/settings/appearance/hooks/useThemePreview.ts` | `clearAllThemeTokensCache()` | Never imported |
| `lib/llm/cheap-llm.ts` | `getModelCostTier()` | Never imported |
| `lib/llm/cheap-llm.ts` | `compareModelCosts()` | Never imported |
| `lib/llm/cheap-llm.ts` | `getRecommendedCheapModels()` | Never imported |
| `lib/llm/pricing-fetcher.ts` | `getAllModelsSortedByCost()` | Never imported |
| `lib/llm/pricing-fetcher.ts` | `clearPricingCache()` | Never imported |
| `lib/llm/pricing-fetcher.ts` | `isCacheFresh()` | Never imported |

### Functions Unexported (kept as internal)

| Location | Function | Reason |
|----------|----------|--------|
| `lib/toast.tsx` | `showToast()` | Used internally by convenience wrappers only |
| `lib/llm/pricing-fetcher.ts` | `refreshPricingCache()` | Used internally by `getPricingCache()` only |

### Duplicates Consolidated

| Functions | New Location | Former Locations |
|-----------|-------------|------------------|
| `resolveImageProfileForChat()` | `lib/image-gen/profile-resolution.ts` | `lib/background-jobs/handlers/title-update.ts`, `app/api/v1/chats/[id]/actions/story-background.ts` |

### Configuration Changes

- Added `electron/**` to `knip.json` ignore list (Electron code is independently compiled)

---

## Cleanup Completed (2026-02-09)

### Dead Code Removed

| Location | Item | Reason |
|----------|------|--------|
| `hooks/useSidebarResize.ts` | Entire file | Sidebar is now permanently collapsed; resize functionality removed |
| `components/settings/appearance/SidebarWidthControl.tsx` | Entire file | Sidebar width control removed from Appearance settings |
| `migrations/lib/mongodb-utils.ts` | Entire file | MongoDB stub with no-op functions; no code imports it |
| `lib/database/migration/migration-service.ts` | Entire file | MongoDB migration service stub that always returns errors |
| `lib/database/migration/index.ts` | Barrel file | Re-export for removed migration service |
| `__tests__/unit/lib/database/migration/migration-service.test.ts` | Test file | Tests for removed migration service stub |

Also removed: `next.config.js` webpack warning suppressions for deleted `mongodb-utils.ts`.

---

## Cleanup Completed (2026-02-02)

### Functions Removed

| Location | Function | Reason |
|----------|----------|--------|
| `lib/avatar-styles.ts` | `getAvatarAspectRatioStyle()` | Never imported anywhere |
| `lib/avatar-styles.ts` | `getAvatarMarginClass()` | Never imported anywhere |
| `lib/chat/connection-resolver.ts` | `hasResolvableConnectionProfile()` | Never imported anywhere |
| `lib/chat-files-v2.ts` | `deleteChatFileById()` | Never imported anywhere |
| `lib/chat-files-v2.ts` | `getChatFileById()` | Never imported anywhere |
| `lib/chat-files-v2.ts` | `readChatFileBuffer()` | Never imported anywhere |
| `lib/chat-files-v2.ts` | `getSupportedMimeTypes()` | Deprecated, never imported |

### Documented as Unused (Preserved)

| Location | Item | Reason for Preservation |
|----------|------|-------------------------|
| `lib/chat/tool-executor.ts` | `formatToolResult()` | Has tests; may be useful for native tool result format implementation. Documented that actual formatting is in `context-builder.service.ts`. |
| `lib/chat/tool-executor.ts` | `FormattedToolResult` | Associated interface for `formatToolResult()` |

---

## Cleanup Completed (2026-01-30)

### Files Removed

| File | Reason |
|------|--------|
| `components/chat/AttachmentPromotionMenu.tsx` | Never imported |
| `components/chat/SystemEventMessage.tsx` | Never imported |
| `components/dashboard/favorite-characters.tsx` | Never imported |
| `components/dashboard/nav-logo-menu.tsx` | Only used by dead nav.tsx |
| `components/dashboard/nav-user-menu-item.tsx` | Only used by dead nav-user-menu.tsx |
| `components/dashboard/nav-user-menu.tsx` | Only used by dead nav.tsx |
| `components/dashboard/nav.tsx` | Only used by dead nav-wrapper.tsx |
| `components/layout/app-header.tsx` | Replaced by new layout system |
| `components/nav-wrapper.tsx` | Replaced by new layout system |
| `components/search/index.ts` | Barrel file, direct imports used instead |
| `components/settings/appearance/hooks/index.ts` | Barrel file, direct imports used instead |
| `components/settings/file-permissions/FilePermissionsManager.tsx` | Never imported |
| `components/tags/tag-dropdown.tsx` | Only used by dead nav.tsx |
| `components/ui/ProfileList.tsx` | Never imported (separate ProfileList in each settings module) |
| `lib/file-storage/project-file-migration.ts` | Migration complete |
| `lib/image-gen/google-imagen.ts` | Duplicate of plugin implementation |
| `lib/llm/tool-formatting-utils.ts` | Not imported anywhere |
| `lib/services/search/` (entire directory) | Never used |
| `scripts/debug-files.ts` | MongoDB utility, no longer relevant |
| `scripts/consolidate-duplicate-tags.ts` | MongoDB utility, no longer relevant |
| `__tests__/unit/lib/services/search/` | Tests for removed search service |

### Dependencies Removed

| Dependency | Reason |
|------------|--------|
| `bcrypt` | Never imported (planned for future auth) |
| `@types/bcrypt` | Type definitions for removed bcrypt |
| `qrcode` | Never imported (planned for future 2FA) |
| `@types/qrcode` | Type definitions for removed qrcode |
| `ts-jest` | Not used (using next/jest instead) |

### Dependencies Added

| Dependency | Reason |
|------------|--------|
| `pdfjs-dist` | Was unlisted but used by FilePreviewPdf |
| `@testing-library/user-event` | Was unlisted but used in tests |
| `jsdom` | Was unlisted but used in tests |

### Configuration Changes

- Created `knip.json` to filter out false positives
- Removed mongodb mock from `jest.config.ts`
- Removed bcrypt from webpack externals in `next.config.js`

---

## Cleanup Completed (2025-12-27)

### Files Removed

| File | Reason |
|------|--------|
| `components/characters/system-prompts/` (entire dir) | Duplicate of `system-prompts-editor/` |
| `components/dashboard/nav-theme-selector.tsx` | Component never integrated |
| `components/debug/DebugFilters.tsx` | Never imported |
| `components/debug/hooks/useDebugState.ts` | Never imported |
| `lib/auth/anonymous-user.ts` | Placeholder for future work |
| `lib/mongodb/auth-adapter.ts` | Placeholder for future work |
| `lib/plugins/interfaces/auth-provider-plugin.ts` | Placeholder for future work |
| `scripts/migrate-apikey-userids.ts` | Migration complete |
| `scripts/fix-file-userids.ts` | Migration complete |
| `scripts/fix-sha256-in-mongodb.ts` | Migration complete |

### Barrel/Index Files Removed (for tree-shaking)

| File | Reason |
|------|--------|
| `lib/chat/index.ts` | Direct imports used instead |
| `lib/export/index.ts` | Direct imports used instead |
| `lib/sillytavern/index.ts` | Direct imports used instead |
| `lib/themes/index.ts` | Direct imports used instead |
| `lib/tokens/index.ts` | Direct imports used instead |
| `lib/repositories/index.ts` | Direct imports used instead |
| `components/debug/index.ts` | Direct imports used instead |
| `components/memory/index.ts` | Never imported |
| `components/providers/theme/index.ts` | Never imported |
| `components/tools/import-export/index.tsx` | Direct imports used instead |
| `components/tools/import-export/hooks/index.ts` | Direct imports used instead |
| `components/images/image-detail/index.ts` | Never imported |
| `components/images/image-detail/hooks/index.ts` | Never imported |
| Various `hooks/index.ts` in settings components | Direct imports used instead |

### Backwards-Compatibility Shims Removed

| File | Reason |
|------|--------|
| `components/tools/restore-dialog.tsx` | Re-export shim never used |
| `components/settings/roleplay-templates-tab.tsx` | Re-export shim never used |

### Dependencies Removed

- `rehype-raw` - not used anywhere

---

## Known False Positives

These files are flagged by knip but are actually used:

| File | How It's Used |
|------|---------------|
| `lib/database/index.ts` | Central database abstraction, used by 10+ files |
| `lib/chat/context/index.ts` | Context builder re-exports, used by 10+ files |
| Various `hooks/index.ts` barrel files | Re-exports, harmless |
| Packages directory (`packages/*`) | npm packages published separately |
| Plugins directory (`plugins/*`) | Loaded dynamically at runtime |
| Migrations lib (`migrations/lib/*`) | Used by migration scripts (mongodb-utils.ts removed 2026-02-09) |

---

## Remaining Work (Low Priority)

### Completed 2026-04-08

1. **Consolidated duplicate `WardrobeItemType`**: Removed local copy in `lib/tools/wardrobe-create-item-tool.ts`, now imports from `lib/schemas/wardrobe.types.ts`
2. **Unexported dedup types**: `DedupClusterResult`, `CharacterDedupResult`, and `DedupResult` in `lib/tools/memory-dedup.ts` made file-internal
3. **Unexported `ValidationResult`**: In `lib/validation/qtap-schema-validator.ts`, made file-internal

### Not Actionable (Reviewed 2026-04-08)

- **Source-level barrel duplicates** (`BuildToolsOptions`, `ParsedTextBlock`, `ShellCommandRequest`): Source files must keep `export` for barrel re-exports to work. The knip "duplicate" is inherent to the barrel pattern.

### Duplicate Exports (~39)

Components with both named and default exports, plus legacy compatibility aliases. Address gradually during regular development.

### Utility Scripts to Keep

| Script | Purpose |
|--------|---------|
| `scripts/reset-file-tags.ts` | Maintenance utility for bulk tag operations |

---

## Running Dead Code Analysis

```bash
npx knip
```

The `knip.json` configuration file filters out known false positives. Results should show only unused exports (low priority).
