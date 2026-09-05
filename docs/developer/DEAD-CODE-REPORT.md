# Dead Code Analysis Report

**Last Updated**: 2026-09-04
**Tool Used**: knip
**Codebase**: Quilltap v4.9.0-dev.121

---

## Executive Summary

Dead code analysis is performed periodically using knip. A knip configuration file (`knip.json`) is now in place to filter out known false positives.

| Category | Status |
|----------|--------|
| Unused Files | 2 remaining as of 2026-09-04, both kept-with-reason (in-progress SVAR file-manager surface — see below). 2026-09-04 deleted three test-only modules knip could not see (`lib/database/meta.ts`, `lib/sillytavern/persona.ts`, `hooks/useNavbarCollapse.ts`). 2026-08-26 cleared two new false positives via `knip.json`. 2026-07-20 removed the superseded `QtapDocLink` Document-Mode chain. Prior cleanups: 2026-05-28 (clothing-records/physical-descriptions), 2026-05-17 (terminal/embedded-gallery/restore/search-replace/connection-profiles barrels + dead modals/sidebars) |
| Unused Dependencies | None flagged as of 2026-09-04 (`tar` false-positive added to `ignoreDependencies` 2026-07-30; `@anthropic-ai/sdk` transitive-in-test added 2026-07-20). Prior removals: @lexical/clipboard, @lexical/history, @quilltap/theme-storybook, jsdom (2026-05-17); @aws-sdk/client-s3, svgo (2026-03-05); bcrypt, qrcode, ts-jest (2026-01-30) |
| Unused Exports | 1061 (2026-09-04, on the tree after the checklist-3 refactor; the sweep itself took the pre-refactor tree from 1056 to 1053, and the refactor's new single-owner modules account for the rise). The 2026-09-04 round removed 34 more exports knip does not list at all (under `app/`, or referenced only by tests). Remainder is intentional barrel/plugin/registry/lifecycle/schema surface |
| Unused Exported Types | 768 (2026-09-04; 753 on 2026-08-26 — growth is new `z.infer` surface from the realtime, LoRA, scenario and fallback work); all reviewed — intentional plugin contracts and Zod `z.infer` data-model surface |
| Unused Enum Members | 4 in ErrorCode (preserved for future use; `UNAUTHORIZED` joined the list on 2026-09-04 when its only consumer, `requireAuth`, was removed) |
| Duplicate Exports | 65 (named + default pattern, low priority) |

---

## 2026-09-04 — v4.9 release sweep, second pass (knip), scoped since the 4.8.4 merge-back

Scope: the commits since `115539440` (merge of 4.8.4 back into main, 2026-08-13), which include the 2026-08-26 round below. The sweep was done against `15573c3a1` and then rebased onto the checklist-3 refactor (`0506517d3`); every removal was re-verified on the rebased tree (`tsc`, a whole-repo grep for each removed name, and the full unit suite), and the closing numbers below were re-taken there. knip 6.34.0 flagged **2 unused files** (the same kept-with-reason SVAR pair), **1056 unused exports**, **770 unused exported types**, 3 unused enum members and 64 duplicate exports; no unused or unlisted dependencies and no unlisted binaries. Note knip needs `node_modules` present — run without it, it reports every `package.json` dev dependency as unused and cannot load `jest.config.ts`.

The whole-repo reference count from prior rounds was re-run over all 3,782 tracked source files, scoring each of the 1,829 flagged symbols by references **outside** its defining file: 332 had none, and after stripping comments only **3** had no in-file use either (`resolveLoraScaleBounds`, `IMAGE_PROFILE_LORAS_KEY`, `ImageLoraSpecStored`). That list is short because knip has two blind spots this round went after directly:

1. **Exports under `app/` are never reported.** `knip.json` lists `app/**/*.{ts,tsx}` as entry files, and knip does not report unused exports of entry files. Two orphaned Zod schemas and a dead type had been sitting there.
2. **Exports referenced only by tests are never reported.** The jest plugin treats every test as an entry point, so a function whose last production caller vanished stays "used" as long as its own unit test survives. Prior rounds could only find these by accident.

So a second scan tokenised every tracked source file into an identifier index and, for each export in the 2,272 non-test `.ts`/`.tsx` files outside `packages/` and `plugins/`, split its references into test and non-test. That surfaced **78 exports with no reference anywhere** (almost all Next.js page default exports, jest manual mocks, `migrations/lib`, and `plugins/dist` internals — see the keep list) and **72 referenced only by tests**. Every one of the 72 was read by hand; 32 of them were dead and are removed below, and re-running the scan after the removals caught two more that had been held alive only by symbols in that list (`isCheapModel`, `getContextUsagePercent`), the rest are kept with a reason.

Verified with `npx tsc` (exit 0), `eslint` on every changed file (clean), `npm run lint` (clean) and the full `npm run test:unit` suite — **756 suites / 11,581 tests** on the pre-refactor tree, **780 suites / 11,872 tests / 68 snapshots** after the rebase, 1 pre-existing skip. Re-running knip on the pre-refactor tree confirmed the reductions (unused exports 1056 → 1053, files and types unchanged); on the rebased tree it reports 2 files / 1061 exports / 768 types / 65 duplicates with no zero-reference candidate left, and `ErrorCode.UNAUTHORIZED` newly listed among the unused enum members (its only consumer was `requireAuth`). Net change: **56 files, +173 / −2,861 lines** including documentation and the version stamp.

### Removed — whole modules

| File | Why it was dead |
|------|-----------------|
| `lib/database/meta.ts` (+ `__tests__/unit/lib/database/migration/meta.test.ts`) | The Mongo-era "preferred backend" store. No production importer; the only thing that ever created or read the `quilltap_meta` table was this module, and `highest_app_version` (the one value the docs attribute to it) actually lives in `instance_settings` (`lib/startup/version-guard.ts`). It had been kept compiling by the `applySqlcipherKey` refactor, which is why it showed up in the since-set. `docs/developer/features/native-port-phase-0.md` used it as the worked example of the SQLCipher key path; that pointer now names `sqlcipher-key.ts`. |
| `lib/sillytavern/persona.ts` (+ the persona `describe` in `__tests__/unit/sillytavern.test.ts`) | `importSTPersona` (already `@deprecated`), `importSTPersonaAsCharacter` (the thing it was deprecated in favour of) and `exportSTPersona` had no importer outside the test. Character and chat import/export in the same directory are live and untouched. |
| `hooks/useNavbarCollapse.ts` (+ `__tests__/unit/hooks/useNavbarCollapse.test.ts`) | ResizeObserver overflow hook for a navbar that no longer exists; last touched 2026-01-23, referenced by nothing but its 357-line test. |

### Removed — functions / consts / types

| File | Removed |
|------|---------|
| `app/api/v1/chats/[id]/schemas.ts` | `queueMemoriesSchema` — `handleQueueMemories` ignores the request body |
| `app/api/v1/projects/[id]/schemas.ts` | `setStateSchema` — the shared `createSetStateHandler` (`lib/api/state-handlers.ts`) carries its own `stateBodySchema` |
| `app/salon/[id]/types.ts` | `ChatParticipantData` (type) |
| `app/salon/[id]/hooks/documentModeApi.ts` | `fetchActiveDocumentRecord` (+ its private `ActiveDocumentResponse`) |
| `lib/api/responses.ts` | `V1_MIGRATION_DEPRECATION` — "retained for reference" since the v2.8 route removal; `DeprecationInfo` stays, it is used by the response helpers |
| `lib/backup/uuid-remapper.ts` | `createUuidRemapper` — restore constructs `new UuidRemapper()` directly |
| `lib/chat/context-manager.ts` | `getContextStatus` |
| `lib/tokens/token-counter.ts` | `getContextWarningLevel` — the same "for UI display" gauge one layer down; no UI ever read either — and `getContextUsagePercent`, which only it called |
| `lib/chat/creation-progress.ts` | `publishCreationProgress`, `finishCreationProgress`, `failCreationProgress` (+ their now-orphaned `operation-progress` imports) — pure delegation wrappers left over from the Almanack refactor; `createCreationProgressEmitter` is the live path and `subscribeCreationProgress` stays for the SSE route. The two test suites that used them as scaffolding now call the `operation-progress` primitives directly |
| `lib/chat/timestamp-utils.ts` | `formatTimestampForSystemPrompt` |
| `lib/errors.ts` | `validateRequestBody`, `requireAuth` — pre-`@/lib/api/middleware` helpers |
| `lib/image-gen/prompt-expansion.ts` | `calculateAvailableSpace` |
| `lib/images-v2.ts` | `calculateSha256` — a one-line alias of `sha256OfBuffer`; the dedup regression suite now imports the real one |
| `lib/llm/cheap-llm.ts` | `estimateModelCost`, `validateCheapLLMConfig`, and `isCheapModel`, whose only caller was `validateCheapLLMConfig` (the live selection ladder consults the plugin registry directly) |
| `lib/llm/errors.ts` | `handleProviderError`, `getUserFriendlyError` — the error classes and `is*`/`parse*` detectors stay; provider plugins raise their own errors and the failover service reads the detectors |
| `lib/llm/pricing.ts` | `getModelsUnderCost`, `calculateCostTier`, `calculateSavings` |
| `lib/navigation/route-flags.ts` | `routeSupportsDebug` — its test now asserts `getRouteFlags(...).supportsDebug` |
| `lib/paths.ts` | `hasShellCapability` (`getShellCapabilities` is live) |
| `lib/repositories/factory.ts` | `getDataBackend`, `isMongoDBEnabled` (+ the "MongoDB or SQLite" header comment) |
| `lib/schemas/profile.types.ts` | `IMAGE_PROFILE_LORAS_KEY` — a never-adopted name for the `loras` key; the readers use property access and `params-builder.ts` keeps the reserved-key set |
| `lib/services/host-notifications/writer.ts` | `buildMultiCharacterRosterContent`, `buildMultiCharacterRosterOpaqueContent` — the content halves of `postHostRosterAnnouncement`, whose poster went in the 2026-06-03 sweep |
| `lib/llm/message-formatter.ts` | `buildMultiCharacterContextSection` — orphaned by the roster removal above; the live system prompt builds its roster through `buildOtherParticipantsInfo` in `context-manager.ts` |
| `lib/themes/registry-client.ts` | `toggleSource` — `addSource` / `removeSource` are wired to `/api/v1/themes`; enable/disable never was, and `help/themes.md` documents only add and remove |

### Deduplicated rather than deleted — the LoRA scale bounds

`DEFAULT_LORA_SCALE` and `resolveLoraScaleBounds` in `lib/image-gen/lora-support.ts` had no caller — because `components/image-profiles/LoraListEditor.tsx` carried a byte-identical private copy under a comment reading "Mirrors `DEFAULT_LORA_SCALE`". The editor could not import the original: `lora-support.ts` reads the in-process plugin registry and cannot ship to the browser. Same shape as the hair-guidance constants on 2026-08-26, so the same fix: both now live in a client-safe `lib/image-gen/lora-scale.ts` and the editor imports `resolveLoraScaleBounds`. The checklist-3 refactor landed the identical split independently, so that module is the refactor's; what this sweep removes on the rebased tree is the `export { DEFAULT_LORA_SCALE, resolveLoraScaleBounds }` re-export (and its unused import) that `lora-support.ts` kept "for the server-side callers" — there are none, and `lora-support.ts` never used either symbol.

### Investigated but KEPT (intentional surface / false positives)

From the two new scans:

- **`app/**/page.tsx` default exports** (17) — Next.js route components; nothing imports them by name.
- **`__mocks__/**`** — jest manual mocks (`jose`, `arctic`, `@google/generative-ai`), resolved by module name.
- **`migrations/lib/**`** (`user-data-path.ts`, `json-store`, `secrets.ts`, `file-manager.ts`, `logger.ts`) — knip-ignored on purpose; files kept only for migrations belong there per CLAUDE.md.
- **`plugins/dist/qtap-plugin-mcp/*` and `qtap-plugin-openrouter/pricing-fetcher.ts`** — plugin internals; checklist item 8 (plugin self-containment) owns that surface, not this one.
- **Registry accessors** — the functional wrappers in `moderation-provider-registry.ts` (7), `search-provider-registry.ts` (12), `system-prompt-registry.ts` (3), and the stats/errors/initialized accessors on `provider-registry.ts` / `tool-registry.ts`. Every registry exposes the same shape over `abstract-provider-registry.ts`; the provider registry's are heavily used, the search ones are test-only, the moderation ones are referenced by nothing at all. Kept under the standing registry rule (2026-04-29) rather than breaking the symmetry — the registry *instances* (`moderationProviderRegistry`, hot-load, initialise) are all live. `createModerationProviderLogger` is kept with them as the sibling of the live `createProviderLogger` / `createSearchProviderLogger`.
- **Theme public API** — `theme-registry.ts` (`getTheme`, `getDefaultTheme`, `getThemeTokens`, `getThemeCSS`, `hasTheme`), `default-tokens.ts` (`getDefault*`), `utils.ts` (`themeColorsToCSS`, `themeTokensToStyleObject`, `mergeWithDefaultTheme`, `themeTokensEqual`, `getThemeDifferences`), and `crypto.ts` (`generateKeyPair`, `signBundleDirectory`, `verifyBundleSignature`). Standing keep since 2026-06-03. **Worth a follow-up:** `verifyRegistryIndex` *is* wired (the registry index signature is checked on fetch), but `verifyBundleSignature` is not called on install, and no signing tool calls `signBundleDirectory` — bundle-level Ed25519 verification is half-built, not dead.
- **`setupPepper` / `storePepperInVault`** (`lib/startup/pepper-vault.ts`) — the write side of the legacy pepper vault, which production no longer writes (`.dbkey` files replaced it; `drop-pepper-vault-v1` retires the table). Kept because the test suite uses `setupPepper` to seed vaults for the still-live legacy `unlockPepper` path in `/api/v1/system/unlock`. The whole module goes when that path does.
- **`UNREPORTED_IF_BLANK_SLOT_TYPES`** (`lib/schemas/wardrobe.types.ts`) — referenced only by `unreported-if-blank-slots.test.ts`, but it is the schema-level statement of the invariant that regression net guards (a slot with `reportWhenEmpty: false` must vanish from every report). Kept under the `lib/schemas/*` rule.
- **`ImageLoraSpecStored`** — `z.infer` of the live `ImageLoraSpecSchema`; standing schema rule.
- **`normalizeVector`** (`lib/embedding/embedding-service.ts`) — flagged test-only because `jest.setup.ts` stubs it, but it is called in-file at two sites.
- **`__reset*ForTests` / `_reset*ForTesting` / `resetHelpSearch` / `resetValidatorCache`** — explicit test hooks their suites use; same rule as `resetFrozenArchiveCacheForTests` on 2026-08-26.
- **`applyWritesUnsafe`, `classifyWriteTarget`, `readLockFile`, `chatActivityTime`, `resolveStandingInstructions`, `renderStandingInstructionsSection`, the `lib/database/meta.ts`-adjacent `META_KEYS`** and the rest of the "referenced by tests and used in-file" group — exported for direct unit testing, live through their module's entry point.
- The "exported helper used only inside its own module" group and the 770 `z.infer` / plugin-contract types are unchanged in character from prior rounds.

### Follow-ups this round surfaced (not dead code)

- **`quilltap_meta` is an orphaned table.** With `meta.ts` gone nothing creates it, and nothing read it before. `docs/developer/DDL.md` and the table list in `DEVELOPMENT.md` still describe it because instances that ran the Mongo migration carry it. Dropping it is a schema change (a migration plus DDL update), so it is left for a deliberate change rather than this sweep.
- **Bundle signature verification** is unwired — see the theme-crypto note above.
- **`ErrorCode.UNAUTHORIZED`** now has no consumer; it sits with the three members already "preserved for future use".

---

## 2026-08-26 — v4.9 release sweep (knip)

knip flagged **4 unused files**, **1064 unused exports**, **753 unused exported types**, 3 unused enum members, and 62 duplicate exports. No unused or unlisted dependencies, and no unlisted binaries.

Method as in the 2026-07-30 and 2026-06-03 rounds: a whole-repo identifier reference count over all 3,484 source files (`.ts/.tsx/.js/.jsx/.mjs/.cjs/.json/.md/.css/.mdx/.yml`, with `node_modules`, `.next`, `.claude` worktrees and build output excluded), scoring each of the 1,817 flagged symbols by references **outside** its defining file. That isolated **361 symbols with no external reference at all** and **4 referenced only by tests**.

The 361 were then narrowed by in-file usage. A first pass counted raw identifier occurrences in the defining file and found 31 candidates; that undercounted, because JSDoc `{@link Foo}` mentions read as uses. A second pass stripped comments before counting and surfaced **6 more** (`readJsonFileOptional`, `parseComponentItemsField`, `joinFolderPath`, `createApiLogger`, `createRepositoryLogger`, `HAIR_PHYSICAL_BOUNDARY`) — `HAIR_PHYSICAL_BOUNDARY` in particular was masked entirely by a `{@link}` in its sibling's doc comment. The comment-stripper has its own false positives (a `/*` inside a string literal), so all 37 were confirmed by hand with a whole-repo `grep` before any deletion; that check reprieved `parseComponentItemsField`, which is called in-file.

Everything not listed below has a real consumer knip does not follow (a barrel, a test, `packages/`, `plugins/`), or falls under a standing keep-rule from a prior round.

Verified with `npx tsc` (exit 0), `npm run lint` (clean), and the full `npm run test:unit` suite (**724 suites / 11,213 tests / 68 snapshots passing**). Re-running knip confirms the reductions: unused files 4 → 2, unused exports 1064 → 1051 (−13, exactly the 11 removals plus the 2 constants now wired up).

### Removed — functions / consts

| File | Removed |
|------|---------|
| `components/providers/avatar-display-provider.tsx` | `useAvatarDisplayContextOptional` |
| `lib/backup/restore/json-stream.ts` | `readJsonFileOptional` |
| `lib/documents/open-document-in-chat.ts` | `standaloneTabPayload` (+ the now-orphaned `DocumentStandaloneTabPayload` type import) |
| `lib/files/folder-utils.ts` | `joinFolderPath` |
| `lib/logging/create-logger.ts` | `createApiLogger`, `createRepositoryLogger` |
| `lib/mount-index/database-store.ts` | `databaseFolderHasContents` (+ its 5 stale `jest.mock` stubs) |
| `lib/mount-index/group-wardrobe.ts` | `GROUP_WARDROBE_FOLDER` (+ orphaned `SHARED_WARDROBE_FOLDER` import) |
| `lib/mount-index/project-wardrobe.ts` | `PROJECT_WARDROBE_FOLDER` (+ orphaned `SHARED_WARDROBE_FOLDER` import) |
| `lib/wardrobe/shared-tiers.ts` | `resolveSharedWardrobeTiersForProject`, `noSharedWardrobeTiers` (+ the private `EMPTY` const and the orphaned `resolveProjectMountPointIds` import) |

Notes:

- **`useAvatarDisplayContextOptional`** is the last of the `use*Optional` context-hook family; `useSessionOptional`, `useSidebarOptional`, and `useAvatarDisplayOptional` all went in the 2026-06-03 sweep for the same reason. The throwing `useAvatarDisplayContext` is the live one.
- **`readJsonFileOptional`** had no caller; `readJsonFile`, `readJsonArrayFile`, and `readJsonArrayFileOptional` are all live in `lib/backup/restore/archive.ts`. Its doc comment was the only thing naming it, from the sibling below it — that comment now points at `readJsonArrayFile`.
- **`standaloneTabPayload`** existed, per its own doc comment, "so both halves of the 'open a document' decision read from one place". Nothing ever called it: all three sites that build a `DocumentStandaloneTabPayload` (`lib/hooks/use-open-document-from-search.ts:128`, `components/layout/left-sidebar/sidebar-footer.tsx:178`, `components/workspace/WorkspaceIntent.tsx:123`) construct the object inline. **Worth a follow-up:** that three-way duplication is real and is what the helper was meant to prevent; consolidating it is a refactor, not a deletion, so it is left for checklist item 3.
- **`joinFolderPath`** joins `lib/files/folder-utils.ts`'s `buildFolderTree` / `isInFolder` / `isInFolderRecursive`, removed from the same file on 2026-06-03. `normalizeFolderPath`, which it wrapped, is live across the `/api/v1/files` routes.
- **`createApiLogger`** and **`createRepositoryLogger`** are the two never-adopted members of the `create*Logger` family. The other three are heavily used — `createServiceLogger` (254 references), `createPluginLogger` (76), `createLogger` (43) — so the file keeps its purpose; these two had zero.
- **`databaseFolderHasContents`** had no production caller anywhere. Its only references were five `jest.mock` factory stubs in the `doc-edit-handler-*` suites, which merely enumerate the mocked module's shape and do not prove use; those stale keys were removed with it. The `folderHasContents` helper it dynamic-imported from `lib/mount-index/folder-paths` is untouched, as are its live siblings `databaseFileExists` / `databaseFolderExists`.
- **`GROUP_WARDROBE_FOLDER` / `PROJECT_WARDROBE_FOLDER`** were one-line re-export aliases of `SHARED_WARDROBE_FOLDER` with no consumer and no in-file use. The parallel `GENERAL_WARDROBE_FOLDER` in `general-wardrobe.ts` is **kept** — it is used in-file at line 42. The live surface of both modules (`ensure*WardrobeFolder`, `read*Wardrobe`) is untouched and still imported by the group/project wardrobe routes.
- **`resolveSharedWardrobeTiersForProject`** was superseded rather than merely unused. Its doc comment names "chat creation, the outfit composer" as its callers, but both (`app/api/v1/chats/route.ts:1131`, `app/api/v1/chats/[id]/actions/participants.ts:220`) resolve the project tier once and then call `sharedWardrobeTiersForCharacter` per character inside the loop — the pattern that module documents for exactly that case. This was checked specifically against the module's stated raison d'être (a call site that threads only `projectMountPointIds` is the bug it exists to prevent): **those call sites are correct**, because the per-character loop supplies the group tier. `resolveSharedWardrobeTiersForChat` and `sharedWardrobeTiersForCharacter` remain live.

### Deduplicated rather than deleted — the hair guidance constants

`lib/wardrobe/slot-guidance.ts` exists, per its module docblock, so that "the wardrobe tools, the outfit-choosing prompt, the character generators, and the image analyser all draw the wardrobe/physical line the same way — a model that reads two different versions of this rule files hair colour as a garment." Two of its three constants were flagged as unused:

- `HAIR_PHYSICAL_BOUNDARY` — the prose-paragraph phrasing, for the character generators and optimizer
- `HAIR_PHYSICAL_DESCRIPTION_NOTE` — its complement, for physical-description prompts

Both turned out to be duplicated **verbatim** — byte-for-byte, verified programmatically — as inline string literals inside `lib/services/character-field-semantics.ts` (`WARDROBE_SEMANTICS` and `PHYSICAL_DESCRIPTION_SEMANTICS` respectively). So they were not dead intent but a live single-source-of-truth violation of precisely the kind the module was written to prevent.

Deleting them would have entrenched the duplication, so instead `character-field-semantics.ts` now interpolates the two constants. Because the strings are byte-identical, the rendered prompt text is unchanged: the patched file was expanded back to literals and compared against `HEAD`, and it matches exactly. That means no `IDENTITY_STACK_BUILDER_VERSION` bump and no golden regeneration are owed, and the 68 snapshots still pass. `slot-guidance.ts` has no imports of its own, so no cycle is introduced. The third constant, `HAIR_SLOT_GUIDANCE`, was already live in the four `wardrobe_*` tools.

### knip.json — silenced two verified false positives

- **`jest.integration.config.ts`** added to `entry`. knip reported it as an unused file, but it is invoked by two `package.json` scripts (`test:all`, `test:integration`) via `--config`, which knip's jest plugin does not parse. Listing it as an entry rather than an ignore also lets knip follow its `globalSetup` chain (the `armSparkplugGuard()` wiring from bug 83).
- **`__tests__/helpers/lexicalPluginHarness.tsx`** added to `ignore`. It is imported by four live suites (`TextReplacementPlugin`, `SmartTypographyPlugin`, `CharTypeaheadPlugin.emoji`, `CharTypeaheadPlugin.unicode`). The sibling `__tests__/helpers/renderWithQuery.tsx` is *not* flagged; the difference is that the harness is imported only through deep relative paths (`../../../../../helpers/…`) while `renderWithQuery` is also imported via the `@/` alias. This is a knip resolution quirk, not a code fact — the code is correct as written and was left alone.

### Investigated but KEPT (intentional surface / false positives)

All 753 flagged types and the remaining flagged exports fall under standing keep-rules from prior rounds (Zod `z.infer` schema surface, `*ToolInputSchema` types, plugin SDK contracts, registry accessors, theme validation API, lifecycle `start`/`stop` pairs, barrel re-exports, and exported helpers used only inside their own module). Specifically cleared this round:

- **The `lib/schemas/*` `z.infer` types** — `FileStatus`, `HelpDocChunkInput`, `MemoryKind`, `RealtimeClientMessage`, `RpFontKey`, `TerminalSessionCreate`, `TextReplacementRulePatch`, the four `plugin-manifest.ts` config types (`AuthProviderConfig`, `ThemeFontDefinition`, `SubsystemOverridesType`, `ToolConfig`, `SystemPromptConfig`), and the five `settings.types.ts` types (`AutoHousekeepingCapOverride`, `AutoHousekeepingSettings`, `AutonomousRoomVisibilityDefault`, `AutonomousRoomDestructiveToolPolicy`, `AutoLockSettings`). Standing rule since 2026-06-03: every `lib/schemas/*` schema and its inferred type is data-model surface.
- **The theme validation family** — `validateThemeTokens`, `validateThemeManifest`, `safeValidateThemeManifest`, `validateQtapThemeManifest`, `validateThemePreference`, plus the `ThemeCompatibility` / `RegistryPreviewColors` `z.infer` types (whose schemas are used in-file at `lib/themes/types.ts:345`, `:476`, `:481`). Documented public theme API; kept since 2026-06-03.
- **`parseComponentItemsField`** (`lib/database/repositories/vault-overlay/parsers.ts`) — flagged as an unused export, but called in-file at line 333. The "exported helper used only inside its own module" category; un-exporting is pure churn.
- **`clearCompressionCache` / `getCompressionCacheStats`** (`lib/services/chat-message/compression-cache.service.ts`) — referenced only by their own test suite. Kept under the lifecycle-pair rule: they are the invalidation and introspection halves of a live cache, and unlike the `_clearHousekeepingOutcomesForTest` removed on 2026-06-03, a test does exercise them.
- **`resetFrozenArchiveCacheForTests`** (`lib/memory/frozen-archive-cache.ts`) — an explicit test helper that its own suite uses. Kept for the same reason. Note the standing follow-up on its neighbour `invalidateFrozenArchive` from 2026-07-30 still applies.
- **`components/files/svar/index.ts` and `components/files/svar/SvarFilePicker.tsx`** — unchanged from 2026-07-20 and 2026-07-30. Still the in-progress SVAR file-manager surface (`docs/developer/features/svar-file-manager-implementation-plan.md`): the barrel is the documented runtime-free public API, `SvarFilePicker` is the Phase 4 costume awaiting page wiring, and the Phase 3 `SvarFileManager` sibling **is** wired behind the "New file manager (beta)" toggle.
- **The 3 `ErrorCode` enum members and 62 duplicate exports** — unchanged in character from prior rounds; the duplicates are the named + default export pattern, still low priority.

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
- **`ps`, `tasklist`, `du`** added to `ignoreBinaries`. These are legitimate OS binaries invoked at runtime: `ps`/`tasklist` for cross-platform liveness checks in `lib/database/backends/sqlite/instance-lock.ts`, `du` for size reporting in `scripts/build-standalone-tarball.mjs`.

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
