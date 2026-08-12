# Bug 33 — Grok's text and PDF attachment branches are dead code

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | text/PDF attachments to Grok |
| **Provenance** | Faithful |
| **Fix site** | `plugins/dist/qtap-plugin-grok/provider.ts` — `isHandledMimeType` admits `text/*` + PDF |
| **v5 status** | **Owed** (Faithful) — mirror the widened gate; retire the grok `unsupported-attachment` vector |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Low.** **FIXED in v4 (2026-08-06).**

### Root cause

Grok's `text/*` and PDF handling never runs: its supported-mime gate is
images-only and runs first, so text/PDF attachments always fall to
"Unsupported file type", and the "requires Grok Files API" arm is likewise
unreachable. Ported as written per the vestigial-cruft rule; pinned by the grok
`unsupported-attachment` vector. (Grok Files API support remains v4's own
deferral.)

### The fix

The gate is now a `isHandledMimeType` check that admits images, `text/*`, and
`application/pdf` — so `text/*` proceeds to the inline-embed branch and PDF
reaches the honest "requires Grok Files API" message, while a genuinely
unsupported binary (e.g. `application/zip`) still gets the generic rejection.
Actual Files API support stays deferred. Fix site:
`plugins/dist/qtap-plugin-grok/provider.ts`.
