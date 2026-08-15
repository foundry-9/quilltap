# Bug 66 — the archived-seat sidebar badge cannot light on a fresh load

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-08-11 (the v5 port's character-archive round-1 beats, their first live run; filed 2026-08-14) |
| **Fixed** | — |
| **Severity** | Low |
| **Who it bites** | anyone reloading a chat that seats an archived character |
| **Provenance** | v5 e2e beat against the ported chat GET, then verified in v4 source |
| **Fix site** | `lib/services/chat-enrichment.service.ts` — `getCharacterDetail` never projects `archivedAt` |
| **v5 status** | v5 mirrors BOTH projections faithfully; its archive beat pins the one-badge fresh-load state, and the two-badge assertion returns with the drift round that absorbs this fix |
| **Index** | [bugs.md](../bugs.md) |

---

**OPEN.** The character-archive feature (`01e481f6`) taught `ParticipantCard`
to badge an archived seat (`ParticipantCard.tsx:386`,
`participant.character?.archivedAt`) and added `archivedAt` to the
enrichment in `app/api/v1/chats/[id]/helpers.ts` (`getEnrichedCharacter`,
`helpers.ts:67`). But the chat **GET** the sidebar renders from enriches its
characters through `chat-enrichment.service.ts getCharacterDetail`, which
was never extended — it projects no `archivedAt` at all. The helpers
enrichment serves only the participants `?action=` replies and the chat
PUT, and the client refetches after those.

**Consequence:** on a fresh load of a chat with an archived seat, the
`Archived` badge cannot light — the data simply is not in the payload. It
appears only after the client performs a participants action (whose reply
routes through the extended helpers enrichment) and refetches. The archived
seat still takes no turns either way; the badge is the only casualty.

### Root cause

Two enrichment paths for the same projection, and the feature extended one:

- `app/api/v1/chats/[id]/helpers.ts:67` — `archivedAt: charData.archivedAt
  ?? null` (extended by `01e481f6`);
- `lib/services/chat-enrichment.service.ts` `getCharacterDetail` — no
  `archivedAt` key anywhere in the file (verified 2026-08-14 at `24633026`).

### The fix

Project `archivedAt` in `getCharacterDetail` exactly as `helpers.ts:67`
does, so the chat GET carries it on first load.

### v5 coordination

v5 reproduces both projections faithfully (the P4.D63/P4.D64 archive
lanes), and its live archive beat **pins the v4-faithful one-badge
fresh-load state** — when this fix lands, that pin flips by design and the
two-badge assertion returns with the drift catch-up that absorbs it.
