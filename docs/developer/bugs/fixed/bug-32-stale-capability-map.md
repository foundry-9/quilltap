# Bug 32 — a stale client capability map hides OpenRouter vision

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | client-side vision gating for OpenRouter |
| **Provenance** | Faithful |
| **Fix site** | `lib/llm/attachment-support.ts` — `OPENROUTER` reports the plugin's four image MIME types |
| **v5 status** | **Owed** — mirror the map so v5's client offers OpenRouter images |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Low.** **FIXED in v4 (2026-08-06).**

### Root cause

`lib/llm/attachment-support.ts`'s hardcoded capability map declares OpenRouter
**unsupported** for attachments, while the OpenRouter plugin actually emits image
parts. The client's vision-capability gating for OpenRouter is therefore wrong.
v5 was not bent to match the stale map.

### The fix

`PROVIDER_ATTACHMENT_CAPABILITIES.OPENROUTER` now reports the plugin's four image
MIME types (`supportsAttachments: true`), landed alongside Bug 31 so the gate
opens onto a working send path. Deriving the map from plugin manifests stays
YAGNI (the manifests aren't reachable from client code without the server-only
registry); each map entry now carries a comment pointing at its plugin instead.
Fix site: `lib/llm/attachment-support.ts`.
