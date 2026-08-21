# Bug 84 — the tool-result error sentence is carried to the client and then ignored

| | |
|---|---|
| **Status** | **Fixed in v4** (verified live 2026-08-21 — see [Verification](#verification)) |
| **Found** | 2026-08-21 (v5 dogfood walk, provoking a `generate_image` refusal on a chat with no resolved image profile) |
| **Fixed** | 2026-08-21 |
| **Severity** | Low — cosmetic, but it defeats a field that exists solely to prevent it, and it hides the one sentence that tells the user what to fix |
| **Who it bites** | anyone whose `generate_image` call fails for a reason worth reading. The notice says `Failed to generate image` and the toast says `Image generation failed: Unknown error`, when the server sent, e.g., `Error: Image generation is not enabled for this chat` — which names the actual remedy |
| **Provenance** | Faithful in v5 (it reproduces this exactly); the defect is v4's own, and it is self-defeating rather than merely missing — the emitter added the field *for* this consumer |
| **Defect site** | `app/salon/[id]/hooks/useSSEStreaming.ts:392` — `trackToolResult` destructures `const { index, name, success, result } = data.toolResult`, dropping the sibling `error`, then renders `result?.error \|\| 'Failed to generate image'` (`:417-427`) and `Image generation failed: ${result?.error \|\| 'Unknown error'}` (`:428`). On failure `result` is `null`, so both fall back every time |
| **Emitter** | `lib/services/chat-message/tool-execution.service.ts:156-168` — builds `toolResultPayload` as `{index, name, success, result}` and, `if (!toolResult.success)`, sets `toolResultPayload.error = resultText`. Its own comment: *"On failure, carry the human-readable error text (same string persisted as the tool message's content) so live UIs can show a useful message instead of a generic 'failed' — the result field itself is often null on error."* |
| **Fix site** | `app/salon/[id]/hooks/useSSEStreaming.ts` — new exported `resolveToolResultErrorText(...)` reads the sibling `error` first, falls back to `result?.error`, and strips the executor's leading `Error: `; `trackToolResult`'s `generate_image` failure branch calls it. Regression test: `__tests__/unit/hooks/useSSEStreaming-tool-error.test.ts` |
| **v5 status** | Was faithful, deliberately unchanged; **v4 has now moved, so the drift catch-up is owed.** `applyToolResult` stores `result: result.result` (`apps/web/src/app/core/chat-stream.reducer.ts:379`) and the notice reads `(call.result ?? {}).error` (`screens/salon/salon-conversation.ts:2947`). Tracked as v5 dogfood finding #99 |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-21)** — by reading the field the emitter was already
sending. `trackToolResult` now destructures `error` alongside `result` and
resolves the display sentence through one exported pure helper,
`resolveToolResultErrorText`, which prefers the sibling `error`, falls back to
the old nested `result?.error` (so nothing regresses if a provider ever puts it
there), strips the executor's own leading `Error: ` wrapper, and returns
`undefined` for anything empty so the caller's generic string still fires. The
`generate_image` failure branch feeds both the composer notice and the toast
from that one value.

The refusal above now reads *"Image generation is not enabled for this chat"* in
both places instead of `Failed to generate image` / `Unknown error`.

The helper is exported rather than inlined so the defect has a test that doesn't
need the whole SSE hook mounted:
`__tests__/unit/hooks/useSSEStreaming-tool-error.test.ts` pins the real failure
shape (`result: null` + sibling `error`), the prefix strip, the nested fallback,
sibling-wins precedence, and the empty cases.

## Symptom

Ask a character to call `generate_image` in a chat whose seats resolve **no**
image profile. The tool is offered (the slate carries it off the profile's own
settings), the executor refuses it, and the live UI reports:

- notice above the composer — `Failed to generate image`
- toast — `Image generation failed: Unknown error`

The server had already sent the sentence that explains it:

```json
{"toolResult": {"index": 0, "name": "generate_image", "success": false,
                "result": null,
                "error": "Error: Image generation is not enabled for this chat"}}
```

`Unknown error` is the least accurate thing the client could have said, and the
accurate thing was in the frame it was reading.

## Root cause

The payload puts the human-readable text in `error`, a **sibling** of `result`,
precisely because `result` is `null` on failure — that is the whole point of the
field, and the emitter's comment says so.

`trackToolResult` then destructures only `{ index, name, success, result }` and
looks for the text at `result?.error` — one level too deep, in the object the
emitter had just documented as usually null. So the fallback fires on every
failure, and the field has no reader anywhere in the app.

## Why it survived

The two halves were written to fit each other and then drifted apart in one
direction only:

- Nothing fails loudly. A missing error string degrades to a generic string, so
  the UI always looks like it is working.
- The failure path is rare in normal use — most `generate_image` calls succeed,
  and the success branch reads `result?.images`, which *is* correctly nested.
- The one test that would notice would have to assert the *rendered sentence*
  against a failing tool result; the coverage asserts the notice's presence and
  lifetime instead.

## The fix (as filed)

Read the field the emitter provides, keeping the old path as the fallback so
nothing regresses if a provider ever does nest it:

```ts
const { index, name, success, result, error } = data.toolResult!
...
const detail = error || (result as { error?: string } | null)?.error
publishToolExecutionStatus({
  tool: name,
  status: 'error',
  message: detail || 'Failed to generate image',
})
showErrorToast(`Image generation failed: ${detail || 'Unknown error'}`)
```

Worth considering in the same pass: the sentence arrives prefixed with `Error: `
(the executor's own wrapper), so the toast would read *"Image generation failed:
Error: Image generation is not enabled for this chat"*. Either strip a leading
`Error: ` at the display site or stop adding it at the source — the former is
local and safer.

Scope note: `error` is only set when `!success`, so the success branch is
untouched, and no other consumer of `toolResult` reads `error` today.

## Verification

**Verified live on 2026-08-21** against a real dev server (the V4test instance
on :3005), driving a real turn through the real streaming pipeline.

The filed repro needs one correction first. It says the tool is offered while
the executor refuses — *"the slate carries it off the profile's own settings"*.
It does not. One `imageProfileId` (`participant-resolver.service.ts:240`,
`chat.imageProfileId || null`) feeds **both** the slate
(`streaming.service.ts:262`, `imageGeneration: !!imageProfileId`, and
`buildToolsForProvider` gates strictly on that flag) and the executor
(`tool-execution.service.ts:295`). With no profile the tool is never offered,
so the `:395` refusal is reachable only when a model emits a `generate_image`
call it was never given — which happens, and which text-parsed tool modes make
easy, since `detectToolCalls` delegates to the provider plugin and filters
nothing against the offered slate. The frame shape, which is all the defect
turns on, is identical either way.

So the run used a **dangling profile reference**, which puts the tool on the
slate *and* guarantees the failure, with no provider spend on the image side:
create a throwaway image profile, point the chat at it, delete it. The chat now
names a profile that no longer exists.

The frame the server actually sent, captured by teeing the SSE body:

```json
data: {"toolResult":{"index":0,"name":"generate_image","success":false,
       "result":null,
       "error":"Error: Image profile not found or not authorized - Image profile \"72e7dd20-…\" does not exist or you do not have access to it"}}
```

`result` is `null` and `error` is its sibling, exactly as filed. What the UI
rendered, captured by `MutationObserver` (see the warning below) and confirmed
by screenshot:

| Surface | Element | Text |
|---|---|---|
| composer notice | `.qt-alert.qt-alert-error` | `Image profile not found or not authorized - Image profile "72e7dd20-…" does not exist or you do not have access to it` |
| toast | `.app-toast` | `Image generation failed: Image profile not found or not authorized - Image profile "72e7dd20-…" does not exist or you do not have access to it` |

Both carry the server's sentence and both have the leading `Error: ` stripped.
Before the fix they read `Failed to generate image` and `Image generation
failed: Unknown error` — `result` being `null` in the frame makes the old
`result?.error` read `undefined` unconditionally, so the fallback was not
merely likely but certain. Reproduced three times in the one session.

To reproduce free, on either app, with no provider spend on the image side:

1. Open a chat whose seats resolve no image profile.
2. Ask the model to call `generate_image` with any prompt.
3. The executor refuses (`Image generation is not enabled for this chat`) without
   contacting an image provider; the frames above are still emitted.
4. Before the fix the notice reads `Failed to generate image` and the toast reads
   `Image generation failed: Unknown error`; after it, both carry the server's
   sentence.

⚠ Measure this with screenshots or a `MutationObserver`. In the v5 walk that
found it, three runs were measured with an injected `setInterval` poller that
died after ~6 ticks and reported "no notice at all" — a false negative that cost
a wrong write-up before it was caught. A settled notice self-dismisses after 6 s,
which is ample to catch if the instrument is actually running. The v4
verification above used a `MutationObserver` for exactly this reason, and the
notice did in fact clear inside a 10 s wait more than once.

## v5 coordination

**v4 has moved (2026-08-21), so this is now owed.** The v5 side is two reads: carry
`error` through `applyToolResult` onto the call (or alongside it) in
`chat-stream.reducer.ts`, and prefer it in `salon-conversation.ts`'s
`generate_image` failure branch. Tracked as v5 dogfood finding #99.
