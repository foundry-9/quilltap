# Bug 94 — the attachment failure ledger had no reader

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-23) |
| **Found** | 2026-08-23 |
| **Fixed** | 2026-08-23 |
| **Severity** | **Medium** on its own; **the reason bug 91 went unnoticed for months** |
| **Who it bites** | anyone attaching a file to a provider that cannot forward it — the failure is reported all the way to the browser and then discarded |
| **Provenance** | Live (Friday, 2026-08-23), found while tracing bug 91 |
| **Fix site** | `app/salon/[id]/hooks/useSSEStreaming.ts` |
| **v5 status** | **Applies as a rule, not as code.** A field plumbed end-to-end with no consumer is a latent silent failure. Bug 84 was the same shape (a failing tool's `error` sibling nobody read); this is its second instance in ten bugs. |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-23).** Every layer did its job except the last one.

### Symptom

An image attached to a NanoGPT profile never reached the model. The plugin knew
and said so, populating:

```ts
attachmentResults: { sent: [], failed: [{ id, error: 'file attachment support … not yet implemented' }] }
```

That object travels through `streamingState.attachmentResults`, through
`message-finalizer.service.ts`, onto the SSE `done` event — and stops. The user
sees a normal reply about a picture the model never received.

### Root cause

`attachmentResults` is threaded through nine files. Searching the client for a
reader:

```
grep -rn "attachmentResults" components/ app/   →   (no matches)
```

The type existed, the plumbing existed, the data was correct and complete. No
component read it. The Salon's `SSEEvent` interface did not even declare the
field.

### Why it survived

Nothing to see, by construction. There is no error state, no console warning,
no degraded rendering — the reply arrives, streams normally, and reads fine,
because a model with no image writes about the image anyway. The only trace is
a field in an SSE frame nobody was watching.

This is worth stating plainly for v5: **the cost of an unread field is not the
field, it is every bug it silently absorbs.** Bug 91 was live for as long as
NanoGPT profiles have carried images, and the machinery to report it was
working the whole time.

### The fix

The Salon's stream hook now declares `attachmentResults` on `SSEEvent` and, on
the `done` event, raises a warning toast naming the count and the plugin's own
error text, collapsing extras into "(and N more)".

A toast rather than a message bubble, deliberately: the turn itself succeeded
and its content is worth keeping. What failed is an input to it, and that is a
warning about the turn, not a replacement for it.

### How to verify

Configure a connection profile on a provider whose plugin cannot forward
images (`DEEPSEEK`, `OPENAI_COMPATIBLE`, `OLLAMA`) with **Supports image
upload** ticked, attach an image, and confirm a warning toast appears naming
the reason.

Note that after bug 91's fix this is now hard to reach by accident — the
describe-fallback intercepts that combination first, which is the point. The
toast is the backstop for a plugin whose declared capability and actual
behaviour disagree.
