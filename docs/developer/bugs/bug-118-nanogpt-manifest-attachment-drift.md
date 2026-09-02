# Bug 118 — the NanoGPT manifest still says images are not forwarded, eleven plugin versions after they were

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-09-02 |
| **Fixed** | — |
| **Severity** | **Low** (no runtime effect today — nothing in `app/` or `lib/` reads the manifest's `providerConfig.attachmentSupport`; it is a shipped, schema-validated, load-bearing-looking declaration that states the opposite of the truth, and the next reader to wire it up inherits a wrong answer for exactly the provider bug 91 was about) |
| **Who it bites** | nobody at runtime; anyone reading the manifest to answer "does NanoGPT forward images?", and any future consumer of the field |
| **Provenance** | Live (Friday, 2026-09-02) — found while diagnosing [bug 116](bug-116-describer-answer-never-verified.md), comparing what the plugin declares against what it does |
| **Fix site** | `plugins/dist/qtap-plugin-nanogpt/manifest.json`, `__tests__/unit/lib/llm/image-transport.test.ts` |
| **v5 status** | **Applies as a discipline point.** A capability declared in more than one place needs every copy under one gate, or the ungated copy is the one that rots. |
| **Index** | [bugs.md](../bugs.md) |

---

### Symptom

NanoGPT declares its attachment support in three places. Two are correct and one
has been wrong since the plugin was introduced.

| source | says |
|---|---|
| `plugins/dist/qtap-plugin-nanogpt/index.ts:106` (the built declaration the registry reads) | `supportsAttachments: true`, JPEG/PNG/GIF/WebP |
| `lib/llm/attachment-support.ts` (`PROVIDER_ATTACHMENT_CAPABILITIES.NANOGPT`) | `supportsAttachments: true`, JPEG/PNG/GIF/WebP |
| `plugins/dist/qtap-plugin-nanogpt/manifest.json` (`providerConfig.attachmentSupport`) | **`supported: false`, `mimeTypes: []`**, *"NanoGPT chat requests are text-only in Quilltap; attachments are not forwarded"* |

The plugin is at 1.2.1 and demonstrably forwards images — its `buildUserContent`
emits `image_url` parts, and the whole point of bug 91's fix (plugin 1.1.0) was
to make it do so.

`git log -S` on the manifest's description string returns exactly one commit:
`781fc4207`, *"feat(providers): add NanoGPT as a bundled provider"*. The block
has never been touched since. Bug 91's fix (`a14a1811d`) updated the code
declaration and added the `NANOGPT` entry to the static mirror, and left the
manifest asserting the behaviour it had just removed.

NanoGPT is the only bundled plugin where the two disagree — the other ten all
match:

```
qtap-plugin-anthropic          code: true    manifest: true
qtap-plugin-google             code: true    manifest: true
qtap-plugin-grok               code: true    manifest: true
qtap-plugin-nanogpt            code: true    manifest: false   ← this bug
qtap-plugin-openai             code: true    manifest: true
qtap-plugin-openrouter         code: true    manifest: true
qtap-plugin-z-ai               code: true    manifest: true
qtap-plugin-deepseek           code: false   manifest: false
qtap-plugin-ollama             code: false   manifest: false
qtap-plugin-openai-compatible  code: false   manifest: false
```

Which is what makes it dangerous rather than merely untidy: a reader checking one
manifest has no reason to suspect it of being the single stale one.

### Root cause — the one copy that nothing gates

`__tests__/unit/lib/llm/image-transport.test.ts` exists precisely to stop the
declarations drifting, and it holds two of the three together — the built
`index.js` and the static mirror. It excludes the manifest **on purpose**, and
says so in a comment:

> *Reading the build (not the source, and not `manifest.json`) matters: bug 97's
> `manifest.json` was already correct, and it was the compiled declaration that
> was wrong.*

That reasoning was right for bug 97, where the manifest was the trustworthy copy
and the build was lying. The conclusion drawn from it — read the build, ignore
the manifest — left the manifest as the only copy with nothing checking it, and
so the only copy free to rot. Bug 97 hardened the two sources that were in the
production path; this is the third, which is in nobody's path and therefore in
nobody's test.

`ProviderConfigSchema` (`lib/schemas/plugin-manifest.ts:315`) validates the
field's *shape* on load, which is exactly enough to make a wrong value look
maintained.

### Why it survived

**Nothing reads it.** A full sweep of `app/`, `lib/`, and `components/` finds no
consumer of `providerConfig.attachmentSupport`. A declaration with no reader
produces no symptom, and the only way to notice is to compare it against the
code by hand — which is what happened here, a year late, while chasing something
else.

**It reads as deliberate.** The description is a full sentence in the house
voice, not a default: *"NanoGPT chat requests are text-only in Quilltap;
attachments are not forwarded."* It was true when written. Nothing about it
looks abandoned.

### The fix

1. Correct the manifest to match the plugin — `supported: true`, the four image
   MIME types from `NANOGPT_SUPPORTED_IMAGE_MIME_TYPES`, and a description that
   matches the code's own (`'Images (JPEG, PNG, GIF, WebP) — requires a
   vision-capable routed model'`). Bump the plugin's patch version in both
   `package.json` and `manifest.json`, and re-run `npm run build:plugins`.

2. Extend `image-transport.test.ts` to hold **all three** declarations together,
   not two. The existing comment stays correct about which source is
   authoritative — the build wins, and a manifest/build disagreement is a
   *manifest* bug — but the disagreement must fail a test rather than wait for
   someone to notice. The check is cheap: every bundled plugin whose built
   `attachmentSupport` is loaded already has its `manifest.json` one directory
   up.

Worth deciding at the same time, though not required to close this: whether the
manifest should carry the field at all, given nothing reads it. Deleting it from
all eleven plugins is also a way to have one source of truth, and a smaller one
than keeping three in sync. The argument for keeping it is that a manifest is
what a third-party plugin author reads and fills in first.

### How to verify

- The parity test fails before the manifest edit and passes after, naming
  `NANOGPT` and the two conflicting values.
- The test also fails if any *other* plugin's manifest is edited out of step with
  its code, which is the property being bought.
- `npm run build:plugins` typechecks and rebuilds nanogpt cleanly; the built
  `index.js` declaration is unchanged by this fix, since it was already right.
