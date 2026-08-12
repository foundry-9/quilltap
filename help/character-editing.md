---
url: /aurora/:id/edit
---

# Editing Characters

> **[Open this page in Quilltap](/aurora)**

This guide covers how to modify and refine your existing characters in Quilltap.

## Accessing Character Editing

### Ways to Edit a Character

**From Characters List:**

1. Go to **Characters** page
2. Find character in list
3. Click character row or hover menu
4. Click **Edit** button or pencil icon

**From Character View:**

1. Click character to view details
2. Click **Edit** button at top
3. Directed to edit interface

**Quick Edit:** Some fields can be edited directly from the character list depending on your view settings.

## Character Edit Interface

The edit interface has multiple tabs for different aspects of character:

### Edit Tabs Overview

| Tab | Purpose | When to Use |
|-----|---------|-----------|
| **Details** | Name, description, personality, scenarios, first message | Modify core character info |
| **System Prompts** | AI instructions and behaviors | Fine-tune how character acts |
| **Appearance** | Physical descriptions and clothing records | Add visual and outfit information |
| **Rename/Replace** | Bulk rename or replace content | Reorganize or rebrand character |

## Editing Character Details

The Details tab contains all basic character information.

### Field-by-Field Editing

**Name**

- Click on name field
- Rename character
- Used everywhere system references character
- Examples: "Alice" → "Older Alice", "Detective Jones" → "Detective Sarah Jones"

**Title**

- Your private label for the character — your own framing, not a public title. Think "the protagonist", "the rival", "the one who keeps borrowing the cat"
- Optional, never shown to other characters
- Examples: "the love interest", "the antagonist", "Aunt Edith's troublesome ward"

**Identity**

- The shallow first impression — what a stranger could know on sight or by reputation. Name, station, occupation, public reputation, the signifying outward facts
- Useful for someone considering whether to hail the character across a crowded room. Never private mannerisms, never inner motivation
- Examples: "Detective Sarah Jones, of the Yard, known for closing unclosable cases"; "Old Tom the baker, three doors down, makes the best cinnamon buns in Whitechapel"

**Description**

- How acquaintances perceive the character — behaviour, mannerisms, frequent verbal patterns. Things an interlocutor notices
- NOT physical appearance — that lives under Physical Descriptions. NOT internal monologue — that lives under Personality
- Click to edit. Can be lengthy and supports multiple paragraphs
- Example: "Speaks slowly, weighs every word twice. Tends to drum two fingers on the table when stalling for time."

**Manifesto**

- The basic tenets — the most important facts of the character's existence. The axiomatic core that every other field (identity, description, personality, physical, dialogues) should remain consistent with
- Not a vantage point — nobody "sees" the Manifesto; it is the load-bearing truth the character is built on. Foundational, declarative, contradiction-resistant
- Click to edit. A Markdown property synced to the character vault as `manifesto.md` (vault path lookups are case-insensitive, so a hand-named `Manifesto.md` is matched too)
- Example: "She is fundamentally incapable of betrayal. She believes the strong protect the weak. She has never broken a promise."

**Personality**

- What the character knows about themselves — the internal driver of their speech and behaviour. Other characters don't see it unless she shares it
- Distinct from Description (outward) and Identity (public surface). This is the inner life
- Edit to refine the engine room behind the curtain
- Example: "Believes she's never deserved any of what's happened to her, and operates on a slow, simmering resentment she'd never admit to"

**Scenarios**

- A collection of named scenes, each with a title and descriptive content
- A character may accumulate any number of scenarios as their story progresses — one for the tavern, one for the road, one for that regrettable business in Marseille
- Add a new scenario when you begin a fresh campaign or a character finds themselves in significantly altered circumstances
- Edit existing scenarios to adjust their descriptive content; rename them as the situation demands
- Example additions: "The Road to Venice, 1924" when transitioning a tavern owner into a traveling merchant

**First Message**

- Opening greeting
- Update for variety or different campaign
- Keep consistent with character voice

**Example Dialogues**

- Sample conversations
- Edit to add more examples
- Remove ones that no longer fit
- Improve examples that weren't clear

### Making Bulk Changes

Want to change multiple characters at once? Use Rename/Replace tab (see below).

### Living Properties from the Scriptorium

