# Bug 116 — the describer's answer is believed without checking the image ever arrived, and the invention is then permanent

| | |
|---|---|
| **Status** | FIXED in v4 (2026-09-02) |
| **Found** | 2026-09-02 |
| **Fixed** | 2026-09-02 |
| **Severity** | **High** (silent fabrication written to durable storage: a confident, detailed, wholly invented description of a picture the model never saw is persisted onto `files.description`, from where it short-circuits every future reader forever — the chat turn, `describe_image`, the gallery, exports) |
| **Who it bites** | anyone whose Image Description Profile routes through a gateway or model that accepts an `image_url` part and ignores it. Confirmed on `NANOGPT/deepseek/deepseek-v4-flash-vision-exp`; the shape applies to any router fronting hundreds of upstream models, which is most of what NanoGPT and OpenRouter are for |
| **Provenance** | Live (Friday, chat `ed1de505`, file `3358d097-0e09-4204-b9d2-a84fec5331e5`, 2026-09-02 21:23 UTC) — user reported "I attached an image and they used `describe_image` to describe it, and it was definitely the **WRONG** description" |
| **Fix site** | `lib/chat/file-attachment-fallback.ts` — new exported `verifyImageReachedModel`, called from `describeImageWithProfile` ahead of every content check |
| **v5 status** | **Applies.** Any port that substitutes a text description for image bytes must verify the bytes arrived before believing the text. The two proofs are already on the response object; the trap is that neither is looked at, and the failure produces well-formed prose rather than an error. |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-02).** `describeImageWithProfile` now verifies the
image arrived before the text is believed, via a new exported
`verifyImageReachedModel`. Both proofs named below are read: the plugin's
`attachmentResults.failed` ledger, and `usage.promptTokens` against a ceiling
derived from `IMAGE_DESCRIPTION_INSTRUCTION` at a deliberately pessimistic 2.5
chars/token (66 tokens; the live call reported 38, and the cheapest real image
tier in the field would put a genuine call at ~123). Cache-read tokens are
added back before comparing, because every plugin normalises them *out* of
`promptTokens` under the 4.6.1 invariant and a cache hit would otherwise read
as a dropped image. A missing `usage`, or `promptTokens: 0`, is silence and is
not failed. Either verdict returns `type: 'unsupported'` with an error naming
the profile, so the existing fallback chain and the uncensored describer take
their turns exactly as they do after a refusal. The check runs *before* the
empty-response and refusal-detector branches, because the failure it catches
produces the healthiest-looking response in the file.

The provenance note below still describes the pre-fix behaviour and is left as
written.

### Symptom

The user attached a screenshot to a chat in the Estate project. The image is a
gothic warship named **FLYING DUTCHMAN** in orbit over an asteroid field —
1536×1024, dark greens and brass, the ship's name legible on the hull.

Quilltap recorded it as:

> "The image is a vertical, close-up portrait photograph of a small, fluffy
> kitten… classic tabby coat… large, round, bright amber eyes… There is no text
> or watermark present in the image."

3175 characters of it, in six sections, with a paragraph on the bokeh. Nothing
in it is true. Even the horizontal/vertical orientation is wrong, and the one
sentence that could have been checked against the pixels — "no text present" —
is contradicted by the ship's name across the middle of the frame.

The user encountered it through `describe_image`, but the tool is not where it
went wrong. The sequence, from `embedded-server.log`:

| Time (UTC) | Event |
|---|---|
| 21:23:19.7 | upload lands in the Estate project store; `files` row created |
| 21:23:27.8 | `auto-describe` completes, writes 3175 chars to `files.description` |
| 21:23:51.9 | chat turn takes the persisted description (no vision call); Amy is handed the kitten |
| 21:24:24.1 | Abigail calls `describe_image` → `source: 'stored-description'` |

`describe_image` did exactly what it is designed to do: it found a stored
description and returned it for free. The falsehood was already in the database,
put there eight seconds after upload by `autoDescribeChatImageAttachment`.

### Root cause — the describer's answer is accepted on its own recognisance

The describer profile is `NANOGPT/deepseek/deepseek-v4-flash-vision-exp`.
Everything on Quilltap's side of the wire is correct, and it is worth saying so
plainly, because bug 91 lives here and its fix held:

- the running plugin is nanogpt 1.2.1, whose built `buildUserContent` emits
  `{type:'image_url', image_url:{url}}` for each attachment;
- `image/webp` is in `NANOGPT_SUPPORTED_IMAGE_MIME_TYPES`;
- the attachment carried base64 `data`, so `attachmentToImageUrl` returned a
  `data:image/webp;base64,…` URL;
- both halves of bug 91's gate — `profileSupportsMimeType` and
  `providerCanTransportImages` — passed, and passed *honestly*.

The bytes went onto the wire. What came back
(`llm_logs` `43d60b48-3909-41d8-9ca1-b1c244dacf63`) settles where they stopped:

```
usage: {"promptTokens":38,"completionTokens":683,"totalTokens":721}
```

38 prompt tokens is `IMAGE_DESCRIPTION_INSTRUCTION` and nothing else — the
instruction is 163 characters. A 1536×1024 image is hundreds to thousands of
tokens on every provider that charges for one. **The model was billed for text
alone.** NanoGPT accepted the `image_url` part and its route for that
experimental model discarded it, then answered the only thing it had: "Please
describe this image in great detail." A model asked to describe an image it
cannot see will describe *an* image, and 683 tokens of tabby kitten is what a
well-behaved vision model produces from that prompt alone.

