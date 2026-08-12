---
url: /aurora
---

# Managing Characters

> **[Open this page in Quilltap](/aurora)**

This guide covers character deletion, relationships, partnerships, NPCs, and other management tasks.

## The Character Card

Open any character and you are greeted, at the very top, by their calling card — portrait to the left, the dossier in the middle, and a tidy column of actions to the right.

The middle panel reads top to bottom:

- **Name and title** — the character's name in full, with their title set just beneath it. A trio of small switches keeps to the upper right: the favourite star, a little console (lit when the character is enrolled as a Carina answerer, able to field quick **@-queries** without joining the conversation — see [Carina](carina.md)), and the user-control figure. The pronouns sit alongside the title (hover them for the full subject / object / possessive breakdown). These pronouns also have a quiet word with the portraitist: a *she/her* lady is drawn as a woman and a *he/him* gentleman as a man, so a character caught in borrowed or masculine attire — a man's shirt, say — is still rendered as the lady she is, rather than left to the easel's guesswork. Anything other than the plain *he* or *she* (a *they*, a coinage of your own, or none at all) is left entirely to the artist's discretion.
- **Aliases** — every other name the character answers to, arranged as a little row of badges.
- **The ledger** — a single line of figures, taken at a glance, telling you how richly furnished this character has become:
  - **memories** — entries in their Commonplace Book
  - **conversations** — chats in which they have appeared
  - **wardrobe items** — garments and accessories in their wardrobe
  - **photos** — portraits kept in their gallery
  - **scenarios** — scene-setting openers written for them
  - **knowledge** — documents tucked into their vault's *Knowledge* folder
  - **core** — documents in their vault's *Core* folder, the packet re-offered to them from time to time
  - **character files** — shown as a fraction (such as **8/8**), this counts how many of the canonical managed files their vault holds against the full set expected. A complete fraction means their vault wants for nothing; a shortfall is a gentle hint that something has gone astray.
- **Groups** — should the character belong to any groups, each appears as a badge wearing that group's own colour and emblem. Hover a badge to read the group's description, or give one a click to call upon the group directly.

Each figure in the ledger carries a tooltip of its own — pause your cursor over any of them to learn what it represents.

## Reset Built-in Characters

On the Characters page toolbar, click **Reset Built-in Characters** to restore the first-run editions of **Lorian** and **Riya**.

What this action does:

- Finds existing Lorian and Riya records, if present
- Removes existing Lorian and/or Riya records
- Re-imports the built-in first-run Lorian and Riya dossiers
- Reuses prior character IDs when those records existed, keeping linked references steady

## Help Tools

Certain characters may be granted the privilege of peering behind the curtain — reading your Quilltap settings and searching the documentation on your behalf, rather like a well-informed butler who knows where everything is kept.

### What Help Tools Do

When enabled for a character, two tools become available:

- **Help Search** — searches the Quilltap help documentation to find guidance on features, settings, and usage
- **Help Settings** — reads your instance configuration (connection profiles, themes, templates, and the like) so the character can understand your current setup and offer informed advice

**Important:** API keys, passphrases, and other secrets are *never* revealed through Help Settings. The tool shows only safe, non-sensitive configuration details.

### Enabling Help Tools

1. Open a character in **Aurora** (`/aurora`)
2. Navigate to the **Profiles** tab
3. Find the **Help Tools** section
4. Select **Enabled** from the dropdown
5. The setting saves automatically

By default, **Lorian** and **Riya** arrive with help tools enabled — they are, after all, your designated guides to the establishment. All other characters have help tools disabled by default.

### The Help Tools Toggle

The toggle offers three positions:

| Setting | Meaning |
|---------|---------|
| **Inherit from global settings** | Uses the global default (currently: disabled) |
| **Enabled** | Help tools are available for this character |
| **Disabled** | Help tools are explicitly turned off |

## Archiving Characters

Between the bustle of the roster and the finality of deletion lies the archive
shelf: a place for characters whose stories have paused but not, one hopes,
ended. Archiving packs a character's every effect into a single sealed `.qtap`
bundle and clears the heavier baggage from the working rooms — without
deleting a single word anyone ever said.

### What Archiving Does

**Packed into the bundle and cleared away:**

- Their memories — the Commonplace Book falls silent
- Their correspondence, the whole of the mail folder
- Every photograph beyond the portrait itself
- Their conversation summaries

**Kept in place, exactly as it stands:**

- Who they are — every character field, still readable on their page
- Their portrait, so old conversations keep their face
- Their wardrobe
- Every chat they took part in, word for word
- What *other* characters remember about them

