# Bug 61 — a wardrobe edit staged before the worn snapshot arrives is dropped, and the dialog reports success

| | |
|---|---|
| **Status** | **OPEN** |
| **Found** | 2026-08-12 |
| **Severity** | Medium (silent data loss — the staged outfit is discarded, no request is sent, no error is shown, and the dialog closes exactly as it does on success; the window is short but is entirely a function of server/network speed) |
| **Who it bites** | anyone who opens the in-chat Wardrobe dialog and stages a change (Wear, add-to-slot, take-off) before the outfit fetch chain finishes — wider on a loaded server, a slow link, a large wardrobe, or a cold cache |
| **Provenance** | Faithful — v5 mirrors the defect exactly. Surfaced by deflaking the v5 port's `wardrobe-flow` e2e beat, which this race had been failing intermittently for months |
| **Defect site** | `components/wardrobe/wardrobe-control-dialog.tsx:322-335` (the Live-tab seeding effect overwrites staged slots) and `:648-659` (the flush skips any character with no captured baseline, then reports success), with `lib/hooks/use-outfit.ts:219-252` supplying the three-round-trip delay |
| **Fix site** | — |
| **v5 status** | Faithful — v5 reproduces it line for line and is NOT diverging; the two sides move together when this is fixed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

Open a chat's Wardrobe dialog and click **Wear** on an item as soon as the list
paints. The item appears in the Live tab's slot, exactly as it should. Click
**Done**: the dialog closes, no error appears, no toast complains.

Nothing was saved. Reopen the dialog and the slot is `Empty` — the character is
wearing what they were wearing before. No request was ever sent.

The same gesture a second later works perfectly, which is what makes this so
hard to notice: it is not reproducible on demand, and the failure is
indistinguishable from success at the moment it happens.

## Root cause

Two independent facts about the dialog combine into silent loss.

**1. The item list is ready before the worn snapshot is.** The rows the user
clicks come from `useCharacterWardrobeItems`
(`wardrobe-control-dialog.tsx:174-175`) — its own fetch. The *worn* snapshot
comes from `useOutfit`, and `refreshOutfit` (`lib/hooks/use-outfit.ts:219-252`)
is a chain of **three** round trips before it publishes anything:

```
GET /api/v1/chats/{id}?action=outfit        // :224
  → fetchWardrobeForCharacter(...)          // :240-243  (personal + archetype, :130)
    → setOutfitState(newOutfitState)        // :252
```

So there is a window — the whole interval between the list painting and that
third response landing — in which **Wear is clickable and the snapshot does not
exist yet**.

**2. A click inside that window is discarded twice over.** Stage first:
`updateLiveStaged` (`:459-471`) has no snapshot to build on, so it falls back to
`EMPTY_EQUIPPED_SLOTS` and stages onto empty — fine so far, and the UI paints
the item. Then the snapshot lands and the Live seeding effect runs for the first
time (`:322-335`):

```ts
if (liveSeededByCharRef.current.has(seedKey)) return
liveSeededByCharRef.current.add(seedKey)
liveBaselineByCharRef.current[selectedCharacterId] = cloneSlots(wornSlots)
setLiveStagedByChar((prev) => ({ ...prev, [selectedCharacterId]: cloneSlots(wornSlots) }))
```

The `liveSeededByCharRef` gate exists precisely so a later `refreshOutfit`
round trip cannot blow away in-progress edits — but it only protects edits made
*after* the first seed. This IS the first seed, so it overwrites the user's
staged slots with the worn snapshot unconditionally.

The edit is now gone from state. What makes it **silent** rather than merely
annoying is the flush (`:648-659`):

```ts
const baseline = baselines[characterId]
if (!baseline) continue                    // :653
...
if (dirty.length === 0) return true        // :659  ← reports SUCCESS
```

`"nothing is dirty"` and `"we never learned what clean was"` are indistinguishable
to this loop. Either way it dispatches nothing and returns `true`, so
`requestClose` (`:687-692`) sees `ok` and calls `onClose()`. The dialog closes
the way it closes after a successful save.

(Ordering note: whether the seed lands before or after the click, the outcome is
the same. Click first and the seed overwrites it; click before the baseline is
captured and the flush skips the character. Both paths end in "no request, no
error, dialog closed".)

## Why it survived

- **It looks correct while it is failing.** The staged item renders; only the
  save is missing, and the save reports success.
- **The window is invisible in testing.** On a warm local server the three round
  trips complete in a few milliseconds, so the race is essentially never lost by
  a human typing at human speed on localhost. It is real for anyone on a slow
  link, a loaded instance, or a large wardrobe.
- **The gate that causes it reads like the gate that prevents it.**
  `liveSeededByCharRef` was added to stop `refreshOutfit` clobbering in-progress
  edits, and it does — for every seed but the first, which is the only one that
  matters here.

## Reproducing it

The window is timing, so widen it rather than racing it. Throttle the outfit
read — in devtools, or with a temporary delay in front of
`GET /api/v1/chats/{id}?action=outfit` — to ~3 s, then:

1. Open a chat, open the Wardrobe dialog.
2. As soon as the item list paints, click **Wear** on any item.
3. Click **Done** immediately.
4. Reopen the dialog: the slot is `Empty`, and the network panel shows **no
   `?action=equip` request was ever sent**.

That recipe fails 100% of the time. (Measured on the v5 port, whose dialog is a
line-for-line port of this one: with no injected delay the margin between the
snapshot landing and the click was **3 ms** — response at +312 ms, click at
+319 ms — and a 3 s delay on the outfit read reproduced it on every run, with
the persisted outfit unchanged and no equip in the request log.)

## The fix

Either half alone closes the data loss; the first is the smaller change.

- **Do not let the first seed overwrite user edits.** When seeding, capture the
  baseline unconditionally but only replace `liveStagedByChar[characterId]` if
  the user has not already staged something for that character — i.e. seed
  `prev[characterId] ?? cloneSlots(wornSlots)`. The baseline is then correct
  (the true worn state), the edit survives, and the flush sees it as dirty and
  sends it.
- **Or gate the affordance.** Disable the Live tab's row actions (or the whole
  tab) until the snapshot has seeded, the way any control that depends on
  unloaded data should behave.

Worth doing regardless of which is chosen: make the "no baseline" case in the
flush distinguishable from "nothing changed", so a future regression cannot
report success for an outfit it never sent.

## Verification

- The reproduction recipe above, with the throttle still in place: the edit
  survives, `?action=equip` is sent once with `mode: 'set_all'`, and reopening
  the dialog shows the item.
- The un-throttled path is unchanged: staging after the snapshot has landed
  still sends exactly one `set_all` per dirty character and none for clean ones.
- Check the multi-character case: the seeding effect and the baseline map are
  both keyed per character, so a fix must keep a fast edit on character A from
  being clobbered by character B's snapshot arriving.

## v5 coordination

v5 reproduces this exactly (its dialog and `use-outfit` port are verbatim), and
is **not** diverging — it stays faithful until v4 moves, then absorbs the fix in
a drift catch-up. Nothing on the v5 side is blocked on it: the port's e2e walk
was made deterministic by equipping an accessory *before* opening the dialog and
waiting for it to paint, which sidesteps the race without depending on today's
behavior. That workaround is deliberately independent of the fix, so it keeps
passing either way.
