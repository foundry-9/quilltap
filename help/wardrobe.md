---
title: The Wardrobe
url: /aurora
tags: [characters, wardrobe, outfit, clothing, appearance, tools, image, import, vision]
---

# The Wardrobe

> **[Open this page in Quilltap](/aurora)**

One does not simply *describe* a character's attire in a single breathless paragraph and call it a day --- not in a civilized establishment such as this. The Wardrobe system grants your characters a proper, itemized collection of garments: tops, bottoms, footwear, and accessories, each catalogued with the precision of a Savile Row tailor and the creative latitude of a Montmartre costumier. Characters may mix, match, and swap individual pieces mid-conversation, and --- should you permit it --- even conjure entirely new ensembles from the gossamer threads of their own imagination.

## What the Wardrobe System Does

Rather than storing a character's clothing as a single monolithic block of descriptive text (the sartorial equivalent of stuffing everything into a steamer trunk), the Wardrobe breaks attire into discrete **wardrobe items**, each assigned to a slot. These items can be equipped, swapped, or removed independently, giving both you and the AI fine-grained control over what a character is wearing at any given moment.

The equipped outfit travels with each chat, so a character might be wearing a ballgown in one conversation and workshop overalls in another --- precisely as the narrative demands.

## Wardrobe Slots

Every wardrobe item belongs to one of four slots, which together compose a complete outfit:

| Slot | What It Covers | Examples |
|------|---------------|----------|
| **Top** | Upper-body garments | Blouses, jackets, waistcoats, corsets, cloaks |
| **Bottom** | Lower-body garments | Trousers, skirts, kilts, petticoats |
| **Footwear** | Shoes, boots, and the like | Oxfords, riding boots, ballet slippers, bare feet |
| **Accessories** | Everything else | Hats, gloves, jewellery, monocles, pocket watches, scarves |

A character may have many items in each slot, and equip multiple of them at once — a t-shirt under a sweater, a dress shirt beneath a waistcoat. The system trusts the LLM (and your own scene-setting) to decide what shows. List them inner-to-outer when it matters; layering is half the fun.

## Creating Wardrobe Items

To furnish a character's wardrobe, open the **Wardrobe** dialog — the clothes-hanger icon on the left sidebar, reachable from any page that bears the sidebar (Salon, Aurora, Prospero, and so on). Opening it from a character's Aurora page conveniently preselects that character.

