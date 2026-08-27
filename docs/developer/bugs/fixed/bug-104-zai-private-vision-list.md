# Bug 104 — the Z.AI plugin kept its own vision list, and a new model outgrew it

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-26) |
| **Found** | 2026-08-26 |
| **Fixed** | 2026-08-26 |
| **Severity** | **Medium** (silent input loss on every turn following a generated image, plus a spurious warning toast) |
| **Who it bites** | anyone running a Z.AI model whose id does not carry a `v` immediately after the generation number — `glm-5.3-flash` and every 5.3+ id — with `supportsImageUpload` ticked |
| **Provenance** | Live (Friday, 2026-08-26), chat `97075274-fa13-4cb7-85c3-dd4e3fe74fdb`, reported as "a weird error that popped up and disappeared" |
| **Fix site** | `plugins/dist/qtap-plugin-z-ai/provider.ts` (plugin 1.1.24) |
| **v5 status** | **Applies.** Any port that lets a provider adapter keep its own model-capability list inherits this. |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-26).** Bug 91's shape, third instance, this time in the
Z.AI plugin — and the only reason it was noticed at all is that bug 94 had
already built the reader.

### Symptom

A warning toast appeared and auto-dismissed after every turn that followed a
Lantern story-background or an Aurora avatar:

> An attachment was not sent to the model: Selected Z.AI model does not support
> image input. Use a vision model such as glm-4.5v or glm-4.6v.

The turn itself succeeded. The character then wrote about a backdrop it had
never been shown.

### Root cause

The two halves of the vision question disagreed about `glm-5.3-flash`.

**The host said yes.** The connection profile `Z.AI GLM 5.3 Flash` carries
`supportsImageUpload = 1`, and the Z.AI plugin's registry entry declares
`supportsAttachments: true` with four image MIME types. Bug 91's predicate
therefore suppressed the describe-fallback and handed the raw bytes to the
plugin — correctly, on the operator's own assertion.

**The plugin said no.** `provider.ts:37` kept a private list:

```ts
const VISION_MODEL_PATTERNS = [/^glm-\d+(\.\d+)?v/i, /^glm-5v/i, /^autoglm-phone/i];
```

Every pattern requires a `v` immediately after the generation number.
`glm-4.6v` matches, `glm-5v` matches, **`glm-5.3-flash` does not** — Z.AI's 5.3
line reads images without a separate `v` variant. `buildUserContent` pushed the
attachment onto `failed` and the bytes never reached the wire.

The plugin's `STATIC_MODELS` catalogue compounds it: it stops at `glm-4.6v` /
`glm-5v-turbo` and has no 5.1, 5.2 or 5.3 entry at all, so every 5.x model
reaches the picker via the live `/models` fetch and is a stranger to the
plugin's own capability logic by construction.

### Why it survived

It did not survive long — bug 94's toast caught it on the first image, which is
exactly the payoff that fix was filed for. What let it *happen* is that bug 91's
rule was applied to NanoGPT and not swept across the other adapters. NanoGPT's
`buildUserContent` carries the reasoning in a comment:

> NanoGPT is a router fronting hundreds of upstream models, so the plugin
> deliberately does NOT keep its own list of which ones read pictures — it would
> be stale within the week. The host has already made that call.

Z.AI is not a router, which is presumably why its list looked defensible. But a
first-party provider ships new model ids too, and a regex pinned to last year's
naming convention is stale the moment the vendor drops the `v` suffix. The list
is the defect, not the pattern inside it.

### The fix

Plugin **1.1.24** deletes `VISION_MODEL_PATTERNS` and `isVisionModel` outright
and drops the `!modelSupportsVision` branch from `buildUserContent`, leaving the
MIME check and the missing-data check as the only reasons an attachment can
fail. `formatMessages` no longer needs its `model` parameter. Attachments now
serialise as `image_url` parts for whatever model the operator pointed at,
matching NanoGPT's post-bug-91 shape.

One question, one answer: *can the model read images?* is the host's to answer,
via `supportsImageUpload`. *Can the transport send them?* is the plugin's, via
the MIME list. Neither one gets to answer the other's question.

### How to verify

1. Point a chat at a Z.AI profile whose model id lacks a `v` suffix
   (`glm-5.3-flash`) and tick **supports image upload**.
2. Let the Lantern generate a story background, or attach any JPEG/PNG/GIF/WebP.
3. Send a turn. **No warning toast**, and the request body carries an
   `image_url` content part — confirm in `llm_logs` for that `CHAT_MESSAGE`.
4. Ask the character what the picture shows; the answer should be grounded in
   the image rather than the surrounding prose.

Regression guard: `glm-5.3-flash` had no static catalogue entry either, so a
model id the plugin has never heard of must still carry its attachments.