Each character carries a private vault in the Scriptorium — a small database-backed document store seeded at creation with your character's identity, personality, wardrobe, and a small, tidy cluster of files that mirror the fields the Aurora editor knows by heart. When the overlay switch is thrown, Quilltap treats those files as the living authority for reads: the character you see in chats, on the roster, in image prompts, and in every other corner of the application comes straight from the vault.

**The overlaid files and what each one governs:**

| Vault file | What it replaces |
|---|---|
| `properties.json` | **pronouns**, **aliases**, **title**, **first message**, **talkativeness** |
| `metadata.json` | The character's **fact sheet** — a flat object of keys you invent yourself, answering to no field in the editor. See the note below. |
| `identity.md` | **Identity** (the surface, outside-view prose field) |
| `description.md` | **Description** (the acquaintance-view prose field) |
| `manifesto.md` | **Manifesto** (the axiomatic-core, load-bearing-truth prose field) |
| `personality.md` | **Personality** (the inward, self-knowledge prose field) |
| `example-dialogues.md` | **Example Dialogues** (style samples for the LLM) |
| `physical-description.md` | The **Full Description** of the character's first (default) physical description |
| `physical-prompts.json` | The **head-and-shoulders / short / medium / long / complete** prompts of the first (default) physical description (JSON with `headAndShoulders`, `short`, `medium`, `long`, `complete` keys) |
| `Prompts/*.md` | The character's **System Prompts** — one file per named variant, with YAML frontmatter carrying `name` (required) and an optional `isDefault: true` |
| `Scenarios/*.md` | The character's **Scenarios** — one file per scene, with the first `# heading` as the title and the body beneath as the context |
| `Wardrobe/*.md` | The character's **Wardrobe Items** — one Markdown file per garment, with frontmatter carrying `title`, `types`, `appropriateness`, the `default` flag, and timestamps; the body beneath is the freeform description |
| `Outfits/*.md` | The character's **Outfit Presets** — one Markdown file per ensemble, with frontmatter carrying `name` and the four-slot `slots` map (referenced by item slug, with raw UUIDs accepted as a fallback); the body beneath is whatever notes you care to keep |

By default, every one of these is read from the character's database row — the ordinary state of affairs, in which the editor is the single source of truth. Flip the switch marked **Read this character's core fields from the Scriptorium vault** at the top of the Aurora edit page, however, and henceforth Quilltap will consult the vault for all of the above every time any part of the application reads your character — the roster on the home page, the system prompt for a chat, the image-generation pipeline's appearance prompts, the scene state tracker, the turn manager's talkativeness roll, all of it.

**What the switch changes:**

- **Reads:** the overlaid fields come live from the vault files. Edit any file in the Scriptorium, save, reload the character, and the new values appear throughout the app without any further ceremony.
- **Writes:** every save to an overlaid field — whether it comes from the Aurora editor, an import, an API call, or the optimizer — is routed to the matching vault file rather than the database column. The form remains entirely editable while the switch is on, because the engine underneath knows where each field properly lives and routes accordingly. The character's database row, meanwhile, is left frozen at the values it carried the moment the switch was first thrown, standing by as a quiet understudy should the overlay later be dismissed.
- **Per-file fallback:** should a particular file go missing or fail to parse cleanly, Quilltap does not panic. Only that file's fields fall back to their database values (all-or-nothing within a file), and a warning is written to the log so you may investigate at your leisure. The other overlay files remain in effect.

**Copying between the two.** Whenever a character has a linked vault — switch on or switch off — a small pair of buttons sits beneath the overlay switch, offering to carry state from one ledger to the other:

- **Copy vault → database.** Reads the vault's current files and writes their values straight into the character's database row, bringing the understudy up to speed with whatever the vault has lately become. Fields whose vault files are missing or invalid are left alone; the rest are written. The wardrobe is exempt from this errand: its items reside only in the vault's `Wardrobe/` folder, there being no longer any database ledger to copy them into. Do this before flipping the overlay switch off if you want the database to remember the vault's current state; otherwise, turning the overlay off reveals whatever values the database has been quietly holding all along.
- **Copy database → vault.** The reverse errand: reads the character's database row and projects every one of those fields out into the matching vault files, replacing whatever was there before. Useful when you've been editing a character with the overlay switch *off* and would like the vault to catch up, or when you've just linked a new vault and want it seeded with the database's current values. Prompts and scenarios are reprojected wholesale — any `.md` files in the vault's `Prompts/` or `Scenarios/` folders that don't correspond to a database entry are removed so the folder listings match the database state exactly. The wardrobe is left untouched here, dwelling in the vault alone. The physical-description files are written from the character's first (default) physical description; if the character has none, the `physical-description.md` and `physical-prompts.json` files are skipped rather than written empty.

