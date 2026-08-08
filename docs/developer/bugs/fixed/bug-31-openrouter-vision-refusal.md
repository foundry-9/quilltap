# Bug 31 — OpenRouter's non-streaming path refuses vision sends

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | OpenRouter + images on non-streaming legs |
| **Provenance** | Faithful |
| **Fix site** | `plugins/dist/qtap-plugin-openrouter/provider.ts` — `sendViaChatCompletions` direct-fetch escape hatch for image sends (approach b) |
| **v5 status** | **Owed** — retire the two `EXPECTED_REFUSALS` entries in the request-builder differential |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Medium.** Re-confirmed at `@openrouter/sdk` **1.2.2**. **FIXED in v4
(2026-08-06).**

### Root cause

On the **non-streaming** legs (regenerate, continuation), the `@openrouter/sdk`
request path rejects v4's own content-parts (image) messages at input
validation, client-side — so v4 sends **nothing** and the image never reaches the
model. (The streaming path is fine.) v5 reproduces the refusal; pinned by two
entries in `EXPECTED_REFUSALS` in the request-builder differential.

Confirmed against the live SDK: `chat.send()` validates content parts with a Zod
schema that expects camelCase `imageUrl` objects and rejects the OpenAI
`image_url` snake_case parts v4 builds (`invalid_union` → "expected string,
received array" at the message-content node).

### The fix

**Approach (b) — route the non-streaming vision path around the SDK.** When a
send carries image attachments, `OpenRouterProvider.sendMessage` now calls a new
`sendViaChatCompletions` that hits `POST /api/v1/chat/completions` directly with
`stream:false` and the standard OpenAI `image_url` parts — the exact escape
hatch `streamMessage` already uses for image/tool requests. No-image sends keep
the SDK path unchanged. The direct path has feature parity with the SDK send:
cache key (`user`), tools, web search, structured output, fallback models,
provider preferences (including ZDR `data_collection`), and reasoning are all
forwarded; the response's `raw`/usage/cache/`reasoning` are surfaced identically.
Approaches (a) reshape-to-camelCase and (c) collect-the-stream were rejected as
riskier and higher-churn respectively. Fix site:
`plugins/dist/qtap-plugin-openrouter/provider.ts`.
