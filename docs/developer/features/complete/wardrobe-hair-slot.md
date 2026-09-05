# Wardrobe "hair" slot

**Status:** Spec for implementation. All decisions are made; do not re-open them or ask the
user — if the code contradicts a line number cited here, trust the code and honor the
*intent* stated here.
**Goal:** Add a fifth wardrobe slot, `hair`, to the existing
`['top', 'bottom', 'footwear', 'accessories']`, threaded through every surface that knows
about wardrobe categories: schemas, equip/displacement mechanics, the LLM tools, the
outfit-choosing LLM, the three AI character generators, wardrobe-from-image analysis,
avatar and scene image prompts, the wardrobe dialogs, exports, and docs.
**Bonus goal (requested):** while touching these sites, consolidate the many duplicated
slot lists into a single source of truth so a sixth slot someday is a small change.

## What the slot means

A `hair` item is a **hairdo, not hair**: "braided", "permed", "elegantly coiffed", "a
severe bun", "marcel waves" — and occasionally a wig or hairpiece. The character's
*natural* hair (colour, length, texture) stays where it has always lived: in
`physicalDescriptions` / the physical-description prompt fields. The boundary rule,
which must be stated consistently in every prompt that draws the wardrobe/physical
line:

> Natural hair — colour, length, texture — is physical description. A deliberate
> hairSTYLE (braids, an updo, a coif, a wig) is a wardrobe item with `types: ["hair"]`.
> An empty `hair` slot means the character's hair is in its natural, unstyled state —
> it never means "no hair".

Because of this, `hair` is **not a clothing slot**. That distinction drives every
special case below (naked collapses, deliberate-nudity detection, undress semantics).

---

## 1. Settled decisions

These were decided with the user's authority; implement exactly this.

1. **Enum value `hair`** (singular, lowercase, matching the style of the others).
   Display label **"Hair"**, group label **"Hair"** (the other groups are plural —
   "Tops", "Bottoms" — but hair is a mass noun; plain "Hair" is correct).
2. **Position: appended LAST** in `WARDROBE_SLOT_TYPES` →
   `['top', 'bottom', 'footwear', 'accessories', 'hair']`. Rationale: the array's order
   is the canonical `types` order (`composite-types.ts`), the YAML frontmatter output
   order (`lib/mount-index/character-vault.ts` `buildWardrobeItemFile`), the bundle-card
   sort order (`group-equipped.ts`), and the UI slot-row order — appending keeps every
   existing item's serialized form and every existing UI ordering stable. Hair renders
   last in slot lists; that is fine.
3. **Hair is excluded from nudity semantics.** "Completely naked and unadorned",
   "- naked", and the `deliberatelyUnclothed` signal are all computed over *clothing*
   slots only. A naked character keeps their braids.
4. **No empty-slot fallback phrase for hair.** The other slots render negative space
   ("topless", "barefoot", "no accessories"); an empty hair slot renders **nothing**
   (natural hair is already described by the physical description).
5. **Undress paths do not get a mechanical hair exemption.** Outfit-selection mode
   `'none'` ("start undressed") continues to empty *every* slot including `hair` (it
   means "no wardrobe applied at all"). Existing user-authored "Naked" `replace`
   composites carry `types: [top,bottom,footwear,accessories]` from before this change
   and therefore never touch hair — correct for free. Going forward, LLM-facing prompt
   text that suggests "designate every slot" for Naked composites is reworded to "every
   *clothing* slot" (see §5.3), but the *mechanics* stay uniform: a composite clears
   exactly what its `types` + leaf slots say, hair included if the author listed it
   (a wig-remover composite legitimately might).
6. **Outfit-hash invalidation is accepted.** `hashEquippedSlots` gains the `hair` key
   unconditionally, so every cached `clothingHash` misses once and every chat re-derives
   its clothing summary one time after upgrade. This is a one-time cheap-LLM cost per
   active chat, not corruption. Do NOT implement conditional key omission to preserve
   old hashes — the permanent complexity isn't worth a transient cache miss. Note it in
   the changelog.
7. **Avatar generation MUST carry the hairdo** (explicit user requirement). Both
   branches of `lib/wardrobe/avatar-prompt.ts` — the dressed branch and the bare-top
   branch — include the `hair` slot, and the bare-top guard that suppresses
   `describeOutfit` must fire when *either* accessories *or* hair is present. A test
   locks this in (§9).
8. **Scene-state `clothing` field carries the hairstyle too.** The persisted field name
   stays `clothing` (no schema churn); its prompts are amended so the summary includes a
   set hairstyle and so undressing does not erase it (§6.3).
9. **Badge color: rose, hue 345** (open gap between accessories at 270° and top at
   220°+wrap; distinct from all five existing hues including shared/240). Exact token
   values in §8.2.
10. **Refactor to one source of truth** (user requested): a slot *metadata registry*
    lives beside the enum; the four duplicated UI label/badge maps, the three local
    `SLOT_KEYS` copies, the two local `cloneSlots` copies, and the five independent
    `validTypes` sets are all replaced by imports. After this change, adding slot #6
    means: extend `WARDROBE_SLOT_TYPES` + `WARDROBE_SLOT_META` (everything else
    type-errors until satisfied), add two CSS token pairs + one badge rule (+ storybook
    mirror), update the LLM prompt texts, the export JSON schema enum, and the docs.
11. **Hats stay accessories.** The help table currently files hats under Accessories;
    that does not change. A hat is worn *over* a hairdo.
12. **No new pseudo-tool aliases** (`simple-json-parser.ts` keeps its existing
    `wear`/`undress`/… aliases; no `style_hair`).
13. **No data migration.** `chats.equippedOutfit` is an unconstrained JSON TEXT column
    and every slot key has `.default([])`, so old rows parse with `hair: []`. Wardrobe
    items are vault frontmatter validated against the (now wider) enum. No DDL change.
    Historical migration scripts and legacy import/restore shapes are frozen and must
    NOT be edited (§7.4).
14. **Forward-compat is one-way lossy and accepted:** a `.qtap` export containing
    `types: ["hair"]` items imports into *older* builds by silently skipping those items
    (`parseWardrobeTypesField` returns null → item skipped). Changelog note only.

