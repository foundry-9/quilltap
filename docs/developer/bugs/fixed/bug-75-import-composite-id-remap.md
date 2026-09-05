# Bug 75 — importing a `.qtap` re-mints wardrobe item ids but not the composite references to them

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-17 (while teaching Summon From Lore to generate composite outfits — the new outfits would have ridden through this exact import path) |
| **Fixed** | 2026-08-17 |
| **Severity** | Medium (silent degradation: every composite outfit in an imported character arrives as an empty bundle — equipping it clears the slots it designates and puts nothing on) |
| **Who it bites** | anyone importing a `.qtap` character whose wardrobe contains composite outfits (`componentItemIds` non-empty) — including every character round-tripped through export→import since the wardrobe composites rework, and, from today, every character Summon From Lore conjures with a generated outfit |
| **Provenance** | Pinned — found by code reading in v4 while extending the assembler; never user-reported because the failure is silent |
| **Defect site** | `lib/import/quilltap-import/import-characters.ts` `importCharacterWardrobeItems` — the create loop strips `item.id` (so `repos.wardrobe.create` mints a fresh id) but passes `componentItemIds` through verbatim, leaving every composite pointing at the export's old ids, which exist nowhere in the destination instance |
| **Fix site** | same function: pre-assign the new ids, remap every `componentItemIds` entry through the old→new map, create leaf items before the composites that bundle them (depth-ordered), and pass the pre-assigned id via `create`'s `options.id` |
| **v5 status** | Not yet assessed — v5's importer must remap composite references whenever it re-mints wardrobe item ids |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-17)** in the same change that taught Summon From Lore and
the AI Wizard to generate composite outfits.

## Symptom

Import a character whose wardrobe contains a composite (an outfit bundling
other items). Every leaf garment arrives intact. The composite also arrives —
title, slots, `replace` flag all faithful — but its `componentItemIds` still
hold the ids the items had **in the export**. The importer re-mints ids on
create, so those references resolve to nothing. Equipping the outfit runs
`dissolveBundlesInSlots` over components that don't exist: the slots the
composite designates are cleared (if `replace`) and nothing is put on. No
error anywhere; the outfit is just hollow.

## Root cause

`importCharacterWardrobeItems` (`lib/import/quilltap-import/import-characters.ts`)
destructures `id` out of each item before calling `repos.wardrobe.create`, so
the repository mints a fresh id — deliberately, to avoid collisions on
`duplicate`-strategy imports. But the spread that carries the rest of the item
(`...itemData`) includes `componentItemIds` untouched. Nothing translated the
old ids to the new ones, and creation order wasn't guaranteed to put components
before the composites referencing them.

## Why it survived

The failure is doubly silent: the import reports success (every row *is*
created), and the wardrobe UI renders the composite card normally — the
dangling references only matter at equip time, where an empty result looks like
an outfit that simply had nothing in it. The legacy `outfitPresets` fold-in
path masked it further: presets predate the composites rework, so the oldest
exports never exercised the broken branch.

## The fix

In `importCharacterWardrobeItems`:

1. Pre-assign a `randomUUID()` for every importable item (`newIdByOldId`).
2. Remap each item's `componentItemIds` through the map; references that don't
   resolve within the same character's items (e.g. shared archetype components,
   which are deliberately not imported) are dropped with an import warning
   rather than left dangling.
3. Sort creation leaf-first by composite depth so no composite is written
   before its components exist.
4. Pass the pre-assigned id via `create`'s existing `options.id` parameter so
   the remapped references are the real row ids.

## How to verify

`__tests__/unit/lib/services/ai-import.service.test.ts` — "resolves generated
composite outfits to componentItemIds" covers the Summon assembler side.
End-to-end: export a character with a composite outfit, import into a fresh
instance, open the wardrobe, equip the outfit — the components go on.
