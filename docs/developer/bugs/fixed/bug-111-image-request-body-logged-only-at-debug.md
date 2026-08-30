# Bug 111 — the only record of what an image request posted is written at a level production does not keep

| | |
|---|---|
| **Status** | FIXED in v4 (2026-08-30) |
| **Found** | 2026-08-30 |
| **Fixed** | 2026-08-30 |
| **Severity** | Medium (no data is harmed and nothing behaves wrongly, but a failed image generation is undiagnosable from the logs — and NanoGPT charges the attempt it takes to discover that) |
| **Who it bites** | Anyone debugging a failed NanoGPT image generation on an instance running at `info`, which is every packaged instance |
| **Provenance** | Friday, live, 2026-08-30. Three consecutive `flux-2-dev-lora` failures at 05:07:19, 05:18:20 and — after a source change — nothing in the logs to tell them apart. `grep -c '"level":"debug"' embedded-server.log` returns **0** |
| **Defect site** | `plugins/dist/qtap-plugin-nanogpt/image-provider.ts` — `generateImage`'s `logger.debug('Posting NanoGPT image request')`, and the unwrapped `await client.images.generate(requestParams)` beneath it |
| **Fix site** | `plugins/dist/qtap-plugin-nanogpt/image-provider.ts` — the generate call is wrapped, and the same facts are logged at `error` on the failure path before the throw is re-raised |
| **v5 status** | Not investigated. **The shape applies** to any port whose provider adapters build a request the transport then reports on generically: the adapter is the only layer that knows what it composed, so it must be the layer that says so when the call fails |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-30).** The generate call is wrapped in a `try`/`catch`
that logs the composed request — model, size, `n`, LoRA dialect, the wire keys
actually written, anything dropped, and the passthrough keys — at `error`,
then rethrows unchanged. The `debug` line above it stays for the success path.

## Symptom

Three image generations failed in a row against `flux-2-dev-lora`, each
answered by NanoGPT with the same generic 400:

```
400 "Image generation failed. Please try a different prompt or image.
     You have not been charged for this request."
```

That message covers a rejected adapter, an unreachable weights repo, an
unsupported resolution and a filtered prompt equally well. The host logged it
three times, identically, from `Image generation failed:` and
`[Image Profiles v1] Image generation failed  error: PROVIDER_ERROR` — neither
of which knows anything about the body.

The one line that does know is in the plugin:

```ts
logger.debug('Posting NanoGPT image request', {
  model, size, n, loraDialect: applied.dialect,
  loraKeys: applied.keys, loraDropped: applied.dropped, passthroughKeys,
});
```

Friday runs at `info`. There are **zero** `"level":"debug"` records in
`embedded-server.log`. Establishing what had actually been posted meant opening
the SQLCipher profile row with the CLI and re-deriving the body by hand from
the dialect table in `image-loras.ts`.

## Root cause

The diagnostic was attached to the **wrong event at the wrong level**.

It is written unconditionally before the call, so its level has to be set for
the common case — every successful generation — and `debug` is the right level
for that. But the information is only ever *needed* in the uncommon case, and
by then the level has excluded it. A line that is verbose when it is useless
and absent when it is useful is worse than no line, because its presence in the
source reads as coverage.

The `await client.images.generate(requestParams)` was also unwrapped, so a
throw carried nothing plugin-specific with it. It surfaced through the host's
generic catch, which has the provider's message and no idea what was asked.

The module's own comment anticipated the need almost exactly — *"when the
dogfood run checks whether the flat keys survived NanoGPT's legacy route, this
line is the record of exactly what was posted"* — and the dogfood run is
precisely the context that would not have it.

## Why it survived

It was written with the LoRA feature (`84f33ce94`) and is correct in
development, where the level *is* `debug`. The gap only opens on a packaged
instance, and the feature's first real exercise on one was the session that
found it.

## The fix

```ts
let response: Awaited<ReturnType<typeof client.images.generate>>;
try {
  response = await client.images.generate(requestParams);
} catch (error) {
  logger.error('NanoGPT image request failed', {
    context: 'NanoGPTImageProvider.generateImage',
    model, size: params.size, n: requestParams.n,
    loraDialect: applied.dialect,
    loraKeys: applied.keys,
    loraDropped: applied.dropped,
    passthroughKeys,
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
```

Three things about the shape are deliberate:

- **The `debug` line stays.** Promoting it to `info` would log a body on every
  successful generation to buy nothing — the success path is not the one that
  needs explaining.
- **The throw is re-raised unchanged.** This adds a record; it does not become
  a handler. The host's classification into `PROVIDER_ERROR` is untouched.
- **Key *names* only, never values.** `applied.keys` is a list of the wire keys
  written, which is what keeps `hf_api_token` — a credential attached inside
  `applyLoras` — out of the log while still recording that it was sent.

## How to verify

Configure a NanoGPT image profile with a LoRA source that cannot resolve (a
private or non-existent HuggingFace repo will do) and generate. The log should
now carry one `NanoGPT image request failed` record naming `loraDialect`,
`loraKeys` and the provider's message together, at a level a packaged instance
keeps — enough to separate "the adapter was rejected" from "the adapter was
never sent" without opening the database.
