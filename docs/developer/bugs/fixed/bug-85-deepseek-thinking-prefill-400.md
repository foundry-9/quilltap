# Bug 85 — a DeepSeek thinking model 400s on every multi-character turn

| | |
|---|---|
| **Status** | **FIXED in v4** (2026-08-21) |
| **Fixed** | 2026-08-21 |
| **Found** | 2026-08-21 (incidentally, while verifying [bug 84](bug-84-tool-error-sentence-never-reaches-the-ui.md) on the V4test instance) |
| **Severity** | High — every turn after the greeting dies with an HTTP 500, and the chat is stuck at one message. Demoted from "no workaround": there **is** one, and it is one switch — turn off **Use `[Name]` prefill** on the connection profile. But nothing points the user at it, and the error text names `reasoning_content`, which is not where the problem is |
| **Who it bites** | anyone with a DeepSeek connection profile on a thinking-capable model, in any chat with at least one LLM character — which `isMultiCharacterChat` (`lib/chat/turn-manager/utils.ts:188-192`) counts as multi-character even with a single AI seat, so effectively **every** character chat. Observed on `deepseek-v4-flash` with `parameters: '{}'`: thinking is on by default server-side, so the user never opted in. Cheap-LLM jobs on the same profile (memory extraction, title generation, scene-state tracking) are unaffected — they apply no turn anchor |
| **Provenance** | v4's own. Not surfaced by the v5 port; found by a v4 dogfood turn |
| **Symptom** | toast: *Failed to generate response: 400 The `reasoning_content` in the thinking mode must be passed back to the API.* |
| **Defect site** | `lib/llm/multi-character-prefill.ts:37` — the hostility predicate is provider-shaped (`PREFILL_HOSTILE_PROVIDERS` holds `ANTHROPIC` only) when the property it is trying to capture is model-shaped, so `defaultMultiCharacterPrefill('DEEPSEEK')` returns `true` and `applyMultiCharacterTurnAnchor` (`lib/services/chat-message/context-builder.service.ts:556-562`) appends a trailing assistant `[Name]` message. DeepSeek's thinking mode reads that as "continue this assistant turn" and demands the `reasoning_content` that produced it — which a synthetic prefill has none of |
| **Fix site** | `lib/llm/thinking-turn.ts` (new — the pure evaluator), `lib/llm/multi-character-prefill.ts` (`defaultMultiCharacterPrefill(provider, runsThinkingTurn)`), `lib/plugins/provider-registry.ts` (`profileRunsThinkingTurn`), `packages/plugin-types` 2.5.8 (`ModelInfo.supportsThinking` / `.thinksByDefault`, `TextProviderPlugin.thinkingTurnRule`), `qtap-plugin-deepseek` 1.0.20 and `qtap-plugin-ollama` 1.0.45 (the declarations), `app/api/v1/{providers,models,connection-profiles}/route.ts`, `components/settings/connection-profiles/ProfileModal.tsx`, `lib/services/chat-message/context-builder.service.ts`, migration `retire-prefill-on-thinking-profiles-v1` |
| **v5 status** | Faithful — `crates/quilltap-core/src/services/multi_character_prefill.rs:38` carries the identical `PREFILL_HOSTILE_PROVIDERS: [&str; 1] = ["ANTHROPIC"]`, ported comment and all, so v5 appends the same prefill and takes the same 400 |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-21).** The prefill default is no longer provider-shaped.
`ModelInfo` gained `supportsThinking` / `thinksByDefault` and
`TextProviderPlugin` gained `thinkingTurnRule`
(`@quilltap/plugin-types` 2.5.8); `lib/llm/thinking-turn.ts` holds the one pure
evaluator that joins them, `providerRegistry.profileRunsThinkingTurn()` wires it
to the plugin table server-side, and `defaultMultiCharacterPrefill(provider,
runsThinkingTurn)` returns `false` for a profile that will reason.
`retire-prefill-on-thinking-profiles-v1` clears the stored `1` on the existing
DeepSeek and Ollama rows that are running a thinking turn. A stored boolean
still outranks every default, so the tri-state is intact and the editor warns
rather than vetoes.