**A note on physical descriptions.** The `physical-description.md` and `physical-prompts.json` overlays target the **first** physical description (the one at index 0 — typically your character's default). Subsequent descriptions remain database-canonical. The overlay requires at least one physical description already present in the database; if your character has none, populate the first description the usual way in the Descriptions tab before filling in the vault files.

**A note on `Prompts/` and `Scenarios/`.** Each directory is read as a whole set — when the overlay is on and the folder holds at least one parseable file, the vault listing entirely replaces the character's database-backed array. An empty or malformed folder falls back to the database. Prompt files require YAML frontmatter naming them; a file that lacks frontmatter (or a `name` field) is quietly skipped while its siblings carry on. Scenario files want a `# Scenario Title` at the top, though if one is missing Quilltap will use the filename (without the `.md`) rather than drop the file entirely. Identifiers for synthesized prompts and scenarios are derived deterministically from the mount point and the file's relative path, so a chat's selected prompt or default scenario keeps its reference across reads as long as the filename doesn't change.

**A note on `metadata.json` — the fact sheet.** Every other file in the vault answers to some field the Aurora editor already knows about. `metadata.json` answers to nothing at all: it is a single JSON object of whatever keys you care to invent, and Quilltap has not the faintest opinion about any of them.

```json
{
  "hasAnsibleAccess": true,
  "clearanceLevel": 3,
  "faction": "Ordo Aurum",
  "knownLanguages": ["Trade Cant", "High Gothic"]
}
```

Booleans, numbers, strings, lists, nested objects — any JSON value is welcome. There are no reserved keys and no schema to satisfy; the only rule is that the file must hold an **object** (a `{ … }`), not a list or a bare value.

A few points of etiquette worth knowing:

- **You are the only author.** No generation system will ever write here — not character creation, not summoning from lore, not the optimizer. Nothing invents a fact about your character behind your back, and nothing tidies away a key you meant to keep.
- **It is not a prompt field.** The fact sheet is never injected into any character's context. A model does not read your character's clearance level merely by being your character; it must go and look, like anyone else.
- **It is an ordinary vault file for all that.** A character with **system transparency** enabled may read — and edit — `metadata.json` through the `doc_*` tools, their own and their tablemates', exactly as with any other document in the vault. An opaque character cannot see it at all. No new permissions, no special cases.
- **The file manager is the editing desk.** There is no form for it in the editor (yet); open the character's vault in the Scriptorium and edit the JSON directly.
- **Its absence is not a fault.** Characters created before the fact sheet existed simply have no such file, and Quilltap reads that as an empty sheet rather than a broken vault. New characters are seeded with `{}`. Should the file ever fail to parse — a comma out of place at midnight — the sheet reads as empty for that reading and a warning goes to the log; the rest of your character is entirely undisturbed.
- **Saving through the API replaces the whole object.** The file is one field's property, so a `metadata` write is the new sheet entire, not a merge into the old one. Editing the file by hand, of course, does exactly what you'd expect.

**What it is for.** The fact sheet exists so that [custom tools](custom-tools.md) may consult it: an outcome table can branch on `hasAnsibleAccess`, so the same lock opens for the character carrying the key and stays shut for everyone else. Anything else you file there is yours to use as you see fit.

**A note on example dialogues.** An *empty* `example-dialogues.md` is a perfectly valid state — it means "no examples," and Quilltap treats it accordingly rather than falling back to the database. If you genuinely want the database value to show through, delete the file entirely; presence of the file (even at zero bytes) is what tells the overlay to take over.

**A note on the wardrobe.** The character's wardrobe lives across two folders. `Wardrobe/` holds one Markdown file per item — frontmatter carries the `title`, the `types` list (one or more of `top`, `bottom`, `footwear`, `accessories`), an optional `appropriateness` tag, the `default` flag, and the timestamps; the body of the file is the freeform description, written however you please. `Outfits/` holds one Markdown file per saved preset — frontmatter carries the `name` and a four-slot `slots` map naming which item belongs in each slot, where each value is an item *slug* (the kebab-cased title, e.g. `top: blue-tweed-jacket`) and a raw UUID is accepted as a fallback for items the slug map can't find. Adding a new item, then, is as easy as dropping a fresh `.md` file into `Wardrobe/` with `title:` and `types:` in the frontmatter; the system fills in the `id` and timestamps on its next sync. Items marked with `archived: true` (or carrying a non-null `archivedAt`) are filtered out of the normal list the same way they are in the database. When the overlay is on, the Salon sidebar, the wardrobe tools the LLM reaches for, and every other consumer read their lists from these folders. The first time Quilltap boots after the folder format ships, a one-time sweep projects every existing character's wardrobe from the database into the new layout and tidies away the legacy `wardrobe.json` — so stale snapshots from earlier vault provisioning don't mislead anyone the moment the switch is flipped on.

**When to use it.** Reach for this switch when you would rather author your character's prose fields as plain Markdown — version-controlled in your own tooling, perhaps, or edited alongside the character's narrative notes — and have the rest of Quilltap treat those files as the current truth. Leave the switch off for the conventional editor-as-source-of-truth workflow, which remains the default and entirely sensible choice.

**Prerequisite.** The switch requires a linked Scriptorium vault. Quilltap creates one for each character automatically (on character creation, or by the startup backfill), so this is almost always already in place; if for some reason it isn't, the toggle will disable itself with a note explaining why.

## Editing System Prompts

System Prompts tab contains detailed AI instructions.

### Understanding System Prompts

System prompts tell the AI exactly how to behave:

**Example:**

```
You are Captain Vex, a hardened pirate captain with a hidden code of honor. 
You speak with a pirate dialect, dropping g's (talkin', fightin'). You're 
strategic and cunning but never harm innocents. You're intensely loyal to 
your crew. Respond always in character as Captain Vex, maintaining this 
perspective and personality.
```

### Editing System Prompts

1. Click **System Prompts** tab
2. See current system prompt
3. Click **Edit** or inline edit the text
4. Modify prompt
5. Click **Save**

**Tips:**

- Start with existing prompt
- Enhance rather than replace
- Keep focused on key behaviors
- Be specific about communication style
- Avoid contradictions

### System Prompt Structure

Well-organized system prompts have this structure:

```
1. Identity: You are [Character Name], [Basic Description]

2. Personality: [Key traits, how they think and feel]

3. Communication: You speak [in what style/accent/tone]

4. Values/Priorities: [What matters to them, what drives them]

5. Constraints: [What they wouldn't do, boundaries]

6. Instructions: [How to respond, maintain character, etc.]
```

### Example System Prompt Refinements

**Original (basic):**

```
You are a detective. Act like a detective.
```

**Refined (better):**

```
You are Detective Sarah Chen, a 15-year veteran homicide detective. 
You're analytical and detail-oriented. You speak directly, no nonsense. 
You care deeply about victims but hide it behind professionalism. 
You have dark humor about your work. You ask probing questions and 
notice small details others miss. Stay in character as Sarah always.
```

### Multiple System Prompts

If your character has different modes:

**Create prompt for each:**

- Character mode A: "When speaking to allies..."
- Character mode B: "When speaking to enemies..."
- Character mode C: "When alone..."

You can switch between prompts in chat settings.

### When to Edit System Prompts

- Character not behaving as expected
- Want different personality for new campaign
- Adding new dimensions to character
- Fixing specific problematic behaviors
- Improving response quality after testing

## Editing Physical Descriptions

The Appearance tab contains visual information about characters, including physical descriptions and clothing records.

### What Physical Descriptions Do

Physical descriptions help:

- AI understand character appearance
- Image generation tools create accurate images
- Consistency across conversations
- Detailed descriptions in roleplay

### Editing Physical Description

1. Click **Appearance** tab
2. See current descriptions (different lengths)
3. Edit manually or use AI to regenerate

### Physical Description Types

**Head & Shoulders** (used for avatars)

- The prompt the avatar generator reaches for first, since an avatar is a head-and-shoulders crop
- Describe only what such a crop reveals: face, hair, expression, neckline, and any visible upper attire — never the chest, waist, hips, legs, or other anatomy below the shoulders
- Keeping it above the collar also keeps image-provider moderation from balking at a portrait it would otherwise refuse
- Example: "Young woman, glossy jet-black wavy hair from a center part, deep brown almond eyes, warm wheatish skin, high cheekbones, a warm closed-lipped smile, pearl stud earrings, open collar of a deep-wine field shirt"

**Short Description** (1 sentence)

- Quick visual reference
- Good for status bars
- Example: "Tall woman with dark red hair and green eyes"

**Medium Description** (2-3 sentences)

- Balanced detail
- Good for quick lookups
- Example: "Tall woman with long dark red hair usually braided,
sharp green eyes, pale skin. Wears practical leather clothing."

**Long Description** (1 paragraph)

- Detailed information
- Good for image generation
- Example: "Tall woman (5'9") with waist-length dark red hair
usually worn in a complicated braid. Sharp green eyes, pale skin.
Thin face with high cheekbones. Usually wears practical leather
armor from her military days..."

