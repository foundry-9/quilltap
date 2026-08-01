---
url: /salon/:id
---

# Chat State

Chat State provides persistent JSON storage for games, inventory tracking, session data, and any other information that should persist across messages in a conversation.

## What is Chat State?

State is a JSON object that stores key-value pairs. Unlike regular messages which flow through the conversation, state persists and can be updated by both you and the AI character. This makes it perfect for:

- **Games**: Track scores, turns, game boards, and player status
- **Inventory Systems**: Manage items, equipment, and resources
- **Character Stats**: Track health, experience, attributes, and skills
- **Session Data**: Remember preferences, settings, and context
- **Writing Projects**: Store outlines, character sheets, and world details

## How to View and Edit State

### In Chats

1. Open any chat conversation
2. On the right, open the **Chat Sidebar** and expand the **Organize** drawer
3. Press **State…**
4. The State Editor modal opens showing the current state

### In Projects

1. Open a project from the Projects page
2. Expand the **Project Settings** card
3. Click **View/Edit** next to "Project State"

### In Groups

1. Open a group from Aurora's Groups page
2. Press the **Group State** button beside **Save Changes**
3. The State Editor modal opens on that group's own ledger

### General (instance-wide)

1. Repair to **Settings → Chat**
2. Expand the **General State** card (it keeps company with Pascal's custom tools)
3. Press **Edit General State**

General State is the foundation the whole establishment stands upon — every chat consults it unless a nearer tier has already spoken.

## State Editor Features

- **View Mode**: By default, state is shown read-only with syntax highlighting
- **Edit Mode**: Click the **Edit** button to modify the JSON
- **Validation**: Invalid JSON is highlighted with an error message
- **Save**: Click **Save** to persist your changes
- **Reset**: Use **Reset State** to clear all state data (with confirmation)

## How AI Uses State

When the state tool is enabled, AI characters can read and write any tier. Without a named
`context`, a fetch returns the merged cascade and a set/delete lands on the **chat** tier.
To reach a particular tier, the character names it: `context: "project"`, `context: "group"`,
or `context: "general"`. For a group, when the character belongs to more than one, it also
supplies a `group` (the group's name or id); belonging to exactly one group, it may omit that.
As ever, keys beginning with an underscore are yours alone and the AI may not touch them, at any tier.

### Fetch State
Read current values to understand context:
```
AI fetches "player.health" → 85
AI: "You're looking a bit weary. Want to rest and recover some health?"
```

### Set State
Update values based on actions:
```
User: "I pick up the golden key"
AI sets "inventory.goldenKey" → true
AI: "You carefully pocket the golden key. It might come in handy later."
```

### Delete State
Remove values when they're no longer relevant:
```
User: "I use the healing potion"
AI deletes "inventory.healingPotion"
AI sets "player.health" → 100
AI: "The potion's warmth spreads through you as your wounds close."
```

### Custom Tools May Write It Too

Pascal's custom tools are no longer read-only guests at this ledger. A tool may declare
**side effects** — writes applied on the server as part of the roll itself, quite beyond
any model's power to fudge — and a state effect lands **at the tier where the key already
lives** (a project counter stays a project counter), defaulting to the chat for a fresh key.
Every write is recorded with the roll, previous value and all. See
*[Custom Tools](custom-tools.md)* for the recipe. Underscore-prefixed keys remain yours
alone: no tool may write them, any more than the state tool may.

## The Cascade — Four Tiers

State no longer flows from a mere two springs but from four, each nearer tier
overriding the more distant when their keys collide:

**chat → project → group → general** — the chat wins.

1. **Chat State**: particular to a single conversation. Chat wins every dispute.
2. **Project State**: shared by every chat under the project's roof.
3. **Group State**: shared by every character enrolled in the group.
4. **General State**: instance-wide bedrock, visible to every chat in the house.

When you fetch without naming a tier, Quilltap serves the **merged view**: the four
layers stacked, top-level keys resolved with the chat's word taken as final, then the
project's, then the group's, and only then the general default.

This lets you:
- Lay down house-wide defaults (an era, a currency, a tone) at the **general** tier
- Set a company's shared ledger at the **group** tier
- Keep a project's world settings at the **project** tier
- Override any of it, key by key, in a single **chat**

### A Word on Groups

The group tier merges into the general view only when **exactly one** group applies to
the table. Should two or more characters bring different groups to the same chat, Quilltap
declines to guess which ledger is meant: the group tier is quietly set aside from the merged
view, and the State Editor posts a note to that effect. To read or write a particular group's
state in that case, edit it from its own **Group State** page, or — for the AI — name the group
explicitly (see below).

## The Underscore Convention

Keys starting with underscore (`_`) are treated as user-only:

- `_notes`: Your private notes the AI won't modify
- `_settings`: Personal preferences
- `_metadata`: Information you want to preserve

The AI will not modify or delete underscore-prefixed keys, even if asked.

## Examples

### Yahtzee Game
```json
{
  "currentPlayer": "Alice",
  "round": 3,
  "scores": {
    "Alice": 145,
    "Bob": 132
  },
  "dice": [3, 3, 3, 5, 6],
  "rollsRemaining": 2
}
```

### RPG Inventory
```json
{
  "player": {
    "name": "Elara",
    "health": 85,
    "maxHealth": 100,
    "gold": 250
  },
  "inventory": [
    { "name": "Iron Sword", "damage": 15 },
    { "name": "Health Potion", "healing": 25 },
    { "name": "Mysterious Map", "description": "Shows the way to..." }
  ],
  "quests": {
    "findTheLostAmulet": { "status": "active", "progress": 2 }
  }
}
```

### Writing Session
```json
{
  "currentChapter": 3,
  "wordCount": 12450,
  "characters": ["Maya", "The Professor", "Agent X"],
  "plotPoints": {
    "introduced": ["the artifact", "the conspiracy"],
    "resolved": ["Maya's backstory"]
  },
  "_notes": "Remember to add more tension in chapter 4"
}
```

## Tips

1. **Start Simple**: Begin with basic key-value pairs, add complexity as needed
2. **Use Clear Names**: `player.health` is better than `ph`
3. **Group Related Data**: Use nested objects to organize related values
4. **Let AI Lead**: For games, let the AI manage state updates naturally
5. **Use Projects**: For multi-chat games or stories, use project state for shared data
6. **Protect Important Data**: Prefix critical keys with underscore if you don't want them changed

## Path Syntax

The state tool supports dot notation and array indexing:

- `player.health` - Access nested property
- `inventory[0]` - Access first array item
- `inventory[0].name` - Access property of array item
- `scores.Alice` - Access property with string key

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Features

- [Tools](tools.md) - Access the State button and other tools
- [Projects](projects.md) - Organize related chats with shared state
- [Tools](tools.md) - Other AI capabilities available in chats
