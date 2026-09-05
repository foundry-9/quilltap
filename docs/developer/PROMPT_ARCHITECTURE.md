# Prompt Architecture

How Quilltap turns a character, a chat, and a moment into the messages a provider actually receives.

The short version: **the system prompt is a stable, cacheable block of character identity, and everything that changes turn to turn is delivered as a message in the transcript.** That split is the whole design. It replaced an older architecture in which a dozen dynamic blocks (scenario, roster, wardrobe, project context, memories, summary, timestamp) were concatenated into one system prompt on every turn — which meant every prompt-cache prefix was invalidated by every scene change, and the user could never see what the model had been told.

---

## 1. The governing principle

Two rules explain nearly every decision in this subsystem:

1. **If it is stable for a character, it goes in the system prompt.** Identity, base prompt, manifesto, personality, aliases, pronouns, appearance, example dialogue. This region is compiled once per participant and cached (`chats.compiledIdentityStacks`), and providers keep it warm across turns.
2. **If it varies with the moment, a member of the Staff says it out loud in the transcript.** Scenario, who joined, who went silent, what time it is, what the character is wearing, what they remember, what the project is, what letters arrived. These are real chat messages with a `systemSender`, visible to the user in the Salon with the speaking feature's avatar, and delivered to the model as ordinary conversation history.

Rule 2 buys three things at once: prompt-cache stability (dynamic content lives *after* the cache breakpoint, not inside the prefix), user visibility (nothing is whispered to the model that the operator cannot read), and natural recency (the model treats "the Host notes it is now half past nine" as an event in the scene, not as a standing instruction).

**Do not add turn-variable content to the system prompt.** That is the one change most likely to look like an improvement and quietly cost a large fraction of the cache-hit discount.

---

## 2. What the model actually receives

For one Salon turn, in wire order:

| # | Role | Content | Varies |
|---|---|---|---|
| 1 | `system` | **Identity stack** + roleplay template + math-notation note + Taboo section + standing instructions (project/group) + tool instructions + tool reinforcement | Per character (cacheable prefix) |
| 2 | `system` | **Identity reminder** — fully static "you are {{char}} and only {{char}}" | Character name only |
| 3 | `system` | **Compressed-history block** — the rolling summary, only when budget compression fired | Every few turns |
| — | `system` | Agent-mode instructions, when agent mode is on (inserted after the system group) | Rare |
| 4 | `user`/`assistant` | **Conversation history**, attributed by `name`; Staff whispers re-roled to `user`; a cache breakpoint on the first surviving Librarian summary | Every turn |
| 5 | `user` | Host **off-scene character introduction**, when a workspace character was just name-dropped for the first time | Rare |
| 6 | `user` | Host **timestamp** whisper, when `autoPrepend` mode fires | Per cadence |
| — | `system` | Tool-change notice, when the user just changed the tool slate (inserted before the last user message) | Rare |
| 7 | `user` | **New user message**, plus trailing per-turn sections (see §7) and any attachments | Every turn |
| 8 | `assistant` | Multi-character anchor `[Name]` prefill — **non-Anthropic providers only** | Multi-character |

Blocks 1–3 are emitted as separate system messages precisely so their cache lifetimes are independent: the persona prefix does not get invalidated when the rolling summary is refolded.

**Local providers see them folded into one.** A local runtime applies the *model's own* chat template, and the Qwen family — plus several Llama- and Gemma-derived templates — raises an exception on any system message after index 0, rejecting the whole request. So the Ollama and OpenAI-Compatible request builders fold the leading `system` run into a single message at request-build time, joining the contents with a blank line (`collapseLeadingSystemMessages` in `@quilltap/plugin-utils`; `OpenAICompatibleProvider.acceptsRepeatedSystemMessages`, which defaults to `true`). Nothing about the assembly above changes, and no hosted provider's bytes or cache breakpoints move — see [bug 82](bugs/fixed/bug-82-three-leading-system-messages.md). A new local provider must opt into the same fold; a new hosted one must not.