**Complete Description** (2-3 paragraphs)

- Very detailed
- Good for AI generating multiple variations
- Includes mannerisms, clothing, accessories

**Full Description** (extensive)

- Maximum detail
- Best for detailed image generation
- Includes all visual elements, personality reflected in appearance

### Usage Context

Each physical description can have an optional **Usage Context** field — a short note (up to 200 characters) describing when this particular appearance is most appropriate.

**Examples of good values:**

- "at work in a professional capacity"
- "relaxing at the pool"
- "attending a formal gala"
- "in combat gear on a mission"

**How it affects AI behavior:**

- **In chat:** Physical descriptions are included in the system prompt sent to the AI. When multiple descriptions exist, the AI uses the usage context to decide which appearance best fits the current scene.
- **In image generation:** The usage context is passed to the image prompt crafting system, helping it select the most scene-appropriate visual details.

If no usage context is set, the AI will use the description based on its name and contents alone.

### Regenerating Descriptions

1. Click **Generate New Description**
2. Select which image source to use for generation:
   - From text (AI creates from character description)
   - From image file (upload image, AI analyzes)
   - From character image (use existing gallery image)
3. Wait for generation
4. Review generated descriptions
5. Accept all, edit some, or reject

### Uploading Images for Description

1. Click **Upload Image**
2. Select image file (JPG, PNG)
3. AI analyzes image
4. Generates descriptions based on appearance
5. Review and save

