# Taboo — instance-wide forbidden phrases

**Status:** Implemented (shipped 4.8-dev)
**Date:** 2026-08-05

> **Reading this doc:** the design below shipped as written. Two details differ
> from the plan and the code is authoritative: `setTabooSettings` **returns**
> the normalized settings (so the PUT route echoes what was stored rather than
> what was submitted), and the settings card wires **Enter explicitly** via
> `onKeyDown` instead of relying on the form's implicit submission.

## Summary

A per-instance list of phrases that characters must never say — the stock LLM-isms of the day ("that's not nothing", "weight-bearing", …). The list is maintained on **Settings → Chat**, stored as a single JSON value in `instance_settings`, and rendered as a universal, character-independent, cache-stable section of the system prompt on every conversational character response.

## Goals

- One list per instance, editable in the UI (Settings → Chat tab).
- Stored as one string value holding a JSON array of strings.
- Injected into the system prompt for **conversational character responses only** — the main Salon turn, regenerate/swipe, and autonomous-room turns.
- Byte-stable rendering so it lives inside the cacheable prompt prefix and never breaks provider prompt caching.
- Exported/backed up with the instance (portable setting).

## Non-goals (this iteration)

- Per-character or per-chat overrides.
- Regex/pattern matching or per-phrase replacement hints (see Future work).
- Coverage of Carina queries, the character-voiced announcer, help chat, or Brahma Console (see Scope decisions).

---

## Design decisions

### Storage: `instance_settings`, not `chat_settings`

The user-visible home is the Chat tab, but the value is instance-scoped, so it goes in the `instance_settings` key/value table — exactly like `dataRetention`, which already has a card on the Chat tab. This costs **no migration** (the table is key/value; absence falls back to the default) and gets `.qtap` export and full-backup coverage automatically via `listPortableInstanceSettings()`.

### Value shape: object wrapping the array

Every JSON-valued instance setting is an object, and the merge-PUT route pattern depends on that. So the stored value is a single string field holding JSON, per the requirement, shaped:

```json
{ "phrases": ["that's not nothing", "weight-bearing"] }
```

```ts
// lib/schemas/settings.types.ts
export const TabooSettingsSchema = z.object({
  phrases: z
    .array(z.string().trim().min(1).max(200))
    .max(500)
    .default([]),
});
export type TabooSettings = z.infer<typeof TabooSettingsSchema>;
```

The setter normalizes on write: trim, drop empties, case-insensitive dedupe, **preserve user order** (order only changes when the user edits, which is a legitimate cache invalidation; sorting would just take control away from the user).

### Portability

Portable (exported and restored). Do **not** add the key to `NON_PORTABLE_INSTANCE_SETTING_KEYS` — new keys are portable by default, so nothing to do beyond not opting out. No `qtap-export.schema.json` change needed: instance settings export as opaque `{key, value}` pairs.

### Prompt placement

The section is appended in `buildSystemPrompt()` (`lib/chat/context/system-prompt-builder.ts`) **immediately after `MATH_FORMATTING_INSTRUCTION` (line ~281) and before `toolInstructions`**. Rationale:

- It stays inside **system block 1**, the cacheable prefix (the Anthropic plugin puts the `cache_control` breakpoint on block 1 only; OpenAI-style keying via `buildCharacterCacheKey` also hashes over it).
- It keeps universal, stable material contiguous, with the genuinely per-turn `toolInstructions` last — matching the existing precedent of the math-formatting note.
- We deliberately do **not** put it at the very front of block 1: the "You are {{char}}" identity anchor holding the first tokens is a documented, load-bearing choice (comment at `system-prompt-builder.ts:85`).
- We deliberately do **not** put it in `buildIdentityStack()`: Carina calls that directly and would silently inherit it.

**Empty list ⇒ no section at all.** No header, no blank block. Instances that never touch the feature produce byte-identical prompts to today (and the golden prompt hash for the empty case is unchanged).

### Plumbing: read async, pass sync

`buildSystemPrompt` is synchronous and must stay that way (two sync call sites plus the determinism test). The caller `buildContext()` (`lib/chat/context-manager.ts`) is async and already reads instance settings (`getMemoryRecallSettings` at ~line 1248). So:

1. `buildContext()` awaits `getTabooSettings()` before the `buildSystemPrompt` call at ~line 778.
2. It passes the phrases (or the pre-rendered section string) into `buildSystemPrompt` via a new optional field on `BuildSystemPromptOptions`, e.g. `tabooPhrases?: string[]`.
3. Call sites that don't pass the option get no section — which is exactly the desired default for the announcer and any future sync caller.

### Scope decisions (which call sites get it)

