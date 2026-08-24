# Bug 97 — the OpenRouter registry entry denies the vision path its own provider implements

| | |
|---|---|
| **Status** | Open |
| **Found** | 2026-08-23 (the quilltap-v5 P4.D106 differential's registry-vs-static comparison, while porting bug 91's predicate) |
| **Fixed** | — |
| **Severity** | **Medium** (no data loss, no error; every OpenRouter vision profile silently degrades to the describe-fallback, and the describer guard refuses OpenRouter by name while its own sentence recommends it) |
| **Who it bites** | anyone whose vision profile — or configured image-description profile — sits on OpenRouter, which proxies most of the strongest vision models |
| **Provenance** | Structural, since `a14a1811`. The contradiction itself is older (bug 45 gave the provider real `image_url` serialisation and nobody moved the manifest), but bug 91's fix is what made the declaration load-bearing |
| **Defect site** | `plugins/dist/qtap-plugin-openrouter/index.ts:74-80` (`attachmentSupport`) |
| **v5 status** | **Reproduced faithfully** — v5's baked `openrouter.json` manifest carries the same `false`, so v5 production behaves identically; its `image_transport_equivalence` full_init rows pin the shared wrong answer and will converge on the manifest regen at the drift round after this is fixed |
| **Index** | [bugs.md](../bugs.md) |

---

### Symptom

Tick **Supports image attachments** on an OpenRouter profile pointed at a
real vision model and upload a picture: the bytes never reach the model.
The request is routed to the describe-fallback instead, so the model gets a
paragraph of secondhand description where every other transporting provider
gets the image itself. Configure an OpenRouter profile as the
**image-description profile** and the guard added in bug 91 refuses it
outright:

> Image description profile (OPENROUTER …) cannot send images — the
> OPENROUTER plugin does not forward image attachments. Pick a describer on
> a provider that does (OpenAI, Anthropic, Google, Grok, **OpenRouter**,
> Z.AI).

The sentence names OpenRouter as a provider that *does* forward images,
while refusing an OpenRouter profile for *not* forwarding them. Both clauses
are sincere; they just read different sources.

### Root cause

Bug 91 introduced the right predicate — `providerCanTransportImages`
(`lib/llm/image-transport.ts`) asks the **plugin registry** first, and only
falls back to the client-safe static map when the registry has no answer.
The registry's answer for OpenRouter is wrong:

- `plugins/dist/qtap-plugin-openrouter/index.ts:74-80` still declares the
  pre-vision conservative default — `supportsAttachments: false as const,
  supportedMimeTypes: []`, with a comment explaining that support is
  model-dependent. That was truthful when it was written.
- `plugins/dist/qtap-plugin-openrouter/provider.ts:75-91` has since learned
  to serialise `image_url` content-parts for exactly four MIME types
  (`SUPPORTED_IMAGE_MIME_TYPES` — JPEG/PNG/GIF/WebP; the bug-45 fix), and
  the non-streaming vision path works.
- `lib/llm/attachment-support.ts:84-90` — the static map — says OpenRouter
  transports those same four types.

So the two sources disagree, and which one wins depends on runtime state:
in **production** the registry is initialised, the `false` wins, and every
bug-91 site (`needsFallbackProcessing`, the describer guard, describer
auto-pick) treats OpenRouter as a dropper. In **jest** the registry is
uninitialised, the static map wins, and OpenRouter transports — which is
why the a14a1811 test suite is green over behaviour production never
exhibits. The test environment and production read opposite branches of
the same predicate.

### Why it survived

The declaration was written honestly *before* the provider could send
images; bug 45 fixed the sending half without touching the declaring half,
and nothing connected them — the "keep the two in step" comment discipline
that NanoGPT 1.1.0 got (its `NANOGPT_SUPPORTED_IMAGE_MIME_TYPES` names the
`index.ts` twin) was never retrofitted here. Then bug 91's fix, correctly
preferring the registry as the source of truth, promoted the stale
declaration from dead metadata to routing input. No test caught it because
the registry-initialised configuration has no jest coverage (the v5 port's
differential runs v4's registry both initialised and not, which is how the
disagreement surfaced).

### The fix

Flip `plugins/dist/qtap-plugin-openrouter/index.ts` `attachmentSupport` to
the truth the provider already implements: `supportsAttachments: true`, the
four MIME types (sourced from, or comment-tied to, `provider.ts`'s
`SUPPORTED_IMAGE_MIME_TYPES` — the NanoGPT keep-in-step precedent), and a
description/notes pair that keeps the model-dependent caveat (the
underlying routed model must still be vision-capable — same posture as
NanoGPT 1.1.0's "the host has already decided"). Bump the plugin version.
Add a test that reads the predicate **with the registry initialised**, so
jest finally sees the production branch; without that, the next stale
declaration survives the same way.

### v5 coordination

v5 reproduces production faithfully: its baked
`provider_manifest/manifests/openrouter.json` carries the same `false`, its
`files/image_transport.rs` unit test pins OPENROUTER as non-transporting
with a comment naming this bug's shape, and its `file_attachment` fixture
deliberately chose Z_AI over OpenRouter for the uncensored-describer case
*because* of this contradiction (Z_AI transports under both tiers). When
this fix lands, v5's next drift round regenerates the manifest and the
pinned rows flip with it — the standard convergence, no tripwire needed.
