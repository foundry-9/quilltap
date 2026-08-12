---
url: /aurora
---

# Groups

> **[Open this page in Quilltap](/aurora)**

A Group is a circle of characters who share a common pocket of knowledge. Where a
Project gathers up files and chats, a Group gathers up *characters* — and hands
each member the keys to a shared study: a designated document store stocked with
a Description, a shelf of Scenarios, and a Knowledge cabinet, all of which the
members may read from, write to, and quietly draw upon mid-conversation.

Think of it as a club with a very well-appointed library. Belong to the club, and
the library is yours.

## What a Group Gives Its Members

Every Group keeps an **official document store** of its very own. Inside it you
will find:

- **A Description** — a few lines on what the Group is and what it's for.
- **A Scenarios shelf** — chat-starters that members can reach for when a new
  conversation is struck up.
- **A Knowledge cabinet** — reference material the members can consult and search,
  woven into their replies as the moment demands.
- **A Core shelf** *(optional)* — a `Core/` folder of shared grounding. Whatever a
  member keeps here is offered back to them alongside their own Core whisper —
  marked plainly as the Group's — so the few things the circle holds in common ride
  at their elbow whenever they take the floor.
- **A shared ledger of State** — a `state.json` of persistent values the whole circle
  reads and writes. It is the **group tier** of the four-tier state cascade
  (chat → project → group → general); edit it from the **Group State** button on the
  group's page, and see *[Chat State](chat-state.md)* for how the tiers stack. One
  wrinkle particular to Groups: when a single chat draws in characters from *two*
  different Groups, Quilltap will not guess whose ledger is meant, and quietly leaves
  the group tier out of the merged view — reach a particular Group's state by editing
  it on its own page instead.

You may also **link additional stores** to a Group — any document store you've
already set up in the Scriptorium — and every member gains full read-and-write run
of those, too.

## The One Golden Rule: It's Personal

Here is the part worth committing to memory, for it is where Groups part ways with
Projects.

**A Group's stores are in scope for a character only because *that very character*
is a member.** When a character takes their turn to speak, Quilltap gathers up the
stores of every Group *they* belong to — and not a sliver more. A companion in the
same chat who happens not to be in the Group sees none of it. Membership is a
personal key, not a shared one; standing in the same room as a member does not
unlock the cabinet for you.

So two characters in one chat may be working from entirely different shelves, each
according to their own memberships. That is by design, and it is what keeps each
Group's secrets among its own.

> **The single, deliberate exception:** when you start a **New Chat**, the
> Scenario menu is generous. If *any* character you've invited belongs to a Group,
> that Group's Scenarios are offered up under a heading reading
> *Group Scenarios: {the Group's name}*. A starting scenario is a menu laid out at
> the door, not a key pressed into anyone's hand — so here, and only here, a
> Group's Scenarios are shown to the whole table when a member is present.

## Tending Your Groups

You'll find your Groups gathered at the top of the **Aurora** page, just above your
characters.

- **Create a Group** — give it a name (and, if you're feeling decorative, a colour
  and an icon). Its official store is furnished for you on the spot.
- **Add or remove members** — open a Group and manage its roster of characters.
  Membership grants access to the shared stores; it does *not* decide who may be
  invited into a chat.
- **Link or unlink stores** — attach any of your existing document stores to the
  Group so its members can reach them as well.
- **Edit the particulars** — name, description, colour, and icon are all yours to
  change.

Any member may add, edit, or remove files in the Group's official store and in any
store linked to it — these shelves are working shelves, not glass cases.

## How a Group's Knowledge Reaches a Conversation

When a member character speaks, Quilltap consults the Group's Knowledge cabinet the
same way it consults a character's own vault or a project's files — quietly, in the
background, surfacing what's relevant.

**Prospero names the shelves.** At the opening of a chat — and again now and then as
it runs on — Prospero slips each member a private note naming the very stores they
may reach by membership, and their own vault besides, with the exact names to quote
when they reach for a document tool. The note is a whisper, meant for that one
member; a non-member at the same table never sees it.

**The library is a click from the composer.** When *you* go to attach a file, any
Group your chat persona belongs to appears under a **Group Files** heading in the
file picker — set above your Projects — so the club library is never far from hand.
The same shelf awaits in the **Open Document** picker: alongside the character
vaults and the project shelves, a **Group Files** accordion lists every store your
companions reach by membership, without your having to "Look everywhere" to find it.

**A character may search the club library alone.** Passing `scope: "group"` to the
`search` or `doc_list_files` tool confines the hunt to just the stores of the Groups
that character belongs to, for when they wish to consult the club's shelves and
nowhere else.

## Tips & Notes

- A character may belong to **as many Groups as you like**; in any turn, all of
  their Groups' stores are pooled together.
- Removing a character from a Group revokes their key at once — their next turn
  will no longer reach that Group's shelves.
- Deleting a Group drops its memberships and unlinks its stores. The official
  store's files are left where they sit, in case you want them.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Pages

- [Projects Overview](/prospero) — the file-and-chat counterpart to Groups
- [The Scriptorium](/scriptorium) — where document stores are made and managed
