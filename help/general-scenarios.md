---
url: /scenarios
---

# General Scenarios

> **[Open this page in Quilltap](/scenarios)**

A scenario, as a reminder, is the sealed envelope handed to your characters at the moment a chat opens — a brief paragraph that sets the stage. **General Scenarios** are the envelopes you'd like Quilltap to keep on the hall table, ready to hand to every new conversation regardless of which project it belongs to (or whether it belongs to a project at all). They are the household standbys; the ones you don't want to draft afresh in every wing of the estate.

## The Three Scopes, Briefly

Quilltap now keeps scenarios in three places, each pitched at a different scale:

- **Project Scenarios** — particular to a single project; rather like a guestbook kept only at one country house.
- **General Scenarios** — instance-wide; available to *every* non-help chat you begin, project or no.
- **Character Scenarios** — personal to one character; the parlour she returns to.

When a chat is started, all three groups appear in the same **Starting Scenario** drop-down, neatly partitioned. Should both a project default and a general default be standing by, the project default wins pre-selection (the more particular wish wins out over the household custom). Character defaults remain a polite override — you'll see a note offering a one-click switch when applicable.

## The Files Themselves

General scenarios live in a top-level `Scenarios/` folder inside a singleton document store called **Quilltap General** — a discreet butler of a store, present in every Quilltap instance but unobtrusive about it. The store is conjured at server startup; you needn't lift a finger.

Each scenario is a plain Markdown file. The same YAML frontmatter applies as in project scenarios:

```yaml
---
name: A Quiet Evening
description: For when the cast simply wants to talk.
isDefault: true
---

The day's small triumphs and minor catastrophes are still warm to the touch.
{{char}} and {{user}} settle into the parlour with the easy, unhurried air of
old friends who have nothing to prove…
```

- **`name`** — Display title used in the drop-down. Falls back to the filename when absent.
- **`description`** — Optional one-line subtitle.
- **`isDefault`** — Marks the general default. One file should claim it; alphabetically-first wins ties, with a soft warning.

The body that follows the closing `---` is what is spliced into the system prompt at chat creation. The customary `{{char}}` and `{{user}}` substitutions are honoured.

## Tending the Collection

The **Scenarios** entry in the sidebar opens the dedicated page where you may:

- **Create** a new scenario via **+ New scenario** — a modal opens with a filename, name, description, default checkbox, and the same Markdown editor used elsewhere in the workspace.
- **Edit** an existing scenario with the **Edit** button — the modal returns, pre-filled.
- **Rename** the underlying file via **Rename** — useful as scenarios mature past their working titles.
- **Delete** a scenario with **Delete**, after a moment's confirmation. Chats that already used it are unaffected, since the scenario text is woven into the chat at the moment of its creation.
- **Set the default** by clicking the radio button at the start of a row. The newly elected default has its frontmatter rewritten to `isDefault: true`, and any sibling that previously claimed the title is gently demoted.

On a generous, full-width page the **Edit**, **Rename**, and **Delete** buttons present themselves inline; should the window narrow to a sliver, the three retire behind a tidy **⋮** menu at the end of each row, a click away from service.

If multiple files claim the default at once (perhaps after direct editing through the Scriptorium), the page surfaces a soft warning so you can settle the matter at your leisure.

## Picking a Scenario for a New Chat

In the new-chat drop-down you'll see, in order:

- **Project Scenarios** — the contents of the project's `Scenarios/` folder, when a project is selected.
- **General Scenarios** — the contents of the Quilltap General `Scenarios/` folder, always.
- **Character Scenarios** — the personal scenarios of the single character you've chosen, when exactly one LLM-controlled character is selected.
- **Custom...** — the blank-slate option, for a one-off scenario typed on the spot.

A project default still pre-selects when present; otherwise the general default takes the field. You may, of course, choose any item from any group.

Beneath the drop-down sits a writing-desk that never leaves the room. Choose **Custom...** and whatever you compose there *is* the scenario, plain and simple. But pick a ready-made scenario from any group and the desk politely remains — anything you jot beneath it is **added below** the chosen scenario rather than replacing it. So you may begin from a trusted envelope and then pencil in tonight's particulars ("...and a storm has knocked out the lights") without rewriting the whole thing. Your pencilled notes survive a change of selection, too, should you reconsider which envelope to start from.

## Keeping the Folder Healthy

Should the Quilltap General store or its `Scenarios/` folder be deleted by some moment of housekeeping zeal, both are reconstructed at the next server start. Previously-deleted files, however, do not reappear.

## Every Character, Every Chat

The Quilltap General store isn't only a pantry for scenarios. Every character in every non-help chat — project or no project, character vault or no — has standing access to it via the `doc_*` tools. Prospero whispers a reminder at chat-start (and again on the periodic context cadence) so the cast can address it by name: `mount_point: "Quilltap General"`. Curate it as a household shelf for things you'd like every chat to be able to reach.

## Quilltap General's Knowledge Shelf

Alongside `Scenarios/`, a `Knowledge/` folder in the Quilltap General store is read on every turn by every character, and is searchable through the unified `search` tool as the **general** tier of the knowledge source. Drop one's house style guide, master glossary, or the rules by which all one's worlds abide here, and they'll be available to every chat without further ceremony. Character vaults and project-linked stores keep their own `Knowledge/` folders too; in the rankings, the closer voice wins on a literal-substring hit — character first, project next, general last — so the general shelf is best reserved for material that should genuinely span everything.

## Changing a Chat's Scenario Later

A scenario chosen at the outset is not binding for the evening. In an open chat, the **Chat Sidebar**'s **Chat** drawer holds a **Scenario** control offering these same tiers; picking a new one rewrites the chat's scene, recompiles every character's standing instructions, and has the Host announce the revision to the room. The particulars are set out in [Chats Overview](chats.md). Note that the frontmatter key the default is read from is `isDefault` — a file marked `default: true` instead is simply a scenario with no claim to the title, and the drop-down will open on **Custom...** with no pre-selection at all.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/scenarios")`

## Related Pages

- [Project Scenarios](project-scenarios.md) — Per-project scenarios offered alongside the general ones.
- [The Scriptorium](scriptorium.md) — Browsing and editing document stores directly.