---

## 2. Phase 0 — single source of truth (`lib/schemas/wardrobe.types.ts`)

All later phases lean on this. Current state (lines cited as of this writing):
`WardrobeItemTypeEnum` at :25 and `WARDROBE_SLOT_TYPES` at :29 are **two independent
literals**; `EquippedSlotsSchema` (:121–126) and `EMPTY_EQUIPPED_SLOTS` (:154–159)
restate the names a third and fourth time.

Rewrite that region of the file to:

```ts
/** All valid wardrobe slot types, in canonical order (types arrays, frontmatter,
 *  bundle sorting, and UI slot rows all follow this order). Append new slots at
 *  the END — inserting mid-list rewrites every serialized `types` array and
 *  reorders existing UI. */
export const WARDROBE_SLOT_TYPES = ['top', 'bottom', 'footwear', 'accessories', 'hair'] as const;

/** Coverage slot types for wardrobe items (derived — never restate the list) */
export const WardrobeItemTypeEnum = z.enum(WARDROBE_SLOT_TYPES);
export type WardrobeItemType = z.infer<typeof WardrobeItemTypeEnum>;
```

(`z.enum` accepts a readonly tuple; the derived type is identical to today's.)

Add, in the same file, the metadata registry and derived helpers:

```ts
export interface WardrobeSlotMeta {
  /** Singular display label ("Hair") */
  label: string;
  /** Group-header label in the item editor ("Tops", "Hair") */
  groupLabel: string;
  /** qt-* badge class for this slot's chip */
  badgeClass: string;
  /** True for garment slots that participate in nudity semantics; false for styling
   *  slots (hair). Drives naked collapses and deliberate-unclothed detection. */
  isClothing: boolean;
  /** Phrase describeOutfit renders when the slot is visibly empty; null = render
   *  nothing (an empty hair slot is just natural hair). */
  emptyFallback: string | null;
}

export const WARDROBE_SLOT_META: Record<WardrobeItemType, WardrobeSlotMeta> = {
  top:         { label: 'Top',         groupLabel: 'Tops',        badgeClass: 'qt-badge-wardrobe-top',         isClothing: true,  emptyFallback: 'topless' },
  bottom:      { label: 'Bottom',      groupLabel: 'Bottoms',     badgeClass: 'qt-badge-wardrobe-bottom',      isClothing: true,  emptyFallback: 'bottomless' },
  footwear:    { label: 'Footwear',    groupLabel: 'Footwear',    badgeClass: 'qt-badge-wardrobe-footwear',    isClothing: true,  emptyFallback: 'barefoot' },
  accessories: { label: 'Accessories', groupLabel: 'Accessories', badgeClass: 'qt-badge-wardrobe-accessories', isClothing: true,  emptyFallback: 'no accessories' },
  hair:        { label: 'Hair',        groupLabel: 'Hair',        badgeClass: 'qt-badge-wardrobe-hair',        isClothing: false, emptyFallback: null },
};

/** Slots that count as clothing for nudity/undress semantics. */
export const CLOTHING_SLOT_TYPES: readonly WardrobeItemType[] =
  WARDROBE_SLOT_TYPES.filter((s) => WARDROBE_SLOT_META[s].isClothing);
```

Rewrite `EquippedSlotsSchema` so a future slot addition is a compile error until every
key exists, without restating the list as a bare literal:

```ts
const equippedSlotArray = () => z.array(UUIDSchema).default([]);

export const EquippedSlotsSchema = z.object({
  top: equippedSlotArray(),
  bottom: equippedSlotArray(),
  footwear: equippedSlotArray(),
  accessories: equippedSlotArray(),
  hair: equippedSlotArray(),
} satisfies Record<WardrobeItemType, ReturnType<typeof equippedSlotArray>>);
```

(The `satisfies` clause is the enforcement: drop a key and `tsc` points here.)

Replace `EMPTY_EQUIPPED_SLOTS` with a derived constant plus a factory, and add the two
generic helpers that will absorb the local duplicates elsewhere:

```ts
/** Fresh all-empty equipped slots. Prefer this over spreading EMPTY_EQUIPPED_SLOTS. */
export function makeEmptyEquippedSlots(): EquippedSlots {
  return Object.fromEntries(WARDROBE_SLOT_TYPES.map((s) => [s, []])) as unknown as EquippedSlots;
}

/** Empty equipped slots (all empty arrays) — kept for existing call sites. */
export const EMPTY_EQUIPPED_SLOTS: EquippedSlots = makeEmptyEquippedSlots();

/** Deep-ish clone (fresh arrays per slot). Tolerates missing keys on raw JSON. */
export function cloneEquippedSlots(slots: EquippedSlots): EquippedSlots {
  return Object.fromEntries(
    WARDROBE_SLOT_TYPES.map((s) => [s, [...(slots[s] ?? [])]]),
  ) as unknown as EquippedSlots;
}

/** Every item id equipped in any slot, deduplicated. Tolerates missing keys. */
export function allEquippedItemIds(slots: EquippedSlots): string[] {
  return Array.from(new Set(WARDROBE_SLOT_TYPES.flatMap((s) => slots[s] ?? [])));
}
```

Do **not** `Object.freeze` `EMPTY_EQUIPPED_SLOTS` (today's object is mutable; freezing
risks a behavior change if any call site mutates a spread-source assumption).

Note on placement: the meta registry (including `badgeClass` strings) deliberately lives
in `lib/schemas/wardrobe.types.ts` because that module is already imported by both
server code and client components, and one file = one place to add a slot.

## 3. Phase 1 — core wardrobe mechanics (`lib/wardrobe/` and friends)

With Phase 0 in, `npx tsc` will flag most of these. Work through them all; the ones
marked **silent** would NOT be caught by the compiler and must be done from this list.

Replace hand-rolled literals with the Phase-0 helpers:

| File | Change |
|---|---|
| `lib/wardrobe/bundle-mutations.ts` :13–20 | Delete local `cloneSlots`; use `cloneEquippedSlots`. **silent** (explicit spread would just drop `hair`) |
| `lib/wardrobe/outfit-displacement.ts` :87 `freshSlots`, :90–97 local `cloneSlots` | `makeEmptyEquippedSlots` / `cloneEquippedSlots`. **silent** |
| `lib/wardrobe/resolve-equipped.ts` :69 local `SLOT_KEYS` | Delete; import `WARDROBE_SLOT_TYPES`. |
| `lib/wardrobe/resolve-equipped.ts` :95–100 | `const equippedItemIds = allEquippedItemIds(slots);` **silent** (hair items would never resolve) |
| `lib/wardrobe/resolve-equipped.ts` :59–64 `leafItemsBySlot` type, :74–75 `emptyResolved`, :159–170 initializers | Type becomes `Record<WardrobeItemType, WardrobeItem[]>`; build initializers with `Object.fromEntries(WARDROBE_SLOT_TYPES.map(...))`. |
| `lib/wardrobe/dissolve-bundles.ts` :136–141, :188 | `cloneEquippedSlots` / `makeEmptyEquippedSlots`. (:52 `SLOT_SET`, :176, :192 already derive.) |
| `lib/wardrobe/group-equipped.ts` :101–106 `slotRemainders` | `makeEmptyEquippedSlots()`. |
| `lib/wardrobe/default-outfit.ts` :31 | `makeEmptyEquippedSlots()`. |
| `lib/wardrobe/apply-outfit-selections.ts` :45 local `SLOT_KEYS`, :47–52 `emptySlots`, :129–132 + :141–144 `toOutfitPreviewSlots`, :179–184 | Same treatment: import the constant, use the factory, build records generically. |
| `lib/wardrobe/apply-outfit-selections.ts` :465 | **Semantic change:** `SLOT_KEYS.some(...)` → `CLOTHING_SLOT_TYPES.some((slot) => result.result!.slots[slot].length > 0)`. This keeps the "did the LLM deliberately pick nothing" detector working when only hair is styled — an outfit of *only* a hairdo still counts as "picked nothing to wear" for the `deliberatelyUnclothed` path. |
| `lib/wardrobe/avatar-generation.ts` :31–36 `equippedSlotsOverride` structural type | Replace the inline four-key type with `EquippedSlots \| null` (it is plain JSON-serializable data; the named type is fine over IPC). |
| `lib/background-jobs/queue-service.ts` :210–215 | Same — this is the job-payload twin of the previous row; both must change together. |
| `lib/hooks/use-outfit.ts` :193 `bySlot` initializer | Build from `WARDROBE_SLOT_TYPES` (the :196 loop already iterates it). |
| `lib/wardrobe/outfit-hash.ts` :26–31, :41–47 | Rewrite both functions to iterate `WARDROBE_SLOT_TYPES` (insertion order = array order, so serialization stays deterministic): `hashEquippedSlots` builds `normalized` via `Object.fromEntries(WARDROBE_SLOT_TYPES.map((s) => [s, slots?.[s] ?? []]))`; `hasEquippedItems` sums `slots[s]?.length ?? 0` over the constant. **silent** for `hasEquippedItems` (a hair-only outfit would read as "nothing equipped" and short-circuit both hash consumers). Per Decision 6, existing hashes change once; that's fine. |
| `lib/wardrobe/composite-types.ts` :14 doc comment | Update the stated canonical order to include `hair`. (:22 logic already derives.) |
| `lib/wardrobe/staged-live-outfits.ts`, `expand-composites.ts`, `hydrate-components.ts`, `shared-tiers.ts`, `wearable-pool.ts`, `next-copy-title.ts` | **No changes** — verified generic. |

Displacement semantics need **no changes**: `outfit-displacement.ts` keys purely on
`item.types` + `item.replace`, and `dissolve-bundles.ts` clears the union of a bundle's
designated + leaf slots. A `types: ['hair']` item layers/replaces in its slot exactly
like any other; a clothing composite never touches hair unless its author listed it.

## 4. Phase 2 — outfit prose and image prompts

### 4.1 `lib/wardrobe/outfit-description.ts` — the one place slot phrasing lives

- `OutfitSlotValues` (:19–24) becomes `Record<WardrobeItemType, string[]>` (and
  `OutfitSlotName` stays `keyof OutfitSlotValues`, now the full union). Add an exported
  builder so call sites stop hand-writing five-key literals:

  ```ts
  /** Build a full OutfitSlotValues by asking fn for each slot's strings. */
  export function buildOutfitSlotValues(
    fn: (slot: WardrobeItemType) => string[],
  ): OutfitSlotValues {
    return Object.fromEntries(WARDROBE_SLOT_TYPES.map((s) => [s, fn(s)])) as OutfitSlotValues;
  }
  ```

- `describeOutfit` (:83–127) rules, restated in full with hair:
  1. Build `visible` generically over `WARDROBE_SLOT_TYPES` minus `options.omit`
     (replacing the hardcoded :85–90 map).
  2. "Completely naked and unadorned" collapse: fires when every visible **clothing**
     slot is empty AND the hair slot (if visible) is also empty. When all clothing is
     empty but hair is styled, do NOT use the collapse — fall through so the output is
     `- naked` (from the top+bottom rule) plus the footwear/accessories fallbacks plus
     the hair line.
  3. Per-slot rendering order stays: top, bottom (with the existing top+bottom→`- naked`
     collapse), footwear, accessories, then **hair last**.
  4. Empty-slot fallbacks come from `WARDROBE_SLOT_META[slot].emptyFallback`; a `null`
     fallback (hair) means an empty visible slot emits **no line at all**. Occupied hair
     renders like any slot: `- **hair:** braided crown, silver pins`.
  5. The existing same-value line-collapsing (`:100–105`) needs no special-casing — a
     multi-slot item covering `hair` + `accessories` legitimately renders
     `- **hair, accessories:** feathered headdress`.
  6. Update the rule table in the doc comment (:71–81) to match.
- `DescribeOutfitOptions.omit` picks up `'hair'` from the widened type automatically.

### 4.2 `lib/wardrobe/avatar-prompt.ts` — **explicit user requirement, highest priority**

Hair is the most visible element of a head-and-shoulders portrait. Both branches must
carry it:

- `leafCounts` (:48 type, :64 initializer, :129–132 assignments): make it
  `Record<WardrobeItemType, number>` built from the constant.
- Compute `const hair = decorateOutfitItems(resolved.leafItemsBySlot.hair, { titleOnly: true });`
  alongside the existing `accessories` extraction.
- **Dressed branch** (:121–127): include `hair` in the `describeOutfit` values (use
  `buildOutfitSlotValues`); `omit` stays `['bottom', 'footwear']` — hair must NOT be
  omitted.
- **Bare-top branch** (:106–119): the guard `accessories.length > 0` exists solely to
  dodge the "completely naked and unadorned" fallback (SFW moderation). It becomes
  `accessories.length > 0 || hair.length > 0`, and the `describeOutfit` call passes
  `hair` alongside `accessories` with `omit: ['top', 'bottom', 'footwear']` unchanged.
  With §4.1 rule 2, a bare-top character with only a hairdo now yields just the hair
  line — no nudity language. This was the likeliest silent-drop bug in the whole
  feature; §9 pins it with a test.
- Note (no code change): `headAndShouldersPrompt` already describes natural hair. The
  hairdo line *complements* it (colour from physical description + styling from
  wardrobe); that duplication is intended.

### 4.3 Consumers that hand-build the slot-values object

Each currently writes the four keys inline; convert all to
`buildOutfitSlotValues((slot) => ...)` (or a `WARDROBE_SLOT_TYPES` loop for the
flatteners):

- `lib/chat/context-manager.ts` :1499–1504 (live-wardrobe Current Scene State override)
- `lib/background-jobs/handlers/scene-state-tracking.ts` :201–206 (baseline
  `clothingDescription`)
- `lib/image-gen/appearance-resolution.ts` :108–124 `wardrobeItemsToSlotValues`
- `lib/memory/cheap-llm-tasks/image-scene-tasks.ts` :834–841 (`resolveCharacterAppearances`)
- `lib/tools/handlers/image-generation-handler.ts` :999 — hardcoded
  `for (const slot of [...] as const)` loop → `WARDROBE_SLOT_TYPES`. **silent** (hair
  would never reach Lantern image prompts)
- `lib/background-jobs/handlers/story-background.ts` :264 — identical loop, identical
  fix. **silent**

`appearance-resolution.ts` behavioral notes (no further code change): `canSkipResolution`
(:88–95) keys on total equipped-item count; characters with a hairdo equipped may cross
the `<= 1` threshold and trigger LLM resolution where they previously skipped — that is
the same cost rule as any other equipped item, accepted. The undressed path (:234–240,
`sceneChar.clothing || ''`) is handled by the scene-state prompt amendment in §6.3, which
keeps the hairstyle inside the `clothing` summary across undressing.

## 5. Phase 3 — LLM tools (`lib/tools/`)

### 5.1 Schemas — stop restating the enum

Every inline `z.enum(['top', 'bottom', 'footwear', 'accessories'])` is replaced by the
shared schema (this is the chokepoint rule from CLAUDE.md — the Zod schema is the single
source of truth):

- `wardrobe-create-tool.ts` :44 `types:` → `z.array(WardrobeItemTypeEnum).nonempty()`.
  Amend the `.describe()` (:46–55): keep the composite-union explanation but change the
  Naked example's wording to *"e.g. a "Naked" composite that designates every clothing
  slot but only contains a ring — combined with replace:true this clears the other
  clothing slots"*, and append: *"The "hair" slot holds a hairstyle or hairdo (braided,
  permed, an updo, a wig) — the styling, not the hair itself; natural hair colour and
  length belong in the character's physical description, and an empty hair slot simply
  means unstyled hair."*
- `wardrobe-update-tool.ts` :54 `types:` → same `z.array(WardrobeItemTypeEnum).nonempty()`.
- `wardrobe-wear-tool.ts` :48–50 `slot:` → `WardrobeItemTypeEnum.describe(...)` (same
  description text).
- `wardrobe-take-off-tool.ts` :43–47 `slot:` → `WardrobeItemTypeEnum.describe(...)`.
- `wardrobe-list-tool.ts` :16–21 `type_filter` description: add `"hair"` to the listed
  possible values (schema itself stays `z.array(z.string())`).
- `wardrobe-create-tool.ts` :170–172 tool description: extend the leaf example list with
  a hair example — *"…(e.g. ["top"] for a shirt, ["top","bottom"] for a dress,
  ["hair"] for a braided updo)"*.