On Anthropic, step 8 is impossible (Sonnet 4.6+ rejects a trailing `assistant` message — "does not support assistant message prefill"), so the multi-character anchor is appended to block 1 as prose instead. The same constraint is why every Staff whisper reaching the model is re-roled to `user`.

---

## 3. The identity stack — `buildIdentityStack()`

`lib/chat/context/system-prompt-builder.ts`. Blocks, in order, each omitted when empty:

1. `## Character Identity` — "You are {{char}}. Everything that follows defines who you are…"
2. **Base system prompt** — the participant's `selectedSystemPromptId`, falling back to the character's `isDefault` prompt, falling back to nothing.
3. `## Character Manifesto` — `character.manifesto`, under the wrapper "The following you hold as true about yourself, without question."
4. `## Character Personality` — `character.personality`, under the wrapper "The following is what you know about yourself. Others do not see it unless you show them."
5. `## Character Aliases` — "You also go by: …"
6. `## Character Pronouns` — "Your pronouns are subject/object/possessive. Use them whenever you refer to yourself in narration…"
7. `## Physical Appearance` — "This is how you look — …": the selected physical description (`shortPrompt` → `mediumPrompt` → `longPrompt` → `completePrompt` → `fullDescription`, first non-empty), with its usage-context note. The wrapper is second person; the body stays noun phrases because it is shared with the image pipelines.
8. `## Example Dialogue Style` — `character.exampleDialogues`, under the wrapper "This is how you speak."

Joined with `\n\n`. `{{char}}`, `{{user}}`, `{{scenario}}`, `{{persona}}` are resolved **here**, at compile time.

Every block addresses the character in the second person — same register as the preamble — and the author-carried fields (3, 4, 8) get referent-fixing wrappers rather than any policing of the author's own person. Outward-facing renderers (§8's identity cards, Host whispers) stay third person: their referent is someone other than the reader. Design: [prompt-person-consistency](features/complete/prompt-person-consistency.md). **Any edit that changes this function's output must bump `IDENTITY_STACK_BUILDER_VERSION` (same file) and register a golden in `__tests__/unit/cache-determinism/system-prompt.test.ts`** — CI fails in both directions if you forget (see §6).

### What is deliberately *not* in the stack

- **`description`** — the acquaintance-level vantage point. It reaches the model through `{{description}}` if the base prompt uses it, through the Host's join announcement, and through other characters' identity cards — but it is not pushed as its own block.
- **`identity`** — the strangers-know vantage point. It exists for *other* characters' view of this one (see §8), not for the character's own prompt.
- **`scenario`** — the chat's scenario is announced by the Host at chat start and lives in history. It only feeds `{{scenario}}` here.
- **`title`** — the private framing; never sent.
- **`firstMessage`** — written into the transcript at chat creation, not into the prompt.

See the character-fields glossary in [CLAUDE.md](../../CLAUDE.md) before moving any of these; the four vantage points are not interchangeable.

## 4. The per-turn wrapper — `buildSystemPrompt()`

Same file. Takes the identity stack (precompiled or freshly built) and appends, in order:

1. **Roleplay template** — the chat's `roleplayTemplateId`, inherited from project default → user default on first use and then persisted onto the chat (`getRoleplayTemplate` in `lib/services/chat-message/participant-resolver.service.ts`). Template-processed.
2. **Math-notation note** — universal, template-free. The Salon renders KaTeX only for `$$…$$`; single-`$` is deliberately disabled so prose like "$50 … $20" is not eaten as math. Without this note models reach for `$x$` or `\(x\)` and their formulas render as literal text.
3. **Taboo section** — the instance-wide forbidden-phrase list (`instance_settings['taboo']`, Settings → Chat → Taboo). Read asynchronously by the caller and handed down, because this builder is synchronous by design. An empty list emits nothing at all, byte-for-byte. Phrases are emitted verbatim and never template-processed — a user phrase may legitimately contain `{{…}}`. The preamble's wording is load-bearing; read the comment on `TABOO_SECTION_PREAMBLE` before editing it.
4. **Standing instructions** — the chat's project `instructions` plus the `instructions` of every group the *responding character* belongs to (`lib/chat/context/standing-instructions.ts`), resolved async by the caller like Taboo and rendered `[STANDING INSTRUCTIONS]` → one headed block per source, groups sorted by name for cache determinism. Stable per character per chat — it changes only when a project/group is edited or a membership changes — which is why it may live in the cacheable prefix even though project *context* (description, store roster) was deliberately moved out to Prospero whispers in Phase E: the whisper content is turn-variable, instructions are not. Empty emits nothing, byte-for-byte. Unlike Taboo the section IS template-processed (`{{char}}`/`{{user}}`), matching the roleplay-template precedent. Help and Brahma chats never see it (separate builders); Carina one-off queries mirror it (see §13).
5. **Tool instructions** — native tool rules, simple-JSON instructions, or text-block instructions, selected per turn by the orchestrator from the resolved tool mode.
6. **Tool reinforcement** — one line, only when tools are present, second person like everything above it: "*When you use workspace tools, you CALL them — you do not merely describe calling them.*"

