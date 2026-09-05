# Bug 91 — a vision model is handed an image its plugin never sends, and nothing says so

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-23) |
| **Found** | 2026-08-23 |
| **Fixed** | 2026-08-23 |
| **Severity** | **High** (silent data loss on the request path: the model answers a question about a picture it was never shown, and confabulates convincingly) |
| **Who it bites** | anyone on a NanoGPT, DeepSeek, OpenAI-Compatible or Ollama connection profile with **Supports image upload** ticked — the correct setting for `deepseek-v4-flash-vision-exp`, `zai-org/glm-4.6v`, `z-ai/glm-4.5v`, a local llava, and every other genuinely vision-capable model those plugins route to |
| **Provenance** | Live (Friday, chat `9d1155d9`, 2026-08-23 04:02–04:07 UTC) — user reported "attaching an image sometimes doesn't actually send it to the vision capable ones" |
| **Fix site** | `lib/llm/image-transport.ts` (new), `lib/chat/file-attachment-fallback.ts` (`needsFallbackProcessing`, `getImageDescriptionProfile`, `describeImageWithProfile`), `lib/llm/attachment-support.ts`, `plugins/dist/qtap-plugin-nanogpt/` (plugin 1.1.0) |
| **v5 status** | **Applies.** Any port must keep "can the model read images?" and "can the transport send them?" as two separate questions with one predicate each. The trap is entirely in conflating them. |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-23).** A single question was being asked where there
were two, and the two answers differed for exactly the profiles the user cared
about most.

### Symptom

The user uploaded an image and asked the character to react to it. Five model
attempts across three providers, from `llm_logs` for the chat:

| model | provider | received the image? | outcome |
|---|---|---|---|
| `glm-5v-turbo` ×2 | Z_AI | yes | `finish_reason: sensitive`, empty (bug 93) |
| `deepseek-v4-flash-vision-exp` ×2 | NANOGPT | **no** | called `attach_image` (bug 92), then improvised |
| `grok-4.20-reasoning` | GROK | yes | answered |

The NanoGPT attempts are this bug. The profile
`NANOGPT/deepseek/deepseek-v4-flash-vision-exp` is a real vision model, the
operator had correctly ticked **Supports image upload**, the request was logged
with `hasAttachments: true` — and the bytes were discarded inside the plugin
before the wire. The model then wrote a confident paragraph about a picture it
had never seen.

### Root cause — two halves, each harmless alone

**Half one: the host asked the wrong question.**
`lib/llm/connection-profile-utils.ts:136` answers image support from one field:

```ts
if (mimeType.startsWith('image/')) {
  return profile.supportsImageUpload === true
}
```

That flag is a truthful statement about the **model**. It says nothing about
the **plugin**. `needsFallbackProcessing` treated it as the whole answer, so a
ticked box suppressed the describe-fallback.

Note what was *not* consulted: NanoGPT's own manifest declared
`supportsAttachments: false`, and `PROVIDER_ATTACHMENT_CAPABILITIES` in
`lib/llm/attachment-support.ts` had no `NANOGPT`, `Z_AI` or `DEEPSEEK` entry at
all. Both sources knew better; neither was in the path.

**Half two: the plugin dropped what it was handed.** Checking the built bundles
that actually run:

| plugin | emits an image content part |
|---|---|
| openai, grok, z-ai, openrouter, google, anthropic | yes |
| **nanogpt, deepseek, openai-compatible, ollama** | **no** |

NanoGPT extends `OpenAICompatibleProvider`, whose base marks every attachment
failed — `"OpenAI-compatible provider file attachment support varies by
implementation (not yet implemented)"` — and whose message mapper carries the
comment `// Standard messages (strip attachments)`.

Either half alone is survivable. Half one without half two sends real bytes to
a plugin that forwards them. Half two without half one triggers the
describe-fallback, and the model reads a description instead. Together they
cancel: the fallback is suppressed *because* the model can read images, and the
bytes are dropped *because* the plugin cannot send them. The model gets
nothing.

### Why it survived

Three reasons, all of them "the failure had no voice":

1. **The plugin reported it.** `attachmentResults.failed` was populated
   correctly and rode the SSE done event — and no UI component consumed it.
   That is bug 94, filed separately.
2. **The transcript asserted the opposite.** The Librarian's upload
   announcement says *"The bytes ride with the user's message above"*, which
   the model reads as fact.
3. **The output looks like success.** A vision model with no image writes prose
   about the image anyway, from the surrounding conversation. There is no error,
   no gap, no tell — just a description that happens to be invented.

### The fix

**One predicate for the second question.** `lib/llm/image-transport.ts`:
`providerCanTransportImages(provider)` reads the live plugin registry
(`getAttachmentSupport`), falls back to a client-safe static mirror, and
defaults to `true` for a provider neither source knows — so a third-party
vision plugin is not crippled by our ignorance of it.

**Both halves must agree.** `needsFallbackProcessing` now routes to the
describer when the model reads images but the plugin cannot send them, and logs
the divergence. The same check guards describer *selection*: an Ollama or
NanoGPT profile is no longer eligible to be the image describer, because a
describer whose bytes are dropped answers from the instruction alone and
invents a picture — the same bug wearing a different hat, and one the test
suite had actually encoded as expected behaviour (`falls back to the uncensored
profile…` used an `OLLAMA` fallback profile).

**NanoGPT learns to send images** (plugin 1.1.0). `buildUserContent` serialises
`image_url` parts and reports a real `attachmentResults` ledger. NanoGPT routes
to hundreds of upstream models, so the plugin deliberately keeps **no** list of
which ones have vision — it would be stale within the week. The host already
made that call: attachments only reach a profile with `supportsImageUpload` set,
and the describe-fallback has replaced them otherwise.

`DEEPSEEK`, `OPENAI_COMPATIBLE` and `OLLAMA` are left as they are and now
correctly route to the describer. DeepSeek's direct API is text-only; the other
two vary by deployment and would need per-endpoint detection.

### How to verify

```bash
# The three built bundles that could not send images — nanogpt now can.
for p in nanogpt deepseek openai-compatible z-ai grok openai; do
  echo "$p $(ggrep -c image_url plugins/dist/qtap-plugin-$p/index.js)"
done
```

```bash
npx jest __tests__/unit/lib/chat/file-attachment-fallback.test.ts
```

End to end in V4test: pick a NanoGPT vision profile, tick **Supports image
upload**, upload an image, and confirm from `llm_logs` that the request carries
an `image_url` part. Untick the box and confirm a describe-fallback prefix
appears instead — never neither.