Result-shape TS interfaces (LLM-visible via JSON): change the hand-written four-key
`current_state`/`slots` objects to `Record<WardrobeItemType, string[]>` (create :152–157,
wear :109–114, take-off :104–109) and `Record<WardrobeItemType, string | null>`
(list :84–89).

Handlers need **no logic changes** — `wardrobe-handler-shared.ts` and all seven per-tool
handlers already iterate `WARDROBE_SLOT_TYPES` or key off `item.types`/`op.slot`
(verified). The create-handler's composite-union (`:247`) and the shared outfit block
(`:183–185`) pick the new slot up automatically.

After the schema edits: `npx jest -u lib/tools/__tests__/tool-definitions-snapshot.test.ts`
(the snapshot materializes the enums and WILL fail until regenerated). Eyeball the
snapshot diff: every wardrobe enum gains `"hair"` and nothing else moves.

### 5.2 The outfit-choosing LLM (`lib/memory/cheap-llm-tasks/outfit-selection.ts`)

- :27 — the slot enumeration becomes:
  `Valid slots are: "top", "bottom", "footwear", "accessories", "hair".` and append this
  sentence to the same paragraph: `The "hair" slot holds a hairstyle or hairdo (braided,
  permed, elegantly coiffed, a wig) — not the hair itself. Leave "hair" empty for the
  character's natural, unstyled hair.`
