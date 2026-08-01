---
url: /salon/:id
---

# Multi-Character Chats

> **[Open this page in Quilltap](/salon)**

Multi-character chats allow you to have conversations with multiple AI characters simultaneously. This creates dynamic group interactions where characters can talk to each other and respond to you as a group.

## What Are Multi-Character Chats?

Multi-character chats are conversations where:

- **Multiple Characters Participate** — Two or more characters are present in the same conversation
- **Characters Take Turns** — A turn manager controls who speaks next
- **Characters Interact** — They can respond to each other, not just to you
- **You Orchestrate** — You can guide the conversation and control the pace

This is ideal for:

- **Ensemble Roleplay** — Group scenes with multiple characters
- **Collaborative Storytelling** — Characters building on each other's contributions
- **Worldbuilding** — Characters from your world interacting naturally
- **Character Development** — See how characters relate to each other

## Creating a Multi-Character Chat

### Starting Fresh

1. Start a new chat with your first character
2. Once in the chat, expand the **Chat Sidebar** (right side)
3. Click **Add Character** button
4. Select another character to add
5. Repeat to add more characters

### From an Existing Chat

1. Open any chat
2. Expand the **Chat Sidebar**
3. Click **Add Character**
4. Choose characters to add to the conversation

### When Adding Characters

You'll be asked:

- **History Access** — Can the new character see messages from before they joined?
  - **Yes** — Character knows what was said before (useful for consistency)
  - **No** — Character starts fresh (useful for surprise entrances)

- **Join Scenario** (optional) — Custom text describing how the character entered
  - Example: "Maya walks through the tavern door, shaking rain from her cloak"
  - This appears as a system message in the chat