That last point deserves its own sentence: **archiving silences the character,
not everyone's memory of them.** Friends and rivals keep every recollection;
only the archived character's own remembering is packed away.

### While Archived

An archived character wears an **Archived** badge, takes no turns in any
scene, receives no letters, answers no @-queries, and cannot be added to new
groups or rosters (existing memberships stand, marked with the badge). Their
page remains open for reading — every field, the wardrobe, the gallery — but
the pen is set down: nothing can be edited until they wake. They are likewise
excused from the export wizard; their bundle *is* their export.

### How to Archive

1. Open the character's page from the **Characters** roster
2. Click **Archive** in the action column
3. The confirmation spells out precisely what is packed and what stays —
   read it, then click **Archive**

The roster hides archived characters by default; the **Show Archived** button
reveals them, resting at the end of the shelf.

### The Bundle and Your Passphrase

The bundle is sealed with your instance passphrase (or, on an instance
without one, with Quilltap's internal key) — the same protection your
databases enjoy. Two consequences worth knowing:

- **Changing your passphrase re-seals every archive** on the shelf. The
  passphrase card warns you how many before it begins; should the rewrite be
  interrupted, it names exactly which bundles still answer to the old
  passphrase.
- The bundle survives a **Delete All Data** or replace-mode restore if you
  leave the "archive shelf" box ticked — as a loose bundle, importable but no
  longer rehydratable, since its character record perished with the rest.

### Waking Them Again

The **Rehydrate** button on an archived character's page unpacks the bundle
and restores every memory, letter, and photograph precisely where it was —
same identifiers, same folders, nothing duplicated and nothing repointed.
Their chat seats return to the table, their memories re-enter the
Commonplace Book (re-indexed in the background), and the character page
comes back to life exactly as it stood.

A few particulars of the ceremony:

- **The bundle stays on the shelf afterwards** as a spare copy; a small
  dialog offers to discard it once the unpacking is done. Keeping it costs
  nothing but shelf space, and you may discard it later from the file
  library. (The library politely refuses to discard a bundle whose character
  is *still* archived — that copy is the only one there is.)
- **If your passphrase changed since the archive was sealed**, the older
  bundle answers only to the passphrase in effect when it was written;
  Quilltap will say so plainly rather than mumble about decryption. Re-seal
  your archives when the passphrase card offers, and this never arises.
- **An interrupted rehydration loses nothing.** The character simply remains
  archived with the bundle intact; press Rehydrate again and it picks up
  where it left off, skipping whatever already made it back.

Should you prefer the character's effects without waking them, the command
line still offers `quilltap db characters export <name>` to decant the
bundle into a plaintext `.qtap` (see the developer CLI reference).

## Deleting Characters

### When to Delete

Delete a character when:

- You no longer want to keep them
- Story is complete and you want to clean up
- Character was created by mistake
- Testing character no longer needed
- You've exported character for backup/sharing

**Note:** Deletion is permanent and cannot be undone. Consider archiving or quick-hiding instead.

### How to Delete

**Method 1: From Character List**

1. Go to **Characters** page
2. Hover over character or right-click
3. Click **Delete** or **Remove**
4. Confirmation dialog appears
5. Click **Delete** to confirm
6. Character is permanently removed

**Method 2: From Character View**

1. Open character to view
2. Click menu icon (⋮ or ⋯) at top
3. Select **Delete Character**
4. Confirmation dialog appears
5. Click **Confirm Delete**
6. Character removed

**Method 3: From Character Edit**

1. Open character edit
2. Click menu icon at top
3. Select **Delete Character**
4. Confirmation appears
5. Click **Confirm**

### Deletion Cascade

When you delete a character, what else happens?

**Auto-deleted:**

- All conversations with this character
- All memories specific to this character
- All file associations specific to this character

**NOT deleted:**

- Associated files (if any) — files remain accessible
- Relationships in other characters' descriptions — must edit manually
- Comments or notes referencing character — must find and update

### Safer Alternatives to Deletion

**Instead of deleting, consider:**

**Quick Hide**

- Hides character temporarily
- Can restore anytime
- Good for: Temporary removal, spoiler hiding, testing cleanup

**Archive with Tag**

1. Create "Archived" tag
2. Tag character with "Archived"
3. Create saved filter hiding archived characters
4. Character hidden but preserved
5. Easy to restore by removing tag

**Rename to Indicate Status**

- Change name to "[ARCHIVED] Character Name"
- Still visible in search but clearly marked
- Can search for "[ARCHIVED]" to see all archived

**Export Before Deleting**

1. Export character (see Import/Export section)
2. Save exported file as backup
3. Then delete if desired
4. Can import again later if needed

### Bulk Deletion (Use Caution!)

If multi-select is available:

1. Select multiple characters
2. Click **Bulk Actions** > **Delete**
3. Confirmation for bulk deletion appears
4. Carefully review which characters will delete
5. Click **Confirm Delete All**
6. All selected characters permanently removed

**Warning:** There is no undo for bulk deletion. Be very careful.

## Character Relationships

Relationships define connections between characters.

### Understanding Relationships

Characters can have relationships with other characters:

**Examples:**

- Family: "Sister of Alice", "Father of James"
- Romance: "In love with Sarah", "Married to Marcus"
- Alliance: "Ally of the Rebels", "Enemy of King John"
- Professional: "Works with Detective Chen", "Mentor of Kael"
- Social: "Friend of Tom", "Rival of Elena"

### Adding Relationships

**During character creation:**

1. In Description or Personality fields
2. Mention relevant relationships
3. Example: "Alice is best friends with James"

**When editing character:**

1. Edit character
2. Edit **Details** tab
3. In Description or Personality section
4. Add relationship information
5. Save

### Linking Relationships

**Structured relationships:**

Some views may support linking to actual characters:

1. In Description or Personality field
2. Type `[Character Name]` or @mention
3. System links to actual character
4. Shows as link in view
5. Can click to view related character

**Manual tracking:**

1. Mention character by name in description
2. System may auto-link
3. Or keep as plain text reference
4. Makes relationships clear when editing

### Relationship Examples

**Good relationship descriptions:**

```
Character: Alice
Description: "...she works closely with Detective Chen at the precinct. 
They have great chemistry. Her sister Sarah is a doctor and often has 
to patch up Alice's injuries from dangerous cases."
```

**Clear relationship markers:**

```
Character: Marcus
Personality: "Devoted husband to Catherine. Father to three children. 
Loyal ally of Captain Vex. Secret rival of his brother Daniel."
```

### Viewing Relationships

To see all relationships a character has:

1. Open character view
2. Look in Description or Personality
3. All mentioned relationships visible
4. Click links to view related characters
5. Build relationship map by following links

### Managing Relationship Changes

If characters' relationships change:

1. Edit character
2. Update Description or Personality
3. Modify relationship information
4. Save changes

**Example:**

- Before: "Alice is best friends with James"
- After: "Alice was best friends with James, but they had a falling out"

## Partnerships

Partnerships let characters work together in conversations.

### What are Partnerships?

A partnership is when two or three characters work together:

**When you chat with a partnership:**

- Multiple characters participate in conversation
- AI switches between character voices
- Creates group roleplay scenario
- Characters interact with each other

**Examples:**

- Detective and partner detective investigate crime
- Two adventurers go on quest together
- Group of friends having conversation

### Setting Up Partnerships

**Method 1: Create partnership with character**

1. Open character
2. Look for **Partners** or **Partnership** section
3. Click **Add Partner** or **Create Partnership**
4. Select second character
5. Optional: Add third character
6. Save

**Method 2: Create partnership during chat**

1. Start chat with one character
2. Click chat options or add participant
3. Select second character to add
4. Conversation becomes partnership
5. Both characters participate

**Method 3: Create partnership from Characters list**

1. From characters page
2. Select multiple characters (if multi-select available)
3. Click **Create Partnership** or similar
4. Partnership created
5. Can be used in chats

### Using Partnerships

**Starting chat with partnership:**

1. Go to **Chats** or **Conversations**
2. Click **New Chat** or **+ New Conversation**
3. Select first character or partnership
4. If partnership: see all members listed
5. Start conversation
6. All partners participate

**During partnership chat:**

- AI generates responses as each character
- Characters interact with you and each other
- Feels like group conversation
- Can ask characters what they think of each other

### Character Switching in Partnerships

Some views allow switching character focus:

1. During partnership chat
2. Click character name at top or in chat
3. Switch which character's perspective to emphasize
4. Or see all perspectives equally

### Managing Partnerships

**Removing from partnership:**

1. Edit character
2. Go to Partners section
3. Click **X** next to partner
4. Partner removed from this partnership
5. Save

**Dissolving partnership:**

1. If partnership is saved/named
2. Delete partnership (see character deletion)
3. Partnership removed but characters remain

**Updating partnership:**

1. Edit character
2. Add or remove partners
3. Modify partnership settings
4. Save

### Partnership Best Practices

| Good Partnership | Poor Partnership |
|------------------|------------------|
| Complementary characters | Similar personalities |
| Different perspectives | Redundant characters |
| Defined relationship | Strangers thrown together |
| Clear individual voices | Indistinguishable voices |
| Purposeful pairing | Random selection |

### Creating Great Partnerships

**Strategy 1: Opposites**

- Pair opposite personality types
- Example: Serious detective + Humorous sidekick
- Creates dynamic dialogue

**Strategy 2: Defined Relationship**

- Characters with established relationship
- Example: Close friends, rivals, siblings
- Pre-existing dynamic enhances chat

**Strategy 3: Complementary Skills**

- Different expertise or knowledge
- Example: Scientist + Historian
- Can discuss topics from different angles

**Strategy 4: Conflicting Goals**

- Characters with different objectives
- Example: Law officer + Criminal informant
- Creates interesting tension/dynamic

## NPCs (Non-Player Characters)

NPCs are characters typically controlled by AI that interact with player characters.

### Creating NPCs

**Mark character as NPC:**

1. When creating character, tag with "NPC"
2. Or add tag later in organization
3. Indicates character is AI-controlled

**Quick NPC creation:**

1. Go to **Characters** > **Create Character**
2. Add quick NPC with minimal info
3. Tag as "NPC"
4. Use in chats and partnerships
5. Quick way to generate opponents/allies

### Ad-Hoc NPCs in Chat

During a chat, create temporary NPCs on the fly:

1. In chat, ask AI to "introduce a [character type]"
2. AI generates NPC character
3. NPC participates in chat
4. NPC doesn't save unless you save it

**Example:**

- You: "A merchant approaches us in the tavern"
- AI: Generates tavern merchant with description
- Conversation continues with merchant

### Using NPCs Effectively

**For game masters:**

- Create NPC library with common character types
- Have NPCs tagged for easy access
- Use ad-hoc NPCs for minor roles

**For storytellers:**

- Create antagonist NPCs
- Create supporting cast
- Use partnerships for multi-NPC scenes

**For roleplay:**

- Create multiple NPCs for interactive scenes
- Use NPCs to create antagonists
- Build world with populated characters

### NPC Best Practices

**Create reusable NPCs:**

```
NPC: Town Guard
Description: "Standard town guard, professional and dutiful"
First Message: "State your business, traveler"
Tags: NPC, Guardians, Town
```

**Quick templates:**

- Tavern Bartender NPC template
- Merchant NPC template
- Guard NPC template
- Enemy NPC template
- Ally NPC template

## Special Character Types

### Antagonist Characters

Create compelling antagonists:

1. **System Prompt:** Explain their motivations clearly

   ```
   "You are the villain of this story. Your goals are [X]. 
   You believe you're justified. Never admit you're wrong. 
   Respond as this character would."
   ```

2. **Personality:** Show their perspective
   - Don't make them purely evil
   - Give them believable motivations
   - Show internal complexity

3. **First Message:** Set antagonistic tone

   ```
   "Well, well... you finally show yourself. I've been waiting 
   for this confrontation."
   ```

### Love Interest Characters

Create romantic interests:

1. **System Prompt:** Define relationship dynamics

   ```
   "You're a complex love interest with genuine feelings but 
   also your own goals. Respond authentically, not idealized."
   ```

2. **Personality:** Show depth and independence
   - Not just devoted to player character
   - Have own opinions and goals
   - Show vulnerabilities

3. **First Message:** Warm but complex

   ```
   "I've been thinking about you... but we need to talk about 
   what happened last time."
   ```

### Mentor Characters

Create mentor/teacher characters:

1. **System Prompt:** Define teaching style

   ```
   "You're a patient mentor. You ask questions to help them learn 
   rather than just giving answers."
   ```

2. **Personality:** Show wisdom and experience
   - Supportive but honest
   - Can challenge student
   - Share relevant lessons

3. **First Message:** Welcoming but knowing

   ```
   "Ah, you're here. I've been expecting you. Come, let me show 
   you what you need to learn today."
   ```

## Character Duplication

If you want to create a variation of existing character:

1. Open character
2. Click menu (⋮)
3. Select **Duplicate** or **Clone**
4. New character created with same details
5. Rename and modify as needed
6. Now have two characters to work with

**Uses:**

- Same character, different time period
- Same character at different skill level
- Testing character variations
- Creating character template

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Topics

- [Characters Overview](characters.md) — About characters
- [Creating Characters](character-creation.md) — Making characters
- [Editing Characters](character-editing.md) — Modifying characters
- [Organizing Characters](character-organization.md) — Tags and filtering
- [Chats](chats.md) — Conversations with characters
- [Character Import/Export](character-import-export.md) — Sharing characters