- :34 — extend the example response with `"hair": []` (keep the example's items as-is so
  the model sees that empty-hair is normal).
- :36–38 — the deliberately-unclothed passage: the example becomes
  `{"deliberate": true, "top": [], "bottom": [], "footwear": [], "accessories": [], "hair": []}`
  and append: `Deliberate nudity is about the clothing slots — an unclothed character
  may still keep a styled hairdo, so fill or empty "hair" on its own merits.`
- :85–89, :158–163, :176–181 — replace the three all-empty literals with
  `makeEmptyEquippedSlots()` / `slots: makeEmptyEquippedSlots()`.
- :183–206 parser/validator — already generic (`for (const slot of WARDROBE_SLOT_TYPES)`,
  and per-slot membership check `itemSlots.includes(slot)`); no change.
- `lib/memory/cheap-llm-tasks/types.ts` :234 — update the comment to
  `// 'top', 'bottom', 'footwear', 'accessories', 'hair'`.

The paired predicate change (`apply-outfit-selections.ts` :465 →
`CLOTHING_SLOT_TYPES`) is in the Phase-1 table; do them together and test together.

### 5.3 Naked-composite guidance

Covered by the create-tool description rewording above ("every clothing slot"). Also
update the matching editor-side comment at `components/wardrobe/wardrobe-item-editor.tsx`
:100 if it restates "every slot". No mechanical exclusion (Decision 5).

