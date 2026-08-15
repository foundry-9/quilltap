# Bug 68 — the multi-character `[Name]` prefill silently kills Ollama's thinking channel

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-14 (Friday, chat `5aae5b4e` "The Conservatory's Silent Sonata" — Marie on `Qwen3.8-27B`, profile "Qwen3.8-27B Thinking" with **Enable Thinking on**, and not one rendered thinking block in the whole conversation) |
| **Fixed** | 2026-08-14 |
| **Severity** | Medium (no data loss, but a paid-for feature is off with no signal: the profile toggle reads on, the model reasons, and the reasoning is discarded before it can be captured — plus the reasoning tokens are billed in wall-clock and context either way) |
| **Who it bites** | anyone running a thinking-capable Ollama model in a **multi-character** chat; single-character chats and greeting generation are unaffected |
| **Provenance** | observed in Friday, traced through the LLM logs and instance logs, then reproduced directly against `localhost:11434` on both the 8B and the 27B |
| **Fix site** | new `lib/llm/multi-character-prefill.ts` (the `multiCharacterPrefill` chokepoint) + `lib/services/chat-message/context-builder.service.ts` (`applyMultiCharacterTurnAnchor`, provider hardcoding removed) + migration `add-profile-multi-character-prefill-field-v1` + the profile editor checkbox |
| **v5 status** | not yet assessed — v5 ports the same prefill carve-out and inherits the defect; port the per-profile setting from this write-up rather than v4's pre-fix provider branch |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-14).** The route is no longer hardcoded by provider. It
is a per-profile setting, `connection_profiles.multiCharacterPrefill`, surfaced
in the profile editor as **Announce the speaker in multi-character scenes
([Name] prefill)** — because the right answer is a property of the model on the
other end, not of the provider. See [The fix](#the-fix) below for the shape and
what was decided about the predicate's home.

---

In a multi-character chat the context builder anchors the reply by
appending an assistant message containing `[Character Name]`, so the model
structurally continues only that character's line
(`context-builder.service.ts`, the `if (isMultiCharacter)` block). Anthropic is
carved out — it rejects assistant-tail requests — and gets a prose system
instruction instead. **Every other provider gets the prefill.**

For Ollama the prefill is not merely tolerated, it is load-bearing in the wrong
direction: Ollama's `think` support is implemented in the model's chat
template, which opens the thinking block at the *start* of the assistant turn.
A prefilled assistant message means the assistant turn has already begun with
visible content, so the template's thinking block is never opened and
`message.thinking` comes back empty — regardless of `think: true`.

The provider plugin is blameless here. It sends `think` correctly, it parses
both `message.thinking` and inline `<think>` blocks
(`plugins/dist/qtap-plugin-ollama/think-parser.ts`), and it hands
`reasoningContent` up when there is any. There simply never is any.

### Evidence

**In Friday.** Every `OLLAMA` assistant row in the instance has
`reasoningContent IS NULL` (15 of 15). The one turn in the whole database where
the plugin *did* capture reasoning was the chat's opening-message generation —
the one Ollama call in the flow that carries no `[Name]` prefill:

```
02:50:13.043  Ollama response carried reasoning   model=Qwen3-8B     enableThinking=false  inlineChars=2000   ← background job, no prefill
01:51:51.238  Ollama stream carried reasoning     model=Qwen3.8-27B  enableThinking=true   reasoningChars=3620 ← greeting generation, no prefill
```

Every subsequent in-scene turn (01:58, 02:14, 02:50) logs nothing — the plugin
had nothing to log. The LLM log for the 02:50 turn
(`5a147760-316d-450c-9062-18749994794d`) ends its message array with
`{"role":"assistant","content":"[Marie]"}`.

(Note the 3620 chars captured on the greeting were then dropped anyway — the
first-message path did not persist `reasoningContent`. That is a **separate**
defect; it was fixed in the same change and is written up below.)

**Reproduced directly**, same model, same server, one variable — the trailing
assistant prefill:

```
27B, no prefill:   thinking = 470 chars   content = "*I glance at you, then let the room fall quiet.* …"
27B, with prefill: thinking =   0 chars   content = "[Marie] I sit down at the piano bench, …"
```

The 8B shows the uglier variant of the same failure — the model reasons anyway,
the template's opening tag is gone, and the orphaned close tag leaks into the
reply:

```
8B, no prefill:   thinking = 552 chars   content = ""
8B, with prefill: thinking =   0 chars   content = " Hello! How can I assist you today?\n</think>\n\nHello! How can I assist you today?"
```

The think-parser's swallowed-opening-tag rule catches that second shape (it
routes everything ahead of an orphan `</think>` into reasoning), so the 8B
degrades to "reasoning survives, badly". The 27B emits no tags at all, so
nothing survives.

### Why it survived

The prefill carve-out was written against a *hard* failure — Anthropic 4.6+
returns a 400 on an assistant tail, so the need for a second path was
unmissable. Ollama's failure is soft: the request succeeds, the reply is
well-formed and in character, and the only casualty is a display-only field
nobody gets an error about. Ollama thinking is also brand new
(`d9c5a1c7`, 2026-08-14), and it was developed and verified against
single-character prompts, where the prefill never appears.