**The defect is that Quilltap believed it.** `describeImageWithProfile`
(`lib/chat/file-attachment-fallback.ts:236`) holds two independent proofs that
the image never arrived, and consults neither:

**Proof one — the response's own token count.** `response.usage` is in hand at
`file-attachment-fallback.ts:410`, where it is passed to `logLLMCall` and then
dropped. `promptTokens` at or near the instruction's own token count is a
provider-agnostic, arithmetic-grade statement that no image was processed. It
costs nothing to check and it is the proof that would have caught this exact
call.

**Proof two — the plugin's attachment ledger.** `LLMResponse.attachmentResults`
(`{sent, failed}`) exists precisely so the host can know what actually went on
the wire rather than assuming; the nanogpt plugin populates it deliberately, and
its doc comment says so. `describeImageWithProfile` never reads it. This one
would *not* have fired here — the plugin did send — but it is the detector for
the neighbouring failure class (a plugin that drops the bytes), and leaving it
unread is bug 91's blindness surviving one layer up from where bug 91 was fixed.

What *is* checked is the response text, at `file-attachment-fallback.ts:461`:

```ts
contentLower.includes('error') ||
contentLower.includes('cannot') ||
contentLower.includes('unable to') ||
…
trimmedContent.length < 20
```

That is a refusal detector. It catches a model that says it cannot see the
image, which is the *polite* failure. It cannot catch a model that answers
confidently, and confidence is the failure mode that matters — a 3175-character
description with section headings reads as the healthiest possible result by
every signal this function looks at. Length is used as evidence of success.

### Why it survived

**The failure has no failure.** Nothing throws, nothing is logged at `warn` or
above, no job is marked FAILED, and no attachment is reported dropped. The
`auto-describe: completed` line reports `descriptionLength: 3175` in the same
cheerful tone it would use for a correct answer. From inside the system this is
indistinguishable from success, and there is no later moment at which it is
re-examined.

**It is invisible on a healthy route.** Every describer that genuinely reads the
image produces a correct description, so the bug is dormant for every profile
except the one pointed at a route that silently drops images — and a router
fronting hundreds of models will always have some of those.

**Bug 91 fixed the half that fails loudly enough to find.** That bug was our
plugin discarding bytes, which we control and can test. The half left standing
is the upstream discarding them, which we cannot control — but *can* detect,
from a number the response already carries.

**And the result is durable.** `files.description` is written once and then
short-circuits `runGenerateImageDescription`
(`file-attachment-fallback.ts:568`) and `handleDescribeImage`
(`lib/tools/handlers/doc-edit/photo-handlers.ts`, case 1) forever. A wrong
description is not a bad answer to one question; it is a permanent fact about
the file, and every subsequent reader is *faster* for it. The user's `describe_image`
call 65 seconds later was already too late to catch anything.

### The fix

In `describeImageWithProfile`, after the response returns and before the text is
believed, verify the image arrived. Both checks belong together — they cover
different failure sources — and both must land *before* the description is
returned, since the caller persists whatever it gets.

1. **Ledger check.** If `response.attachmentResults?.failed` names the
   attachment, treat the call as `type: 'unsupported'` with the plugin's own
   error, and let the existing fallback chain try the next describer. A plugin
   that told us it dropped the bytes has already answered the question.

2. **Token-floor check.** Compare `response.usage.promptTokens` against a floor
   derived from the instruction alone. `IMAGE_DESCRIPTION_INSTRUCTION` is a
   module constant, so the floor can be computed once. When prompt tokens do not
   exceed it by a meaningful margin, the image was not processed: fail the
   attempt with an error naming the profile and the observed count, and fall
   through to the chain. Guard on `usage` being present and non-zero — a
   provider that reports nothing must not be failed for silence.

Both failures should name the profile in the error text the way the existing
transport refusal at `file-attachment-fallback.ts:270` does, because the
operator's action is the same one: pick a different describer.

Not in scope, but worth stating so it is a decision and not an oversight: the
persisted description is the amplifier, and there is a case for recording
*provenance* alongside it (which profile, which source, whether the image was
verified as received) so a later reader can distinguish a checked description
from an unchecked one. That is a schema change and belongs in its own pass.

### How to verify

- **Regression, ledger half:** a describer whose provider returns
  `attachmentResults.failed` for the attachment must produce `type:
  'unsupported'` and advance to the fallback chain, not return the model's text.
- **Regression, token half:** a stubbed response carrying a long, plausible
  description and `usage.promptTokens` equal to the instruction's own count must
  fail the attempt. Pre-fix this test returns the description; that is the whole
  bug in one assertion.
- **Guard:** a response with `usage: undefined`, and one with
  `promptTokens: 0`, must **not** be failed — silence about tokens is not
  evidence of a dropped image.
- **Healthy path:** a response with `promptTokens` well above the floor returns
  the description unchanged, with `source: 'vision-call'`.
- **Live:** re-upload the Flying Dutchman screenshot with the describer pointed
  at `deepseek/deepseek-v4-flash-vision-exp`. Expected after the fix: the
  primary fails with a "did not process the image" error naming the profile, the
  chain or the uncensored fallback answers instead, and `files.description`
  holds a description of a ship.

### Related

- **Bug 91** — the same sentence ("a vision model is handed an image its plugin
  never sends, and nothing says so") one layer in. 91 fixed the plugin and built
  the transport gate; this is the case the gate cannot see, because the gate
  asks whether we *can* send and never asks whether it *arrived*.
- **Bug 117** — found while diagnosing this one. Unrelated cause, but it is why
  `auto-describe` reported `linksUpdated: 0` here: the description never reached
  the document store, so at least the search index was spared the kitten.