## 6. Phase 4 — AI generators, image analysis, scene tracking

### 6.1 The shared semantics strings (`lib/services/character-field-semantics.ts`)

These feed the AI Wizard, Summon From Lore, and the Character Optimizer. Two edits:

- `WARDROBE_SEMANTICS` (:52): extend the slot gloss list with
  `"hair" (a hairstyle or hairdo — braided, permed, an updo, a wig; the styling, not the
  hair itself)`, and amend the closing exclusion sentence to:
  `Anything permanently part of the body (scars, tattoos, fur) is PHYSICAL DESCRIPTION,
  not wardrobe — with one deliberate exception: a hairSTYLE goes in the wardrobe's
  "hair" slot, while the hair's natural colour, length, and texture stay in the
  physical description.`
- `PHYSICAL_DESCRIPTION_SEMANTICS` (:46): after the "NO clothing, outfits, jewelry, or
  accessories" clause, append: `Natural hair — colour, length, texture — belongs here;
  a deliberate hairSTYLE (braids, an updo, a wig) belongs in the WARDROBE's "hair" slot
  instead. Describe the hair itself, not its styling.`

Keep the two statements exactly complementary — they are read by the same models in the
same prompts.

### 6.2 Wardrobe generation prompt + sanitizer (`lib/wardrobe/generated-items.ts`)

Shared by the Wizard and Summon From Lore (`character-wizard.service.ts` and
`ai-import.service.ts` import it; neither has its own enumeration).

- :38 — add the hair gloss to the slot-type sentence, mirroring §6.1's wording.
- :64 — `Generate 4-8 individual garments/accessories…` → `Generate 4-8 individual
  garments/accessories, plus optionally ONE signature hairstyle item (types: ["hair"])
  if the character's look calls for a deliberate hairdo…`
- :69 — align the permanent-features rule with the §6.1 exception sentence.
- :77 — `const validTypes = new Set(['top', 'bottom', 'footwear', 'accessories']);` →
  `new Set<string>(WardrobeItemTypeEnum.options)`. **silent** (the sanitizer would
  otherwise strip `"hair"` and drop the item at :93).

Also touch the physical-description prompts that currently claim all hair:

- `lib/services/character-wizard.service.ts` :260, :266, :272, :277 — after "Do NOT
  include clothing, outfits, or accessories — those are handled separately by the
  wardrobe system.", append `Include the character's natural hair (colour, length,
  texture) here, but not a styled hairdo — hairstyles are wardrobe items.`
- `lib/services/ai-import.service.ts` :209 — same appended sentence.

### 6.3 Scene-state tracking (`lib/memory/cheap-llm-tasks/image-scene-tasks.ts`)

The persisted per-character `clothing` field (≤200 chars) now also carries the hairstyle
(Decision 8). Amend both prompts:

- :193 (initial-summary prompt) and :224 (incremental-update prompt) — extend the
  `clothing` field's definition with: `Include the character's current hairstyle in this
  summary when one is set (e.g. "hair in a tight braid").`
- :188 (the undress rule) — append: `Undressing removes clothing but does NOT remove a
  hairstyle; keep the hairstyle in the summary unless the narrative explicitly changes
  it (hair let down, ribbon pulled loose).`

The baseline builder (`scene-state-tracking.ts` :201–206) already flows hair in via the
Phase-2 `describeOutfit` change; nothing else here. The `clothingHash` cache-miss on
upgrade is Decision 6.

### 6.4 Character Optimizer (`lib/services/character-optimizer.service.ts`)

Independent literals; both must change:

- :140 — `…slot-typed clothing/accessory items (top, bottom, footwear, accessories)…`
  → `(top, bottom, footwear, accessories, hair)`, and append the one-line hair gloss.
- :519 — `Valid slot types: "top", "bottom", "footwear", "accessories"; a single garment
  may cover several slots (a dress is ["top","bottom"]).` → add `"hair"` to the list and
  extend the example clause: `…(a dress is ["top","bottom"]; a braided updo is
  ["hair"])`.
- :505 — align the removable-things sentence with the §6.1 exception wording.

### 6.5 Wardrobe-from-image (`lib/wardrobe/image-analysis.ts`)

The vision prompt actively steers away from describing the person; it needs a rewrite of
three rules plus the validator:

- :124 — rule 3 becomes: `3. Classify it into one or more slot types: "top", "bottom",
  "footwear", "accessories", "hair"` and add a sub-bullet after the existing
  multi-slot one: `- If the subject wears a distinct, deliberate hairstyle (braids, an
  updo, an elaborate coif, a wig), emit ONE "hair" item describing the styling. Plain,
  loose, unstyled hair is NOT an item.`
- :141 — `- Focus ONLY on clothing and accessories. Do not describe people, backgrounds,
  or non-wearable objects.` → `- Focus ONLY on clothing, accessories, and a deliberate
  hairstyle if one is present. Do not describe faces, bodies, backgrounds, or other
  non-wearable features.`
- :143 — `- Valid types are ONLY: "top", "bottom", "footwear", "accessories", "hair"`.
- :147–155 `buildUserPrompt` — `'Analyze this image and identify all visible clothing
  items, accessories, and any deliberate hairstyle.'`
