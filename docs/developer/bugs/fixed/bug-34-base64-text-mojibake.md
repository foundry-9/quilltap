# Bug 34 — a dead base64 `catch` ships text attachments as mojibake

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | rare text attachments to Anthropic/Grok |
| **Provenance** | Faithful |
| **Fix site** | `plugins/dist/qtap-plugin-anthropic/provider.ts` + `plugins/dist/qtap-plugin-grok/provider.ts` — `decodeBase64Text` round-trip check |
| **v5 status** | **Owed** — retire the `text-attachment-mangled-b64` pin (`node_lenient_base64`) |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Low.** **FIXED in v4 (2026-08-06).**

### Root cause

For a newline-free, base64-charset **text** file attached to Anthropic or Grok,
v4 wraps the decode in a `try/catch` — but `Buffer.from(s, 'base64')` **never
throws**; it leniently mangles (`"hello" → "��e"`, `"x=1" → ""`). The
catch is dead code, so the mangled bytes ship. v5 now reproduces v4's mojibake
byte-for-byte (via `node_lenient_base64`, pinned by
`text-attachment-mangled-b64`) rather than shipping the raw content.

### The fix

A `decodeBase64Text` helper replaces the throw-reliance with a round-trip check:
decode, re-encode, and compare (normalizing whitespace and trailing padding). A
match means the input really was base64 (return the decoded text); a mismatch
means it was plain text all along (return it verbatim). Applied at both sites —
`plugins/dist/qtap-plugin-anthropic/provider.ts` and
`plugins/dist/qtap-plugin-grok/provider.ts`. The helper is kept local to each
plugin rather than shared through `@quilltap/plugin-utils`: it is a ~10-line pure
function, and each plugin bundles its own deps, so a published-package round-trip
(with its manual-publish gate) would be disproportionate.
