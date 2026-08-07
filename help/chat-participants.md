---
url: /salon/:id
---

# Chat Sidebar

> **[Open this page in Quilltap](/salon)**

The Chat Sidebar is your right-hand control room for any conversation in The Salon — a single tasteful cabinet of drawers from which the entire chat may be conducted, tuned, and tidied. Where once there were three separate apparatus (a Participants Sidebar, a Tools palette popover, and a Chat Settings modal) you now have one cabinet with five drawers: **Participants**, **Chat**, **Visibility**, **Organize**, and **Edit Content**.

## What the Chat Sidebar Holds

Each drawer attends to a different aspect of running the conversation:

- **Participants** — the cast of characters, who's speaking, who's queued, and every dial for tuning their behaviour. (This page treats that drawer in considerable detail; the rest are sketched briefly below with cross-references.)
- **Chat** — the per-chat dials. Agent Mode, Roleplay Template, Project assignment, Image Provider, Lantern announcements, automatic avatar generation, and the gateways to the Tools and Run Tool modals. Regenerate Background lives here too, when story backgrounds are switched on.
- **Visibility** — only present in multi-character chats. Two toggles: **All Whispers** (show or hide private asides) and **Shared Vaults** (whether characters may read one another's vaults).
- **Organize** — the chat as an object. Copy ID, Rename, State editor, Continue Elsewhere, Export, and Gallery (when there are photos to display).
- **Edit Content** — the heavier instruments. Replace, Bulk Replace, Re-extract Memories, and Delete Memories.

Only one drawer stands open at a time, in the manner of a well-mannered campaign desk; opening another closes the previous. Participants is open by default whenever the sidebar is expanded.

## Accessing the Sidebar

### Opening the Sidebar

The sidebar appears automatically in multi-character chats. If collapsed:

1. Look for the sidebar strip on the right edge of the chat
2. Click the **expand button** (left-facing arrow)
3. Or click any mini avatar in the collapsed strip
4. Sidebar expands to full width and reveals the five drawers

### Closing the Sidebar

To collapse and save space:

1. Click the **collapse button** (right-facing arrow) in the sidebar header
2. Sidebar minimizes to a thin strip with mini avatars (always the Participants view, in miniature)
3. Click expand or any avatar to open the cabinet again

### Resizing the Sidebar

Should the cabinet feel too narrow for your cast — or too greedy with the page — you may take it by the handle and let it out a notch:

1. Hover the **inner edge** of the expanded sidebar (the seam where it meets the conversation). A slim grip of three dots reveals itself and the cursor turns to the resize arrows.
2. **Drag toward the chat** to widen the cabinet, or **back toward the wall** to slim it. The conversation reflows to make room as you go.
3. Release wherever it suits you. The width is held within sensible bounds so neither the cabinet nor the conversation is ever crushed to a sliver.

Prefer the keyboard? Give the grip focus (Tab to it) and use **← / →** to nudge the width, or **Home / End** to leap to the narrowest and widest settings.

Your chosen width is **remembered across reloads** (saved in your browser), so the cabinet opens to the size you left it. The slim collapsed strip keeps its own fixed, modest footprint regardless.

### Moving Between Drawers

Each drawer is a clickable header within the expanded sidebar. Click the header to open the drawer; click it again, or open any other drawer, to close it. Which drawer is open is **session-only** — every reload returns you to Participants, by design.

## Sidebar Views

### Collapsed View

When collapsed, the sidebar shows:

**Mini Avatars:**
- Small circular avatars for each participant
- Stacked vertically on the right edge, sorted by predicted turn order
- Shows current speaker with glowing border
- Turn position badges on all active participants (color-coded by status)
- Status overlay icons on avatars indicate non-active states (silent, absent) so you can see at a glance who's participating even with the sidebar collapsed
- Absent participants shown dimmed

**Quick Actions:**
- Pause/Resume button at the top
- Click any avatar to expand sidebar

**When to use:**
- Maximize chat space
- Quick glance at participants
- On smaller screens

### Expanded View

Full sidebar showing the five accordion drawers. The slim header at the top is now nothing more than the word **Chat** and a collapse arrow; the participant count moved into the **Participants** drawer's own header line, and the turn status, queue indicator, pause button, participant cards, and Add Character button all live inside that drawer's body.

**Participants drawer (open by default):**
- Participant count in the drawer header ("3 characters")
- Turn status message
- Queue count if applicable
- Pause/Resume button
- Full participant cards (talkativeness sliders, action buttons, status dropdowns, impersonation controls)
- Add Character button at the bottom

**Other drawers** sit closed beneath Participants until summoned — see the brief tours below.

**When to use:**
- Managing participants
- Adjusting settings
- Multi-character scene orchestration

## Participant Cards

The following sections describe what appears inside the **Participants** drawer when it is open. The pause/resume button sits above the list; the participant cards form the bulk of the drawer; the **Add Character** button sits at the bottom.

Each character in the sidebar has a card with:

### Identity Section

**Avatar:**
- Character's profile image or initials
- Current speaker has glowing/animated border
- Turn position badge showing predicted speaking order (color-coded by status)

**Name and Title:**
- Character's name
- Optional title/role beneath

**Type Badge:**
- "Character" for regular characters
- "User Character" for user-controlled characters
- "NPC" for on-the-fly characters

### Connection Profile Dropdown

Each character card includes a **connection profile dropdown** that lets you change which LLM service and model the character uses, directly from the sidebar:

- **Dropdown selector** shows the current model (e.g., "gpt-4-turbo", "claude-3-opus")
- **"User (you type)"** option switches the character to user control (impersonation)
- **Change immediately** — selecting a different profile saves automatically
- Present on **every** participant card — including the seat you are presently typing as. The card you've claimed as your own ("You") carries the very same dropdown, so any participant may be handed off to an LLM, and any LLM reclaimed for your own pen, all from the one control. Pass your own seat to a model and the room can carry on without you (you may still slip back in by impersonating); pick a model for a character and they answer for themselves once more.

This makes switching models the fastest possible action — no need to open a settings modal.

### System Prompt Dropdown

Immediately beneath the connection profile selector, each LLM-controlled character card also carries a **system prompt dropdown**. If the character has more than one named system prompt (defined on the character's edit page), this lets you pick which one the LLM should speak from — without leaving the chat:

- **Use default prompt** — the entry marked as default on the character takes the stage
- **Every named prompt** the character carries appears in the list, with the default marked
- **Effect is immediate** — the next turn (nudge, auto-response, or swipe) uses the newly chosen prompt
- Only shown for LLM-controlled characters that have at least one named prompt on file

If you want a character to keep the same costume but change their register for an afternoon — swap them from their "Formal" variant to their "Casual" one here, and the switch takes effect with the very next line they speak.

### Rebuild System Prompt Button

Tucked beside the system prompt dropdown — and present even for characters who carry no named prompts at all — is a small refresh button with a circular-arrow glyph. Press it and Quilltap will re-compile this character's system prompt for the chat from the ground up, drawing on whatever is presently inscribed on the character's record: manifesto, personality, named prompts, aliases, pronouns, and the rest of the identity pantry.

Why on earth would one need such a thing? Because while changing the dropdown is caught the moment you let go of it, **edits to the underlying character — say, you stepped away to polish their manifesto on the character page — are not propagated to a running chat's cached prompt automatically.** Your edits will eventually take effect, but the cached version may linger through a turn or two first. The refresh button settles the matter at once. A toast confirms the rebuild has been completed, and the very next turn speaks from the fresh draft.

Reach for it whenever you've revised a character's prompt content elsewhere and want to be quite certain the chat is reading from the updated copy rather than yesterday's.

### Status Indicators

**Control Mode:**
- LLM icon if AI-controlled, with a provider icon badge showing the current LLM service and model
- "You" indicator if impersonated

**Participation Status:**
- Full color when **active** — speaking and roleplaying normally
- Muted styling with **Silent** badge when silenced — present but observing
- Dimmed with **Absent** badge when away — turns are skipped entirely
- Removed participants no longer appear in the sidebar

**Current Turn:**
- Glowing border when it's this character's turn
- "Generating..." text while responding
- Typing animation during generation

### Control Section

**Talkativeness Slider:**
- Horizontal slider (LLM-controlled characters only)
- Drag to adjust speaking frequency
- Left = quieter, Right = chattier
- Changes apply immediately

**Turn Action Buttons:**

- **Nudge** — Force immediate response (LLM characters)
- **Queue** — Add to speaking queue
- **Dequeue** — Remove from queue (if queued)
- **Stop** — Interrupt the current generation (shown on the generating character's card)

**Status Dropdown:**
- A dropdown selector on every participant card lets you set their participation state
- **Active** — Character speaks and roleplays normally (default)
- **Silent** — Character receives turns but is instructed to observe silently; they may have inner thoughts, physical reactions, and actions, but must not speak aloud. Messages from silent characters appear with a distinctive dotted border and muted tones, rather like whispered asides at a particularly discreet garden party
- **Absent** — Character is temporarily away from the scene; the turn manager skips them entirely, and they appear dimmed at the bottom of the sidebar. Other characters are notified of their departure
- **Removed** — Character has left the chat for good; they cannot be whispered to and have no knowledge of events after their departure. Their past messages remain visible
- When any character's status changes, all other LLM-controlled characters are informed in their next turn's prompt

**Impersonation Controls:**

- **Impersonate** — Take control of this character
- **Stop Impersonate** — Return to AI control

**Remove Button:**
- Remove this character from the chat
- Only available if more than one character present

## Participants Drawer Header

These items appear at the top of the **Participants** drawer body, above the participant cards:

### Participant Count

"3 characters" or "2 characters" appears in the drawer's own header line, beside the word *Participants*.

- Counts only LLM-controlled characters
- Helps track chat complexity

### Turn Status

Current state of the conversation:

- **"Your turn to speak"** — All characters have spoken, waiting for you
- **"Generating response..."** — AI is creating a response
- **"Waiting for [Name]..."** — Waiting for specific character
- **"[Name] is thinking..."** — Character actively generating

### Queue Information

If characters are queued:

- **"2 in queue"** — Shows how many are waiting
- Queue empties as characters speak

### Pause/Resume Button

Controls auto-response flow:

- **Pause** — Stop automatic turn progression
- **Resume** — Continue automatic responses
- Most useful for all-LLM chats

## Managing Participants

### Announcements from the Host

Whenever a character is added to the chat, removed from it, or switched between **active**, **silent**, and **absent** states, the Host steps forward and announces the change in the conversation as a synthetic message — visible to you and to every other LLM character in the chat. Add announcements include the new arrival's avatar and either their **identity** (drawn from `identity.md` in the character's vault, when one exists) or their **description** field as a fallback — identity preferred, description used only when there is no vault identity to draw upon. Remove and state-switch announcements are text-only.

Characters whose **System Transparency** is off do not see the Host's messages — the same Staff-filter rule that already hides Lantern, Aurora, Librarian, and Prospero announcements from opaque characters applies here too. You always see them.

The Host also issues a one-time advisory whisper when a chat has no user-controlled character attached. Without one, the auto-memory pipeline cannot record what your characters come to know about *you* — only what they come to know about themselves — so the Host gently nudges you toward attaching or creating a user persona. The whisper appears at most once per chat; once acted upon (or once a user-controlled character has been added), it does not return.

### Announcements from Prospero

When you reassign a participant to a different connection profile from the sidebar — swapping the LLM that drives a particular character — Prospero, master of the agentic and tool-using systems, steps forward and announces the change so the rest of the room is in on the news. The note records the participant's name, the new profile, and the one it replaced. Like the Host's announcements, Prospero's messages are filtered out of the conversation handed to characters whose **System Transparency** is off; you always see them.

### How Staff Announcements Appear

All of the Staff — the Host, Prospero, the Lantern, Aurora, the Librarian, the Concierge, the Commonplace Book, and Ariel — make their remarks not as full-throated bubbles but as slim, foldable **chips** set into the flow of conversation. When several arrive in quick succession (the opening flurry of a chat, say, or a busy spell of document tidying), they pack themselves cheek by jowl across a row, flowing left to right and wrapping to the next line as needed, so that a whole parade of notices occupies but a sliver of vertical space.

Each chip wears a small coloured dot before the speaker's name, a quiet signal of how much it ought to command your attention:

- A **red dot** marks the consequential — files saved, renamed, or struck from the catalogue; characters arriving, taking their leave, or changing their bearing between active, silent, and absent; the Concierge's warnings about delicate content.
- An **amber dot** marks the noteworthy — a fresh backdrop from the Lantern, a refreshed portrait or change of attire from Aurora, a terminal opened or closed by Ariel, a character's driving LLM swapped by Prospero.
- A **hollow grey dot** marks the merely ambient — Prospero's periodic notes on the project and its papers, the Host's calls of the hour, the Commonplace Book's quiet recollections.

Click any chip to unfold it into its full announcement; click it again — or the chevron at its end — to fold it back into the row. Unfolding one chip in the middle of a packed run simply lifts that single notice out for a closer look, leaving its neighbours snug in their row.

### Adding Characters

1. Click **Add Character** at the bottom of the sidebar
2. A character selector opens, offering three doors:
   - **Choose from your library** — pick a soul already in your keeping
   - **Create New NPC** — conjure an ad-hoc character on the spot (see below)
   - **Summon from Lore** — distil a character out of your worldbuilding notes (see below)
3. Whichever door you take, the chosen character lands back in the selector, ready for you to settle the particulars
4. Configure options:
   - **History Access** — Can they see previous messages?
   - **Join Scenario** — Optional entrance description
   - **Starting Outfit** — The wardrobe with which they cross the threshold: defaults, a slot-by-slot composition, the cheap LLM's best guess from the scene, or nothing at all
5. Click **Add** to confirm
6. Character appears in the sidebar

#### Creating an Ad-Hoc NPC

For a quick walk-on who needn't trouble your permanent library, click **Create New NPC** and fill in a few essentials:

- **Name** and **Description** (the description doubles as the character's personality)
- Optionally a **Physical Description**, a **Scenario**, a custom **System Prompt**, and an **Avatar**

Every field you complete is set down faithfully — Scenario and Physical Description included. Confirm, and the new NPC is preselected in the picker so you can choose their connection profile and starting outfit before adding them to the chat.

#### Summoning from Lore

When the soul you want is already implied by your notes, click **Summon from Lore** to open the summoning apparatus. Upload lore files or paste text, choose a connection profile for the conjuration, and let the wizard draw out a fully-formed character. The summoned character is added to your library and preselected in the picker, where you finish as you would for any other arrival.

A single summoning produces a single soul; should the lore yield more than one (or none at all), the apparatus will say so and leave the picker untouched — repair to **Aurora** to sort out a crowded conjuration.

### Removing Characters

1. Find the character's card in the sidebar
2. Click the **Remove** button (X or trash icon)
3. Confirm removal
4. Character leaves the chat

**Notes:**
- Cannot remove the last character
- Past messages from removed characters remain visible
- Character can be re-added later

### Reordering (if supported)

Some versions support drag-and-drop reordering:

1. Click and hold a character card
2. Drag to new position
3. Release to drop
4. Order affects display, not turn selection

## Talkativeness Control

### What Talkativeness Does

Controls how likely a character is to speak when it's time to select the next speaker:

- **Higher values** — More likely to be selected
- **Lower values** — Less likely to be selected
- **Zero** — Never volunteers (must be nudged or queued)

### Adjusting Talkativeness

1. Find the character's card
2. Locate the slider below their name
3. Drag left or right to adjust
4. Value updates immediately
5. Next turn selection uses new value

### Suggested Settings

**Lead Character:** 0.7-1.0
- Speaks frequently, drives the conversation

**Supporting Character:** 0.4-0.6
- Balanced participation

**Background Character:** 0.1-0.3
- Chimes in occasionally

**Silent/Reactive:** 0.0
- Only speaks when prompted

## Turn Control

### Using Nudge

Forces a character to speak immediately:

1. Find the character in sidebar
2. Click **Nudge**
3. Character generates response immediately
4. Overrides normal turn order

**Use cases:**
- Character should react to something specific
- Breaking normal flow for dramatic effect
- Testing a character's response

### Using Queue

Adds characters to an ordered speaking list:

1. Click **Queue** on first character to speak
2. Badge "1" appears on their avatar
3. Queue more characters as needed
4. They speak in the order queued

**Managing queue:**
- Click **Dequeue** to remove from queue
- Queue persists until processed or cleared
- Queued characters speak before random selection

### Turn Order Badges

Position badges on each participant show their predicted turn order:

- **Green pulsing** — Currently generating (#1)
- **Green static** — Next speaker
- **Blue** — Queued to speak
- **Neutral** — Eligible, sorted by talkativeness
- **Amber** — Your turn position
- **Dimmed** — Already spoke this cycle
- **No badge** — Absent or removed participant

## Impersonation

### Starting Impersonation

1. Find the character to control
2. Click **Impersonate**
3. Character switches to user control
4. When it's their turn, you type their response

### Visual Indicators

When impersonating:

- Card shows "You" indicator
- Impersonate button changes to "Stop Impersonate"
- Input area shows which character you're typing as

### Switching Characters

If impersonating multiple characters:

1. Look above the input field
2. Click the character name/avatar to switch
3. Your next message sends as that character

### Stopping Impersonation

1. Click **Stop Impersonate** on the character's card — always present there, so you are never stranded mid-impersonation
2. If the character has no connection profile of its own, you'll be asked to pick one so it can answer under its own steam again
3. The character resumes speaking for itself; nothing else about the seat is disturbed

## Pause and Resume

### The Pause Button

Located in the sidebar header:

- **Pause** (shown during auto-responses) — Stop automatic progression
- **Resume** (shown when paused) — Continue auto-responses

### When to Pause

- Reading and absorbing a complex scene
- Planning your next action carefully
- Taking a break during long sessions
- Preventing runaway all-LLM conversations

### Auto-Pause

In all-LLM chats (no user-controlled characters):

- System auto-pauses after several turns
- Notification appears asking to continue
- Click Resume or Pause to respond
- Prevents infinite conversation loops

## The Other Four Drawers

Opening any of these closes whichever drawer is presently open. None of them is open by default.

### Chat

The per-chat dials, formerly scattered across a Tools palette popover and a Chat Settings modal, now in one place:

- **Agent Mode toggle** — flick on for iterative tool use; see [Agent Mode](agent-mode.md)
- **Roleplay Template** — pick the prose style; see [Templates in Chats](templates-in-chats.md)
- **Project** — assign this chat to a project (or none)
- **Image Provider** — which image profile generates pictures for this chat
- **Announce Generated Images** — whether the Lantern announces fresh images in-chat; see [The Lantern](lantern.md)
- **Auto-generate Character Avatars** — when on, characters receive a fresh portrait each time their wardrobe shifts
- **Tools…** — opens the per-chat tool allowlist modal
- **Run Tool…** — opens the manual tool-invocation modal; see [Run Tool](run-tool.md)
- **Regenerate Background** — only appears when story backgrounds are enabled; queues a fresh background; see [Story Backgrounds](story-backgrounds.md)

### Visibility

Only present in chats with two or more characters. Two toggles:

- **All Whispers** — show or hide the private asides characters send to one another, along with the Staff's own whispers to your cast: the Commonplace Book's murmured recollections, Prospero's notes to a character on which shelves they may read, Carina's quiet answers, and the rest. A short list never hides, on the grounds that these are your machinery rather than the scene's: Pascal's private rolls, your own private Run Tool results, and the failure notices belonging to each — a tool that went wrong, or a question Carina could not answer. The house does not conceal the dice from the person who called for them, nor the news that a die failed to land. Anything you wrote yourself — an announcement you whispered from the composer — likewise always stays in your view.
- **Shared Vaults** — let characters in this chat peek at one another's vaults (read-only) via the `doc_*` tools; off by default, in which case vault reads remain whispered to the caller

### Organize

The chat as an object, rather than a conversation:

- **Copy ID** — spirits the conversation's unique identifier onto the clipboard, ready to be pasted to the CLI or handed to a colleague; the button flashes a check-mark once the deed is done
- **Rename** — give it a different title
- **State…** — open the chat state editor; see [Chat State](chat-state.md)
- **Continue Elsewhere** — fork this conversation into a new chat with a different scenario or project
- **Export** — download a SillyTavern-compatible export of the chat
- **Gallery** — opens the photo gallery; appears only when there are pictures to display

### Edit Content

The heavier instruments — best wielded with deliberation:

- **Replace** — find and replace text across the conversation
- **Bulk Replace** — re-attribute messages between characters in bulk
- **Re-extract Memories** — re-run the Commonplace Book extractor across the chat
- **Delete Memories** — remove this chat's memories from the Commonplace Book (with a count of how many would go)

## Sidebar Behavior

### Responsiveness

The sidebar adapts to screen size:

- **Wide screens** — Full expanded sidebar by default
- **Medium screens** — Collapsed by default, expand on click
- **Narrow screens** — Overlay mode, closes after action

### Persistence

Your sidebar state is remembered with measured discretion:

- **Collapsed/expanded preference** — saved across reloads (the mini-avatar strip remembers it has retired into its cubby)
- **Sidebar width** — the size you drag it to is saved in your browser and restored on the next visit
- **Which drawer was open** — session-only; every reload returns to Participants
- **Talkativeness settings** persist per chat
- **Queue clears** when processed

### Updates

The sidebar updates in real-time:

- Turn indicators update as characters speak
- Queue badges update as queue processes
- Status messages reflect current state

## Troubleshooting

### Sidebar won't open

**Causes:**
- Single-character chat (sidebar not shown)
- UI issue
- Screen too narrow

**Solutions:**
- Verify multiple characters in chat
- Refresh the page
- Try wider screen or zoom out

### Can't remove character

**Causes:**
- Last remaining character
- Character is speaking

**Solutions:**
- Add another character first
- Wait for current generation to complete

### Talkativeness not affecting turns

**Causes:**
- Only one character active
- Characters are queued (queue overrides)
- Very similar talkativeness values

**Solutions:**
- Ensure multiple characters active
- Clear the queue
- Increase difference between values

### Nudge not working

**Causes:**
- Character is inactive
- Connection profile issue
- Already generating

**Solutions:**
- Activate the character
- Check connection profile
- Wait for current generation

### Queue order wrong

**Causes:**
- Clicked in wrong order
- Queue was modified
- Display not updated

**Solutions:**
- Clear queue (dequeue all) and re-queue
- Refresh if display seems stale

### Impersonation issues

**Causes:**
- Character already AI-controlled with active generation
- Multiple impersonations confusing input

**Solutions:**
- Wait for generation to complete
- Check which character is selected above input
- Click correct character to switch

## Tips for Using the Sidebar

### For Roleplay

- Keep sidebar expanded during complex scenes
- Adjust talkativeness as scene focus shifts
- Use queue to set up dramatic moments
- Pause to plan important responses

### For Performance

- Collapse sidebar on small screens
- Reduce active characters when not needed
- Use talkativeness instead of removing/adding

### For Organization

- Note queue positions for planned sequences
- Watch turn indicators to follow conversation
- Use pause to prevent missed content

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Pages

- [Chats Overview](chats.md) — Basic chat functionality
- [Multi-Character Chats](chat-multi-character.md) — Setting up group conversations
- [Turn Manager](chat-turn-manager.md) — How turns are determined
- [Message Actions](chat-message-actions.md) — Working with messages
- [Characters](characters.md) — Creating chat participants