- :161 — `const VALID_TYPES = new Set<string>(['top', …])` →
  `new Set<string>(WardrobeItemTypeEnum.options)`. **silent** (a `"hair"` answer would
  currently be filtered and the item defaulted to `accessories` at :211 — keep that
  default-to-accessories fallback as-is for genuinely unknown types).

### 6.6 AI-wizard UI copy

`components/characters/ai-wizard/types.ts` :284 →
`wardrobeItems: 'Clothing, accessories, hairstyles, and composite outfits (top, bottom, footwear, accessories, hair)',`

## 7. Phase 5 — API routes, persistence, export

### 7.1 API routes

- `app/api/v1/chats/[id]/actions/outfit.ts`
  - :42 — the duplicated `slot: z.enum([...])` → `slot: WardrobeItemTypeEnum.optional()`.
  - :169–174 — the `slotMap` seed → build from `WARDROBE_SLOT_TYPES` (the :177 fill loop
    already iterates the constant; an unseeded `hair` key would `undefined`-push).
  - :124, :233 and the `WardrobeItemType` casts — already generic; verify only.
- `app/api/v1/chats/route.ts`
  - :477–481 — the unguarded four-spread → `allEquippedItemIds(equippedSlots)`.
    **silent-throw risk today** (spreading a missing key throws).
  - :503–508 — the opening-outfit whisper's `outfit` literal →
    `buildOutfitSlotValues((slot) => titlesFor(slot))`.
- The wardrobe CRUD routes (`app/api/v1/wardrobe/*`, `app/api/v1/characters/[id]/wardrobe/*`,
  transfers, preview-avatar, regenerate-avatar) all validate through
  `WardrobeItemTypeEnum` / `EquippedSlotsSchema` — **no changes**, they widen for free.
- `lib/chat/creation-progress.ts` :41–46 — `OutfitPreviewSlots` →
  `export type OutfitPreviewSlots = Record<WardrobeItemType, OutfitPreviewEntry[]>;`
  (SSE payload for the new-chat progress dialog; consumers in
  `components/wardrobe/OutfitSlotsPreview.tsx` are handled in §8).
- `lib/services/aurora-notifications/writer.ts` (:25–31 takes `OutfitSlotValues`) —
  widens via the §4.1 type change; **verify** the whisper body renders slots by
  iterating the object's keys (so hair appears) rather than naming the four; fix to a
  `WARDROBE_SLOT_TYPES` loop if it enumerates.

### 7.2 Doc-comment hygiene

- `lib/schemas/chat.types.ts` :836 and :1190 — update the `equippedOutfit` comments to
  `{ top, bottom, footwear, accessories, hair }`.

### 7.3 Export schema (`public/schemas/qtap-export.schema.json`)

- `$defs/WardrobeItem/properties/types/items/enum` (≈:1244) — add `"hair"`. This is the
  only hard validation blocker (Ajv path used by AI-import and the schema-validator
  tests).
- `$defs/Chat/properties/equippedOutfit` (≈:561–597) — add a `hair` property beside the
  four (same `{ "type": "array", "items": UUID }` shape as its siblings) and update the
  description sentence to `{ top, bottom, footwear, accessories, hair }`. The object is
  open (`additionalProperties` defaults true) so this is documentation-grade, but keep
  the schema honest.
- `$defs/LegacyOutfitPreset` (≈:1295) — **do not touch** (frozen pre-4.5 shape).
- The NDJSON schema `$ref`s the monolith — no separate change.

### 7.4 Explicitly frozen — do NOT edit

Historical formats that can never contain `hair`:
`lib/backup/restore/legacy-migrations.ts` (incl. `upgradeLegacyEquippedSlots` — it only
runs on the detected legacy single-UUID shape), `lib/backup/restore/archive.ts` legacy
sniffing (:145–181), `lib/import/quilltap-import/legacy-presets.ts`,
`lib/database/repositories/vault-overlay/schema.ts` `LegacyVaultWardrobeJsonSchema`
(:81–91), and everything in `migrations/scripts/` (`migrate-clothing-records-to-wardrobe`,
`migrate-outfit-presets-to-composites-v1`, `convert-equipped-outfit-to-arrays-v1`).

Also automatically correct with zero edits (verified): vault write path
(`lib/mount-index/character-vault.ts` `buildWardrobeItemFile` passes `types` through),
vault read gate (`vault-overlay/parsers.ts` `parseWardrobeTypesField` derives its
allow-set from `WardrobeItemTypeEnum.options`), `wardrobe.repository.ts`,
`vault-overlay/wardrobe-writes.ts` / `wardrobe-sync.ts`, `chats.repository.ts`
(`removeEquippedItemFromAllChats` iterates the constant),
`lib/background-jobs/handlers/wardrobe-announcement.ts` (`EquippedSlotsSchema.safeParse`),
and the Quilltap CLI (no wardrobe category knowledge; its `wardrobe/` path counter is
slot-agnostic).

## 8. Phase 6 — UI

### 8.1 Kill the duplicated maps, add the slot

Delete the local `SLOT_LABEL` / `SLOT_LABELS` / `TYPE_BADGE_CLASS` copies and read
`WARDROBE_SLOT_META[slot].label` / `.badgeClass` instead:

- `components/wardrobe/equipped-slot-row.tsx` :29–41 (consumers :102, :108, :117, :163 —
  the lowercased label interpolations, e.g. "Search hair items…", read fine as-is)
- `components/wardrobe/wardrobe-item-row.tsx` :51–63 (consumers :154, :203, :258–259)
- `components/wardrobe/equipped-bundle-card.tsx` :30–42
- `components/wardrobe/outfit-selector.tsx` :130–135, plus its five inline unions/arrays:
  :104 and :164 (`Partial<Record<'top'|'bottom'|'footwear'|'accessories', …>>` →
  `Partial<Record<WardrobeItemType, …>>`), :232 and :387/:395 (the `as const` arrays and
  type predicate → iterate `WARDROBE_SLOT_TYPES`).
- `components/wardrobe/wardrobe-control-dialog.tsx` :70 —
  `const SLOT_FILTERS: SlotFilter[] = ['all', ...WARDROBE_SLOT_TYPES];` (labels at
  :979–986 are derived by capitalization already). This filter row grows to six
  buttons — check it wraps acceptably in the dialog at narrow widths; add `flex-wrap` to
  its container if it doesn't.
