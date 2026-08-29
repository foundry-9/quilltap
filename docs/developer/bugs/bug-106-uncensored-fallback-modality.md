# Bug 106 — the uncensored reroute inherits a vision model's message array and hands it to a text-only fallback

| | |
|---|---|
| **Status** | OPEN |
| **Found** | 2026-08-29 |
| **Severity** | **High** (the Concierge's last line of defence is guaranteed to fail on any turn carrying an image — the character says nothing and the chain stops) |
| **Who it bites** | anyone on `AUTO_ROUTE` whose `uncensoredTextProfileId` names a model that does not read images, the moment a moderation refusal lands on a turn whose history carries an attachment |
| **Provenance** | Live (Friday, 2026-08-29), chat `f77a332e-1abc-4180-8bc9-97d031d93005` — two consecutive turns for the character **Abigail** produced nothing at all, reported as "some failures the last two turns" |
| **Defect site** | `lib/services/chat-message/provider-failover.service.ts:174` (the reroute re-sends `formattedMessages` verbatim) × `lib/services/dangerous-content/provider-routing.service.ts:82` (the substitute is chosen without asking what it can read) |
| **v5 status** | **Applies.** Any port that swaps the model mid-turn without re-deciding the attachment question inherits it — the message array is shaped for the model it was built for. |
| **Index** | [../bugs.md](../bugs.md) |

---

## Symptom

Two consecutive turns for the same character produced no message at all. The
Salon showed the turn start and then the floor passed on.

```
16:54:04  [EmptyResponse] Empty response from provider that passed moderation, retrying same provider
                                    provider: Z_AI  model: glm-5.3-flash
16:54:06  [EmptyResponse] Same-provider retry also returned empty
16:54:06  [DangerousContent] Empty response detected, attempting uncensored retry
16:54:07  [DangerousContent] Uncensored retry failed
          400 Model "deepseek/deepseek-v4-flash-latest" does not support image inputs.
          Remove image content or choose a multimodal model.
16:54:07  [TurnOrchestrator] Chain stopped: empty response
```

Identical at 16:57:22. Both turns had a live, correctly-configured uncensored
fallback available; both spent it on a request the fallback could not accept.

## Root cause

Two independent things went wrong, and only the second is this bug.

**The trigger** is ordinary and expected: Z.AI's moderation refused the turn.
The logged response is unambiguous — the provider named its own refusal rather
than erroring:

```json
{"content":"","contentLength":0,"error":null,"finishReason":"sensitive"}
```

That is exactly the case `AUTO_ROUTE` exists for, and the machinery fired
correctly: same-provider retry, then reroute to the configured uncensored
profile.

**The defect** is that the reroute changes the model and keeps the message
array. `attemptEmptyResponseRecovery` passes its caller's `formattedMessages`
straight through to `restreamInto`
(`provider-failover.service.ts:174`), and that array carries
`attachments?: unknown[]` per message (`:33`). It was built once, by
`context-builder.service.ts:911`, against the **original** profile — the only
profile `processFileAttachmentFallback` was ever shown.

So bug 91's predicate had already run and already answered, for a different
model:

| | `Z.AI GLM 5.3 Flash` (original) | `DeepSeek V4 Flash Latest` (fallback) |
|---|---|---|
| `supportsImageUpload` | **1** | **0** |
| `isDangerousCompatible` | 1 | 1 |

The tick on the left is what suppressed the describe-fallback and put raw bytes
into the array — correctly, on the operator's own assertion, and bug 104 had
made `glm-5.3-flash` honour it. The **0** on the right is the operator saying,
just as plainly, that this model cannot read pictures. Nothing ever asked it.
`resolveProviderForDangerousContent` (`provider-routing.service.ts:62`) selects
on two conditions and no others — `isDangerousCompatible === true` and a
decryptable API key (`:82`, `:113`) — so a text-only model is a fully eligible
substitute for a vision model mid-turn, and NanoGPT's gateway is left to
discover the mismatch and return a 400.

The failing history, confirmed from `llm_logs`: 87 messages, one attachment at
index 84 (16:57); 85 messages, one at index 74 (16:54). Both were the user's own
"I made you something" messages. So the two turns most likely to carry a picture
were the two turns the safety net could not cover.

## Why it survived

Every case in `provider-failover.service.test.ts` builds its history as
`formattedMessages: [{ role: 'user', content: 'Hello' }]` (`:88`, `:149`,
`:187`) — a plain string, no `attachments` key. The suite exercises the reroute
thoroughly and exclusively in the one shape that cannot expose the fault. The
routing tests are green for the same reason: they assert *which* profile comes
back, which is the question the code does ask.

It is also invisible in production until it fires. The reroute is a recovery
path, so it runs only when the primary has already refused; a chat can carry
images for weeks without the two conditions meeting. When they do meet, the
`[DangerousContent] Uncensored retry failed` line is logged at `error` and the
Salon reports the *original* empty response, so the operator sees a moderation
refusal — which is true — and not the fact that the remedy was structurally
incapable of running.

Worth naming plainly: this is the fourth appearance of bug 91's shape in this
catalogue (91, 97, 104, now 106), and the first where both halves answered
correctly. The profiles are right. The predicate is right. What is missing is
that the answer was computed for a model that is no longer the one being called.

## The fix

Not yet written. Two halves, and they answer different questions:

1. **The router should not offer a model that cannot take the payload.**
   `resolveProviderForDangerousContent` needs to know whether the turn carries
   attachments and filter candidates on `profileSupportsMimeType` (or the
   `supportsVision` capability already carried in `lib/llm/fallback-data.ts:157`)
   as well as `isDangerousCompatible`. The scan at `:113` should skip a
   text-only profile for an image-bearing turn rather than return it.
2. **The reroute should re-decide the attachment question for the profile it
   actually ends up calling.** Even with (1), an explicitly configured
   `uncensoredTextProfileId` is honoured ahead of the scan, so the retry needs
   to re-run `processFileAttachmentFallback` against the substituted profile —
   which for a text-only model means the describe-fallback replaces the bytes
   with a description and the retry proceeds. That is what the describer is for,
   and it turns this failure into a degraded-but-delivered turn.

(1) alone leaves the explicit-profile path broken. (2) alone works but silently
prefers a describer over a vision model that was available. Both, in that order.

**Operator workaround in the meantime:** point `uncensoredTextProfileId` at a
vision-capable profile that is already `isDangerousCompatible` —
`NANOGPT/deepseek/deepseek-v4-flash-vision-exp`, `NANOGPT/zai-org/glm-4.6v`, or
`Grok 4.5`. That rescues both observed turns, and costs nothing on text-only
ones.

## How to verify

1. Set **Concierge → uncensored text profile** to a profile with
   `supportsImageUpload = 0` (`/settings?tab=chat`).
2. In a chat whose current profile has `supportsImageUpload = 1`, attach an
   image to a user message.
3. Provoke a moderation refusal from the primary provider — content that model
   declines, or a profile pointed at a filtered endpoint. The log should show
   `finishReason: "sensitive"` and an empty body.
4. **Before the fix:** `[DangerousContent] Uncensored retry failed … does not
   support image inputs`, then `Chain stopped: empty response`.
   **After:** the retry reaches the fallback with the image replaced by its
   description, and the character answers.
5. Repeat with the uncensored profile set to a vision-capable one — the bytes
   should ride through untouched, with an `image_url` part visible in the
   `CHAT_MESSAGE` request in `llm_logs`.

Regression guard: the existing failover tests must gain a case whose
`formattedMessages` carries an `attachments` array. A green suite over
`content: 'Hello'` is what let this through.
