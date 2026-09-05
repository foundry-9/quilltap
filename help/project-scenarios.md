---
url: /prospero/:id
---

# Project Scenarios

> **[Open this page in Quilltap](/prospero)**

A scenario, in our particular sense of the word, is a sealed envelope handed to your characters at the moment a chat opens — a brief, evocative paragraph that establishes the setting, the tenor of the encounter, and the shape of the world they have just stepped into. Stored as plain Markdown files in a project's own document shelf, **Project Scenarios** are these envelopes drafted once and reused across every new chat in the project, sparing you the chore of re-typing the same opening every time you sit down with a familiar cast.

## What Sets Project Scenarios Apart

A character may, of course, carry her own personal scenarios — favourite settings she returns to, like a comfortable parlour. But a *project* scenario is one rung larger: it belongs to the project itself, and is offered to **every** chat begun within that project's confines, regardless of which character takes the stage. Imagine an Estate housing several characters; the Estate's grand hall, its rose garden, its Sunday teas — those belong to all who reside there, and so they belong to the project rather than to any single character.

For envelopes you'd like handed out at *every* chat, regardless of project, see [General Scenarios](general-scenarios.md). When more than one default is in play, the project's wish wins out over the household custom.

When you start a new chat in a project that has scenarios on file, you'll see them in the same drop-down where character scenarios have always lived, neatly grouped under **Project Scenarios**. They sit shoulder-to-shoulder with the General Scenarios and any Character Scenarios on offer, and you may pick from any group — or write a one-off "Custom" scenario in the textarea below as before.

## The Files Themselves

Each scenario lives as a Markdown file inside a folder called `Scenarios/` within the project's official document store (the auto-created store named `Project Files: <your project name>`). The folder is conjured automatically the moment you visit the project page, so you needn't perform any incantation to bring it into being.

A scenario file may carry a small block of **YAML frontmatter** at the top, in which the file declares its own metadata:

```yaml
---
name: Welcome to the Estate
description: A summer evening, the triad gathered in the conservatory.
isDefault: true
---

The conservatory glows amber as the sun lowers itself into the rose garden.
{{char}} has just poured a fresh cup of tea, and {{user}} is settling
into the wicker chair by the window…
```

- **`name`** — The display title shown in the new-chat drop-down. If absent, the filename (stripped of its `.md`) stands in.
- **`description`** — A one-line subtitle shown beneath the name. Optional but charming.
- **`isDefault`** — Marks this scenario as the project's standing selection. Exactly one file should claim this honour; if more than one does, the alphabetically-earliest one wins and a soft warning is offered.
- **`archived`** — Set `true` to retire the scenario from the pickers without destroying it. Omit the key entirely to keep it in circulation; there is no need to write `archived: false`.

The body of the file (everything after the closing `---`) is the scenario content proper — the text spliced into the system prompt at chat creation. The familiar substitutions, `{{char}}` and `{{user}}`, are honoured at chat time exactly as they are in character scenarios.

## Tending the Collection

The **Scenarios** card on each project's page is your atelier. Every project automatically grows one of these cards, and from it you may:

- **Create** a new scenario via the **+ New scenario** button. A modal opens, complete with the same Markdown editor used elsewhere in the workspace; you supply a filename, a display name, an optional description, and the body. Tick the **Use this scenario as the project default for new chats** box if you wish to enthrone it.
- **Edit** an existing scenario by clicking its **Edit** button. The same modal returns, this time pre-filled with the scenario's contents.
- **Rename** the underlying file via **Rename** — useful when the scenario has matured beyond its original working title. The file moves; the body stays exactly as it was.
- **Delete** a scenario with the **Delete** button, after a moment's confirmation. The file is removed from the document store; chats that already used it are unaffected, since the scenario text is woven into the chat at the moment of its creation.
- **Set the default** by clicking the radio button at the start of a row. The newly elected default has its frontmatter rewritten to `isDefault: true`, and any sibling that previously claimed the title is gently demoted.
- **Archive** a scenario with the **Archive** button, which retires it from the drop-downs without destroying it. See below.

When the card is pinched for room — as it so often is in the three-abreast project grid — the quartet of **Edit**, **Rename**, **Archive**, and **Delete** withdraw behind a single **⋮** menu at the end of each row; a click unfurls them. Where the card has elbow room to spare, the four present themselves inline, as plainly as ever. The radio button minding the default keeps its post on the left regardless.

### Archiving: the Dust Sheet, Not the Bonfire

A scenario may fall out of season without falling out of favour. **Archive** draws a dust sheet over it: the scenario leaves every drop-down and every list — this card, the Salon's in-chat picker, the new-chat form — while the file remains exactly where it was, gaining only an `archived: true` line in its frontmatter.

Tick **Show archived**, which keeps company with the **+ New scenario** button, and the retired scenarios reappear wearing a small **Archived** badge, each offering a **Restore** button. The same tickbox appears beside the scenario drop-down elsewhere, so you may deliberately select an archived scenario when the occasion calls for it — archiving hides a thing, it does not lock it away.

Chats that already began with an archived scenario continue untroubled, the text having been woven in at their creation. An archived scenario may never hold the project default, however: archive the reigning one and the project simply has no default until you elect another.

Should a scenario file have multiple defaults claimed (perhaps after editing the files directly through the Scriptorium), the card surfaces a soft warning naming the conflicting files so you may resolve the dispute at your leisure.

## Picking a Scenario for a New Chat

When you begin a new chat within a project, the **Starting Scenario** drop-down on the new-chat form will offer:

- **Project Scenarios** — the contents of the project's `Scenarios/` folder.
- **Character Scenarios** — the personal scenarios of the single character you've chosen, if exactly one LLM-controlled character is selected.
- **Custom...** — the blank-slate option, for a one-off scenario typed on the spot.

The **project default** takes precedence when seeding the form's initial selection. If the chosen character also has a default scenario of her own, you'll see an inline note naming her default and offering a single click to switch to it — the override is never silent. You remain in charge of which scenario opens the curtain.

The free-text desk beneath the drop-down stays open even once a scenario is chosen: anything written there is **layered beneath** the selected scenario rather than supplanting it, so a project scenario can be embellished with tonight's particulars without disturbing the original. (See [General Scenarios](general-scenarios.md) for the fuller account.)

## Keeping the Folder Healthy

Should you, in some moment of housekeeping zeal, delete the `Scenarios/` folder or even the entire `Project Files:` document store, fear not — both are reconstructed at the next server start (and at the next visit to the project page, whichever comes first). The structure reappears empty, ready for fresh scenarios; previously-deleted files do not return.

## Changing a Chat's Scenario Later

A scenario chosen at the outset is not binding for the evening. In an open chat, the **Chat Sidebar**'s **Chat** drawer holds a **Scenario** control offering these same tiers; picking a new one rewrites the chat's scene, recompiles every character's standing instructions, and has the Host announce the revision to the room. The particulars are set out in [Chats Overview](chats.md). Note that the frontmatter key the default is read from is `isDefault` — a file marked `default: true` instead is simply a scenario with no claim to the title, and the drop-down will open on **Custom...** with no pre-selection at all.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/prospero/:id")`

## Related Pages

- [Projects Overview](projects.md) — Main project documentation
- [Project Files](project-files.md) — The document shelf where scenario files live
- [Project Chats](project-chats.md) — Conversations in projects
- [Project Settings](project-settings.md) — Other project configuration
- [The Scriptorium](scriptorium.md) — Browsing and editing document stores directly