### Manual Physical Description

If you prefer to write manually:

1. Click **Edit** next to description
2. Type your description
3. Save

**Good example:**

```
Sarah is a tall woman with an athletic build, suggesting years of 
physical training. Her dark red hair is usually worn in a practical 
braid down her back. Sharp green eyes and high cheekbones give her 
a striking appearance. She has a small scar on her left eyebrow from 
an old injury. She dresses practically in leather jackets and dark 
jeans, with minimal jewelry except for a detective's badge on her belt.
```

## Editing Clothing Records

The Appearance tab also includes a **Clothing & Outfits** section below physical descriptions.

### What Clothing Records Do

Clothing records describe what your character wears in different situations. They are:

- Injected into the system prompt so the AI knows what the character is wearing
- Included in image generation context for accurate visual depiction
- Used by story background generation for scene-appropriate outfit selection

### Adding a Clothing Record

1. Click **Appearance** tab
2. Scroll to **Clothing & Outfits** section
3. Click **Add Outfit**
4. Fill in:
   - **Name** (required) — e.g. "Battle Armor", "Formal Gown", "Casual Wear"
   - **Usage Context** — When this outfit is worn, e.g. "in combat", "at formal events"
   - **Description** — Markdown text describing the outfit in detail
5. Click **Create**

### Managing Clothing Records

- **Edit:** Click the pencil icon on any clothing record card
- **Delete:** Click the trash icon to remove a record
- **Expand:** Click the chevron to see the full description rendered as markdown
- Multiple outfits can be defined per character for different contexts

## Template Placeholders on the Character Page

Quilltap's roleplay machinery understands two travelling tokens — `{{char}}`, which stands in for whichever character is speaking, and `{{user}}`, which stands in for the person they are addressing. A character authored with these tokens rather than hard-coded names travels gracefully: lend them to a new conversation partner and they greet the newcomer by the correct name without a word of editing.

