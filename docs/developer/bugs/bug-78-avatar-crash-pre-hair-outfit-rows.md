# Bug 78 — avatar generation crashes on any chat row written before the hair slot

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-08-18 (the v5 port's `P4.D87` hair-slot lane — the avatar-job oracle regeneration at `979652a9` turned 7 of 9 fixture cases into this crash; the mechanism then independently re-derived from source at the port's unification review) |
| **Fixed** | — |
| **Severity** | High (a hard crash of the avatar job on the data every long-lived instance actually has; two sibling read sites degrade soft and silently lose live clothing) |
| **Who it bites** | anyone whose instance predates `4423ad10` (the hair slot) — i.e. every existing real instance. Any chat row whose `equippedOutfit` was written under the four-slot era AND has items equipped crashes avatar generation for that chat's characters; a freshly created chat is fine, and a row with nothing equipped escapes via the `allEquippedItemIds` early return |
| **Provenance** | Pinned — v5 does NOT reproduce (its `Slots::from_value` reads a missing key as `[]` per the hair feature's own no-migration guarantee); the v5 harness pins the divergence in BOTH directions with a convergence tripwire that fires the moment a regenerated v4 oracle stops throwing |
| **Defect site** | `lib/database/repositories/chats.repository.ts:547-558` — `getEquippedOutfit` returns `chat.equippedOutfit as EquippedOutfitState`, a raw cast with no schema parse, so a four-key legacy object flows on unrepaired; `lib/wardrobe/resolve-equipped.ts:162-163` — `for (const slot of WARDROBE_SLOT_TYPES) { const expanded = expandComposites(slots[slot], itemsById) }` with no `?? []`, so `slots['hair']` is `undefined` on a pre-hair row; `lib/wardrobe/expand-composites.ts:115` — `for (const root of rootIds)` then throws `rootIds is not iterable`; `lib/background-jobs/handlers/character-avatar.ts:116` — `buildCharacterAvatarPrompt` is awaited outside any try, so the job dies |
| **Fix site (proposed)** | one of the two ends: `resolveEquippedLeaves`' slot loop reads `slots[slot] ?? []` (the one-line spelling `EquippedSlotsSchema.parse` already implies — every slot key is `.default([])`), or `getEquippedOutfit` parses through `EquippedSlotsSchema` instead of casting. The schema-parse end also heals the two soft sites below |
| **v5 status** | Not affected — v5's typed `Slots::from_value` defaults an absent key to `[]`. The v5 harness (`avatar_job_tier3_equivalence`, case `legacy_four_key_equipped`) asserts v4 THROWS and v5 COMPLETES-and-writes, both directions, with a convergence tripwire: when v4's regenerated oracle stops throwing, the pin fails loudly and retires to a plain equality |
| **Index** | [bugs.md](../bugs.md) |

---

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

## v5 coordination

v5 stays as it is (it already reads the missing key as `[]`). The pin lives
in `quilltap-v5` `crates/quilltap-harness/tests/avatar_job_tier3_equivalence.rs`
(case `legacy_four_key_equipped`): the v4 leg asserts the throw, the v5 leg
asserts a real completed write. When this bug is fixed v4-side, the next
oracle regeneration flips the v4 leg, the tripwire fires by design, and the
port retires the divergence pin to a plain equality in its next drift
catch-up — the established convergence pattern.
