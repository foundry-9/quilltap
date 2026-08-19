# Bug 78 — avatar generation crashes on any chat row written before the hair slot

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-18 (the v5 port's `P4.D87` hair-slot lane — the avatar-job oracle regeneration at `979652a9` turned 7 of 9 fixture cases into this crash; the mechanism then independently re-derived from source at the port's unification review) |
| **Fixed** | 2026-08-18 |
| **Severity** | High (a hard crash of the avatar job on the data every long-lived instance actually has; two sibling read sites degrade soft and silently lose live clothing) |
| **Who it bites** | anyone whose instance predates `4423ad10` (the hair slot) — i.e. every existing real instance. Any chat row whose `equippedOutfit` was written under the four-slot era AND has items equipped crashes avatar generation for that chat's characters; a freshly created chat is fine, and a row with nothing equipped escapes via the `allEquippedItemIds` early return |
| **Provenance** | Pinned — v5 does NOT reproduce (its `Slots::from_value` reads a missing key as `[]` per the hair feature's own no-migration guarantee); the v5 harness pins the divergence in BOTH directions with a convergence tripwire that fires the moment a regenerated v4 oracle stops throwing |
| **Defect site** | `lib/database/repositories/chats.repository.ts:547-558` — `getEquippedOutfit` returns `chat.equippedOutfit as EquippedOutfitState`, a raw cast with no schema parse, so a four-key legacy object flows on unrepaired; `lib/wardrobe/resolve-equipped.ts:162-163` — `for (const slot of WARDROBE_SLOT_TYPES) { const expanded = expandComposites(slots[slot], itemsById) }` with no `?? []`, so `slots['hair']` is `undefined` on a pre-hair row; `lib/wardrobe/expand-composites.ts:115` — `for (const root of rootIds)` then throws `rootIds is not iterable`; `lib/background-jobs/handlers/character-avatar.ts:116` — `buildCharacterAvatarPrompt` is awaited outside any try, so the job dies |
| **Fix site** | both ends, plus the one hand-rolled read that bypassed them. `lib/schemas/wardrobe.types.ts` — new `normalizeEquippedSlots(raw)`, the single place a stored slot bag is coerced to all five slots (`EquippedSlotsSchema.safeParse`, with a key-by-key salvage for a bag the parse refuses); `lib/database/repositories/chats.repository.ts` — `getEquippedOutfit` maps every character's entry through it instead of casting, which heals the two soft sites as well; `lib/wardrobe/resolve-equipped.ts:163` — `slots[slot] ?? []`, so a raw bag handed in by any other caller cannot reach `expandComposites` as `undefined`; `lib/tools/handlers/wardrobe-create-handler.ts` — read the post-equip state through `getEquippedOutfitForCharacter` rather than off the chat row by hand |
| **v5 status** | Not affected — v5's typed `Slots::from_value` defaults an absent key to `[]`. The v5 harness (`avatar_job_tier3_equivalence`, case `legacy_four_key_equipped`) asserts v4 THROWS and v5 COMPLETES-and-writes, both directions, with a convergence tripwire: when v4's regenerated oracle stops throwing, the pin fails loudly and retires to a plain equality |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-18).** Fixed at both ends the filing offered, because
they answer different halves of the question. The repository end is the real
repair: `getEquippedOutfit` now sends every character's entry through a new
`normalizeEquippedSlots`, so the value that leaves the raw JSON column has all
five slots however few it was written with — which heals the crash and the two
soft sites in one move, and means the write path re-persists a whole bag the
next time anything equips. The resolver's `?? []` stays as well, because
`resolveEquippedOutfitForCharacter` is exported and several callers hand it a
slot bag that never passed through the repository (a job payload, a staged
composition); a chokepoint upstream cannot cover a function anyone may call
directly. The normalization deliberately *salvages* rather than parses-or-dies:
a bag the schema refuses for one bad id keeps the slots that are still legible,
since discarding the lot would lose live clothing to repair the crash. A third
site turned up in the sweep — `wardrobe-create-handler` read `equippedOutfit`
straight off the chat row, so the post-equip `current_state` it hands the model
was short a slot on the same rows; it now reads through the repository like
everything else. (One thing the filing describes was left alone: the avatar
handler's `await` outside a try. With the read repaired there is nothing here
for it to catch, and a bare catch there would only hide the next real failure.)

## Symptom

Regenerate an avatar for a character in any chat created before the hair
slot landed, with anything equipped, and the job crashes:

```
TypeError: rootIds is not iterable
```

The avatar never renders. The same underlying read feeds two more sites that
do NOT crash — the scene-state tracker and the context manager's live-outfit
override sit behind their own try/catch — so those degrade soft instead:
the model silently stops being told what the character is wearing.

## Root cause

`4423ad10` added the fifth slot with a deliberate no-migration design:
`equippedOutfit` is unconstrained JSON, and `EquippedSlotsSchema` gives every
slot key `.default([])`, so a four-key legacy row is *supposed* to read as
`hair: []`. The design holds everywhere the value passes through the schema —
but `getEquippedOutfit` (`chats.repository.ts:554`) returns the stored object
through a raw `as EquippedOutfitState` cast, never parsing it, and the
resolver's per-slot loop (`resolve-equipped.ts:163`) indexes
`slots[slot]` without a `?? []`. On a pre-hair row `slots['hair']` is
`undefined`, `expandComposites` iterates it (`expand-composites.ts:115`), and
the avatar handler awaits the whole resolution outside any try
(`character-avatar.ts:116`).

## Why it survived

Every code path that *writes* `equippedOutfit` today writes all five keys, so
fresh data never trips it — only rows written before the feature do, and the
suite's fixtures were all written after. (The v5 port hit it precisely
because its avatar-job fixture builder reproduced the PRE-hair shape: 7 of 9
oracle cases crashed on regeneration, which is what surfaced this.) The
`allEquippedItemIds` early-return further narrows it to rows with items
equipped, which keeps trivial chats out of the blast radius and the crash out
of casual testing.

## Verification

On a copy of any pre-4.9 instance: pick a chat with an equipped outfit from
before the hair feature, trigger avatar regeneration for a participant —
the job fails with `rootIds is not iterable`. After the fix it completes,
and the scene-state / context-manager sites regain the live clothing they
were silently dropping.

Covered in the suite by
`__tests__/unit/lib/wardrobe/resolve-equipped.test.ts` ("resolves a legacy slot
bag written before the hair slot existed" — it reproduces the exact
`rootIds is not iterable` throw when the `?? []` is removed) and by the
`normalizeEquippedSlots` block in
`__tests__/unit/lib/schemas/equipped-slots-forward-compat.test.ts`, which sits
beside the schema-level no-migration guarantee it exists to enforce.

## v5 coordination

v5 stays as it is (it already reads the missing key as `[]`). The pin lives
in `quilltap-v5` `crates/quilltap-harness/tests/avatar_job_tier3_equivalence.rs`
(case `legacy_four_key_equipped`): the v4 leg asserts the throw, the v5 leg
asserts a real completed write. When this bug is fixed v4-side, the next
oracle regeneration flips the v4 leg, the tripwire fires by design, and the
port retires the divergence pin to a plain equality in its next drift
catch-up — the established convergence pattern.