The `{{timestamp}}` template variable is populated here **only** when `timestampConfig.autoPrepend` is false; the auto-prepend path is a Host whisper instead.

## 5. Identity reinforcement — block 2

`buildIdentityReinforcement(characterName)` emits a fully static "you control only {{char}}, never write another participant's turn, do not prefix your reply with your own name" block.

It deliberately **does not name the other participants**. An inline roster is exactly the turn-variable content that bisects a cache prefix; the model already knows who is present from Host roster announcements in history and from per-message `name` attribution. Keep it static.

## 6. Compiling and caching the stack

`lib/services/system-prompt-compiler/compiler.ts` builds the identity stack for every LLM-controlled CHARACTER participant and stores it on `chats.compiledIdentityStacks` (column added by `migrations/scripts/add-compiled-identity-stacks-field.ts`, see [DDL.md](DDL.md)). Since 4.9 the stored value is a **stamped envelope** `{ version, stacks: { participantId → stack } }`, where `version` is `IDENTITY_STACK_BUILDER_VERSION` (colocated with `buildIdentityStack`). Reads require strict version equality — absent, legacy bare-map, older, *and newer* (downgrade) all read as "nothing cached" and rebuild lazily through the read-through fallback; a stale map is discarded on merge, never blended into. Bumping the constant is how a wording change in the builder reaches every existing chat, with no migration.

**Invalidation hooks** — the only places that recompile:

| Event | Call |
|---|---|
| Chat created | `compileAllIdentityStacks` |
| Participant added / reactivated | `compileIdentityStackForParticipant` |
| Participant `selectedSystemPromptId` changed | `compileIdentityStackForParticipant` |
| Chat `scenarioText` changed | `compileAllIdentityStacks` |
| Chat merge brings a participant across | `compileIdentityStackForParticipant` |

**Edits to the character record itself do not invalidate anything.** Renaming a character or rewriting their personality does not fan out across their chats; that fan-out is an unbuilt design pass. Correctness is preserved by the **read-through fallback**: when the cached entry is missing or empty, `buildSystemPrompt` rebuilds from current data for that turn and does not persist it. So a stale entry is a stale *prompt*, not a broken one — worth knowing when a character edit appears not to take effect in an existing chat.

Compiler failures never propagate: a cache write that fails logs and returns, and the fallback covers it.

## 7. Provider prompt caching

Two independent mechanisms:

