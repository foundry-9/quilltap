# Bug 66 — the archived-seat sidebar badge cannot light on a fresh load

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-11 (the v5 port's character-archive round-1 beats, their first live run; filed 2026-08-14) |
| **Fixed** | 2026-08-14 |
| **Severity** | Low |
| **Who it bites** | anyone reloading a chat that seats an archived character |
| **Provenance** | v5 e2e beat against the ported chat GET, then verified in v4 source |
| **Fix site** | `lib/services/chat-enrichment.service.ts` — `getCharacterDetail` now projects `archivedAt` on both return paths — **and** `app/salon/[id]/hooks/useParticipants.ts`, whose field-by-field rebuild dropped it again; `EnrichedCharacterDetail` and the client's `CharacterData` carry the field |
| **v5 status** | v5 mirrors BOTH projections faithfully; its archive beat pins the one-badge fresh-load state, and the two-badge assertion returns with the drift round that absorbs this fix |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-14).** `getCharacterDetail` now projects
`archivedAt: character.archivedAt ?? null` exactly as `helpers.ts:67` does, on
**both** of its return paths — the main one and the earlier chat-avatar-override
return, which is the one an archived seat in a chat with a wardrobe-generated
avatar takes. `EnrichedCharacterDetail` declares the field (so the projection
cannot be dropped again without a type error at the return sites), and the
Salon client's `CharacterData` gained the matching optional field so the badge
that `ParticipantCard` renders is type-backed end to end.

**The filing named only half the chain.** Verifying the fix against a live
instance (archive a seated character, reload the chat) showed the payload
carrying `archivedAt` and the badge still dark: `useParticipants`
(`app/salon/[id]/hooks/useParticipants.ts`) rebuilds each participant's
`character` **field by field** for `ParticipantCard`, and dropped the tombstone
on the floor. Which means the badge could not light on *any* path — not after a
participants action either, contrary to the entry below. Both projections now
carry it, and the badge was confirmed on a cold load.

Regression coverage:
two cases in `__tests__/unit/lib/services/chat-enrichment.service.test.ts` — one
per return path — plus the existing shape assertion, which now names
`archivedAt: null` for a living character.

**The original entry follows.**

The character-archive feature (`01e481f6`) taught `ParticipantCard`
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