| Call site | Gets Taboo? | Why |
|---|---|---|
| Main Salon turn (orchestrator → `buildMessageContext` → `buildContext`) | **Yes** | The core case. |
| Regenerate / swipe (`regenerate-swipe.service.ts`) | **Yes** | Same chain, still a conversational response. |
| Autonomous rooms (`autonomous-room-turn.ts` → orchestrator) | **Yes** | Inherits automatically via the same chain. |
| Character-voiced announcer (`lib/services/announcer/character-voiced.ts`) | No (default) | Sync call site; doesn't pass the new option. Short generated announcements; revisit if clichés show up there. |
| `self_inventory` tool (`lib/tools/handlers/self-inventory/builders.ts`) | No (default) | Introspection/reporting; minor fidelity gap vs. the real prompt, acceptable. Note it in the handler comment. |
| Carina (`carina.service.ts`, uses `buildIdentityStack` directly) | No | Deliberately minimal, cost-sensitive calls. Future work if Carina answers exhibit the clichés. |
| Help chat, Brahma Console, memory extraction, image prompts, optimizer | No | Separate builders / not character speech. |

### Cache bookkeeping

- Regenerate the golden hash in `__tests__/unit/cache-determinism/system-prompt.test.ts` only if the empty-list case changes it (it shouldn't, since empty ⇒ omitted); add a new golden case **with** phrases.
- Bump `PROMPT_CACHE_STRUCTURE_VERSION` in `lib/llm/cache-key.ts` — the documented bump policy names "the system-prompt builder layout", and the bump is cheap.
- The rendered section is deterministic: fixed template + stored phrase order. It must **not** pass through `processTemplate` — user phrases could contain `{{...}}` and must be used literally (verify the joined prompt isn't template-processed downstream of the builder; the math note sets the template-free precedent).

---

## The prompt section

### Design rationale

A bare list of banned phrases has three known failure modes, and the template below addresses each:

1. **The pink-elephant effect.** Printing the exact forbidden tokens into every context raises their salience; weaker models parrot what they've just read. Mitigations: frame the phrases as *worn-out clichés beneath the character* (an aversive frame, not a neutral mention), keep the section compact, and forbid referencing the list itself (otherwise characters joke about "the phrases I'm not allowed to say").
2. **Prohibition without an alternative.** "Never say X" leaves a vacuum the model refills with X's nearest neighbor. Pairing the ban with a positive instruction — say the underlying thing in plain, specific words — reliably outperforms prohibition alone.
3. **Literal-string dodging.** Banning only the exact string invites trivial variants ("load-bearing", "that's hardly nothing"). A blanket preamble extends each entry to its inflections, rewordings, and near-variants, so entries stay simple bare phrases while the coverage generalizes. (This replaces hand-writing variant lists per entry, which the settings UI can't ask users to do.)

Voice: the codebase's character sections are second-person ("You are {{char}}…"), and its one existing universal section (`MATH_FORMATTING_INSTRUCTION`) uses a bracketed all-caps tag with imperative voice. The Taboo section follows the universal-section precedent — bracketed tag, imperative, addressed to the speaker.

### Template

Module-level constant in `system-prompt-builder.ts`, phrases interpolated as plain markdown bullets in stored order:

```markdown
[STYLE: FORBIDDEN PHRASES]
The phrases below are worn-out clichés, beneath you. They never appear in anything you say — not verbatim, and not as inflections, rewordings, or near-variants of the same formula. When one of them would be the easy thing to reach for, say what you actually mean in plain, specific words instead. Never mention, quote, or allude to this list.
- "that's not nothing"
- "weight-bearing"
```

Rendering rules:

- Each phrase renders as `- "<phrase>"` — double quotes, no escaping beyond what markdown needs (none in practice).
- Empty list ⇒ the entire section (tag included) is omitted.
- No `{{...}}` template processing anywhere in this section.

---

## Implementation steps

### 1. Settings layer

- [ ] `lib/schemas/settings.types.ts` — add `TabooSettingsSchema` + `TabooSettings` type, with the doc-comment block style used by `DataRetentionSettingsSchema` (documents storage location + accessor names).
- [ ] `lib/instance-settings/index.ts` —
  - `KEY_TABOO = 'taboo'` in the key-constants block (~line 30).
  - `DEFAULT_TABOO_SETTINGS: TabooSettings = { phrases: [] }`.
  - `getTabooSettings()` / `setTabooSettings()` following the `dataRetention` pair exactly (read: parse-or-default with the `[InstanceSettings]` warn log; write: `Schema.parse` then stringify the parsed value). The setter additionally trims, drops empties, and dedupes case-insensitively before parse.
  - Re-export the schema + type at the bottom of the module.
  - Debug logs on read/write per the logging rule.

### 2. API route

- [ ] `app/api/v1/settings/taboo/route.ts` — `GET` + `PUT`, modeled line-for-line on `app/api/v1/settings/data-retention/route.ts`: `createContextHandler`, merge-then-`safeParse` on PUT (partial PUTs merge over stored value), `successResponse(settings)` / `validationError(...)`.
- [ ] `docs/developer/API.md` — document both verbs next to the data-retention entries (~lines 448/460).

### 3. UI (Settings → Chat)

- [ ] `lib/query/keys.ts` — add `settings.taboo` to the query-key factory.
- [ ] `components/settings/chat-settings/TabooSettings.tsx` — new card component, self-contained fetch like `DataRetentionSettings.tsx` (instance-scoped settings don't ride the `useChatSettings` chat-settings blob):
  - `useQuery({ queryKey: queryKeys.settings.taboo, queryFn: ({ signal }) => apiFetch<TabooSettings>('/api/v1/settings/taboo', { signal }) })`.
  - Editing UI: add-input (Enter or an Add button) + removable pill/row list, following the in-settings list precedent of `TextReplacementSettings.tsx` and the pill styling of the Aliases editor (`CharacterBasicInfo.tsx:219-247`). No comma-separated input — phrases can contain commas.
  - Each add/remove PUTs the whole `phrases` array, then `setQueryData` + success toast (`lib/toast.tsx`), matching `DataRetentionSettings`' commit-and-toast pattern.
  - `qt-input` / `qt-button-primary` / `qt-settings-shell` classes; no new Tailwind one-offs.
  - Card copy in the Quilltap voice (e.g. *"Phrases the household has agreed never to utter — strike the tired ones from every tongue in the establishment."*).
- [ ] `components/settings/tabs/ChatTabContent.tsx` — mount in a `<CollapsibleCard title="Taboo" sectionId="taboo" forceOpen={activeSection === 'taboo'}>` alongside the other cards; deep link `/settings?tab=chat&section=taboo` then works for free via `useSettingsSection` + `CollapsibleCard`.
- [ ] `components/settings/chat-settings/README.md` — add the new section file to the folder docs.

### 4. Prompt integration

- [ ] `lib/chat/context/system-prompt-builder.ts` —
  - `TABOO_SECTION_HEADER` / template constant with a doc comment explaining the pink-elephant framing (so nobody "simplifies" it into a bare list later).
  - Export `renderTabooSection(phrases: string[]): string | null` (null when empty) so it's unit-testable in isolation.
  - New optional `tabooPhrases?: string[]` on `BuildSystemPromptOptions`; push the rendered section after `MATH_FORMATTING_INSTRUCTION`, before `toolInstructions`.
- [ ] `lib/chat/context-manager.ts` — in `buildContext()`, await `getTabooSettings()` alongside the existing instance-settings read and pass `tabooPhrases` into the `buildSystemPrompt` call (~line 778). Debug-log the phrase count when non-empty.
- [ ] `lib/llm/cache-key.ts` — bump `PROMPT_CACHE_STRUCTURE_VERSION`.
- [ ] Verify the assembled system prompt is not template-processed after the builder (phrases must be literal).

### 5. Docs & help

- [ ] `help/taboo.md` — new help doc, Quilltap voice, frontmatter `url: /settings?tab=chat&section=taboo`, ending with the In-Chat Navigation section whose `help_navigate(url: "/settings?tab=chat&section=taboo")` matches. (The context resolver auto-prefers the more specific URL over the generic chat-settings doc; no registry to edit.)
- [ ] `help/chat-settings.md` — add a `### Taboo` block under "Understanding Chat Settings Sections".
- [ ] `docs/developer/DDL.md` — add the `taboo` key to the `instance_settings` key list (~line 1335).
- [ ] `docs/CHANGELOG.md` — plain-voice entry.
- [ ] Consider a Glossary line in `CLAUDE.md` only if the feature grows a personified identity; plain "Taboo" needs none.

### 6. Tests

- [ ] `__tests__/unit/lib/instance-settings/taboo.test.ts` — defaults on absence, corrupt-value fallback, setter normalization (trim/dedupe/order preserved), round-trip. Copy the data-retention suite.
- [ ] `__tests__/unit/app/api/v1/settings/taboo/route.test.ts` — GET defaults, PUT merge + validation errors. Copy the data-retention route suite.
- [ ] Prompt-builder unit tests — `renderTabooSection`: empty ⇒ null; phrases render in order with quotes; section lands between the math note and tool instructions in `buildSystemPrompt`; omitted when the option is absent (announcer / self-inventory paths).
- [ ] `__tests__/unit/cache-determinism/system-prompt.test.ts` — confirm the empty-list golden hash is unchanged; add a with-phrases golden case (regenerate via `UPDATE_GOLDEN_PROMPT_HASH=1` if the harness needs it).
- [ ] `__tests__/unit/lib/instance-settings/portable-settings.test.ts` — confirm the new key is treated as portable (adjust the guard fixture if it enumerates keys).
- [ ] Component test for `TabooSettings.tsx` with `renderWithQuery`.

---

## Future work

- **Per-phrase replacement hints** — extend entries to `{ phrase, instead? }` so the section can render "…instead, say X". The object-wrapped schema makes this a backward-compatible extension.
- **Carina coverage** — if Carina answers exhibit the clichés, pass the rendered section into her hand-built prompt in `carina.service.ts` (she bypasses `buildSystemPrompt` by design).
- **Announcer coverage** — thread the option through `character-voiced.ts` if wardrobe/announcement text starts tripping the list.
- **Detection/reporting** — a post-response check that flags when a taboo phrase slipped through (out of scope; would pair well with The Concierge).
