# Bug 93 — a provider states its refusal and Quilltap answers "try resending"

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-23) |
| **Found** | 2026-08-23 |
| **Fixed** | 2026-08-23 |
| **Severity** | **Medium** (no data loss; the user is told a refusal is a transient fault and invited to retry something that cannot succeed) |
| **Who it bites** | anyone on a moderated provider — Z.AI, OpenAI, Azure, Google — whose content trips the provider's own filter |
| **Provenance** | Live (Friday, chat `9d1155d9`, 2026-08-23 04:02:49 and 04:02:53 UTC): `glm-5v-turbo` returned `finish_reason: "sensitive"` with empty content, twice |
| **Fix site** | `lib/llm/moderation-finish-reason.ts` (new), `lib/services/chat-message/provider-failover.service.ts` (`getEmptyResponseReason`), `lib/services/chat-message/orchestrator.service.ts` |
| **v5 status** | **Applies.** The finish-reason field is provider testimony and should be read before anything is inferred from an empty body. |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-23).** The provider said why. Nobody read it.

### Symptom

Two consecutive `glm-5v-turbo` turns returned empty content with
`finish_reason: "sensitive"` — Z.AI's moderation layer declining outright. The
Salon rendered a blank message and offered the standard explanation:

> The AI model returned an empty response. This is a known issue with some
> providers. Please try resending your message.

Every clause is wrong here. It is not a known provider quirk, it is a stated
refusal; and resending identical content to the same moderation layer produces
an identical refusal, as the second attempt demonstrated.

### Root cause

`grep -rn "sensitive" lib/` returned nothing. The string appears nowhere in the
codebase. `extractFinishReason` (`lib/llm/extract-finish-reason.ts`) pulls the
value correctly out of every provider dialect and its only consumers were the
LLM-call logger and `isTruncatedFinishReason` in the native tool loop.

`getEmptyResponseReason` — the function whose entire job is explaining an empty
response — did not take a finish reason as a parameter. It inferred from three
booleans about what retries had been attempted, which is guesswork in the
presence of testimony.

### Why it survived

Empty responses are common and usually *are* transient, so the generic copy is
right often enough to look right. The failure needs someone to compare the
message on screen against `llm_logs.response.finishReason` for the same turn to
notice they disagree — and the copy is confident enough that nobody thinks to.

It also hid behind bug 91 in this session: the same turns were failing to
receive their image, so the empty replies read as part of that.

### The fix

`lib/llm/moderation-finish-reason.ts` classifies the known refusal strings:
`sensitive` (Z.AI), `content_filter` / `content-filter` (OpenAI, Azure),
`refusal` (OpenAI Responses), and `safety`, `prohibited_content`, `blocklist`,
`spii`, `image_safety`, `recitation` (Google).

Matching is **literal**, against a set, after lower-casing and trimming — not a
substring test. A false positive tells a user their content was refused when it
was not, which is a worse failure than the one being fixed; `insensitive_stop`
must not match `sensitive`, and a test asserts it.

`getEmptyResponseReason` now takes the finish reason, the provider and the
model, and when the provider named a refusal it says so, names the reason
verbatim, and contradicts the retry advice explicitly: *"resending the same
content will be refused again"*, with the two things that might actually work —
route to an uncensored provider, or change what is being asked. The
orchestrator extracts the reason from `streamingState.rawResponse` and also
logs `moderationRefusal` alongside it.

Testimony first, inference second: everything below the refusal branch is
unchanged.

### How to verify

```bash
npx jest __tests__/unit/lib/llm/moderation-finish-reason.test.ts
```

In V4test: send something a moderated provider will refuse and confirm the
Salon names the provider, the model and the finish reason rather than
suggesting a retry.
