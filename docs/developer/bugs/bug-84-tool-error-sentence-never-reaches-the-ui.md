# Bug 84 — the tool-result error sentence is carried to the client and then ignored

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-08-21 (v5 dogfood walk, provoking a `generate_image` refusal on a chat with no resolved image profile) |
| **Severity** | Low — cosmetic, but it defeats a field that exists solely to prevent it, and it hides the one sentence that tells the user what to fix |
| **Who it bites** | anyone whose `generate_image` call fails for a reason worth reading. The notice says `Failed to generate image` and the toast says `Image generation failed: Unknown error`, when the server sent, e.g., `Error: Image generation is not enabled for this chat` — which names the actual remedy |
| **Provenance** | Faithful in v5 (it reproduces this exactly); the defect is v4's own, and it is self-defeating rather than merely missing — the emitter added the field *for* this consumer |
| **Defect site** | `app/salon/[id]/hooks/useSSEStreaming.ts:392` — `trackToolResult` destructures `const { index, name, success, result } = data.toolResult`, dropping the sibling `error`, then renders `result?.error \|\| 'Failed to generate image'` (`:417-427`) and `Image generation failed: ${result?.error \|\| 'Unknown error'}` (`:428`). On failure `result` is `null`, so both fall back every time |
| **Emitter** | `lib/services/chat-message/tool-execution.service.ts:156-168` — builds `toolResultPayload` as `{index, name, success, result}` and, `if (!toolResult.success)`, sets `toolResultPayload.error = resultText`. Its own comment: *"On failure, carry the human-readable error text (same string persisted as the tool message's content) so live UIs can show a useful message instead of a generic 'failed' — the result field itself is often null on error."* |
| **v5 status** | Faithful, deliberately unchanged. `applyToolResult` stores `result: result.result` (`apps/web/src/app/core/chat-stream.reducer.ts:379`) and the notice reads `(call.result ?? {}).error` (`screens/salon/salon-conversation.ts:2947`). v5 absorbs the fix in a drift catch-up once v4 moves — see v5 dogfood finding #99 |
| **Index** | [bugs.md](../bugs.md) |

---

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

## The fix

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

Reproduces free, on either app, with no provider spend:

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
which is ample to catch if the instrument is actually running.

## v5 coordination

v5 stays faithful until v4 moves. When it does, the v5 side is two reads: carry
`error` through `applyToolResult` onto the call (or alongside it) in
`chat-stream.reducer.ts`, and prefer it in `salon-conversation.ts`'s
`generate_image` failure branch. Tracked as v5 dogfood finding #99.