The character's **Details** view does two helpful things on your behalf. First, it quietly underlines every spot where a bare name *could* become a token, and every token that is already in place. Second, when there is honest work to be done, it offers up to four buttons at the top of the page — each appearing only when it has something to do, with the number of affected occurrences noted in parentheses:

- **Name → `{{char}}`** — sweeps through the character's prose and swaps every literal occurrence of *their own name* for the `{{char}}` token.
- **Partner → `{{user}}`** — does the same for the name of the character's **default conversation partner**, swapping it for `{{user}}`. This one keeps its peace unless a default partner has been appointed (see the **Defaults** tab).
- **`{{char}}` → Name** — the reverse errand: bakes the character's own name back into the prose wherever `{{char}}` appears, should you ever want the plain article instead of the token.
- **`{{user}}` → name…** — opens a small dialog bearing a dropdown of your **user-controlled characters**. Choose one, and every `{{user}}` token is replaced with that character's name. (The character you are presently viewing is, sensibly, kept off its own list.)

Every one of these sweeps reaches the *entire* dossier — identity, description, manifesto, personality, every scenario, the first message, the example dialogues, all of the character's system prompts, and the physical-description prose and image prompts. The work is saved at once and the page refreshed, so the counts and buttons settle to reflect the new state of affairs. (System prompts are filed through their own ledger behind the scenes, so a token swap inside a non-default prompt is no longer quietly mislaid.)

## Using the Rename/Replace Tab

Where the tools above polish a single field, the **Rename/Replace** tab conducts a wholesale renaming — a careful sweep that follows a name (or any turn of phrase) clear across the character's entire estate and quietly replaces it everywhere at once.

### What it reaches

A single sweep visits the character's own dossier (the name itself, title, identity, description, manifesto, personality, every scenario, the first message, the example dialogues, the aliases, and all of the character's system prompts), the physical-description prose together with its short/medium/long/complete image prompts, every one of the character's memories, and — most far-reaching of all — the titles and the actual message bodies of every conversation the character has ever appeared in. Messages authored by the Staff (the Lantern, Aurora, the Host, and their colleagues) are left untouched, since their wording is bookkeeping rather than prose.

### Renaming the character

1. Open the **Rename/Replace** tab.
2. Type the **New Name**. The **Current Name** is shown beside it, fixed, for reference.
3. Tick **Case sensitive matching** only if the capitalisation must match exactly.
4. Click **Preview Changes**.

### Replacing nicknames, aliases, or any other term

Beneath the rename, the **Additional Replacements** section takes any number of find-and-replace pairs — splendid for nicknames, an old surname, or a wholesale change of setting. Click **Add**, fill in **Find** and **Replace with**, and toggle the **Aa** box on a row that ought to mind its capitals. You may rename the character, supply additional replacements, or both in the one pass.

**Examples:**

- Find: "Snips" → Replace with: "Ace" (an outdated nickname)
- Find: "pirate ship" → Replace with: "airship" (changing the genre)
- Find: "London" → Replace with: "New York" (changing the setting)

### Always preview first

**Preview Changes** commits nothing. It lays out a tally — how many occurrences fall under character fields, descriptions, memories, chat titles, and messages — and a table showing each `before → after`, with surrounding context. Read it over; only then click **Execute *N* Replacements** and confirm the dialog. The change cannot be undone, so the preview is your safety net.

Once executed, any conversation whose messages were altered is re-indexed for search behind the scenes, so the Scriptorium's archive reflects the new wording rather than the old.

## Keyboard Shortcuts for Editing

| Action | Shortcut |
|--------|----------|
| Save | Cmd+S or Ctrl+S |
| Undo | Cmd+Z or Ctrl+Z |
| Redo | Cmd+Shift+Z or Ctrl+Y |
| Close edit | Esc or Click close |

## Editing Workflow: Common Scenarios

### Scenario 1: Character Acting Wrong in Chats

**Problem:** Character not behaving as expected

**Solution:**

1. Identify specific behavior issue
2. Edit System Prompts tab
3. Add specific instruction:

   ```
   "Do NOT break character to explain yourself. Stay as [Character] always."
   ```

