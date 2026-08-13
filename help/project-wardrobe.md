---
url: /prospero/:id
---

# Project Wardrobe

> **[Open this page in Quilltap](/prospero)**

A garment, in the ordinary run of things, belongs to a single character — her own armoire, her own peculiar taste in hats. But some attire belongs not to any one player but to the *production* itself: the household livery worn by every footman, the regimental greatcoat issued to all who serve, the masquerade dominoes handed round at the door. **Project Wardrobe** is the shelf where such shared attire lives — garments stored in a project's own document store and offered to *every* character who takes the stage in that project's chats.

## Where Wardrobe Items Come From

Quilltap draws a character's wearable garments from four tiers, nearest to farthest:

1. **The character's own vault** — her personal armoire, hers alone.
2. **Her groups' wardrobes** — shared attire belonging to the [groups](groups.md) she is a member of, which she carries with her into any chat.
3. **The project's wardrobe** — shared attire belonging to the project, wearable by every character in its chats. *(This page.)*
4. **Quilltap General** — the household-wide collection of [Shared Items (archetypes)](wardrobe.md), available to every character in every chat regardless of project.

When the same item appears in more than one tier, the nearer tier prevails — a project may quietly shadow a household archetype with its own version, a group shadows the project, and a character's personal garment outranks the lot. A project garment becomes wearable the moment a chat belongs to that project; outside the project, it is simply not on offer.

## Garments Worn Without Being Asked

Mark a project garment as a **default** and it is put on at the opening of the curtain: every character joining a chat in that project arrives already wearing it, whether they were cast at the chat's creation, ushered in mid-scene by **Add Character**, or folded in when two conversations are merged. This is the proper way to dress a household — the livery goes on every footman without your having to dress each one by hand.

Defaults layer rather than compete. A character with a default coat of her own does not lose it to the project's waistcoat; she wears both, in the order the garments were made. And a character who would rather abstain need only keep a personal copy of the item with its default flag turned off — the personal copy shadows the project's, and she goes without.

A default **composite** ("House Livery" bundling coat, waistcoat, and boots) resolves to its component garments, so the character is dressed in the pieces, not in an abstraction.

## The Files Themselves

Each project wardrobe item lives as a Markdown file inside a folder called `Wardrobe/` within the project's official document store (the auto-created store named `Project Files: <your project name>`). The folder is conjured automatically the moment you visit the project page, so no incantation is required to bring it into being. The same `Wardrobe/` convention is used by character vaults and by Quilltap General, so an item may be moved between tiers simply by moving its file.

A wardrobe item carries a small block of **YAML frontmatter** declaring its metadata — title, the slots it covers (top, bottom, footwear, accessories), an optional appropriateness note, and whether it is a default — with the descriptive prose below. Composite outfits (a "House Livery" bundling coat, waistcoat, and boots) are supported here exactly as in personal wardrobes; the system computes slot coverage automatically and refuses circular bundles.

## Tending the Collection

The **Wardrobe** card on each project's page is your atelier. Every project automatically grows one of these cards, and from it you may:

- **Create** a new item via the **+ New wardrobe item** button — supply a title, an optional description, an optional **Portrait Cue**, the slots it covers, an optional appropriateness note, and (for composites) the existing project items it bundles. The Portrait Cue is a short, literal phrase whispered to the portraitist and the Lantern *in place of* the title when the bare name fails to conjure the right picture (the prose description, being for human eyes, never reaches the easel).
- **Edit** an existing item with its **Edit** button; the inline form returns pre-filled.
- **Delete** an item with the **Delete** button, after a moment's confirmation. Equipped references across existing chats are cleaned up; composites that bundled the item tolerate its absence gracefully.

## Wearing Project Garments

Project wardrobe items behave exactly like any other once a chat belongs to the project. Characters may wear them through the Wardrobe dialog, dress themselves into them via the wardrobe tools, and have them appear in scene-state, avatar, and image-generation prompts — all without the item being duplicated into each character's personal armoire.

## Keeping the Folder Healthy

Should you, in some moment of housekeeping zeal, delete the `Wardrobe/` folder or even the entire `Project Files:` document store, fear not — both are reconstructed at the next server start (and at the next visit to the project page, whichever comes first). The structure reappears empty, ready for fresh garments; previously-deleted files do not return.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/prospero/:id")`

## Related Pages

- [The Wardrobe](wardrobe.md) — The full wardrobe system, including character vaults and shared archetypes
- [Project Scenarios](project-scenarios.md) — The same tiered idea, for opening scenes
- [Projects Overview](projects.md) — Main project documentation
- [Project Files](project-files.md) — The document shelf where wardrobe files live
- [The Scriptorium](scriptorium.md) — Browsing and editing document stores directly
