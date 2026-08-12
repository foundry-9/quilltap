# Session 7 — Message attribution & tool cards (Bugs 28, 29, 30)

Three bugs about **who a message or tool run appears to come from** — one on
the LLM-context side, two on the Salon rendering side.

Read the standing rules in [README.md](README.md). Full root causes:
`../bugs.md` → Bugs 28, 29, 30. **All three are Faithful** — same-round
v5 mirrors owed (the entries name the exact v5 sites).

⚠️ Salon client files — ask before editing if the user is mid-chat in dev.

---

## Bug 28 — a Staff-signed ad-hoc announcement reaches the model anonymous

**Severity: Medium.** Ruled a bug in both apps (2026-08-02).

Attribution keys on `customAnnouncer`, which the Insert Announcement dialog
writes only in `character` and `custom` modes. **`staff` mode** carries a
`systemSender` and no `customAnnouncer`, so
`lib/chat/context/announcement-attribution.ts` passes it through untouched
(`resolveAnnouncerName` at `:45`, keyed at `:65`/`:88`) — the announcement
reaches the LLM as a bare anonymous `user` turn. The doc-comment at `:75`
("Staff announcements carry their identity in their prose already") holds only
for prose Staff actually wrote, not operator-authored ad-hoc ones.

**Fix:** widen `resolveAnnouncerName` to fall back to the message's
`systemSender` when `customAnnouncer` is absent, resolve the display name via
the existing staff table (`lib/chat/staff-display-names.ts`), and emit the
same `[Name] ` prefix the other modes get. Fix the `:75` doc-comment. Note the
staff-voicing convention on record: persona body for UI, neutral
`opaqueContent` for LLM context when relevant — make sure the prefix lands on
the LLM-facing text this feature governs, not just the UI copy.

**Verification:** unit test on `resolveAnnouncerName`: staff-mode message with
`systemSender: 'host'` (and `'suparna'`) → prefixed with the staff display
name; character/custom modes unchanged; a message with neither field still
passes through. Fails pre-fix.

---

## Bug 29 — a user-initiated tool card wears the last speaker's face

**Severity: Medium.**

A composer-run tool persists its pending TOOL result with
`initiatedBy: 'user'` and **no** `participantId`
(`orchestrator.service.ts:611`–`:630`). The renderer's positional borrow — a
TOOL row with no participant takes the nearest preceding assistant's
participant, stopping at a USER boundary
(`VirtualizedMessageList.tsx:228`–`:247`) — grabs whoever spoke last, because
the tool row is written *before* the user's message. The name/avatar block is
`ToolMessage.tsx:428`–`:443`.

**Fix:** suppress the positional borrow when `initiatedBy === 'user'` and head
the card with the operator instead. Do not change the borrow for
character-initiated tool rows — that heuristic is correct there.

**Verification:** component/unit test: TOOL row with `initiatedBy: 'user'`
between two other characters' messages → headed as the operator, not the
previous speaker; a character-initiated TOOL row still borrows. Fails pre-fix.
**v5 mirror site:** `chat-view-model.ts::resolveToolAvatar`.

---

## Bug 30 — "whispered to unknown" for a user-initiated private run

**Severity: Low.**

A standalone user-initiated Pascal custom-tool run whispers to `ctx.user.id`
— deliberately the operator's userId, not a participant id
(`app/api/v1/chats/[id]/custom-tools/route.ts:318`–`:320`). The renderer
resolves each `targetParticipantId` via `participantNames?.[id] || 'unknown'`
(`MessageRow.tsx:323`–`:324`), and that map is keyed only by
character-participant ids — so it renders "whispered to unknown".

**Fix:** in the renderer, when a `targetParticipantId` equals the operator's
own userId, render "you"/"yourself". Do not change what the route stores —
the userId targeting is deliberate (it is how `private:true` runs hide from
characters).

**Verification:** unit test on the whisper-label resolution: target = own
userId → "you"; target = participant id → that name; unknown id → today's
fallback. Fails pre-fix.
**v5 mirror site:** `message-row.ts:490`.

---

## Definition of done

- [ ] Three fixes with regression tests failing pre-fix
- [ ] Manual pass: staff-signed ad-hoc announcement shows attributed in the
      LLM log (check via the request log / llm-logs, not just the UI);
      composer tool card wears the operator's face; private run says
      "whispered to you"
- [ ] `npx tsc`, `npm run lint`, full `npm run test:unit` green
- [ ] `docs/CHANGELOG.md` entries; `bugs.md` Status rows flipped
- [ ] Final report: all three Faithful — same-round v5 mirrors owed at the
      named sites; Bug 28 is explicitly a both-apps bug, so the v5 half is a
      fix there too, not just a mirror