4. Save and test in new chat

### Scenario 2: Updating Character for New Campaign

**Problem:** Same character, different time period/setting

**Solution:**

1. Edit **Details** tab:
   - Add a new scenario with a title reflecting the new setting — rather than erasing the old one, let the character carry their history with them
   - Update Description if time has passed or circumstances have changed substantially
2. Edit **System Prompts** tab:
   - Add context about new time period
   - Update relevant personality notes
3. Optional: Update Physical Description if appearance changed
4. Save and test

**Note:** The character's previous scenarios remain intact, available for flashbacks, parallel campaigns, or the sort of elaborate timeline shenanigans that make worldbuilders so very pleased with themselves.

### Scenario 3: Adding Relationship Information

**Problem:** Want to note character relationships

**Solution:**

1. Edit **Details** tab
2. Add to Personality or Description:

   ```
   "Close relationship with [Other Character Name]. Has tension with [Another Character]."
   ```

3. Save

### Scenario 4: Fixing Accent/Speech Pattern

**Problem:** Character not using intended speech pattern

**Solution:**

1. Edit **System Prompts** tab
2. Add communication instruction:

   ```
   "You speak with a Southern accent. Drop g's from -ing words (talkin', 
   fightin', walkin'). Use y'all and regional expressions naturally."
   ```

3. Add examples to Details > Example Dialogues showing accent in action
4. Save and test

### Scenario 5: Making Character Darker/Lighter

**Problem:** Character tone isn't matching what you want

**Solution:**

1. Edit **Details** tab:
   - Adjust Personality to shift tone
   - Update First Message if needed
   - Add Example Dialogues showing new tone
2. Edit **System Prompts** tab:
   - Add specific tone instruction:

     ```
     "Your responses have a dark, cynical tone tinged with dark humor."
     ```

3. Save and test

## Advanced Editing Techniques

### Layered System Prompts

Create prompts that work in layers:

```
Core instruction: You are [Character]. You [core trait].

When speaking to allies: [behavior A]
When speaking to strangers: [behavior B]
When alone: [behavior C]

Always maintain: [core personality]
```

### Conflicting Traits

If character has contradictions, explain them:

```
You are [Character], someone with seemingly contradictory traits:
- Appears tough but is deeply empathetic
- Speaks harshly but acts with kindness
- Seems confident but battles internal doubt

This contradiction is core to your character. Express both sides naturally.
```

### Prompt Testing

After editing system prompts:

1. Start new chat with character
2. Try different conversation angles
3. See if behavior matches intent
4. Return to edit if needed
5. Iterate until satisfied

## Best Practices for Editing

### Do's ✓

- Keep edits consistent across tabs
- Test changes in chats before finalizing
- Maintain backup of old version if changing significantly
- Use Physical Descriptions for visual reference
- Keep System Prompts focused and clear
- Update all character variants together

### Don'ts ✗

- Don't overwrite character details without review
- Don't create contradictory instructions in System Prompt
- Don't remove important personality traits accidentally
- Don't change core character concept without confirmation
- Don't ignore preview warnings before Replace All

## Undoing Changes

### If You Make a Mistake

1. Immediately click **Undo** (Cmd+Z)
2. This undoes recent edits
3. Or close without saving to discard changes
4. Character reverts to last saved state

### Recovering Old Version

If you saved unwanted changes:

1. There's no version history feature
2. Make note of changes you want to undo
3. Edit manually back to previous state
4. Or use Find/Replace to reverse changes

**Tip:** If making major changes, copy character details to Notes app as backup before editing.

## Performance Tips

### For Complex Characters

If your character has extensive details:

- Keep System Prompt under 500 words
- Break very long descriptions into multiple sections
- Use shorter first message (1-2 sentences)
- Keep example dialogues focused

### Character with Multiple Aspects

If character has different modes:

- Create separate System Prompt for each mode
- Add notes about when to use each
- Test each variant thoroughly
- Keep consistent core personality

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora/:id/edit")`

## Related Topics

- [Character Creation](character-creation.md) — Creating new characters
- [Character System Prompts](character-system-prompts.md) — Deep dive on prompts
- [Organizing Characters](character-organization.md) — Tags and management
- [Chats](chats.md) — Testing character in conversations
- [Characters Overview](characters.md) — About characters