- **Cache key** (`lib/llm/cache-key.ts`) — `quilltap:char:<characterId>:v<N>`, keyed per **character**, not per chat, because the persona block is what forms the prefix. Providers apply it differently: `prompt_cache_key` (OpenAI, Grok), `user_id` (DeepSeek's real KV isolation), `user` (OpenAI-compatible, Z.AI, OpenRouter), ignored (Anthropic, Ollama, Curl). Bump `PROMPT_CACHE_STRUCTURE_VERSION` when the *structure* changes — tool-schema shape, system-prompt layout, persona-block format — not for wording edits. Design: [per-character-prompt-caching.md](features/complete/per-character-prompt-caching.md).
- **Content breakpoints** (Anthropic) — `ContextMessage.cacheControl` marks the first surviving Librarian summary whisper in the selected history, so system + tools stay hot across summary folds and only the summary-and-after re-prefills.

## 8. Where the dynamic content went

Everything the old architecture concatenated into the system prompt now has a speaker. All of these are real messages with `systemSender` set (see the enum in `lib/schemas/chat.types.ts` — that is the authoritative list).

| Was a prompt block | Now says it | `systemKind` / trigger |
|---|---|---|
| Scenario | **The Host** | `postHostScenarioAnnouncement` at chat start |
| "You are talking to X" | **The Host** | `postHostUserCharacterAnnouncement` at chat start |
| Multi-character roster, joins, departures, status | **The Host** | `add` / `remove` / `status-change`; join announcements carry the character's vault `identity.md`, falling back to `description` |
| Silent-mode rule | **The Host** | `postHostSilentModeAnnouncement` |
| Timestamp | **The Host** | `timestamp`, on the `autoPrepend` cadence |
| Off-scene character cards | **The Host** | First time a non-participant workspace character is name-dropped in real dialogue; idempotent via `hostEvent.introducedCharacterIds` |
| Project context, general shelf | **Prospero** | Chat start, then every `projectContextReinjectInterval` messages. Carries description + store roster only — `project.instructions` moved into the standing-instructions block of system block 1 (§4) and is deliberately absent from the whisper |
| Group stores / personal vault | **Prospero** | Targeted whisper to the responding character, same cadence |
| Current outfit, wardrobe, outfit changes | **Aurora** | Opening-outfit whisper; outfit-change whispers from the wardrobe job |
| Conversation summary | **The Librarian** | Rolling-summary fold |
| Memory recall, recap, inter-character memories, knowledge, scene state | **The Commonplace Book** | One consolidated whisper per turn, plus `relevant-conversations` and `retrospective-recall` |
| — (new) | **Aurora Core** | Core packet on a first / periodic / silence / context-transition cadence (`lib/chat/context/core-whisper-trigger.ts`) |
| — (new) | **Suparṇā** | New letters in the character's vault `Mail/` folder |

### Transcript body vs. LLM body

Staff writers populate **two** bodies in lockstep: `content` (persona-voiced, what the operator reads) and `opaqueContent` (persona-free). When any non-user character in the chat has `systemTransparency !== true`, the whole chat goes opaque-anywhere and every character's LLM context reads `opaqueContent ?? content`, so no character hears the Staff by name when a companion cannot. The user character does not count toward the test. The Salon UI always shows the full persona voicing. Swap point: `normalizeWhisperRoles` in `lib/services/chat-message/context-builder.service.ts`.

The same pass re-roles Staff messages from `ASSISTANT` to `USER` — they are inputs *to* the character, not utterances *from* it, and an assistant-role tail 400s on Anthropic. Whispers carrying attachments stay `ASSISTANT` so the Lantern image walker can still find them structurally.

### Whisper visibility

`targetParticipantIds` scopes a message: null/empty is public, otherwise only the sender and the targets see it — enforced in single-character context too, so a private aside cannot leak there. Consolidated Commonplace Book whispers are **stripped from LLM context entirely** (recall is recomputed each turn and inlined fresh; stale copies would just bloat the window). The `relevant-conversations` kind is exempt — it is posted on fold and intentionally persists.

## 9. Trailing per-turn sections

Recall reaches the model as plain second-person prose appended to the new user message, not as the persona-voiced whisper. `buildCommonplacePersonaWhisper` writes the transcript body ("*The Commonplace Book turns to the entries that bear on this moment…*"); `buildCommonplaceLLMContext` writes the model's ("*You remember the following entries that bear on this moment…*"). Same for the Core whisper and Suparṇā's mail.

Sections are appended to the new user message in this order, separated by `---`:

1. Aurora Core packet
2. Commonplace Book recall (scene state → recap → relevant memories → inter-character memories → knowledge → relevant past conversations → retrospective recall). The relevant-past-conversations section is present only when the instance-wide `memoryRecall.perTurnConversationSummaries` setting is on (off by default); otherwise that list reaches the character through the recap, the fold-posted `relevant-conversations` whisper, or the retrospective mini-recap.
3. Suparṇā mail
4. "Nothing to add" turn-skip note

On continue / nudge / chained autonomous turns there is no new user message, so the turn-skip note is pushed as its own trailing `user` message.

**Ordering constraint:** the Core whisper is computed and placed before the Commonplace Book whisper, on purpose. Identity grounds the speaker; memory then situates them. Reversed, recall floods identity and the character starts performing the person who had those experiences rather than being the person who grew from them. Do not reorder without reading the Core whisper design first.

## 10. Templates

`lib/templates/processor.ts`. SillyTavern-compatible `{{var}}` substitution; unknown variables resolve to empty string.

| Variable | Value |
|---|---|
| `{{char}}` | Character name |
| `{{user}}` | User character name, or `User` |
| `{{description}}` | Character description |
| `{{manifesto}}` | Character manifesto |
| `{{personality}}` | Character personality |
| `{{scenario}}` | Chat `scenarioText`, falling back to the character's first scenario |
| `{{persona}}` | User character's description |
| `{{system}}` | Resolved base system prompt |
| `{{mesExamples}}` / `{{mesExamplesRaw}}` | Example dialogues |
| `{{timestamp}}` | Formatted time — only on the non-`autoPrepend` path |
| `{{trim}}…{{/trim}}` | Strips surrounding newlines |
| `wiBefore` / `wiAfter` / `loreBefore` / `loreAfter` / `anchorBefore` / `anchorAfter` | Declared, always empty — no lorebook support yet |

Where substitution happens matters: identity-stack fields are resolved **at compile time** (so the cached stack is already substituted), while the roleplay template and tool instructions are resolved **per turn** in `buildSystemPrompt`. Taboo phrases are never processed.

`processCharacterTemplates` is the batch form, used for the first message at chat creation.

## 11. Character system prompts

```typescript
interface CharacterSystemPrompt {
  id: string
  name: string
  content: string
  isDefault: boolean
}
```

Selection order per participant: participant `selectedSystemPromptId` → the prompt flagged `isDefault` → none. Prompts are synced into the character's vault (`managed-fields.ts` → `buildSystemPromptFile`), edited under `/settings?tab=prompts` (`components/settings/prompts/`), and served by `/api/v1/characters/[id]/prompts`.

Starter prompts come from `SYSTEM_PROMPT` plugins, loaded by `lib/plugins/system-prompt-registry.ts` and addressed as `pluginShortName/promptName`. The bundled set ships in `plugins/dist/qtap-plugin-default-system-prompts/prompts/` as `MODEL_CATEGORY.md` (`CLAUDE_COMPANION.md`, `GPT5_ROMANTIC.md`, `GENERIC_COMPANION.md`, …). Third-party collections: [System Prompt Plugin Development Guide](./SYSTEM_PROMPT_PLUGIN_DEVELOPMENT.md).

## 12. The public identity card

`buildPublicIdentityCard(character, userName)` renders the **surface** view one character has of another: name, title, pronouns, aliases, and the `identity` field — falling back to `description`, then to an explicit "no public identity on record" line so a bare name is never handed over with no context.

It deliberately omits `personality` and `manifesto`, the private vantage points, so surfacing a card to a third party cannot leak what others are not meant to see. Used by Carina (telling the answerer who is consulting them) and by off-scene introductions.

`buildOtherParticipantsInfo` still exists and is still exported, but no longer feeds the system prompt — it serves the mentioned-characters scan and identity-reinforcement naming.

## 13. Other prompt paths

| Path | Builder | Shape |
|---|---|---|
| **Help chats** | `lib/help-chat/system-prompt-builder.ts` | Same identity preamble and identity reminder, plus a help-assistant role, page documentation context, and other help characters. No roleplay template, scene state, timestamps, Concierge, or project context. |
| **Brahma Console** | `lib/brahma-console/system-prompt-builder.ts` | Character-less neutral brief. No identity, no personality, no page context, no memories. Optional SQL-access section when `run_sql` is enabled. |
| **Carina** | `lib/services/carina/carina.service.ts` | `buildIdentityStack` + an explicit scenario section + the standing-instructions section (project + the answerer's groups, mirrored insertion) + a "Reference Query / Who Is Asking" section built from the asker's public identity card + the answerer's own memory recall. No conversation history — the isolation is the point. |
| **`self_inventory`** | `lib/tools/handlers/self-inventory/builders.ts` | Reconstructs the prompt for introspection, including standing instructions. Known fidelity gap: it omits the Taboo section a live turn carries. |
| **Character-voiced announcer** | `lib/services/announcer/character-voiced.ts` | `buildSystemPrompt` with no Taboo phrases and no standing instructions. |

## 14. Traps

- **`lib/chat/initialize.ts` is legacy.** Its private `buildSystemPrompt` still runs at chat creation and its output is written as a `role: SYSTEM` message at the head of the chat — but `buildConversationMessages` filters history down to `USER`/`ASSISTANT`/`TOOL`, so **that message never reaches the model**. It is an artifact. Do not "fix" a prompt by editing it, and do not delete it casually either — the chat-creation flow and its tests still depend on `buildChatContext` for the processed first message.
- **Character edits do not invalidate compiled stacks** (§6). Expect one stale turn's worth of confusion when debugging.
- **Nothing turn-variable belongs in system blocks 1–2** (§1, §5).
- **Do not reorder Core before/after Commonplace** (§9).
- **Cache-structure bumps are structural, not cosmetic** (§7).
- **Whisper role must end `user`.** Anthropic 4.6+ rejects an `assistant` tail; any new trailing injection has to follow the same pattern as the timestamp and off-scene pushes.

## 15. Key files

| File | Role |
|---|---|
| `lib/chat/context/system-prompt-builder.ts` | `buildIdentityStack`, `buildSystemPrompt`, `buildIdentityReinforcement`, `buildPublicIdentityCard`, `renderTabooSection` |
| `lib/chat/context/standing-instructions.ts` | Resolve + render project/group `instructions` for the standing-instructions section |
| `lib/services/system-prompt-compiler/compiler.ts` | Compile / cache / invalidate `chats.compiledIdentityStacks` |
| `lib/chat/context-manager.ts` | `buildContext` — budget, memory, knowledge, scene state, whisper emission, final message assembly |
| `lib/services/chat-message/context-builder.service.ts` | History filtering, whisper role normalization, opaque body swap, multi-character anchoring |
| `lib/services/chat-message/orchestrator.service.ts` | Tool mode + tool instructions, Prospero cadence, agent-mode and tool-change injections |
| `lib/chat/context/message-attribution.ts` | `name` attribution, history-access and presence-window filtering, whisper visibility |
| `lib/chat/context/compression.ts`, `lib/chat/context-summary.ts` | Budget compression and the Librarian rolling summary |
| `lib/chat/context/core-whisper-trigger.ts` | Aurora Core cadence |
| `lib/templates/processor.ts` | `processTemplate`, `buildTemplateContext`, `processCharacterTemplates` |
| `lib/llm/cache-key.ts` | Per-character provider cache key + structure version |
| `lib/plugins/system-prompt-registry.ts` | `SYSTEM_PROMPT` plugin registry |
| `lib/services/{host,prospero,aurora,librarian,commonplace,suparna,lantern,concierge}-notifications/` | Staff writers — persona body + opaque body per announcement |

## 16. See also

- [SYSTEM_FLOWCHARTS.md](SYSTEM_FLOWCHARTS.md) — turn-level flow diagrams
- [features/complete/per-character-prompt-caching.md](features/complete/per-character-prompt-caching.md)
- [features/complete/commonplace-whisper-overhaul.md](features/complete/commonplace-whisper-overhaul.md)
- [features/complete/carina.md](features/complete/carina.md)
- [features/complete/taboo.md](features/complete/taboo.md)
- [SYSTEM_PROMPT_PLUGIN_DEVELOPMENT.md](SYSTEM_PROMPT_PLUGIN_DEVELOPMENT.md)
