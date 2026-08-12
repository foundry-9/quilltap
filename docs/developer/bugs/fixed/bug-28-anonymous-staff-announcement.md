# Bug 28 — a Staff-signed ad-hoc announcement reaches the model anonymous

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | operator-authored Staff announcements |
| **Provenance** | Faithful |
| **Fix site** | `lib/chat/context/announcement-attribution.ts` — `resolveAnnouncerName` falls back to `systemSender` (via `staffDisplayName`) when no `customAnnouncer`, gated to `systemKind === 'announcement'`; prefix also applied to `opaqueContent` |
| **v5 status** | **Owed** (Faithful, both-apps) — this is a bug in v5 too; fix `resolveAnnouncerName` there in the same round, not merely mirror it |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Medium.** Ruled a bug in **both** apps (2026-08-02).

**FIXED in v4 (2026-08-06)** — `resolveAnnouncerName`
(`lib/chat/context/announcement-attribution.ts`) now falls back to the message's
`systemSender`, resolved through `staffDisplayName`
(`lib/chat/staff-display-names.ts`), when no `customAnnouncer` is present, and
emits the same `[Name] ` prefix. The fallback is gated to `systemKind ===
'announcement'` inside `attributeAdhocAnnouncements` so ordinary Staff whispers
(which also carry a `systemSender` but name themselves in their prose) are not
double-tagged, and the prefix is applied to `opaqueContent` as well so it
survives the opaque-anywhere body swap in `normalizeWhisperRoles`. Pinned by
`announcement-attribution.test.ts`. **Both-apps bug:** v5's `resolveAnnouncerName`
must be *fixed* in the same round, not merely mirrored.

### Symptom

An ad-hoc announcement signed as the Host / Suparṇā reaches the LLM as a bare
`user` turn with no attribution — the same anonymous block the whole announcement
attribution feature exists to abolish.

### Root cause

Attribution keys on `customAnnouncer`, which the Insert Announcement dialog
writes only in `character` and `custom` modes. **`staff` mode** carries a
`systemSender` and no `customAnnouncer`, so it passes through untouched
(`lib/chat/context/announcement-attribution.ts` — `resolveAnnouncerName` at
`:45`, keyed on `customAnnouncer` at `:65`/`:88`; the doc-comment at `:75` says
"Staff announcements carry their identity in their prose already", which holds
only when Staff *wrote* the prose, not when an operator signed an ad-hoc one as
Staff).

### The fix

Widen `resolveAnnouncerName` to take the message's `systemSender` when
`customAnnouncer` is absent, resolve the display name from the existing staff
table (`lib/chat/staff-display-names.ts`), and emit the `[Name] ` prefix. v5
mirrors this exactly and must move in the same round.
