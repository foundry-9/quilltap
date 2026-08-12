# Bug 22 — chat GET omits four controlled-select fields

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Medium |
| **Who it bites** | anyone changing those four settings |
| **Provenance** | Faithful |
| **Fix site** | `app/api/v1/chats/[id]/handlers/get.ts` — project `timelineMode`, `alertCharactersOfLanternImages`, `showThinking`, `answerConfirmationOverride` |
| **v5 status** | **Owed** (Faithful) — re-port the projection |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — the chat GET projection
(`app/api/v1/chats/[id]/handlers/get.ts`) now emits `timelineMode`,
`alertCharactersOfLanternImages`, `showThinking`, and
`answerConfirmationOverride` (each `?? null`), so the controlled selects survive
a reload. Pinned by `handlers/get.test.ts` ("projects the four controlled-select
fields"). v5 obligation (**Faithful**): re-port the projection in the same round.

**Severity: Medium.** The write lands; the display never reflects it.

### Symptom

Change the Story's Clock (timeline mode), lantern-image alerts, show-thinking, or
the answer-confirmation override. The save succeeds, but the select snaps back to
its default, and a reload can never show the true value — for the Story's Clock,
v4 cannot tell you which clock a chat is on.

### Root cause

The chat GET projection (`app/api/v1/chats/[id]/handlers/get.ts`, ~`:528`–`:568`)
builds an explicit object that **omits** `timelineMode`,
`alertCharactersOfLanternImages`, `showThinking`, and
`answerConfirmationOverride`, though `app/salon/[id]/types.ts:253`–`262` declares
all four on the `Chat` type. So the controlled selects read `undefined`.

### The fix

Add the four fields to the GET projection. v5 ports the projection faithfully but
its SPA works around the gap by keeping the in-session choice (v4's own
`selectedTemplateId` idiom) rather than reverting on a successful save; when v4
grows the projection, v5 re-ports it.