The provider comparison confirms the blast radius is Ollama-only — other
providers carry reasoning out of multi-character chats fine, because their
reasoning channel is a protocol field rather than a template artifact:

| provider | multi-char turns | with reasoning |
|---|---:|---:|
| DEEPSEEK | 5689 | 1742 |
| Z_AI | 3647 | 227 |
| GROK | 1022 | 121 |
| **OLLAMA** | **12** | **0** |

### The fix

The predicate is **neither** of the two options originally sketched. A
plugin-declared `messageFormat` flag is static per-plugin, so it would have
dropped the prefill for every Ollama profile including the many with thinking
off, where it works and is the stronger anchor; reading the plugin-owned
`enable_thinking` key host-side would have hardcoded into the context builder
exactly what the plugin-options schema exists to keep out. A third sketch —
having the plugin strip the prefill and re-prepend it to the response — was
rejected as not equivalent: it restores thinking but discards the structural
anchoring, which is what weak local models need most.

Instead the choice became **the user's, per profile**, which is the honest
shape: whether a model wants an already-opened turn is a property of that
model, and the failure modes are not confined to Ollama. Anthropic 4.6+ hard-
rejects it; Ollama loses its thinking channel to it; and some models visibly
spend their reply working out whether `[Name]` was an instruction to them or a
previous speaker's slip.

- **`connection_profiles.multiCharacterPrefill`** (migration
  `add-profile-multi-character-prefill-field-v1`) — INTEGER, backfilled to
  preserve today's behaviour exactly: `0` for ANTHROPIC rows, `1` for
  everything else.
- **`lib/llm/multi-character-prefill.ts`** is the single chokepoint.
  `defaultMultiCharacterPrefill(provider)` answers what a new profile starts
  with; `profileUsesNamePrefill(profile)` resolves a stored row. **Never read
  the column directly** — NULL means "never chosen" (a pre-migration row, or a
  profile imported from a pre-4.9 bundle, where the field simply isn't in the
  JSON) and only the chokepoint knows it resolves to the provider default. The
  tri-state is the whole reason an old Anthropic export can't come back from
  the dead with the prefill on.
- **`applyMultiCharacterTurnAnchor`** (`context-builder.service.ts`) replaces
  the inline `if (provider === 'ANTHROPIC')`. The prose branch is unchanged —
  it deliberately does not teach the model to emit a `[Name]` tag of its own.
- **The profile editor** gains the checkbox, seeded from the provider default
  on create and re-seeded when the provider is switched on an unsaved profile.
  Ticking it on an Anthropic profile is permitted — the setting is the user's —
  but the editor warns that it will error on every multi-character turn.

`finalizeMessageResponse()`'s truncation at the first foreign speaker tag stays
the structural backstop on both routes, and single-character chats use neither.

The Ollama plugin's `enable_thinking` help text was left as-is (it describes
the plugin's own behaviour accurately); the caveat belongs to the host, and
lives in `help/connection-profiles.md` — a new "Announcing the Speaker in
Multi-Character Scenes" section, plus a bullet in the Ollama provider notes
pointing at it — and in `help/chat-multi-character.md`.

### Verified in the running app

A two-character chat in V4test on `hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M` with
**Enable Thinking** on, same chat and same profile, only the checkbox moved:

| `multiCharacterPrefill` | stored `reasoningContent` |
|---|---|
| off | 1139 chars, then 2934 chars |
| on | NULL |

The off-turn's request was inspected in the LLM log and carried the prose
anchor in the system message, no `[Riya]` assistant message, and a `user`
role in final position. The reply stayed inside its own turn either way.

The greeting fix was verified in the same run: the auto-generated opening
message came back with 1305 characters of reasoning persisted, where before it
stored none.

### A separate defect, fixed alongside

The 3620 characters of reasoning the greeting *did* capture were dropped
because `generateGreetingMessage` (`lib/chat/initial-greeting.ts`) read
`chunk.content` and nothing else. It now tracks `chunk.reasoningContent`
(cumulative — assignment, not concatenation), returns it on `GreetingResult`,
and `autoGenerateFirstMessage` carries it through all four generation attempts
onto the stored greeting message. Not caused by the prefill and not fixed by
the prefill work; recorded here because this bug's investigation is what
surfaced it.

### How to verify

1. Point a profile at a thinking-capable Ollama model with **Enable Thinking**
   on and **Announce the speaker in multi-character scenes** *unticked*, and
   seat its character in a chat with at least one other character.
2. Take a turn. Confirm a thinking block renders, and that the row's
   `reasoningContent` is non-NULL:

   ```sh
   npx quilltap db --instance V4test "SELECT id, provider, reasoningContent IS NOT NULL FROM chat_messages WHERE role='ASSISTANT' AND provider='OLLAMA' ORDER BY createdAt DESC LIMIT 5"
   ```

3. Regression-check the anchor itself: the reply must still be one character's
   turn, with no `[Other Name]` or `Other Name:` tags and no continuation into
   another participant's voice.
4. Regression-check a single-character Ollama chat and a multi-character chat
   on a profile that kept the box ticked — neither should change.
5. Regression-check Anthropic: existing Anthropic profiles must read as
   unticked after the migration and must not 400 on a multi-character turn.
6. Start a fresh chat whose opening greeting is generated by a thinking model
   and confirm the greeting bubble carries a thinking fold.
