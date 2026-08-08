# Session 8 — Provider attachments & streaming (Bugs 31, 32, 33, 34, 35)

Five provider-side defects: OpenRouter vision (two), Grok attachments,
a dead base64 guard, and the Ollama SSE splitter. Most of the work lives in
provider **plugins**, so the plugin rules apply throughout.

Read the standing rules in [README.md](README.md). Full root causes:
`../bugs.md` → Bugs 31–35. **All five are Faithful** (31 is pinned via
`EXPECTED_REFUSALS` in the request-builder differential) — v5 mirrors owed in
the same round.

## Plugin rules for this session

- Any plugin change: bump the **patch version** in its `package.json` (and
  `manifest.json` if needed) — manually, then re-run `npm run build:plugins`
  before staging. That build typechecks each plugin and is the *only* thing
  that does (`npx tsc` at the root excludes `plugins/`).
- Plugins must **bundle** their deps — a plugin importing
  `@quilltap/plugin-utils` (or an SDK) unbundled breaks per-instance installs.
- Provider plugins normalize usage to exclude prompt-cache hits — don't
  disturb that while in these files.
- The OpenRouter reasoning channel (`delta.reasoning` being dropped) is a
  **separate pending discussion** — do not change it silently while editing
  the OpenRouter plugin.

---

## Bug 31 — OpenRouter's non-streaming path refuses vision sends

**Severity: Medium.** Re-confirmed at `@openrouter/sdk` 1.2.2. The hardest
item here — do it first while fresh.

On the **non-streaming** legs (regenerate, continuation), the SDK's request
path rejects v4's content-parts (image) messages at input validation,
client-side — so v4 sends **nothing** and the image never reaches the model.
Streaming is fine.

**Fix:** reconcile the message shape with what `@openrouter/sdk` 1.2.2's
non-streaming path accepts. Start by reproducing: build the exact message the
plugin sends on a regenerate leg with an image and run it through the SDK's
validation to see what it objects to. Likely resolutions, in preference
order: (a) reshape the content parts to the schema the SDK validates,
(b) use the SDK's raw/underlying request path for non-streaming when parts are
present, (c) route non-streaming through the streaming path and collect. Pick
the smallest that ships the image; record the choice in `bugs.md`.

**Verification:** a regenerate/continuation leg with an image attachment
reaches OpenRouter carrying the image (assert on the built request in a unit
test; manually confirm against the live API once). Streaming leg unchanged.
**v5:** pinned by two `EXPECTED_REFUSALS` entries — they retire when this
lands.

---

## Bug 32 — a stale client capability map hides OpenRouter vision

**Severity: Low.**

`lib/llm/attachment-support.ts`'s hardcoded map declares OpenRouter
unsupported for attachments while the plugin emits image parts.

**Fix:** update the map so OpenRouter reports vision support (do this in the
same change as Bug 31 so the gate opens onto a working path). Deriving the map
from plugin manifests is a nice-to-have — YAGNI unless it is trivial; if you
skip it, leave a comment pointing map entries at their plugins.

**Verification:** the client attachment UI offers images on an OpenRouter
profile; unit test on the map/gate.

---

## Bug 33 — Grok's text and PDF attachment branches are dead code

**Severity: Low.**

Grok's supported-mime gate is images-only and runs first, so the `text/*` and
PDF branches (and the "requires Grok Files API" arm) are unreachable — every
text/PDF attachment gets "Unsupported file type".

**Fix:** widen the mime gate to admit what the branches behind it actually
handle: `text/*` proceeds inline; PDF reaches the honest "requires Grok Files
API" message instead of the generic rejection. Actual Files API support stays
deferred — do not build it here.

**Verification:** unit tests: text attachment to Grok ships inline content;
PDF gets the Files-API message; unsupported binary still gets the generic
rejection. Fails pre-fix.

---

## Bug 34 — a dead base64 `catch` ships text attachments as mojibake

**Severity: Low.**

For a newline-free, base64-charset **text** file attached to Anthropic or
Grok, the decode is wrapped in `try/catch` — but `Buffer.from(s, 'base64')`
never throws; it leniently mangles (`"hello"` → garbage). The catch is dead
and the mangled bytes ship.

**Fix:** replace the throw-reliance with a round-trip check: decode, re-encode
(normalizing padding/whitespace), and compare; on mismatch treat the content
as plain text rather than base64. Apply at both the Anthropic and Grok sites
(factor the check into a shared helper if they don't already share one —
plugin-utils bundling rules apply if it lands in a shared package).

**Verification:** unit tests with the entry's own examples: `"hello"` and
`"x=1"` attached as text arrive verbatim; a genuine base64 payload still
decodes. Fails pre-fix (ships mojibake).
**v5 note:** v5 currently reproduces the mojibake byte-for-byte via
`node_lenient_base64` (pinned `text-attachment-mangled-b64`) — that pin
retires when this lands.

---

## Bug 35 — the Ollama SSE splitter drops JSON split across reads

**Severity: Low.**

The Ollama stream decoder splits each network read on `\n` with no cross-read
buffer — a JSON object straddling two reads is silently lost.

**Fix:** carry the tail of each read in a buffer until the next newline
arrives; flush any final non-empty tail at stream end (attempt parse; log at
debug if it isn't valid JSON). Standard SSE/NDJSON splitter pattern.

**Verification:** unit test feeding the decoder a response body chopped at an
arbitrary byte boundary mid-object → no content lost, output identical to the
unchopped feed. Fails pre-fix.

---

## Definition of done

- [ ] All five fixes; regression tests failing pre-fix
- [ ] Every touched plugin: patch version bumped, `npm run build:plugins`
      clean (it typechecks the plugins), deps still bundled
- [ ] `npx tsc`, `npm run lint`, full `npm run test:unit` green
- [ ] One manual smoke per provider touched (OpenRouter image regenerate,
      Grok text attachment, Ollama streaming) if profiles are available;
      otherwise say so in the report
- [ ] `docs/CHANGELOG.md` entries; `bugs.md` Status rows flipped, with
      the Bug 31 approach recorded
- [ ] Final report: v5 mirrors owed for all five; Bug 31's
      `EXPECTED_REFUSALS` and Bug 34's `text-attachment-mangled-b64` pins
      named as retiring
