# Bug 30 — "whispered to unknown" for a user-initiated private run

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | composer custom-tool runs |
| **Provenance** | Faithful |
| **Fix site** | `app/salon/[id]/whisper-visibility.ts` — `resolveWhisperTargetLabel` resolves the operator's own userId to "you"; threaded as `currentUserId` through `SalonView` → `VirtualizedMessageList` → `MessageRow` |
| **v5 status** | **Owed** (Faithful) — mirror at `message-row.ts:490` |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Low.**

**FIXED in v4 (2026-08-06)** — the whisper label resolves through
`resolveWhisperTargetLabel` (`app/salon/[id]/whisper-visibility.ts`), which
renders the operator's own userId as "you" (a participant id resolves to its
name; anything else keeps the "unknown" fallback). The operator's userId is
threaded as `currentUserId` through `SalonView` → `VirtualizedMessageList` →
`MessageRow`. The route's userId targeting is unchanged. Pinned by
`whisper-visibility.test.ts`. v5 obligation: same-round mirror at
`message-row.ts:490`.

### Root cause

A standalone user-initiated Pascal custom-tool run whispers to `ctx.user.id` —
the operator's userId, deliberately not a participant id
(`app/api/v1/chats/[id]/custom-tools/route.ts:318`–`320`). The renderer resolves
each `targetParticipantId` via `participantNames?.[id] || 'unknown'`
(`MessageRow.tsx:323`–`324`), and `participantNames` is keyed only by
character-participant ids, so the operator's own userId never resolves and falls
to "unknown".

### The fix

When a `targetParticipantId` equals the operator's own userId, render "you" /
"yourself". v5 mirrors `message-row.ts:490`.
