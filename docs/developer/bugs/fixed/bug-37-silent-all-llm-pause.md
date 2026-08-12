# Bug 37 — `AllLLMPauseModal` is unreachable; the pause is silent

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | chats that hit the all-LLM pause threshold |
| **Provenance** | Faithful |
| **Fix site** | `handlers/get.ts` — project `isPaused` + `allLLMPauseTurnCount`; `app/salon/[id]/SalonView.tsx` — opener effect on `isPaused && isAllLLM` |
| **v5 status** | **Owed** (Faithful) — mirror the projection + opener |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — the chat GET projection now emits `isPaused` and
`allLLMPauseTurnCount` (`handlers/get.ts`), and `SalonView` gained an opener
effect that opens `AllLLMPauseModal` whenever `chat.isPaused && isAllLLM`. Because
the chain-complete SSE event already triggers `fetchChat`, that one effect covers
both a live pause and loading an already-paused all-LLM room — no new SSE event,
the transport is left alone. The modal was kept, not deleted. Pinned by
`handlers/get.test.ts` ("projects isPaused and allLLMPauseTurnCount"). v5
obligation (**Faithful**): mirror the projection + opener in the same round.

**Severity: Low.**

### Root cause

The all-LLM-pause **does** fire — the chat stops at the turn-count threshold and
writes `isPaused` — but the dialog that would explain it can never open:
`ChatModals.tsx:423` mounts `AllLLMPauseModal` and `SalonView` wires all three
handlers, yet `setAllLLMPauseModalOpen(true)` appears **nowhere** in v4 (every
occurrence passes `false`). `allLLMPauseTurnCount` / `isPaused` are in neither
app's chat-GET projection, so the client is never told; the user gets a silent
pause with no explanation. (`ChatModals.tsx:427` even computes the dead modal's
`nextPauseAt`.)

### The fix

Either give the modal an opener (and project the fields it needs) or delete it.
