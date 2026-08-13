# Composer Text Replacement — Layer 1.5 Spec

**Status:** Proposal / Not Implemented
**Scope:** quilltap-server (renderer + server). No shell changes.
**Phase:** 1.5 of the [composer-spellcheck](composer-spellcheck.md) plan. Layer 1 (browser spellcheck + Aurora dictionary feed) has shipped; Layer 2 (typeahead) is still deferred.

## Summary

Add user-defined word-boundary text replacements to the Salon ChatComposer and Document Mode rich Lexical editor — the cross-platform substitute for OS autocorrect that Layer 1 explicitly couldn't deliver. Type `Aris` then space and the editor swaps it for `Aristarchus the Wise`. Rules are global, simple `from → to` pairs, edited from the Chat settings tab. No shell changes; this works in browser, Electron, and Docker alike.

## Goals

- A user can define a list of literal-string replacements that fire on word boundaries while typing.
- Replacements apply in **both** the Salon ChatComposer **and** the Document Mode rich editor (mirroring Layer 1's surface coverage).
- A single Cmd/Ctrl+Z reverts a replacement to the literal text the user typed (matches macOS autocorrect behaviour).
- Rules are managed through a small CRUD UI on the Chat settings tab, beneath the spellcheck toggle from Layer 1.
- A master on/off toggle is provided so the whole subsystem can be silenced without deleting rules.

## Non-goals

- **Snippet expansion** (multi-line, cursor-positioning, date macros, `;sig` triggers). Pure word-boundary replace only. If snippet expansion is wanted later, it gets its own layer.
- **Per-character or per-project rule scopes.** Single global list. Per-character/per-project overrides can be revisited once the global system has shipped and earned its place.
- **Regex rules.** Literal strings only. Regex would change the threat model (catastrophic backtracking, accidental matches inside words) and most users want literal replacements anyway.
- **Source-mode textareas** (`spellCheck={false}` surfaces — Markdown source view, plain-text source view, the `MarkdownLexicalEditor` source view). Same exclusion as Layer 1, same reason: a Markdown-syntax surface is the wrong place to autocorrect.
- **Paste-triggered replacement.** Only typed input fires rules. Pasted content is left alone — matches macOS / Word behaviour and avoids surprises when copying quoted text.
- **LLM-driven completion.** That's Layer 3.

## Known State (verified 2026-05-23)

- **Layer 1 setting** lives in [settings.types.ts:364](lib/schemas/settings.types.ts:364) as `composerSpellcheck: z.boolean()` on the chat-settings schema, persisted via [chat-settings.repository.ts:212](lib/database/repositories/chat-settings.repository.ts:212), served by [route.ts:42](app/api/v1/settings/chat/route.ts:42), edited via [ComposerSpellcheckSettings.tsx:16](components/settings/chat-settings/ComposerSpellcheckSettings.tsx:16), and consumed via SWR in [LexicalComposerWrapper.tsx:89](components/chat/lexical/LexicalComposerWrapper.tsx:89) and [DocumentPane.tsx:120](app/salon/[id]/components/DocumentPane.tsx:120).
- **Lexical plugins** in the Salon composer live in [components/chat/lexical/plugins/](components/chat/lexical/plugins/). Existing plugins (`KeyboardPlugin`, `MarkdownBridgePlugin`, `ImagePastePlugin`, `ExternalControlPlugin`, `FormattingCommandPlugin`) follow the same shape: a `useLexicalComposerContext` hook, one or more `editor.registerXxx` calls inside a `useEffect`, returning the unregister disposers. New Layer 1.5 plugin will follow the same pattern.
- **Document Mode plugins** live alongside [DocumentPane.tsx](app/salon/[id]/components/DocumentPane.tsx) in a `DocumentEditorPlugins` component. The Layer 1.5 plugin must be registered there as well.
- **No `text_replacement_rules` table** exists. Clean slate.
- **`/api/v1/settings/chat`** is a single GET/PATCH route returning the full settings shape. We could fold rule storage into it, but rule edits scale better as a dedicated CRUD endpoint — see Architecture below.

## Architecture

Three moving parts:

1. **Storage.** A new SQLCipher table `text_replacement_rules` with row-per-rule semantics. Single global list (per the single-user [project_single_user](~/.claude/projects/-Users-csebold-source-quilltap-server/memory/project_single_user.md) convention — no `userId` column).
2. **API.** New REST resource at `/api/v1/settings/text-replacements` with action-dispatch handlers. A new boolean `textReplacementsEnabled` is added to `chat-settings` so the master switch can be flipped without touching the rule table.
3. **Lexical plugin.** `TextReplacementPlugin.tsx`, registered in both `ComposerPlugins` (Salon) and `DocumentEditorPlugins` (Document Mode). Listens for word-boundary characters typed at the end of a `TextNode` and replaces the preceding word in place if a rule matches.

### Why a table, not a JSON column

A JSON column on `chat_settings` would be simpler to implement but worse to live with:

- Every UI edit (add row, edit a cell) would PATCH the whole array, which fights React form state and is racy if two tabs are open.
- Export/import diffs become opaque blobs.
- If the schema needs to evolve (per-rule case-sensitivity toggle, per-rule notes, etc.) every existing row gets a NULL backfill regardless of storage shape — but with a table the migration is normal `ALTER TABLE ADD COLUMN`; with JSON it's a per-row data migration.

The cost of doing it right: one migration, one repository, one route module, one Zod schema. All well-trodden ground.

### Why a separate `textReplacementsEnabled` toggle (not just "delete all rules")

The whole point of a master switch is to let the user A/B the feature without losing their list. Same reason `composerSpellcheck` exists separately from "uninstall the OS dictionary."

### Schema

New table (camelCase columns, per DDL.md convention):

```sql
CREATE TABLE text_replacement_rules (
  id TEXT PRIMARY KEY NOT NULL,
  fromText TEXT NOT NULL,
  toText TEXT NOT NULL,
  caseSensitive INTEGER NOT NULL DEFAULT 0,  -- 0 = case-insensitive match
  enabled INTEGER NOT NULL DEFAULT 1,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_text_replacement_rules_enabled ON text_replacement_rules(enabled);
CREATE INDEX idx_text_replacement_rules_sortOrder ON text_replacement_rules(sortOrder);
```

Notes:

- `fromText` is the literal trigger. Compared whole-word only — leading/trailing whitespace is rejected at the API.
- `caseSensitive` is per-rule. Default `0` (case-insensitive). When `caseSensitive = 0`, matching is folded but the **output is verbatim `toText`** — we don't try to preserve typed casing. (Smart casing — "preserve title case if the trigger was capitalized" — is a deferred refinement; gets complicated fast and is rarely what writers actually want.)
- No `UNIQUE` constraint on `fromText` because two rules with the same trigger but different `caseSensitive` flags are legal; the runtime resolves precedence (case-sensitive wins; see "Conflict resolution" below). A soft uniqueness check in the API for the `(fromText, caseSensitive)` pair gives a friendly error.
- `sortOrder` exists for future UX (drag-to-reorder, deterministic display), not for matching priority. Matching is keyed purely by `fromText`.

### Conflict resolution

The runtime keeps two maps: a case-sensitive map keyed by exact `fromText`, and a case-insensitive map keyed by `fromText.toLowerCase()`. On a word boundary:

1. Look up the typed word in the case-sensitive map. If found → replace.
2. Else lower-case it and look up in the case-insensitive map. If found → replace.
3. Else no-op.

If two case-insensitive rules collide on the same lower-cased key (e.g. user has both `aris → Aristarchus` and `ARIS → Aristarchus the Wise`), the API rejects the second insert with a 409 explaining the collision. This is the soft uniqueness check from above.

### Lexical plugin behaviour

`TextReplacementPlugin.tsx` registers a single `editor.registerCommand(KEY_DOWN_COMMAND, ...)` listener at `COMMAND_PRIORITY_LOW` (matches the pattern in `KeyboardPlugin`). On every keystroke it:

1. Bails immediately if the editor is in composition (IME). Lexical exposes `editor.isComposing()`; check that.
2. Bails if the key is not a word-boundary trigger. Trigger set: ASCII space, NBSP (` `), tab, newline, and the ASCII terminal punctuation `. , ; : ! ? )`. Open punctuation (`(`, `"`, `'`) is excluded — they typically *precede* a word, not terminate one. Em-dash and en-dash are excluded for v1 (writers commonly type them mid-word).
3. Reads the current selection. Bails unless it is a collapsed selection inside a `TextNode`.
4. Walks backward from the cursor across the `TextNode`'s text to find the word boundary on the *other* side — i.e. the run of non-whitespace, non-terminator characters ending at the cursor.
5. Looks the candidate word up in the two rule maps (case-sensitive first, then case-insensitive). If no match, returns `false` so the keystroke proceeds normally.
6. On match, queues an `editor.update(() => { ... }, { tag: 'text-replacement' })` that:
   - Splits the `TextNode` at the start of the match and replaces the matched span with `toText`.
   - Inserts the trigger character after the replacement (so typing `Aris ` ends with a space, not a missing one).
   - Sets the selection to immediately after the inserted trigger.
7. Returns `true` from the command handler to swallow the original keystroke (we just synthesised its effect).

The `{ tag: 'text-replacement' }` option groups the whole replacement into a single Lexical history entry, so one Cmd-Z undoes it back to `Aris ` (the literal text the user typed) — matching the macOS autocorrect feel. A second Cmd-Z then undoes the typing itself.

### Shared with the other typing aids

Two things are no longer this plugin's alone, and changing either means changing both features:

- **`$isInCodeContext()`** (`components/chat/lexical/utils/code-context.ts`) is the ONE code-context predicate shared by this plugin, `CharTypeaheadPlugin` and `SmartTypographyPlugin`. It came out of [bug 63](../bugs/fixed/bug-63-text-replacement-in-code.md), which is what happened when two typing aids kept their own bail lists. Never re-inline a code check at a call site.
- **Registration order is load-bearing.** `.` is a word-boundary trigger here *and* the ellipsis trigger for [smart typography](composer-smart-typography.md). Smart typography registers at `COMMAND_PRIORITY_NORMAL` (2) and this plugin at `COMMAND_PRIORITY_LOW` (1); Lexical's `triggerCommandListeners` loops `for (let i = 4; i >= 0; i--)`, so NORMAL runs first. The full order is emoji/Unicode typeahead → smart typography → text replacement, mounted in that order in `LexicalComposerWrapper.tsx` and `DocumentPane.tsx`. The worked interaction table (`Aris...`) is asserted step by step in `__tests__/unit/components/chat/lexical/plugins/SmartTypographyPlugin.test.tsx`; that is the test that fails if someone reorders the stack.

⚠ Note also that both plugins commit through a **nested** `editor.update()` — nested because the command listener is already inside an update — which Lexical *queues* rather than running inline. A flag assigned inside that callback is still `false` when the handler returns. Both handlers therefore decide in a `read()` pass and return `true` unconditionally after `preventDefault()`; a flag-based return would hand an already-prevented keystroke to the next listener down.

### Disabled paths

- If `chatSettings.textReplacementsEnabled` is `false`, the plugin still mounts but its keydown handler returns `false` immediately. Mounting/unmounting on every toggle would be churn.
- If the rule list is empty, same — handler returns false immediately.
- Rules with `enabled = 0` are skipped at map-build time, not at lookup time.

### Why not `editor.registerNodeTransform(TextNode, ...)`?

Node transforms fire on every text mutation including programmatic ones. We'd have to filter for "this came from a user keystroke" and we'd lose easy access to the keystroke that triggered it (so we can't tell whether the user typed `space` or `period`). A `KEY_DOWN_COMMAND` listener is the right shape.

### Why not `MarkdownShortcutPlugin`?

Lexical's built-in shortcut plugin operates on Markdown patterns (`** → bold`, `# → heading`), not arbitrary string replacements, and its API doesn't lend itself to user-configured pairs. Custom plugin is cleaner.

## Phase 1 — Server changes

### 1.1 Migration

Add `migrations/scripts/2026-05-XX-add-text-replacement-rules.ts` creating the table and indexes above. Per [CLAUDE.md → Writing migrations](CLAUDE.md):

- Add a pretty-label entry to [prettify.ts](lib/startup/prettify.ts) — e.g. *"Building the autocorrect ledger."*
- No loop, no `reportProgress` needed (single `CREATE TABLE`).
- List in [scripts/index.ts](migrations/scripts/index.ts).

Update [DDL.md](docs/developer/DDL.md) with the new table.

### 1.2 Repository

Create `lib/database/repositories/text-replacement-rules.repository.ts` extending `BaseRepository`. Methods:

- `list({ enabledOnly?: boolean }): TextReplacementRule[]`
- `getById(id: string): TextReplacementRule | undefined`
- `create(input: TextReplacementRuleInput): TextReplacementRule`
- `update(id: string, patch: Partial<TextReplacementRuleInput>): TextReplacementRule`
- `delete(id: string): void`
- `bulkReplace(rules: TextReplacementRuleInput[]): TextReplacementRule[]` — for the import path; truncates and reinserts in a transaction.

Conflict check: `create` and `update` must reject inserts that would create a `(fromText, caseSensitive)` duplicate. Throw a typed error that the route translates to 409.

Add to [repositories/index.ts](lib/database/repositories/index.ts).

### 1.3 Zod types

Add to `lib/schemas/text-replacement.types.ts`:

```ts
export const TextReplacementRuleSchema = z.object({
  id: z.string().uuid(),
  fromText: z.string().min(1).max(100).refine(v => v === v.trim(), 'no leading/trailing whitespace'),
  toText: z.string().min(1).max(1000),
  caseSensitive: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TextReplacementRuleInputSchema = TextReplacementRuleSchema.pick({
  fromText: true,
  toText: true,
}).extend({
  caseSensitive: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
```

Lengths picked to be loose-but-bounded: 100-char trigger, 1000-char output. The 1000-char ceiling lets users wedge in a paragraph-sized boilerplate ("standard scene-break") without giving them a DOS vector on the rule list.

### 1.4 Add the master toggle to chat settings

Extend [settings.types.ts:364](lib/schemas/settings.types.ts:364):

```ts
/** Whether user-defined text-replacement rules fire in the Salon composer and Document Mode editor (default: true) */
textReplacementsEnabled: z.boolean().default(true),
```

Wire through [chat-settings.repository.ts](lib/database/repositories/chat-settings.repository.ts), the route's PATCH validator at [route.ts:173](app/api/v1/settings/chat/route.ts:173), the destructure at [route.ts:241](app/api/v1/settings/chat/route.ts:241), and the response shape at [route.ts:266](app/api/v1/settings/chat/route.ts:266). Mirror exactly how `composerSpellcheck` is plumbed.

### 1.5 New API route

`/api/v1/settings/text-replacements` — `createContextHandler` + `withCollectionActionDispatch`.

- `GET` (no action) → list all rules.
- `POST` (no action) → create one.
- `POST?action=bulk-replace` → replace the whole list (for import).
- `PATCH /:id` (item route at `/api/v1/settings/text-replacements/[id]`) → update one.
- `DELETE /:id` → delete one.

Use the response helpers from `@/lib/api/responses` (`successResponse`, `badRequest`, `notFound`, the new `conflict` if there isn't one — fall back to `errorResponse(409, ...)`).

Debug-log every CRUD operation through the existing logger (per CLAUDE.md "every new feature… debug logs being fired").

### 1.6 Export / import

Per the [feedback_export_import](~/.claude/projects/-Users-csebold-source-quilltap-server/memory/feedback_export_import.md) note, the rule list needs to be in:

- `.qtap` export (full backup)
- `.qtap` import path (round-trip)
- [public/schemas/qtap-export.schema.json](public/schemas/qtap-export.schema.json)
- The backup CLI (`npx quilltap db backup` already snapshots the SQLCipher file wholesale, so no change there — but any logical/JSON export path needs an explicit branch).

SillyTavern export does **not** need to include these — they're a Quilltap-specific concept with no counterpart.

## Phase 2 — Renderer changes

### 2.1 SWR hook for rules

Create `lib/text-replacement/useTextReplacementRules.ts`:

```ts
export interface CompiledRules {
  caseSensitive: Map<string, string>;
  caseInsensitive: Map<string, string>;
  empty: boolean;
}

export function useTextReplacementRules(): {
  rules: TextReplacementRule[] | undefined;
  compiled: CompiledRules;
  isLoading: boolean;
};
```

The hook fetches `/api/v1/settings/text-replacements` via SWR, memoises a `CompiledRules` object (two maps for O(1) lookup), and returns both the raw list (for the settings UI) and the compiled form (for the plugin). Empty/loading states resolve to `compiled.empty === true` so the plugin can short-circuit.

### 2.2 The Lexical plugin

Create `components/chat/lexical/plugins/TextReplacementPlugin.tsx`. Behaviour matches the spec in **Architecture → Lexical plugin behaviour** above. Takes no props — reads `useTextReplacementRules()` + `useSWR('/api/v1/settings/chat')` internally.

Test coverage (Jest, in `components/chat/lexical/plugins/__tests__/TextReplacementPlugin.test.tsx`):

- Case-sensitive match fires.
- Case-insensitive match fires when no case-sensitive rule exists.
- Case-sensitive rule wins over case-insensitive rule for the same trigger.
- No match → no replacement.
- Replacement is undone in one Cmd-Z step.
- IME composition skips the plugin.
- Disabled (`textReplacementsEnabled = false`) skips the plugin.
- Trigger inside a word does not fire (e.g. `Marisa` should not match the rule `Aris → Aristarchus`).
- Pasting text containing a trigger does not fire (paste path doesn't go through `KEY_DOWN_COMMAND`).

### 2.3 Mount the plugin in both surfaces

- [LexicalComposerWrapper.tsx](components/chat/lexical/LexicalComposerWrapper.tsx): add `<TextReplacementPlugin />` inside `ComposerPlugins`, alongside the other plugin tags around line 123.
- [DocumentPane.tsx](app/salon/[id]/components/DocumentPane.tsx): add `<TextReplacementPlugin />` inside `DocumentEditorPlugins`.

### 2.4 Settings UI

New component `components/settings/chat-settings/TextReplacementSettings.tsx`, mounted on the Chat tab beneath `ComposerSpellcheckSettings`. Two parts:

1. **Master toggle** for `textReplacementsEnabled` — same visual shape as the spellcheck toggle. Helper text: *"Replaces literal words as you type. Pure word-boundary matching; one Cmd/Ctrl+Z reverts a replacement."*
2. **Rule table** — small editable list with columns `Trigger | Replacement | Case-sensitive | Enabled | (delete)`. A footer "Add rule" button appends a draft row. Each row saves on blur or Enter; deletes are confirmed inline.

Bonus row at the top of the table: a one-line "Try it" textarea where the user can type to see their rules fire. Helps debug rules in isolation. Optional for v1 — flag it if pressed for time.

Extend [useChatSettings.ts](components/settings/chat-settings/hooks/useChatSettings.ts) with `textReplacementsEnabled` plumbing matching the spellcheck pattern. Rule CRUD does **not** flow through `useChatSettings` — it owns its own SWR cache via `useTextReplacementRules`.

### 2.5 Help docs

Per CLAUDE.md, all user-visible changes go in `help/*.md`. Add a section to the Chat-tab help file describing:

- What text replacement does (and what it doesn't — no snippet expansion, no regex).
- The Cmd-Z behaviour.
- That pasted text isn't transformed.
- How to add / edit / disable rules.

Standard frontmatter: `url` pointing to `/settings?tab=chat&section=text-replacements`, and an "In-Chat Navigation" section with the matching `help_navigate(url: "...")` call. Steampunk + Wodehouse voice.

### 2.6 Changelog

Top entry in [docs/CHANGELOG.md](docs/CHANGELOG.md), plain American English (per the [feedback_changelog_writing_style](~/.claude/projects/-Users-csebold-source-quilltap-server/memory/feedback_changelog_writing_style.md) override):

```
- Salon composer and Document Mode rich editor now apply user-defined text replacements on word boundaries (the cross-platform substitute for OS autocorrect). Rules are managed on the Chat settings tab; a master toggle silences the whole subsystem without losing the list. Pure literal-string matching, no snippets, no regex.
```

## Phase 3 — Verification

### Type checks

- `npx tsc` in the repo root (per CLAUDE.md, not `npm run build`).

### Manual verification

1. Open Salon, add a rule `Aris → Aristarchus the Wise` (case-insensitive). Type `Aris ` in the composer — text replaces to `Aristarchus the Wise `. Cmd-Z once — back to `Aris `. Cmd-Z again — back to nothing.
2. Repeat in Document Mode (rich Lexical, not source mode).
3. Toggle master switch off, type `Aris ` — no replacement. Toggle on — replacement returns. Rule list is preserved across the toggle.
4. Add a case-sensitive rule `URL → Uniform Resource Locator`. Type `URL ` → replaces. Type `url ` → no replacement (case-sensitive only).
5. Add a case-insensitive rule `dr → Doctor`. Type `Mr. Smith and dr ` → replaces. Type `Dread ` → does **not** replace (word-boundary, not substring).
6. Paste a block of text containing `Aris` somewhere mid-line — confirm the paste is left alone.
7. Try to add a second `aris` rule with `caseSensitive=false` — confirm the API returns 409 and the UI surfaces the conflict.
8. With a Chinese IME active (or any IME), type a composition that happens to look like a trigger — confirm the plugin doesn't fire.
9. Source-mode textareas: confirm rules don't fire (Markdown source view in DocumentPane, plain-text source view, MarkdownLexicalEditor source view).
10. Export the instance, blow it away, re-import — confirm rules survive the round trip.

### Automated tests

- Repository tests (Jest, in `lib/database/repositories/__tests__/text-replacement-rules.repository.test.ts`): CRUD, conflict rejection, `bulkReplace` atomicity.
- API tests for the new route (mirror an existing route test in `app/api/v1/__tests__/` or equivalent).
- Plugin tests as listed in **2.2**.

### Logs

- Server: confirm CRUD operations log through the existing logger at debug level.
- Renderer: a single `[text-replacement]` debug line per replacement is enough; the plugin runs on every keystroke and we don't need a log per keystroke.

## Open questions

- **Smart casing.** Should typing `Aris ` with rule `aris → aristarchus` produce `Aristarchus ` (preserve typed casing) or `aristarchus ` (verbatim)? V1 is verbatim — predictable and matches `from`/`to` semantics. Smart casing is a deferred refinement.
- **Em-dash / en-dash as boundaries.** Excluded in v1 because writers commonly type `—` mid-word in prose. Reconsider if users report missed replacements.
- **A "preview" / "try it" row in the settings UI.** Listed as bonus in 2.4. Cheap to add and disproportionately useful for debugging rules. Recommend including it in v1.
- **Whether to seed the table with a few example rules** ("teh → the", "recieve → receive", "soemthing → something"). Tempting as discoverability, but also a forever-maintenance burden and arguably patronising. Default to empty; the help doc shows examples instead.

## Deferred (for later layers)

- **Snippet expansion** (multi-line outputs, cursor positioning with `$|` markers, date/time macros, `;sig`-style triggers without word-boundary semantics).
- **Per-character / per-project rule scopes.** Useful for worldbuilding ("in *this* project, `Aris` always means the rival, not the hero"), but adds resolution-order complexity.
- **Regex rules.** Possibly never.
- **Import from macOS Text Replacements / TextExpander.** Possibly worth a one-shot CLI: `npx quilltap text-replacements import <plist|json>`.
- **Layer 2** — typeahead menus for `@`/`#`/`/` (still deferred).
- **Layer 3** — LLM ghost-text completion (still deferred).

## File-touch summary for Claude Code

**quilltap-server, server side:**
- `migrations/scripts/2026-05-XX-add-text-replacement-rules.ts` — new file.
- `migrations/scripts/index.ts` — register the migration.
- [lib/startup/prettify.ts](lib/startup/prettify.ts) — pretty-label entry.
- [docs/developer/DDL.md](docs/developer/DDL.md) — document the new table.
- `lib/schemas/text-replacement.types.ts` — new file.
- `lib/database/repositories/text-replacement-rules.repository.ts` — new file.
- [lib/database/repositories/index.ts](lib/database/repositories/index.ts) — register the repository.
- [lib/schemas/settings.types.ts](lib/schemas/settings.types.ts) — add `textReplacementsEnabled`.
- [lib/database/repositories/chat-settings.repository.ts](lib/database/repositories/chat-settings.repository.ts) — persist the new field.
- [app/api/v1/settings/chat/route.ts](app/api/v1/settings/chat/route.ts) — accept the new field.
- `app/api/v1/settings/text-replacements/route.ts` — new collection route.
- `app/api/v1/settings/text-replacements/[id]/route.ts` — new item route.
- Export/import plumbing (find by greping for where `composerSpellcheck` or other chat-settings fields are mentioned in export code) — include rules.
- [public/schemas/qtap-export.schema.json](public/schemas/qtap-export.schema.json) — extend.

**quilltap-server, renderer side:**
- `lib/text-replacement/useTextReplacementRules.ts` — new file.
- `components/chat/lexical/plugins/TextReplacementPlugin.tsx` — new file.
- [components/chat/lexical/LexicalComposerWrapper.tsx](components/chat/lexical/LexicalComposerWrapper.tsx) — mount the plugin.
- [app/salon/[id]/components/DocumentPane.tsx](app/salon/[id]/components/DocumentPane.tsx) — mount the plugin in `DocumentEditorPlugins`.
- `components/settings/chat-settings/TextReplacementSettings.tsx` — new file.
- [components/settings/chat-settings/hooks/useChatSettings.ts](components/settings/chat-settings/hooks/useChatSettings.ts) — plumb `textReplacementsEnabled`.
- [components/settings/chat-settings/types.ts](components/settings/chat-settings/types.ts) — add `textReplacementsEnabled`.
- The Chat-settings tab page component — mount `<TextReplacementSettings />`.
- `help/<chat-settings-file>.md` — new section.
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — top entry.

**No quilltap-shell changes.** This is pure renderer + server.