- `components/wardrobe/OutfitSlotsPreview.tsx` :16–21 — derive `SLOTS` from
  `WARDROBE_SLOT_TYPES.map((key) => ({ key, ...WARDROBE_SLOT_META[key] }))`; update the
  ":4 four-slot" doc comment. Keep `sm:grid-cols-2` (five cells lay out 2+2+1; the
  orphan cell is acceptable).
- `components/wardrobe/wardrobe-item-editor/types.ts` :17 —
  `export type CandidateGroup = WardrobeItemType | 'multi';`
- `components/wardrobe/wardrobe-item-editor/constants.ts` — `GROUP_LABEL` derives from
  `WARDROBE_SLOT_META[*].groupLabel` plus `multi: 'Multi-slot'`;
  `GROUP_ORDER = [...WARDROBE_SLOT_TYPES, 'multi']` (`multi` must stay last); delete its
  `TYPE_BADGE_CLASS` copy.
- Already derive from `WARDROBE_SLOT_TYPES` and need nothing: `outfit-composer.tsx`,
  `wardrobe-item-editor.tsx` (:559 checkbox group auto-gains a capitalized "Hair"
  checkbox; :251 replace-widening), `WardrobeComponentPicker.tsx`,
  `ProjectWardrobeManager.tsx` (:235 renders raw lowercase `{type}` — while there, wrap
  it in the same `capitalize` treatment its siblings use), `import-from-image-modal.tsx`,
  `WardrobeTransferDialog.tsx`.

### 8.2 CSS tokens and badge class

`app/styles/qt-components/_variables.css` — add to the light block (after the
accessories pair, ≈:489):

```css
--qt-badge-wardrobe-hair-bg: hsl(345 55% 55% / 0.12);
--qt-badge-wardrobe-hair-fg: hsl(345 55% 42%);
```

and to the dark block (≈:828):

```css
--qt-badge-wardrobe-hair-bg: hsl(345 55% 58% / 0.25);
--qt-badge-wardrobe-hair-fg: hsl(345 55% 72%);
```

`app/styles/qt-components/_content.css` — add `.qt-badge-wardrobe-hair` to the shared
badge-geometry selector list (≈:212–216, beside its siblings) and a rule block after the
shared/indigo one (≈:1671):

```css
/**
 * Wardrobe hair badge (rose)
 */
.qt-badge-wardrobe-hair {
  background-color: var(--qt-badge-wardrobe-hair-bg);
  color: var(--qt-badge-wardrobe-hair-fg);
}
```

### 8.3 theme-storybook mirror — **publish gate**

The `qt-badge-wardrobe-*` family is **entirely absent** from
`packages/theme-storybook/src/css/qt-components.css` (verified by grep), and per the
standing rule the whole family gets ported, not just the new class:

1. Port `.qt-badge-wardrobe-{top,bottom,footwear,accessories,shared,hair}` into the
   storybook CSS: the shared geometry rule de-Tailwinded to plain CSS (that file uses no
   `@apply` — translate `inline-flex items-center justify-center flex-shrink-0` and the
   padding/token properties into literal CSS, mirroring how the app rule at
   `_content.css` :205+ resolves), plus the six per-slot color rules, plus the twelve
   `--qt-badge-wardrobe-*` token pairs in the storybook's light and dark variable
   sections following the file's existing token conventions. Mirror the app
   **faithfully, quirks included**.
2. Optionally extend the wardrobe-notice sample copy in
   `packages/theme-storybook/src/stories/components/Chat.tsx` (:402) with a hair
   mention (e.g. `Wearing: Crimson Evening Gown (top, bottom), Glass Slippers
   (footwear), Marcel Waves (hair)`) so theme authors can see the badge context.
3. Bump the package's **patch version**, run `npm run build` inside the package, then
   **STOP and ask the human to `npm publish`** — the publish gates the commit
   (CLAUDE.md standing rule). Do not work around a failed publish.

No bundled-theme changes: grep confirms none of `themes/bundled/*` overrides any
`qt-badge-wardrobe` token, and there is no per-slot icon anywhere (slots are text
badges), so no icon-registry or Madman's Box work.

## 9. Phase 7 — tests

### 9.1 Existing tests that must be updated (compile errors or literal four-key fixtures)

`__tests__/unit/lib/wardrobe/*` (dissolve-bundles, apply-outfit-selections.tiers,
group-equipped, default-outfit, outfit-utils, avatar-prompt, resolve-equipped,
wardrobe-frontmatter-replace, outfit-hash, generated-items,
apply-outfit-selections.concurrency), `__tests__/unit/lib/tools/handlers/
wardrobe-handlers.test.ts` + `wardrobe-handler-shared.test.ts`,
`__tests__/unit/lib/memory/cheap-llm-tasks/outfit-selection.test.ts`,
`__tests__/unit/lib/background-jobs/handlers/scene-state-tracking.test.ts`,
`__tests__/unit/image-gen/appearance-resolution.test.ts`,
`__tests__/unit/app/api/v1/chats/[id]/actions/outfit.test.ts`,
`__tests__/unit/app/api/v1/wardrobe/transfers/route.test.ts`,
`__tests__/unit/components/wardrobe/wardrobe-control-dialog.race.test.tsx`,
`__tests__/unit/lib/database/repositories/character-properties-overlay.test.ts`,
`__tests__/unit/lib/services/staff-opaque-voicing.test.ts`,
`lib/chat/__tests__/creation-progress.test.ts`,
`__tests__/unit/lib/validation/qtap-schema-validator.test.ts`,
`__tests__/unit/api/run-tool-action.test.ts`.
Where a fixture builds `{ top: [], bottom: [], footwear: [], accessories: [] }`, prefer
switching it to `makeEmptyEquippedSlots()` over adding a fifth literal key.

Tool snapshot: `npx jest -u lib/tools/__tests__/tool-definitions-snapshot.test.ts`.

`outfit-hash.test.ts` asserts relations (equal/not-equal), not pinned digests — it
should pass with at most fixture updates.

### 9.2 New tests (write these; they pin the decisions)

