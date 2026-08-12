# Bug 41 — `Content-Disposition` mangles a filename with an apostrophe and non-ASCII

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | exporting a chat whose title has both |
| **Provenance** | Pinned |
| **Fix site** | `lib/api/content-disposition.ts` — `buildContentDisposition` runs the ext-value through `encodeExtValue` (percent-encodes `' ( ) * !`) |
| **v5 status** | the `content_disposition` vector `ascii-apostrophe-with-non-ascii` self-retires |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `buildContentDisposition`
(`lib/api/content-disposition.ts`) now runs the ext-value through
`encodeExtValue`, which percent-encodes the RFC 8187 stray characters
`encodeURIComponent` leaves raw (`' ( ) * !`). The apostrophe arrives as `%27`,
so `filename*=UTF-8''…` stays grammatical and browsers recover the real UTF-8
name; plain-ASCII names are unchanged. Covered by the entry's own case in
`__tests__/unit/lib/api/content-disposition.test.ts`. v5 obligation: the
`content_disposition` corpus vector `ascii-apostrophe-with-non-ascii`
self-retires once v4 ships.

**Severity: Low.** Pinned.

### Symptom

Export a chat titled `Wings Over Suparṇā's Quiet Governance`; it downloads with
the two non-ASCII characters replaced by underscores (the ASCII fallback)
instead of the real UTF-8 name.

### Root cause

`lib/api/content-disposition.ts:16`–`17` builds `filename*=UTF-8''${…}` with
`encodeURIComponent`, which leaves `'` **unescaped**. In RFC 8187 the apostrophe
is the delimiter in `charset'lang'value`, so an unescaped `'` inside the value
makes `filename*` ungrammatical; the browser discards it and falls back to the
ASCII substitution (`filename.replace(/[^\x00-\x7F]/g, '_')`). Affects any title
with an apostrophe **and** a non-ASCII character.

### The fix

Percent-encode `'` in the ext-value. v5 fixed it (`encode_ext_value`), pinned by
the corpus vector `ascii-apostrophe-with-non-ascii` — a vanished divergence fails
loudly, so the carve-out self-retires when v4 ships.