1. Pick the character from the dropdown at the top of the dialog (if one isn't already selected)
2. Click **+ New Item**
3. Use the **"Add to"** selector to choose where the garment lives — **This character** (a personal item, the default), **Shared — everywhere** (a household archetype), or **Shared — this project** (offered when you've opened the dialog inside a project's chat). See [Where Wardrobe Items Come From](#where-wardrobe-items-come-from-three-tiers) for what each tier means.
4. Choose the **slot(s)** the garment covers (top, bottom, footwear, or accessories)
5. Give the item a **title** (e.g., "Burgundy velvet smoking jacket") and a **description** --- as lavish or as terse as you please --- that the AI will use when referencing the garment
6. Optionally supply a **Portrait Cue** --- a short, literal phrase whispered to the portraitist and the Lantern when a likeness is drawn (see [Portrait Cues](#portrait-cues-dressing-for-the-camera) below)

You may edit or remove your personal items at any time via each row's `⋮` menu. The wardrobe is yours to curate, though your characters may have opinions about it (see below).

## The Wardrobe Control Dialog

For day-to-day fussing-about with what a character is wearing, there is a more direct instrument than the Aurora page's tabs and panels: the **Wardrobe** dialog. A small clothes-hanger icon dwells on the left sidebar (between Themes, when shown, and Settings) and is accessible from every page that bears the sidebar — Salon, Aurora, Prospero, the Foundry, and so on.

What the dialog allows you to do, with the directness of a valet pulling out the morning's tweeds:

- **Pick any character** from a single dropdown at the top — the dialog needn't be tied to whoever is presently speaking in a chat.
- **Browse the wardrobe** in full: filter by slot, mark items as **default** (a star toggle), edit them in place, **duplicate** them (the item's `⋮` menu mints an identical copy with "(copy)" appended to its name — handy for spinning a near-twin garment off an existing one; duplicating a composite outfit keeps the very same component pieces rather than cloning them anew), **move** them, **copy** them, delete them, or compose new ones.
- **Build composite items** — a "Rain Outfit" that bundles a raincoat, jeans, and boots; a "Nice Jewellery" set comprising earrings, locket, and ring. The editor's *Composes* panel lets you pick existing items as components; the system computes the slot coverage automatically and refuses to allow circular bundles.
- When opened **inside a chat**, a second column appears with two tabs:
  - *Wearing now* — what this character is actually wearing in the chat. Each slot lists what is currently equipped as removable chips; a small **+** opens a picker, and choosing a garment **wears** it across *every* slot it covers — so a dress settles into both top and bottom, and a composite ensemble takes all the ground it claims, in a single gesture. Whether the new piece *layers* over what is already worn or *clears those slots first* is decided by the garment's own **replace** setting (see *The Replace Toggle* below); ordinary single garments layer, so use the **Clear** button to bare a slot before dressing it afresh when you mean to swap rather than pile on. Composite items are shown as a single chip with a "composite" note. Edits to this tab **stage** in the dialog and are committed all at once when you click **Done** (or close the dialog) — Aurora announces the change exactly once and the avatar regenerates exactly once, no matter how many slots you fussed with along the way. If your final state happens to match what the character was already wearing, nothing is committed and nothing is announced. Should you prove quicker than the post — dressing the character before word arrives of what they already have on — your gesture is held and then folded into the true state the instant it lands, so nothing you clicked is lost to the delay. In the rare event that word never arrives at all, the dialog says so and asks before letting the unsaved alteration go, rather than closing as though it had saved.
  - *Fitting room* — a virtual outfit just for the avatar generator. Edits here never reach the chat unless you say so. Buttons let you reset the fitting room from what the character is currently wearing, from their default-outfit items, or to clear it entirely. A **Wear this** button (in chat only) commits the whole composition at once, replacing what the character is wearing — Aurora announces the change, the avatar regenerates against the new outfit, and the dialog closes itself with the work complete.
- Wardrobe rows on the left switch their action labels based on which tab is active: *Wear* / *+ Layer* live in the *Wearing now* tab; *Try on* / *+ Add* push the same items into the fitting room without committing.
- Out of chat, only the *Fitting room* tab appears. It is seeded from the character's defaults so a click of **Generate avatar** has something to work with even before you fuss with it.
- **Generate a new avatar** with a model of your choosing. The fitting-room outfit is what the avatar generator sees — meaning you can compose a never-before-worn outfit, take a portrait of it, and never disturb the character's actual chat state. In a chat, the new portrait replaces the character's avatar in that conversation only (the chat's default model is not touched). Out of chat, the dialog produces a downloadable preview and saves nothing to the character's avatar record.

The Wardrobe dialog supersedes the per-participant outfit dropdowns and the standalone "Gift Item" modal that previously lived in the participant sidebar. The same operations remain reachable, but with rather more elbow room.

### Import from Image

For those moments when visual inspiration strikes --- a photograph discovered in one's research, a portrait from a fashion plate, a screenshot from a film --- Quilltap can analyze a reference image and propose wardrobe items derived from whatever garments are visible therein. It is rather like having a couturier examine a daguerreotype and reproduce the ensemble, stitch by stitch.

To use this feature:

1. Open the **Wardrobe** dialog (the clothes-hanger icon on the left sidebar) and select the character
2. Click **Import from image** (it sits beside **+ New Item** at the foot of the wardrobe list)
3. Drop an image file into the upload zone, or click to browse (JPEG, PNG, WebP, or GIF, up to 10 MB)
4. Optionally provide **guidance notes** --- free-text hints to steer the analysis (e.g., "this is a medieval fantasy setting," "focus on the woman on the left," "ignore the background characters")
5. Click **Analyze Image**

A vision-capable LLM will examine the image and return a list of proposed wardrobe items, each with a suggested title, description, slot type(s), and appropriateness tags. You are then presented with a review screen where you may:

- **Edit** any field (title, types, appropriateness, description) before importing
- **Deselect** items you do not wish to import
- **Re-analyze** the image if the results are unsatisfactory

Click **Import Selected** to add the approved items to the character's personal wardrobe. They are created as non-default items --- you may mark them as defaults or equip them afterwards, at your leisure.

**Requirements:** This feature requires at least one vision-capable provider to be configured (Anthropic Claude, OpenAI GPT-4o, Google Gemini, or xAI Grok). If you have configured an **Image Description Profile** in your Chat settings, that profile will be used; otherwise Quilltap will select any available vision-capable provider from your connection profiles.

### Where Wardrobe Items Come From (Three Tiers)

A character does not draw her wearable garments from a single drawer. Quilltap consults three tiers, nearest to farthest:

1. **The character's own vault** — her personal armoire, hers alone.
2. **The project's wardrobe** — shared attire belonging to whichever project the chat lives in (a household livery, a regimental coat), wearable by every character in that project's chats. See [Project Wardrobe](project-wardrobe.md).
3. **Quilltap General** — the household-wide collection of shared items (archetypes, below), available to every character in every chat regardless of project.

When the same garment appears in more than one tier, the nearer tier prevails: a character's personal item outranks a project item, which in turn outranks a household archetype. A project's garments are on offer only while a chat belongs to that project; outside it, they simply aren't shown.

### Shared Items (Archetypes)

Some garments transcend the boundaries of any single wardrobe. A Roman legionary's tunic, a proper Edwardian morning suit, or a pair of sensible Wellington boots --- these are the sort of items that any character might reasonably don, regardless of their personal collection.

**Shared items** (also known as archetypes) are wardrobe items not bound to any particular character — the household-wide tier, kept in Quilltap General. Any character may equip them directly, without the tedium of maintaining duplicate entries.

When you add a new garment from the Wardrobe dialog, an **"Add to"** selector at the top of the editor lets you choose its destination:

- **This character** — a personal item in the character's own vault (the default).
- **Shared — everywhere** — a household archetype in Quilltap General, wearable by every character in every chat.
- **Shared — this project** — a [Project Wardrobe](project-wardrobe.md) item (offered only when you're in a chat that belongs to a project), wearable by every character in that project's chats.

Shared items appear in the dialog's list tagged "· shared" and are wear-only there; manage household archetypes from any character's wardrobe and project items from the project's [Wardrobe card](project-wardrobe.md). (Editing an existing item keeps it in whichever tier it already lives.)

A shared item marked as a **default** garment is worn by *every* character — a household archetype dresses the whole cast in every chat, a project item dresses everyone in that project's chats. Use the honour sparingly, and only when the garment truly is a uniform: a mourning band for a season of grief, the livery of a great house, the regimental coat that no member of the regiment would be seen without. Any character who would rather not may keep a personal copy of the item with its default flag turned off, and the house will say nothing further about it.

When you use **Move** or **Copy** from an item's `⋮` menu, Quilltap opens a destination picker with:

- **General** (Quilltap General)
- **Projects** (all projects)
- **Groups** (all groups)
- **Users** (character vault wardrobes)

**Copy** always generates a fresh wardrobe item ID at the destination. **Move** keeps the item's existing ID and removes it from the source after a successful write.

### Composite Items (Bundled Outfits)

Rather than selecting each garment individually every time a character must dress for an occasion, you may compose a single wardrobe item out of *other* wardrobe items. A "Garden Party Attire" composite might bundle a linen blazer, white slacks, and oxfords; a "Nice Jewellery" composite might bundle a pair of earrings, a locket, and a ring. The composite itself is a wardrobe item like any other — it covers whichever slots its components do, and equipping it places the bundle in those slots in one tidy gesture.

To create one, add a wardrobe item as you ordinarily would, then in its details note the constituent items. The system protects against curious accidents (an item containing itself, or a circular reference between two items) by quietly refusing to save such arrangements.

Composites used to be called "outfit presets" and lived as a separate species. They have been folded into the wardrobe, sparing the curator one extra concept to mind. Existing presets are migrated to composite items automatically, with their identities preserved.

#### Layer or Replace?

By default, slipping into *any* garment --- a lone scarf or a whole composite --- is a *gentle* affair: it **layers** atop whatever the character already has on, and nothing presently worn so much as wrinkles. Don a "Nice Jewellery" set and the earrings, locket, and ring simply join the ensemble already in progress --- the day's frock stays exactly where it is. This is the same courteous rule whether one wears it from the Wardrobe dialog, lets a character dress themselves, or works through the tools: the garment's **replace** setting alone decides between layering and a clean sweep.

Should you prefer a clean sweep --- a complete change of costume, as it were --- tick **"Replace everything in its designated slots"** on the composite. Now equipping it first empties every slot the outfit *designates* and then places only its own pieces, leaving no stray accessory from the previous getup clinging on.

Here is the subtle bit, and a rather useful one: a composite may be told to **designate** slots beyond the garments it actually contains. This lets an outfit clear ground it doesn't itself occupy. The classic example is a "Naked" composite that holds nothing but, say, a wedding ring, yet designates *all four* slots --- with Replace ticked, donning it strips the character to that single ring. Without the designation, those empty slots would be left untouched, and the poor soul would remain half-dressed in yesterday's tweeds.

(The Replace *toggle* in the item editor is a composite's prerogative alone --- a composite is the only thing that may **designate** ground beyond what it occupies. A lone garment carries no such switch: stored plainly, it layers, and to make room for it you simply **Clear** the slot first, or hand the deed to a character via the tools' dedicated *replace* gesture, which clears the covered slots and dresses in one motion.)

### Archiving and Deletion

Items that have fallen out of favour need not be destroyed entirely. **Archiving** an item hides it from wardrobe lists and tool results while preserving it for posterity --- and it will remain equipped if currently worn, so mid-conversation wardrobe crises are averted. Should you wish to restore an archived item, simply unarchive it.

**Permanent deletion** removes an item entirely and cleans up references in equipped slots across all chats. Any composite that bundled the deleted item will tolerate the absence gracefully — the dangling reference is dropped at read time without disturbing the rest of the bundle.

## Characters and Their Wardrobe Tools

During a chat, characters with the appropriate permissions may attend to their toilette by means of seven tools, each named with a tidy `wardrobe_` prefix so there is never any doubt as to whose drawer one is rummaging through. Wearing and editing are handled by altogether separate instruments — for a single garment and a whole bundled ensemble alike behave identically, the item's own *replace* setting deciding whether it layers atop what is worn or sweeps the slot clean.

Throughout, a character sees not only the items in their **own** wardrobe but also any shared garments hanging in the **project** stores and the great communal cloakroom that is **Quilltap General** — though shared items, being held in common, may be *worn* but never *altered* by a single character's hand.

- **wardrobe_list** --- Survey the available garments — one's own plus the shared finery of the project and Quilltap General. Composites are flagged with their components listed; each item notes whether you own it (and may thus edit it) or merely borrow it.
- **wardrobe_read** --- Inspect one item in full: its Portrait Cue, its default-outfit standing, its composite particulars, and the slots it presently occupies. Where `wardrobe_list` offers a glance, this offers a proper appraisal.
- **wardrobe_wear** --- Put garments on. Hand it an ordered list of changes and it applies them in sequence — force-swap the coat, *then* layer a muffler over it, all in a single gesture. Per item: `wear` (don it across every slot it covers, honoring its replace setting — ordinarily a gentle layering), `replace` (clear those slots first, a decisive swap), or `add_to_slot` (tuck it into one named slot).
- **wardrobe_take_off** --- Remove garments, or empty a slot entirely. Likewise an ordered list. Per item: `remove` (take a worn piece off across every slot it covers, leaving any other layers undisturbed — narrow it to a single slot if you wish) or `clear_slot` (sweep one slot bare).
- **wardrobe_create** --- Invent an entirely new garment and add it to the wardrobe, OR compose a new outfit from existing items via `component_item_ids` or `component_titles` (a composite). One may furnish a **Portrait Cue** (`image_prompt`) to steer the artist's hand, and one may **gift the item to another character** in the chat.
- **wardrobe_update** --- Amend an item one already owns — its name, its description, its Portrait Cue, its appropriateness, its coverage, and so forth. Only the particulars you supply are changed; the rest stands. Shared garments, being communal property, are politely declined.
- **wardrobe_archive** --- Retire an item one owns to the back of the closet: hidden from listings and no longer wearable, yet not destroyed — a human may restore it from the Aurora page at leisure. (No character may *permanently* discard a garment; that remains a human prerogative.) Shared garments are, again, declined.

For models that do not support tool use natively, characters may invoke these capabilities using text-block syntax: `[[WARDROBE]]`, `[[READ_WARDROBE]]`, `[[WEAR]]`, `[[TAKE_OFF]]`, `[[CREATE_WARDROBE_ITEM]]`, `[[UPDATE_WARDROBE_ITEM]]`, and `[[ARCHIVE_WARDROBE_ITEM]]`.

### Gifting Wardrobe Items

A character may, with suitable generosity and the `canCreateOutfits` permission, conjure a garment not merely for their own wardrobe but for that of another character in the conversation. This is accomplished by specifying a **recipient** when creating a wardrobe item --- the newly minted garment is placed directly into the recipient's collection, and may optionally be equipped upon them at once.

From the **user's** perspective, a small gift icon appears beside the **Outfit** header on each character's participant card in the sidebar. Clicking it opens a form where you may design a new wardrobe item and bestow it upon that character --- complete with the option to have them don the gift immediately. This is rather like having a personal couturier on retainer, dispatching bespoke garments to your cast of characters at a moment's notice.

For models using text-block syntax, gifting uses the `recipient` attribute: `[[CREATE_WARDROBE_ITEM title="Red Scarf" types="accessories" recipient="CharacterName"]]A gift for you[[/CREATE_WARDROBE_ITEM]]`.

### The Wardrobe Flags

Three flags on each character govern their clothing:

- **canDressThemselves** --- When enabled (the default), the character may use `wardrobe_list`, `wardrobe_read`, `wardrobe_wear`, and `wardrobe_take_off` to browse and change their outfit during conversation. Disable this if you prefer to maintain strict authorial control over what they wear.
- **canCreateOutfits** --- When enabled (also the default), the character may use `wardrobe_create`, `wardrobe_update`, and `wardrobe_archive` to fabricate, amend, and retire garments on the fly. This is delightful for characters with a flair for fashion, but you may wish to disable it if your character's wardrobe should remain fixed.
- **canChooseOutfit** --- Disabled by default. When enabled, a *new* chat with this character opens with its Starting Outfit already set to **Let Character Choose**, so a character with a wardrobe worth showing off arrives dressed for the occasion without your having to flip the switch each time. It changes only the default the new-chat dialog offers; you may still overrule it for any particular chat.

All three flags live on the character's **Wardrobe** tab on the Aurora page — `canChooseOutfit` sits just above the "Open wardrobe" button; the other two are grouped with the character's other wardrobe permissions.

## Outfit Selection When Starting a Chat

When you begin a new conversation, you will be asked how to handle the character's outfit:

- **Default** --- The character arrives wearing everything marked as a default garment across all three tiers --- their own vault, the project's wardrobe, and Quilltap General --- layered one atop the next rather than squabbling over a single slot. Should the character keep their own copy of a shared garment, that copy prevails: mark it *not* a default and they will decline the house livery altogether, with no offence taken.
- **Manual** --- You hand-pick which items the character is wearing at the start of the scene
- **Let Character Choose** --- The character examines the scenario and the whole of their wardrobe (all three tiers), then selects what seems most appropriate for the occasion. This is accomplished by a discreet consultation with the AI before the conversation begins --- rather like sending one's valet ahead to assess the dress code. Should the consultation fail for any reason (a misplaced cufflink, an uncooperative telegraph, or a valet who has simply not returned within the minute allotted him), the character falls back to their default outfit with admirable composure.

  A character may also elect to wear *nothing* --- a nudist at home, a bathing scene, a setting in which clothing would be plainly absurd --- and when they do so deliberately, the house respects it. The distinction matters: an empty answer offered *without* that deliberate declaration is treated as a valet who has lost his nerve, and the character is put into their defaults rather than sent out undressed by accident. When several characters are dressing at once, they now consult in parallel rather than queueing politely in the hall, so one slow valet no longer keeps the entire party waiting.
- **None** --- The character begins with no equipped outfit; what they wear (if anything) is left to the narrative

The dialog now proposes a sensible starting choice for each character on its own, so you need only intervene when your taste differs. Continuing from an earlier conversation keeps everyone in what they last wore; a character carrying the **canChooseOutfit** flag opens on **Let Character Choose**; a character with a proper default outfit on file opens on **Default**; and a character with no default outfit to speak of opens on **Manual**, its panel already unfolded so the empty slots are plain to see. When several characters are present, each folded panel wears a small badge — **Defaults**, **Composed**, **Dress Themselves**, **Undressed**, or **Same as Last** — so the whole cast's attire reads at a glance.

If you have also chosen a **Play As** character to represent yourself in the conversation, that character appears in the outfit selector too --- so you may dress your own persona alongside the cast, sparing yourself the indignity of arriving at a gala in whatever you happened to be wearing at your last engagement.

This ensures that every conversation starts with the appropriate sartorial context, whether your character is attending a gala or has just tumbled out of bed.

## How the Wardrobe Affects Image Generation

When Quilltap generates images of a character --- whether through the Lantern background system or direct image generation --- it consults the currently equipped wardrobe items rather than any legacy clothing description, so what the character is *actually wearing* in the conversation is what appears in the picture.

What the picture-maker is *told*, however, is each equipped item's **title** (or its Portrait Cue, if you have set one --- see below). The lavish prose **description** is reserved for human eyes and for the AI's own references; it is deliberately *not* handed to the image provider, lest a paragraph of purple costume-writing be parroted, word for word, onto the canvas.

If no wardrobe items are equipped, the system falls back gracefully to the character's legacy clothing description, so nothing breaks for characters who have not yet been fitted with a proper wardrobe.

### Portrait Cues (Dressing for the Camera)

Some garments are named perfectly well for a wardrobe drawer yet say nothing useful to a painter. "Captain's Epaulet" tells the portraitist precisely nothing about what to *draw*; a title like "Garden Party Hat #3" is worse still. And a few items carry a meaning no name can convey at all --- a rank glyph, a heraldic device, an insignia whose particular geometry matters.

For these, each wardrobe item offers an optional **Portrait Cue**: a short, literal, plain-text phrase handed to the avatar generator and the Lantern *in place of* the title whenever a likeness is drawn. Set one, and the picture-maker hears your words instead of the bare name; leave it blank, and the title speaks as before.

A few principles for a cue that actually lands:

- **Be literal and visual, not lavish.** "Intricate dense burnished-gold circular insignia on the shoulder" --- not a paragraph of lore. The flowery Description is for humans; the Cue is for the easel.
- **Keep it terse.** Cues are stitched together into a single comma-separated list of what the character has on, so a runaway sentence crowds out the rest of the outfit.
- **Let complexity carry meaning.** Image-makers cannot reliably reproduce a *specific* arbitrary glyph from a description, but they handle relative *busyness* well. "Intricate, many-ringed gold glyph" for a senior rank versus "small, simple gold glyph" for a junior one reads, at a glance, exactly as you intend --- even if the precise number of rings is left to the painter's hand.
- **Placement is a suggestion, not a command.** Phrases like "on the left shoulder" nudge but do not bind; picture-makers are famously cavalier about where they put things.

A Portrait Cue changes only what the *image* pipeline is told. The title still appears in lists and tools, the description still informs the AI's prose, and a character referring to the garment in conversation is none the wiser. Should you need a glyph rendered with true fidelity --- exact rings, exact spokes --- a Cue will get you the *impression*; for the genuine article, compose the portrait without the insignia and lay the real artwork over the shoulder afterward.

## Aurora's Wardrobe Announcements

Whenever a character's outfit changes during a chat --- whether you yourself adjust a slot from the sidebar, gift a freshly-tailored garment with the equip-now option ticked, or the character themselves invokes the `update_outfit_item` tool --- Aurora will quietly take note. After a polite minute of stillness (long enough for you to fuss with all four slots without setting off a flurry of announcements), she steps in with a brief Markdown summary of the present ensemble, addressed to everyone at the table. The wait resets each time another change lands, so she only speaks once the dust has truly settled.

These announcements appear as ordinary chat messages attributed to Aurora and are visible to every character in the conversation, ensuring nobody is left guessing about who is now wearing what.

## Per-Conversation Avatars

Should you wish it, Quilltap can generate fresh character portraits whenever an outfit changes --- a sort of automated daguerreotype service, if you will. When enabled, each outfit change triggers a background portrait generation that reflects the character's current ensemble. The resulting avatar appears alongside their messages, creating a visual chronicle of the character's sartorial journey through the conversation.

To enable this feature, look for the **Auto-Generate Avatars** toggle in your chat settings. Note that each portrait costs an image generation API call, so this feature is entirely opt-in --- one does not wish to receive an unexpectedly large bill from one's portraitist.

The generated avatars update asynchronously: the chat continues without interruption, and the new portrait appears once the image provider has finished its work. Previous messages retain whatever avatar was current at the time, so scrolling backwards through the conversation reveals each costume change in sequence.

## Migration from Legacy Clothing

If your characters already have clothing descriptions from before the Wardrobe system existed, fear not: Quilltap automatically migrates those descriptions into wardrobe items as full-coverage outfits. The original `clothingRecords` data is preserved, so nothing is lost in the transition. Think of it as unpacking a steamer trunk into a proper armoire --- everything is still there, just better organized.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Topics

- [Tools](tools.md) - Overview of AI tools available in Quilltap
- [Using Tools in Chat](tools-usage.md) - How tools work during conversation
- [Characters](characters.md) - General character management