- **Starting Outfit** — How the new arrival is dressed when they step into the room. The same four choices the new-chat ceremony offers:
  - **Use defaults** — They arrive in whatever is marked default across all three wardrobe tiers — their own vault, the project's wardrobe, and Quilltap General — layered together (the standing presumption)
  - **Compose outfit** — Pick the starting outfit slot by slot, the way one might lay clothes out on the bed before a party
  - **Let character choose** — A cheap LLM peeks at the scenario and chooses something fitting from all three wardrobe tiers (not offered to characters you're impersonating). It may deliberately choose nothing at all where the scene calls for it; an *undeclared* empty answer, or a consultation that runs past a minute, falls back to their defaults
  - **Start undressed** — Every slot empty, for entrances best left to imagination

  The dialog now settles on a sensible opening choice for each character on its own, so you need only overrule it when your taste differs:

  - Carrying on from an earlier conversation? Everyone keeps to **Same as last conversation**.
  - A character marked to choose their own attire — the `canChooseOutfit` flag in their vault `properties.json` — opens on **Let character choose**.
  - A character with a proper default outfit on file (at least one garment marked default) opens on **Use defaults**.
  - A character with no default outfit to speak of opens on **Compose outfit**, with their panel already unfolded so the empty slots are plain to see.

  When several characters are present, each one's folded panel wears a small badge — **Defaults**, **Composed**, **Dress Themselves**, **Undressed**, or **Same as Last** — so you can read the whole cast's attire at a glance without unfolding a single panel.

## How Multi-Character Chats Work

### The Turn System

When multiple characters are present, they take turns speaking:

1. **You Send a Message** — Your message kicks off a round
2. **Characters Respond** — Each active character speaks once
3. **Your Turn Returns** — After all characters have spoken, you can respond again

The **Turn Manager** controls this cycle. See [Turn Manager](chat-turn-manager.md) for details.

### Who Speaks Next?

The next speaker is determined by:

1. **Manual Queue** — If you've queued a character, they speak next
2. **Talkativeness** — Characters with higher talkativeness are more likely to speak
3. **Recent Speakers** — Characters who just spoke are skipped
4. **Completion Check** — Once all have spoken, it's your turn

### Control Modes

Each character can be:

**LLM-Controlled (Default)**

- AI generates responses for this character
- Speaks automatically when it's their turn
- Follows their personality and system prompt

**User-Controlled (Impersonation)**

- You type what this character says
- Character waits for your input on their turn
- Great for playing as a character alongside AI characters

## Managing Participants

### The Chat Sidebar

The right-hand cabinet — see [Chat Sidebar](chat-participants.md) for the full tour — opens with a **Participants** drawer that shows everyone in the chat:

**Collapsed View (Default):**

- Mini avatars in a vertical strip
- Current speaker indicator (glowing border)
- Queue position badges
- Pause/Resume button for all-LLM chats

**Expanded View (Participants drawer open by default):**

- Full character cards with details
- Talkativeness sliders
- Turn action buttons (Nudge, Queue)
- Impersonation controls
- Remove buttons

Beneath the Participants drawer sit **Chat**, **Visibility**, **Organize**, and **Edit Content** — each described briefly on the [Chat Sidebar](chat-participants.md) page. Click the expand/collapse arrow to switch between the full cabinet and the narrow mini-avatar strip.

### Character Cards

Each participant card shows:

- **Avatar and Name** — Character identity
- **Type Badge** — "Character" or "User Character"
- **Connection Profile** — Which LLM they use
- **Participation Status** — Active, Silent, Absent, or Removed
- **Turn Indicator** — Glowing when it's their turn

### Adjusting Talkativeness

Control how often each character speaks:

1. Expand the Chat Sidebar
2. Find the character's card
3. Adjust the **Talkativeness** slider:
   - **Low (left)** — Character speaks less often
   - **High (right)** — Character speaks more frequently

**Tips:**

- Set main characters higher, supporting characters lower
- Equal settings give everyone equal speaking chances
- Very low settings mean the character rarely volunteers to speak

### Controlling Turn Order

**Nudge** — Force a character to speak immediately:

1. Find the character in the sidebar
2. Click **Nudge** button
3. They'll respond next, bypassing the normal queue

**Queue** — Add a character to the speaking queue:

1. Click **Queue** on a character's card
2. They're added to an ordered queue
3. Queue badge shows their position
4. Characters speak in queue order before random selection resumes

**Dequeue** — Remove from the queue:

1. If a character is queued, click **Dequeue**
2. They're removed from the pending queue
3. Normal selection rules apply again

### Adding and Removing Characters

**To Add:**

1. Click **Add Character** in the sidebar
2. Select from your character list
3. Configure history access and join scenario
4. Character joins the chat

**To Remove:**

1. Find the character in the sidebar
2. Click **Remove** button
3. Confirm removal
4. Character leaves the chat (their past messages remain)

**Note:** You cannot remove the last character — every chat needs at least one participant.

### Character Participation States

Each character in a multi-character chat can be set to one of four states via the **Status** dropdown on their participant card:

**Active** (default) — The character speaks and roleplays normally, taking turns as determined by the turn manager.

**Silent** — The character still receives turns, but their prompt instructs them to observe without speaking aloud. They may have interior thoughts, physical reactions, and subtle actions — but no audible dialogue. Messages from silent characters appear with a distinctive dotted border and muted tones, rather like watching someone's inner monologue unfold at a particularly charged dinner party.

**Absent** — The character is temporarily away from the scene. The turn manager skips them entirely. They appear dimmed at the bottom of the sidebar with no turn position badge. Set a character to Absent when they've stepped away from the scene but may return later.

**Removed** — The character has left the chat permanently. They cannot be whispered to and have no knowledge of events after their departure. Their past messages remain visible. Removed characters can be re-added later via the Add Character button, but they arrive as a fresh participant.

**Status Change Notifications:** When any character's status changes, all other LLM-controlled characters are notified in their next turn's prompt — so if someone goes silent or steps out, the remaining characters can react naturally.

## Impersonation

Impersonation lets you control a character directly, typing their responses yourself.

### Starting Impersonation

1. Find the character in the Chat Sidebar
2. Click **Impersonate** button
3. The character is now user-controlled
4. When it's their turn, you type their response

### While Impersonating

- The input field shows which character you're typing as
- Your message appears as that character, with their avatar
- Other characters respond to what you wrote as that character
- You can switch between impersonating different characters

### Multiple Impersonations

You can impersonate multiple characters:

1. Enable impersonation on multiple characters
2. Choose which one to type as before sending
3. Click the character's name/avatar above the input to switch

Whoever you've chosen above the input is the voice your next message carries: the message is filed under that character, shown with their name and avatar, and presented to the other characters as having come from them. Switch the selection and the very next line you send changes hands accordingly — no need to touch a character's card.

### Stopping Impersonation

1. Click **Stop Impersonate** on the character's card
2. Select a connection profile for them to use
3. They return to LLM control
4. AI will generate their responses going forward

### Use Cases for Impersonation

- **Play as your OC** — Control your original character while AI plays others
- **Collaborative Writing** — Multiple human writers each controlling characters
- **Testing Characters** — See how a character sounds with manual writing
- **Directing Scenes** — Manually guide key moments

## All-LLM Chats

Chats where all characters are LLM-controlled (no user input needed):

### How They Work

- Characters respond to each other automatically
- No user messages required to continue
- Can create infinite conversation loops

### Auto-Pause Feature

To prevent runaway conversations:

- After several character turns without user input, chat auto-pauses
- You'll see a notification asking to continue or stop
- Click **Resume** to continue the conversation
- Click **Pause** to stop and take manual control

### Manual Pause Control

- Click **Pause** in the Chat Sidebar header
- Characters stop responding
- Click **Resume** when ready to continue
- Useful for reading or planning your next action

## Per-Character Settings

Each character in a multi-character chat can have individual settings:

### Connection Profile

Different characters can use different LLMs:

1. Click on a character in the sidebar
2. Select **Connection Profile** from their options
3. Choose which LLM handles this character
4. Useful for mixing model capabilities or costs

### System Prompt Override

Customize a character's behavior for this chat:

1. Access character settings in the chat
2. Add or modify their system prompt
3. Only affects this chat, not the character globally

### Image Generation Profile

Set which image service to use when this character generates images:

1. Configure in character settings within the chat
2. Each character can use different image services

## Whispers

In the bustling parlour of a multi-character chat—where three or more distinguished personalities hold court—one occasionally finds oneself in need of a *private word*. This is where whispers come in, much like those delicious asides one overhears (or, more properly, does *not* overhear) at a particularly eventful garden party.

### How Whispers Work

A whisper is a message visible only to its sender and its intended recipient. All other characters in the chat remain blissfully unaware of its contents, rather like a note passed under the table at a dinner party hosted by someone with excellent taste and questionable associates.

**For AI Characters:** Characters with native tool-calling abilities will discover the `whisper` tool at their disposal. They may use it to send private asides, secret warnings, or clandestine plans to a specific character by name or alias.

**For You, the Distinguished Reader:** When participating in a chat with three or more characters, you will find a small speech-bubble icon beside each character in the participant sidebar. Clicking it opens a whisper dialog—a discreet little window where you may compose your private communique.

### Visibility

- **Default:** Whispers between AI characters are hidden from the chat display, preserving the illusion that some things are, in fact, private.
- **Show All Whispers:** A toggle in the **Visibility** drawer of the Chat Sidebar lets you peek behind the curtain and see all whispers, including those between characters. These "overheard" whispers appear with a distinctive faded style, as if glimpsed through a frosted window.
- **Your Whispers:** Whispers you send, or whispers addressed to characters you control, are always visible to you.

### Context and Memory

The machinery behind the curtain is equally discreet. When assembling context for an AI character's next response, whispers addressed to *other* characters are filtered out entirely—your scheming villain will never accidentally reference a secret plan whispered between two heroes. The Commonplace Book memory system likewise respects whisper privacy, ensuring that memories extracted from whispered messages are attributed only to the participants involved.

### Memory Recap at Chat Start

When a character first speaks in a chat — whether at the very beginning or upon joining an existing conversation — they receive a personalized "What You Remember" narrative summary drawn from their Commonplace Book. This recap is generated automatically by the cheap LLM, weaving together memories of varying importance into a first-person narrative that gives the character a sense of continuity. The recap appears in the character's context after their personality notes, ensuring they arrive to the scene already aware of their history with other participants, much as a well-prepared dinner guest reviews the guest list before entering the room.

## Best Practices

### Scene Management

- **Set the Stage** — Describe the setting clearly in your first message
- **Guide Transitions** — Use your messages to move the scene forward
- **Use Nudge** — When a specific character should react to something
- **Pace with Pauses** — Don't let scenes rush; pause when you need to think

### Character Balance

- **Adjust Talkativeness** — Give spotlight to key characters
- **Use Queue** — Ensure everyone gets important moments
- **Impersonate Strategically** — Take control for pivotal character moments
- **Remove When Done** — Characters can leave scenes naturally

### Keeping Track

- **Watch the Turn Indicator** — Know whose response you're waiting for
- **Check the Queue** — See who's coming up next
- **Review History** — Scroll up to refresh context
- **Use Summaries** — Enable context summaries for long scenes

### Performance

- **Fewer Characters** — More participants = more API calls = higher cost
- **Set Absent for Off-Scene Characters** — Rather than keeping everyone active
- **Use Cheaper Models** — For less important characters
- **Monitor Tokens** — Large casts use more context

## Troubleshooting

### Character not speaking when expected

**Causes:**

- Character is inactive
- Character already spoke this round
- Connection profile issue
- Very low talkativeness setting

**Solutions:**

- Check Active status in sidebar
- Use Nudge to force a response
- Verify connection profile is valid
- Increase talkativeness slider

### Wrong character speaking

**Causes:**

- Queue order unexpected
- Talkativeness imbalance
- Random selection variance

**Solutions:**

- Use Queue to control exact order
- Adjust talkativeness settings
- Use Nudge for immediate response
- Reattribute the message if needed

### Characters talking over each other

**Causes:**

- Turn manager not functioning
- Multiple queued characters
- UI display issue

**Solutions:**

- Refresh the page
- Clear the queue
- Check for multiple active requests

### Impersonation not working

**Causes:**

- Character not set to impersonate
- Wrong character selected in input
- Connection profile still active

**Solutions:**

- Verify impersonation is enabled
- Check character selector above input
- Ensure no connection profile is set

### All-LLM chat won't stop

**Causes:**

- Auto-pause disabled
- Pause button not visible
- Characters responding too fast

**Solutions:**

- Click Pause button in sidebar
- Refresh the page if needed
- Wait for current response to complete

### A character keeps speaking for everyone

Now and then a character will forget its manners and start narrating the whole table — answering as the others, tagging lines with `[Someone Else]`, and carrying half the conversation single-handedly. The establishment guards against this on every turn: each character is instructed, in no uncertain terms, to speak only for itself, and should a reply nevertheless wander into another's voice, the offending remainder is quietly trimmed before it reaches the page.

**Causes:**

- A less capable model assigned to that character — smaller models are the usual culprits, prone to mimicking the transcript and writing everyone's lines
- A very long, crowded scene that tempts the model to "wrap things up" for the whole cast

**Solutions:**

- Assign that character a more capable model (set its connection profile in the sidebar) — the single most effective remedy
- Keep an eye on characters running on lightweight models in busy multi-character scenes

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Pages

- [Chats Overview](chats.md) — Basic chat functionality
- [Turn Manager](chat-turn-manager.md) — Detailed turn management documentation
- [Nothing to Add — Turn Skipping](turn-skipping.md) — Letting a character pass a turn
- [Chat Sidebar](chat-participants.md) — Full sidebar documentation, including the Chat / Visibility / Organize / Edit Content drawers
- [Message Actions](chat-message-actions.md) — Editing and managing messages
- [Characters](characters.md) — Creating and managing characters