**Two deliberate departures from the plan below**, both explained in
[As built](#as-built): the plugin-side hook is a *declarative rule* rather than
the predicate function step 2 proposed, and only DeepSeek and Ollama declare
one. The Z.AI fold-in listed under "Worth folding in" was examined and left
alone; the DeepSeek plugin's own two defects are now
[bug 86](../bug-86-deepseek-thinking-detection.md).

---

## Symptom

Start a chat with any character on a DeepSeek profile using `deepseek-v4-flash`.
The opening greeting arrives normally, with a "Thinking" chip on the bubble. Send
any second message and the turn dies:

```
Failed to generate response: 400 The `reasoning_content` in the thinking mode
must be passed back to the API.
```

Every subsequent turn fails the same way. Because the failure is an HTTP 400 from
the endpoint rather than an empty reply, it surfaces as a toast and a server-log
line and nothing else — the same shape as
[bug 82](bug-82-three-leading-system-messages.md).

## Root cause

**The error message is misleading, and following it leads to the wrong fix.** It
names `reasoning_content` and history, so it reads like "you failed to echo the
reasoning from earlier assistant turns." It is not about history at all.

In a multi-character chat every reply is anchored to the character whose turn it
is, by one of two routes (`lib/llm/multi-character-prefill.ts`). The **prefill**
route appends a trailing assistant message containing `[Character Name]`, so the
model structurally continues only that character's line. DeepSeek's thinking mode
sees a request ending on an assistant turn, reads it as a continuation, and
requires the `reasoning_content` that produced that turn. A synthetic `[Name]`
prefill has none — so it 400s.

Two supporting facts make the diagnosis specific rather than plausible:

- **The greeting works** because it is generated by `lib/chat/initial-greeting.ts`,
  which applies no turn anchor. Exactly one message per chat escapes.
- **`isMultiCharacterChat` returns true for a single AI seat**
  (`lib/chat/turn-manager/utils.ts:188-192`: `userControlled.length >= 2 ||
  llmControlled.length >= 1`). So this is not a group-scene edge case — a plain
  one-character chat takes the prefill and therefore the 400.

This is the third member of a family the prefill module already documents — and
laid out together, the family says something the individual entries do not:

| Hostile to prefill | Why | Scope |
|---|---|---|
| Anthropic 4.6+ | hard-rejects a request ending in an assistant message | **provider** — true whether or not thinking is on |
| Ollama thinking models | the chat template never opens the reasoning block, so `message.thinking` comes back empty ([bug 68](bug-68-ollama-prefill-kills-thinking.md)) | **thinking** — thinking-off Ollama profiles are fine |
| **DeepSeek thinking models** | **400 — continuing a thinking turn requires the `reasoning_content` that produced it** | **thinking** — and on `deepseek-v4-flash` thinking is on by default |

Two of the three are thinking failures wearing a provider's name. Only
Anthropic's is genuinely about the provider. But the predicate is
provider-shaped: `PREFILL_HOSTILE_PROVIDERS` holds `ANTHROPIC`, DeepSeek is not
in it, and `defaultMultiCharacterPrefill` therefore returns `true`. The mechanism
is answering the wrong question, which is why each new thinking model has to be
discovered the hard way. See [The fix](#the-fix).

### What this is *not*

An earlier draft of this entry blamed the general history path — that
`context-builder.service.ts` drops `reasoningContent` from historical assistant
turns, and that the DeepSeek plugin's echo carve-out
(`qtap-plugin-deepseek/provider.ts:108-132`) covers tool-call turns only. Both
statements are true, and both are irrelevant here. The A/B below settles it: with
prefill off, a successful turn carried history containing one assistant message
*with* reasoning (length 278) and one *without*, and DeepSeek accepted it without
complaint. The plugin's tool-call carve-out is correct and untouched by this bug.
The cited line range `555-562` was also the prefill append itself, not a history
builder.

## Why it survived

- **The greeting always works**, so a new chat looks healthy for exactly one
  message.
- **DeepSeek profiles are usually cheap-LLM profiles.** Memory extraction, title
  generation, and scene-state tracking apply no turn anchor and succeeded
  throughout the session that found this. The bug only appears once the profile
  is put on a seat.
- **The error text points away from the cause.** It names `reasoning_content`,
  which sends you into the plugin's reasoning plumbing — where you find a
  documented, correct-looking, and entirely unrelated carve-out.
- **Thinking mode was never opted into.** The profile has `parameters: '{}'`; the
  flash tier thinks by default. Nothing in the UI suggests the model is in a mode
  with extra request rules.

## The fix

**Scope prefill-hostility to thinking-capable models, not to providers.** The
provider-level move — adding `DEEPSEEK` to `PREFILL_HOSTILE_PROVIDERS` — is the
obvious one-liner and it is the wrong shape, for a reason already on the record:
[bug 68](bug-68-ollama-prefill-kills-thinking.md) considered a
plugin-declared static flag for exactly this and **rejected it**, because it
*"would have dropped the prefill for every Ollama profile including the many with
thinking off, where it works and is the stronger anchor."* That objection lands
verbatim on DeepSeek: a blanket provider rule would strip the anchor from
non-thinking DeepSeek profiles that are fine with it.

### Why thinking is the right predicate

The prefill is not decoration. It is a structural anchor that stops weaker models
from forgetting whose turn it is and writing the whole cast — bug 68's own words
for what the rejected third sketch would have thrown away: *"the structural
anchoring, which is what weak local models need most."*

Thinking-capable models are precisely the population that needs it least and
breaks on it most:

- **They break on it.** Two of the three known hostilities are thinking
  failures, not provider quirks — Ollama's chat template never opens the
  reasoning block behind a prefilled turn (bug 68), and DeepSeek's thinking mode
  400s on continuing a turn whose reasoning it never saw (this bug). Only
  Anthropic's is structural: it rejects an assistant tail whether or not thinking
  is on, so that one stays a provider rule.
- **They need it least.** A model spending tokens deliberating about whose turn
  it is does not need `[Name]` shoved into its mouth to work it out. The module
  already notes the converse failure — *"some models visibly spend their reply
  working out whether `[Name]` was an instruction to them or a previous speaker's
  slip."*

This is a judgement call, not a measured result, and worth flagging as such. The
supporting precedent is that Anthropic profiles have run the prose route since
4.9 without the identity drift the prefill exists to prevent — strong models cope.
It has not been measured against a weak *thinking* model, which is the population
where the two arguments pull apart.

Framed this way the change stops being a DeepSeek patch and becomes the predicate
the mechanism always wanted. `multi-character-prefill.ts` already says so in its
own header: *"Which route suits a profile is a property of the model on the other
end, not of the provider."* The default has been provider-shaped ever since only
because there was nothing model-shaped to ask.

### Shape

1. **Give `ModelInfo` a thinking capability.** It already carries
   `supportsImages` and `supportsTools` (`packages/plugin-types/src/plugins/provider.ts:177`);
   thinking belongs beside them. Two facts are needed, because the providers
   differ: whether the model *can* think, and whether it thinks **without being
   asked** — `deepseek-v4-flash` does (the reproducing profile has
   `parameters: '{}'` and still returned reasoning), while Ollama and Anthropic
   thinking is opt-in per profile.
2. **Let the plugin answer "will this profile run a thinking turn?"** Capability
   alone is not enough for the opt-in providers, and bug 68 was right to refuse
   the host reading plugin-owned option keys — *"would have hardcoded into the
   context builder exactly what the plugin-options schema exists to keep out."*
   An optional plugin-side predicate keeps that boundary: only the plugin knows
   both its model table and its own option keys. Absent the method, fall back to
   the thinks-by-default flag.
3. **`defaultMultiCharacterPrefill` consults it**, and returns `false` when the
   profile's model will run a thinking turn. Anthropic keeps its provider-level
   rule for its own separate reason. Non-thinking DeepSeek and thinking-off
   Ollama profiles keep the prefill — which is precisely bug 68's objection
   satisfied rather than re-incurred.
4. **A migration for existing rows.** `profileUsesNamePrefill` honours a stored
   boolean over the provider default, and DeepSeek profiles created before this
   carry a literal `1` written by `defaultMultiCharacterPrefill` at creation, not
   by any user choice. The list change alone fixes nothing for them. Bug 68 set
   the precedent with `add-profile-multi-character-prefill-field-v1`, which
   backfilled `0` for ANTHROPIC and `1` for everything else; this needs the
   matching pass for thinking-active rows. **This is the half a filing would
   miss.**
5. **Keep the choice the user's.** Bug 68 deliberately made this a per-profile
   tri-state and permits ticking prefill *on* for Anthropic with a warning. Do
   not turn the new rule into a hard veto — seed the default correctly and warn
   in the editor the way the Anthropic case already does.

### Worth folding in

`plugins/dist/qtap-plugin-z-ai/provider.ts:57` hand-rolls
`supportsReasoningEffort(model)` for its own model table — the same per-model
reasoning capability, expressed ad-hoc because there is nowhere shared to put it.
Once step 1 lands it should retire into the shared flag. Related but separate,
and **not** prerequisites: the DeepSeek plugin's `isThinkingEnabled(body)`
(`provider.ts:51-58`) infers thinking state by inspecting the outgoing request
body, which is wrong for a model that thinks by default — the reproducing profile
sends no `thinking` key, so the predicate returns `false` and
`stripThinkingIncompatibleParams` never runs. Its README compounds this by
documenting thinking mode as a `deepseek-v4-pro` feature reached through profile
parameters. Both want fixing; neither causes this 400.

## As built

The shape below survived intact except in two places, both worth recording
because the reasoning is not obvious from the diff.

### The plugin hook is a rule, not a predicate

Step 2 asked for an optional plugin-side predicate, on the grounds that only
the plugin knows both its model table and its own option keys. That reasoning
holds and is preserved — but a closure only answers on the server, and the
connection-profile editor needs the same answer in the browser. It is the
editor that writes the column: `buildRequestBody` always sends
`multiCharacterPrefill`, so the server-side default in
`app/api/v1/connection-profiles/route.ts` almost never fires. A fix the editor
could not see would have seeded the wrong value into every new profile and left
the server correcting nothing.

So the hook is `thinkingTurnRule` — `{ optionKey, enabledValues,
disabledValues }`. It says exactly what the predicate would have said about the
option key, and it serialises out through `/api/v1/providers` to the editor.
The model half of the answer (`thinksByDefault`) travels separately, on
`modelsWithInfo` from `/api/v1/models`, which the editor already fetches. Both
sides then run the same pure `evaluateThinkingTurn`, so there is one evaluator
and no second implementation to drift.

Bug 68's boundary objection is honoured either way: the host still does not
name a plugin's option keys. The plugin does, in its own declaration.

### Only DeepSeek and Ollama declare a rule

The mechanism is general; the declarations are not. DeepSeek and Ollama are the
two providers with *observed* prefill hostility while thinking. Z.AI, OpenAI,
Grok and OpenRouter all have reasoning options and none has been seen to break
on a prefill, and this entry's own argument for thinking-as-predicate is
flagged in [Why thinking is the right predicate](#why-thinking-is-the-right-predicate)
as a judgement call rather than a measured result. Silently flipping the anchor
on four more providers on the strength of a judgement call would trade a known
bug for four unknown ones. A new thinking provider is now a four-line
declaration in its plugin.

### Z.AI's `supportsReasoningEffort` was not retired

"Worth folding in" proposed retiring
`plugins/dist/qtap-plugin-z-ai/provider.ts:57` into the shared `ModelInfo`
flag. On inspection it does not fold: it parses the GLM *generation* out of the
model id (`glm-5.2` and newer, excluding the `glm-Nv` vision family) precisely
so it keeps working when Z.AI ships a new generation or revises an id, and Z.AI
model ids arrive dynamically from `/models` — `STATIC_MODELS` is only a merge
list. A static per-model flag would be strictly worse there. Left as is.

### The stored-null row

`profileUsesNamePrefill` honours a stored boolean over any default, so the
thinking answer only reaches rows that never chose. Those are rare — pre-4.9
rows and imports — but the editor showed them the *provider* default while the
server would resolve the *thinking* one, and a save would have frozen the wrong
answer into the column. `ProfileModal` now corrects a null row once the model
list lands. It fires only for a null row, so it can never overwrite a choice.


## Verification

An A/B on one chat, two cheap DeepSeek turns. **Run 2026-08-21 on V4test; both
legs below are observed, not predicted.**

Setup: a chat with one character on a `deepseek-v4-flash` profile with
`parameters: '{}'` and `multiCharacterPrefill = 1`.

**Leg A — prefill on (control).** Send any message. The turn 500s; the toast
reads ``Failed to generate response: 400 The `reasoning_content` in the thinking
mode must be passed back to the API``, and `logs/combined.log` gains two entries
of that string from `DeepSeekProvider.streamMessage`.

**Leg B — prefill off.** `PUT /api/v1/connection-profiles/<id>` with
`{"multiCharacterPrefill": false}`, confirm the column reads `0`, send another
message. The turn completes normally. No new `reasoning_content` entries appear
in the log, and the reply persists with `reasoningContent` of length 4111 — so
thinking mode is still fully active. Only the trailing prefill message changed.

Leg B is also the control for the history theory: its request carried both an
assistant turn *with* reasoning and one *without*, and DeepSeek accepted it.

Note the failing turn writes **no `llm_logs` row** — the request errors before
the log write — so `combined.log` is the only durable trace. Do not go looking in
`quilltap db logs`.

## v5 coordination

v5 is faithful and fires no tripwire:
`crates/quilltap-core/src/services/multi_character_prefill.rs:38` carries the
same one-element hostile list with the Anthropic comment ported verbatim, so both
sides append the prefill and take the same 400.

What v5 owes once v4 moves is more than a list entry, because the repair changes
the predicate's shape rather than its contents: the model-thinking capability,
whatever plugin-side hook v4 settles on for the opt-in providers, and the
migration. Its `connection_profiles` column is the same nullable-optional boolean
(`crates/quilltap-core/src/db/connection_profiles.rs:125`), so a stored `true`
outranks the default there too and the backfill is owed identically. Worth
coordinating before v4 lands it — this is the kind of change that is cheaper to
port as a design than to re-derive from a diff.