1. **`describeOutfit` hair semantics** (extend
   `__tests__/unit/lib/wardrobe/outfit-utils.test.ts` or the module's own test):
   - all slots empty → `- completely naked and unadorned` (hair does not break the
     collapse);
   - all clothing empty + hair `['braided']` → output contains `- naked` and
     `- **hair:** braided`, NOT "completely naked and unadorned";
   - dressed + hair empty → NO hair line and no "no hairdo"-style fallback;
   - dressed + hair set → `- **hair:** …` rendered last.
2. **Avatar prompt carries the hairdo** (extend
   `__tests__/unit/lib/wardrobe/avatar-prompt.test.ts`):
   - dressed character with an equipped hair item → prompt text contains the hairdo;
   - bare-top character with NO accessories but WITH a hair item → prompt contains the
     hairdo and contains no nudity language (the reworked guard);
   - bare-top with neither → outfitText empty (existing behavior preserved).
3. **Deliberate-unclothed detection ignores hair**
   (`apply-outfit-selections` tests): an LLM selection of `deliberate: true` with all
   clothing slots empty and hair styled still routes to `deliberatelyUnclothed`.
4. **Outfit-selection parser accepts hair** (`outfit-selection.test.ts`): a response
   with `"hair": ["<uuid>"]` where the item's `types` is `['hair']` lands in the slot;
   a hair-typed item offered to `top` is rejected (existing per-slot membership rule).
5. **Sanitizers accept hair**: `generated-items` — an item with `types: ['hair']`
   survives `sanitizeGeneratedWardrobeItems`; `image-analysis` — parser keeps a
   `"hair"` item (and still defaults unknown types to `accessories`).
6. **Hash includes hair** (`outfit-hash.test.ts`): equipping a hair item changes the
   hash; `hasEquippedItems({ ...empty, hair: ['x'] })` is true.
7. **Round-trip**: `EquippedSlotsSchema.parse` of a four-key legacy object yields
   `hair: []` (the no-migration guarantee).

### 9.3 Verification checklist

- `npx tsc` (NOT `npm run build`) — must be clean; it is the net that catches the
  remaining hand-written five-key literals.
- `npm run lint` (also sweeps docs for the Quilltap spelling rule).
- `npm run test:unit`.
- Manual smoke on the V4test instance (`~/iCloud/Quilltap/V4test`, dev on :3005 — never
  Friday): create a "Braided Crown" item with types `["hair"]` from the wardrobe dialog;
  wear it via the dialog and via `wardrobe_wear`; confirm the Hair slot row, rose badge,
  and slot filter render; generate an avatar and confirm the hairdo phrase appears in
  the logged image prompt; run a wardrobe-from-image import on a portrait with an
  elaborate updo and confirm a hair item is proposed; start a new chat with
  `llm_choose` and confirm the model may fill `hair`; verify an old chat (created
  pre-change) still loads its outfit and re-derives its clothing summary once.

## 10. Phase 8 — documentation

Help docs (steampunk/Wodehouse voice; each keeps its `url` frontmatter and In-Chat
Navigation section intact):

- `help/wardrobe.md` — :11 "tops, bottoms, footwear, and accessories" → five-way list;
  :21 "four slots" → five, and add a table row:
  `| **Hair** | A hairdo, not the hair itself | Braids, chignons, marcel waves, a severe bun, the occasional wig |`
  plus a short boundary paragraph: hats remain Accessories (worn *over* the coiffure);
  natural hair lives in the physical description; an empty Hair slot merely means the
  character's hair is au naturel. Update :39 (slot list), :125 ("four slots"), :227
  ("all four slots").
- `help/chats.md` :82 — The Green Room now shows five slots (add **Hair**).
- `help/project-wardrobe.md` :34 — slot list.
- `help/character-editing.md` :134 and :179 — the "four-slot `slots` map" and `types`
  list. **Verify the described frontmatter shape against the actual output of
  `buildWardrobeItemFile` in `lib/mount-index/character-vault.ts` while editing** — the
  help text must describe what the code writes today, with five slots.
- `help/ai-character-import.md` :56 — generation-step slot list.
- `README.md` :192 — slot list (plain voice; README is user-facing marketing-ish, match
  its existing register).
- `docs/developer/DDL.md` :380 — the `types` row gains `hair`; check the
  `equippedOutfit` column description nearby (≈:496) for a slot list.
- `docs/developer/API.md` :1676, :1697, :1736, :1876, :2335 — every enumerated slot
  list gains `hair`.
- `docs/CHANGELOG.md` (plain American English, no steampunk): new "hair" wardrobe slot
  for hairdos; wardrobe tools/generators/image-analysis/avatar prompts understand it;
  note the one-time scene-state clothing-summary re-derivation after upgrade, and that
  exports containing hair items import into older Quilltap builds minus those items.
- This file: move to `docs/developer/features/complete/` when done.

No new bug-catalogue entry (feature, not defect). No plugin or `packages/` changes
besides theme-storybook (§8.3 publish gate). Version bumps and lint/test/typecheck
orchestration are handled by `/commit`.

## 11. Suggested commit sequencing

One PR/commit is fine, but implement in this order so `tsc` stays your guide:

1. Phase 0 (SSOT + `hair` in the enum) — then `npx tsc` and fix every error it raises
   using the Phase-1/UI tables above.
2. The **silent** items (marked above) that tsc cannot see: `cloneSlots`-style spreads,
   `allEquippedItemIds` at `resolve-equipped.ts:95`, `hasEquippedItems`, the two
   hardcoded image-prompt loops, the two sanitizer allow-sets, `outfit.ts` `slotMap`
   seed, `chats/route.ts` spread.
3. Prompt-text passes (§5, §6) — grep for `footwear` afterward as a completeness check:
   the only surviving hits should be the frozen legacy/migration files (§7.4), CSS,
   meta registry, and docs.
4. UI + CSS + storybook (§8), stopping at the publish gate.
5. Export schema + docs + tests (§7.3, §9, §10).

---

*Provenance: exploration of the wardrobe subsystem on 2026-08-17; line numbers are
accurate as of `main` @ 8fe63c4f. If lines have drifted, search for the quoted code.*
