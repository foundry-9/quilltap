# Bug 82 — three leading system messages break strict local chat templates

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-19 (v5 dogfood walk, on a local Ollama profile running `qwen3.5-9b-q6`) |
| **Fixed** | 2026-08-19 |
| **Severity** | High for the users it reaches — **every non-opening turn fails outright**, with no reply and nothing on screen explaining why |
| **Who it bites** | anyone whose model applies a chat template that requires the system message to be first and singular. The Qwen family does; so do several Llama-derived and Gemma templates. It reaches Ollama and any OpenAI-Compatible local server (llama.cpp, LM Studio, vLLM) that applies the model's own template. Hosted providers are unaffected — they accept repeated leading system messages |
| **Provenance** | Faithful and deliberate: the three-block split exists to serve prompt caching (see the comments at the defect site), and predates local-provider support becoming common |
| **Fix site** | `packages/plugin-utils` 2.4.0 — `collapseLeadingSystemMessages` (`src/providers/system-messages.ts`) plus `OpenAICompatibleProvider.acceptsRepeatedSystemMessages` / `applySystemMessagePolicy`, applied in both body builds; `plugins/dist/qtap-plugin-openai-compatible/provider.ts` sets the flag false; `plugins/dist/qtap-plugin-ollama/provider.ts` calls the helper on both paths |
| **Defect site** | `lib/chat/context-manager.ts:1902` (block 1, the cacheable system prompt), `:1915` (block 2, identity reinforcement — "emitted as a separate system message so block 1 can be marked with a cache breakpoint"), `:1926` (block 3, the compressed-history summary). Three consecutive `role: 'system'` messages reach the provider unchanged; no request builder collapses them |
| **v5 status** | **Owed** — v5 emits the identical three blocks (`services/build_context.rs`, blocks 1/2/3) and fails identically against the same model. Finding #95 now owes the per-provider collapse |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-19).** The collapse landed exactly where the write-up
below places it — at request-build time, per provider — so the context
assembly, and with it the whole prompt-caching design, is untouched.

`@quilltap/plugin-utils` 2.4.0 exports `collapseLeadingSystemMessages`: it folds
a run of consecutive *leading* `system` messages into one, joining the contents
with a blank line, and returns the same array reference when there are fewer
than two of them. Only the leading run is touched — a system message that turns
up later stays where it is, because moving it would change what the model is
told and when — and an empty block is skipped rather than contributing a stray
blank line.

The choice is declarative per provider rather than hard-coded:
`OpenAICompatibleProvider` gained `acceptsRepeatedSystemMessages`, **defaulting
to `true`**, and applies it through `applySystemMessagePolicy` in both the
streaming and non-streaming body builds. `OpenAICompatibleEndpointProvider` sets
it `false`; `DeepSeekProvider`, the only other subclass, leaves the default
alone and is byte-identical on the wire. Ollama's provider builds its own
request and calls the helper unconditionally on both paths — an Ollama endpoint
is a local runtime by definition, so there is no case to gate on.

Regression cover: `__tests__/unit/plugins/leading-system-messages.test.ts` —
the helper's own four cases, then the three-block turn driven through Ollama
(both paths) and OpenAI-Compatible (both paths) with the folded content asserted
verbatim, and finally DeepSeek asserted to still send **three** system messages
in order. That last one is the regression that matters.

A second thing changed to make the suite honest about this: `jest.config.ts`
now maps `@quilltap/plugin-utils` to `packages/plugin-utils/src`, because
`packages/` is where an SDK change lands first and the publish that installs it
necessarily comes later — without the mapping the suite tests the previous
release of the SDK while asserting on this release's plugins.

**Not done, and deliberately.** The write-up's aside about surfacing a failed
turn was checked rather than acted on: the error *does* reach the UI today. The
provider throws, `primary-stream.service.ts` rethrows, the orchestrator's
`handleStreamError` emits an `error` SSE event, and `useSSEStreaming` raises it
into `showErrorToast`. What is genuinely absent is a *persistent* failed-turn
marker in the transcript — a toast is easy to miss, which is very likely what
"no error banner" describes — and that is a UI feature rather than part of this
fix.

---

## Symptom

Point a chat at a local Ollama profile running a Qwen model and send a message.
The **opening greeting works**. Every turn after it dies:

```
HTTP 500 {"error":{"code":500,"message":"
  While executing CallExpression at line 85, column 32 in source:
  ...first %}↵            {{- raise_exception('System message must be at the beginnin...
  Error: Jinja Exception: System message must be at the beginning.","type":"server_error"}}
```

On screen the user's message posts and **no reply ever arrives** — no error
banner, no failed-turn marker. The failure is only visible in the server log.

## Root cause

The greeting path sends **one** system message, which every template accepts.
A normal turn sends **three**, consecutively, at the head of the array:

```
roles: ['system', 'system', 'system', 'user', 'user', 'user', 'assistant', 'user']
```

Templates in the Qwen family accept a system message only at index 0 and
`raise_exception` on any later one, so the whole request is rejected before a
single token is generated.

The split itself is not accidental and should not simply be undone — the
comments at `context-manager.ts:1898-1917` explain that block 1 is the
byte-identical cacheable prefix (Anthropic ephemeral cache, OpenAI automatic
prefix cache) and that block 2 is kept separate precisely so a cache breakpoint
on block 1 is not invalidated by the reinforcement's content. **Merging the
blocks unconditionally would trade this bug for a prompt-caching regression on
every hosted provider.**

## Why it survived

Hosted providers — where nearly all real usage lives, and where the cache
design pays for itself — accept repeated leading system messages happily. The
failure needs a local model whose template enforces system-first, and then only
on the second turn onward, which is easy to read as "the local model is flaky"
rather than as a request-shape defect.

## The fix

Collapse the leading system run **at request-build time, for the providers that
need it**, leaving the context assembly (and therefore the caching design)
untouched:

- in the Ollama and OpenAI-Compatible request builders, fold any run of
  consecutive leading `system` messages into a single message, joining the
  contents with a blank line;
- leave every hosted builder alone, so cache breakpoints keep landing where
  they do today.

A per-provider capability (`acceptsRepeatedSystemMessages`, defaulting true)
would make the choice declarative rather than hard-coded in two builders, and
would give any future local provider the same protection.

Worth doing alongside it: **surface a failed turn in the UI**. The turn dies
with a 500 and the user sees only an absence — the same class of silence as
bug 47's budget exhaustion.

## Verification

- Ollama + a Qwen model: a second, third and fourth turn all succeed.
- The merged message's text is the three blocks in order, so nothing is lost
  from the prompt.
- A hosted provider's outbound request is **byte-identical** to before the fix
  (the regression that matters — assert it on Anthropic, where the cache
  breakpoint is explicit).
- A local server whose template is permissive (llama.cpp with `--chat-template
  chatml`) keeps working either way.

## v5 coordination

v5 reproduces this faithfully and stays that way until v4 moves; v5 finding #95
is filed against this bug and will retire when the port absorbs the fix.
