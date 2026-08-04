---
url: /salon
---

# Chats Overview

> **[Open this page in Quilltap](/salon)**

Chats are the core of Quilltap. They're where you have conversations with AI characters, explore stories, collaborate on creative work, and interact with your configured AI assistants.

## What Are Chats?

Chats are conversation sessions where you:

- **Talk to Characters** — Interact with AI-driven personalities you create
- **Tell Stories** — Collaborate on roleplay, fiction, and worldbuilding
- **Get Assistance** — Ask questions, brainstorm ideas, and work through problems
- **Use Tools** — Generate images, search the web, manage files, and more

Each chat maintains its own history, context, and settings. You can have ongoing conversations that span multiple sessions, with the AI remembering what you've discussed.

## Types of Chats

### Single-Character Chats

The simplest chat type:

- One AI character responds to your messages
- Direct conversation between you and the character
- Great for focused interactions, Q&A, or one-on-one roleplay

### Multi-Character Chats

More complex conversations with multiple participants:

- Multiple AI characters can participate
- Characters take turns speaking based on the turn manager
- You can also control characters yourself (impersonation)
- Ideal for group scenes, ensemble stories, or collaborative worldbuilding

See [Multi-Character Chats](chat-multi-character.md) for details.

### Project Chats

Chats associated with a specific project:

- Access project-specific files and context
- Characters can reference project documents
- Organized within project workspace
- Great for focused creative work or research

## Starting a Chat

### From the Characters Page

1. Go to **Characters** in the left sidebar
2. Find the character you want to chat with
3. Click **Chat** button on their card
4. A new chat opens with that character

### From a Character's Profile

1. Open a character's profile
2. Click **Start Chat** or **New Chat** button
3. Chat opens with that character ready to respond

### From the Chats Page

1. Go to **Chats** in the left sidebar
2. Click **New Chat** button
3. Select a character to chat with
4. Optionally configure chat settings before starting

### Quick Start

Most characters have a **First Message** — an introductory message the character sends when you start a new chat. This sets the scene and establishes the character's voice.

### The Green Room — a word on what happens while the curtain rises

Between the moment you press **Start** and the moment the room is yours to speak in, a good deal of unseen bustle takes place behind the scenes — and it is not always instantaneous. The cast must be gathered, everyone's particulars committed to memory, the opening scene set, and — most time-consuming of all — any character you have asked to *choose their own attire* must repair to the wardrobe and settle on an outfit, each such decision being a small consultation that takes a moment or two.

Rather than leave you drumming your fingers at a blank screen, Quilltap now raises a small status dialog — **The Green Room** — for the duration. It reports, in plain terms, what is presently afoot; and as each character finishes deciding, it displays their chosen ensemble across the four slots (**Top**, **Bottom**, **Footwear**, and **Accessories**), so you may see at a glance what everyone has elected to wear. A running log beneath keeps a tidy record of the proceedings.

The dialog cannot be waved away while the work is underway — there would be nothing to return to — and it retires of its own accord the instant the conversation is ready for you. The one exception is trouble: should something go amiss, it will say so and offer you a **Close** button. (This attends fresh conversations and the *Continue Elsewhere* manoeuvre; autonomous rooms keep their own counsel.)

### Taking a Character's Chair — "Play As"

By default you attend a chat as yourself, the unseen correspondent. But should you wish to step onto the stage and inhabit one of the cast, the **Play As (Optional)** dropdown on the new-chat form stands ready. It now draws its guest list strictly from the room itself — *every* character you have added to the cast is offered, and none who have not been.

This is a happier arrangement than it may first appear, for the **Select Characters** roster on the left now presents the *entire* company — including those you keep as personal personas, who once kept themselves discreetly out of that list. Add whomever you mean to inhabit to the cast as you would any other, and they take their place in the Play-As dropdown alongside the rest.

Choose one, and that character quietly changes hats: where the machine once spoke for them, now you do. Their connection profile is set aside (you are the author now, and need no model), and they remain in the cast under your own hand. Select **Chat as yourself** again and the character is handed back to the LLM — remaining in the room, though you will want to assign a connection profile once more before the curtain rises.

One consequence follows, as surely as a headache follows a particularly long dinner party: the moment any character takes your chair, the room can no longer be made **autonomous**, for an autonomous room by its very nature keeps no human at the table. The *Make this an autonomous room* toggle greys itself out and posts a courteous note to that effect. Return the character to LLM control to restore the option.

## The Chat Interface

### Message Area

The main area where conversation happens:

- **Your Messages** — Appear on one side with your avatar
- **Character Messages** — Appear with the character's avatar, name, and a small provider/model badge showing which LLM service generated the response
- **System Messages** — Background operations like memory extraction (if enabled)
- **Timestamps** — Show when messages were sent

### Input Area

Where you compose messages:

- **Text Field** — Type your message here
- **Send Button** — Click to send (or press Enter)
- **Attachment Button** — Add files or images to your message
- **Composition / Document / Terminal toggles** — Switch input modes

### Header

Shows chat information and controls:

- **Chat Title** — Auto-generated or custom name; it doubles as a direct link back to this conversation's own Salon address, handy for pinning open in a fresh tab
- **Copy ID** — a small button just past the title that whisks the conversation's unique identifier onto the clipboard, flashing a check-mark once the deed is done
- **Character Info** — Who you're chatting with
- **Action Menu** — Additional chat operations

### Chat Sidebar

On the right, the **Chat Sidebar** is the single cabinet from which every per-chat dial and action is reached — a five-drawer affair holding **Participants**, **Chat**, **Visibility**, **Organize**, and **Edit Content**:

- **Character Avatars** — Visual indicator of who's in the chat
- **Turn Information** — Whose turn it is to speak
- **Controls** — Manage character participation
- **Per-chat settings and actions** — Agent Mode, Roleplay Template, Project, Image Provider, announcements, rename, export, replace, memory tools, and the rest

See [Chat Sidebar](chat-participants.md) for the full tour.

## Basic Chat Actions

### Sending Messages

1. Type your message in the input field
2. Press **Enter** to send (or click Send button)
3. Character responds automatically (if LLM-controlled)

**Tip:** Use **Shift+Enter** for line breaks without sending.

**A word on line breaks.** The Salon honours your line breaks exactly as you strike them. A **single** press of Return begins your next words upon a fresh line, snug beneath the last — none of that classical-Markdown habit of sweeping the two together into one flowing line. A **double** press of Return (leaving a blank line betwixt) opens a wholly new paragraph. This courtesy extends to blockquotes, so that a passage entered thus —

```
> Line one
> Line two
> Line three
```

— arrives as three orderly lines, and not as one breathless run-on sentence.

**A word on mathematics.** The Salon typesets LaTeX mathematics — `$$e^{i\pi}+1=0$$` between double dollar signs, or the backslashed `\(...\)` and `\[...\]` forms — into proper printed-monograph equations. Single dollar signs remain honest currency and are never mistaken for algebra. The full particulars are catalogued in [Mathematical Notation](math-notation.md).

### Viewing History

Scroll up to see earlier messages in the conversation. Long chats may have:

- **Context Summary** — Brief summary of earlier conversation at the top
- **Load More** — Button to load older messages if history is truncated

### Waiting for Responses

When the AI is generating a response:

- **Typing Indicator** — Shows the character is "thinking"
- **Stop Button** — Cancel generation if you change your mind
- **Progress** — Some themes show generation progress

## Message Actions

Each message has actions you can perform:

### For Your Messages

- **Edit** — Modify the message content
- **Delete** — Remove the message
- **Resend** — Send the same message again

### For Character Messages

- **Swipe/Regenerate** — Generate a new alternative response
- **Edit** — Modify what the character said
- **Delete** — Remove the message
- **Reattribute** — Change which character said it (multi-character chats)

See [Message Actions](chat-message-actions.md) for complete details on editing, regenerating, and managing messages.

## Chat Settings and Configuration

### Per-Chat Settings

Each chat can have its own configuration:

- **Roleplay Template** — Formatting and style settings (Chat drawer of the Chat Sidebar)
- **Image Generation** — Which image provider to use (Chat drawer of the Chat Sidebar)
- **Connection Profiles** — Which LLM to use per participant (on each participant card in the Participants drawer)
- **System Prompt Overrides** — Custom context per participant (on each participant card in the Participants drawer)
- **Tools** — Which AI tools are available (Chat drawer → Tools…)
- **Project** — Which project this chat belongs to (Chat drawer)

### Accessing Chat Settings

1. Open the chat
2. Open the **Chat Sidebar** on the right and expand the **Chat** drawer for roleplay template, project, image provider, Lantern announcements, auto-avatar, Tools, Run Tool, Agent Mode, and Regenerate Background
3. Open the **Visibility** drawer (multi-character chats only) for All Whispers and Shared Vaults
4. Open the **Participants** drawer for connection profiles and per-participant settings directly on each card

## Managing Chats

### Finding Chats

- **Chats Page** — Lists all your conversations
- **Search** — Find chats by title or content
- **Filter** — Show chats by character, project, or date
- **Sort** — Organize by recent, alphabetical, or other criteria

### Renaming Chats

1. Open the chat
2. Click the title or use the Action Menu
3. Enter a new name
4. Save the change

**Note:** Renaming disables auto-rename for that chat.

### Deleting Chats

1. Open the chat or find it in the Chats list
2. Click **Delete** in the Action Menu
3. Confirm deletion
4. Choose whether to delete associated memories

**Warning:** Deletion is permanent.

### Exporting Chats

Save chats for backup or sharing:

1. Open the chat
2. Use Action Menu > **Export**
3. Choose export format
4. File downloads to your computer

### Exporting a Markdown Transcript

There comes an evening — there always does — when one wishes to carry the conversation out of the house entirely: to read it by lamplight, hand it to a friend, or file it in whatever commonplace book one keeps beyond these walls. For that there is **Export Markdown**, which produces not a data file for machines but a *transcript for people*: a single Markdown document of who said what, and when.

Open the **Chat Sidebar** on the right, expand the **Organize** drawer, and press **Export Markdown**. The file arrives named after the chat, and contains:

- The chat's title and its opening scenario, set at the head of the document.
- Every message anyone actually said, each under a heading of the form `## Speaker — timestamp`. Where a message has been regenerated into several variants, only the one showing in the Salon makes the page.
- Pascal's roll announcements, Carina's answers (Brahma's included, under his own name), and any announcements you inserted yourself — voiced by a Staff member, a character, or a name of your own invention.
- The Host's notices recording that the conversation continues from another chat, has moved elsewhere, or absorbed a neighbouring thread — so the paper trail survives the change of address.
- Whispers, marked as such beside the speaker's name.

The timestamps are the chat's *own* clock. A chat running on fictional time is transcribed in fictional time; a chat with a configured timezone keeps it; a chat with neither simply reads the household clock. The Staff's housekeeping chatter — memory whispers, image announcements, the marking of hours — is left out of the record, as are the prompts sent to the models; the transcript is what a reader would want, not what the machinery required.

The same transcript twice is the same file twice, to the letter — nothing in it depends on the moment of export.

### Continuing a Conversation Elsewhere

Now and again the matter under discussion drifts so far afield that the original setting will simply not bear it. The project no longer fits, the scenario has worn thin, and rather than narrate one's way out of it — like a guest pretending the parlour was always the conservatory — one wishes simply to *change venue*.

To do so, open the **Chat Sidebar** on the right, expand the **Organize** drawer, and press **Continue Elsewhere**. The familiar new-chat dialog appears, pre-filled with the present project (or none, as the case may be) and the cast of characters now in the room. From there:

1. Adjust the project, characters, scenario, or image profile as you see fit.
2. Click **Continue**.

Quilltap thereupon does the heavy lifting:

- A fresh chat is created with the chosen project and scenario.
- The Host posts a brief notice at the top of the new chat linking back to the previous one.
- The Librarian's most recent summary, together with every message that followed it, is replayed into the new chat — your characters carry on, mid-thought, as though the change of address were a passing remark.
- The turn order, who is up to speak, and whether the proceedings are paused are all preserved, so nothing in the conversational rhythm is lost.
- The Host posts a closing notice in the original chat, linking forward to the new venue.

The original chat is not deleted; you may always return to it. But henceforth the canonical thread continues at the new address.

A particularly civilised variation: in the same dialog you may flip the chat over to an **autonomous room**, taking yourself out of the picture entirely and letting the LLMs carry the conversation forward without you. Remove your own character from the cast, enable the autonomous controls (cadence, budget, visibility), and press **Continue**. The carryover proceeds as above — Librarian summary, recent messages, turn order, Host bookends — and the new room then runs on its own schedule, with you free to attend to other matters. Autonomous rooms require at least two LLM-controlled characters and no user-controlled participant, which the dialog will enforce before letting you proceed.

### Merging a Conversation In

Where *Continue Elsewhere* sends the present company onward to a fresh venue, its mirror-image — **Merge In…** — summons another gathering *here*, folding a second conversation's cast and its accumulated history into the one before you. Useful when two threads have wandered toward the same table and you would sooner they shared it.

Open the **Chat Sidebar**, expand the **Organize** drawer, and press **Merge In…**. (The button keeps its peace inside autonomous rooms, which run by their own clockwork.) A roster of your recent conversations appears, each annotated with who was in attendance and when the talk last stirred. Choose one, and a confirming dialog presents the newcomers:

1. A **guest list** — every character eligible to come across, each with a checkbox. All are ticked to begin with, but you are the doorman: untick anyone you would rather leave behind, and only the chosen few are admitted. (Anyone already present in *this* chat is quietly omitted from the list entirely, there being no sense in announcing a guest who is already seated.)
2. For each admitted guest, the same wardrobe options as the new-chat dialog, defaulting to **Same as last conversation** so they arrive dressed as they were when last we saw them.

Press **Merge In**, and Quilltap attends to the formalities:

- Each newcomer joins as an LLM-driven participant. (Should the other conversation have had its own user-controlled character — its human's voice over there — that character is brought in under the LLM's hand, since *your* voice in this room is already spoken for.)
- The Host posts a recap at the foot of the conversation, linking back to the source chat and carrying its summary, so the assembled company knows where the newcomers have been.
- A matching notice is posted in the source chat, pointing forward to here.

Unlike a change of venue, no old messages are replayed into the running conversation — the recap stands in for the history, and the proceedings carry on uninterrupted.

## Advanced Features

### Memory Integration

Quilltap can extract and store memories from your chats:

- **Auto-extraction** — Important facts saved automatically
- **Semantic Search** — Find past conversations by meaning
- **Character Memory** — Characters can remember previous interactions
- **Memory Recap** — When a chat begins or a character joins an existing conversation, the system generates a first-person narrative summary from the character's Commonplace Book memories. This "What You Remember" recap gives each character a sense of continuity across conversations — rather like a butler whispering a briefing in one's ear before entering the drawing room. The recap draws from memories of varying importance and is injected into the character's context automatically; no action on your part is required.

  Should the briefing-butler be detained — an unresponsive provider, most commonly, which accepts one's request with every appearance of attentiveness and then simply says nothing at all — Quilltap declines to wait indefinitely on his account. After a short interval the recap is abandoned, the character enters the room without it, and the conversation proceeds as though nothing had happened. You will notice, at worst, a character a shade less freshly briefed than usual; you will not be left staring at a stalled reply.

For Semantic Search to find a conversation by meaning, Quilltap first renders it into a tidy transcript and commits that to memory — an *embedding*, in the parlance — quiet clerical work performed in the background after each exchange. Should the indexing-clerk be indisposed at the decisive moment — the embedding provider abed, or the whole establishment shuttered mid-sentence — a conversation may slip through un-indexed and sit, unsearchable, in the stacks. No matter: at every startup Quilltap takes a discreet inventory and sets any half-finished conversation to rights, re-rendering and re-indexing whatever was left undone, so your library of past chats stays complete without the slightest intervention on your part.

See [Chat Settings](chat-settings.md) for memory configuration.

### Mentioned Characters

When the conversation invokes the name of a character who exists in your workspace but is not, at present, *in* the chat — a former companion, a notorious uncle, the upstairs maid — Quilltap quietly slips a *Characters Mentioned* dossier into the responding character's briefing. The dossier carries the absent party's name, any known aliases, pronouns, and their full description, so the speaker may refer to them with the easy familiarity of one who has read the social register, rather than improvising particulars on the spot.

The mechanism is unobtrusive by design. It scans the conversation (including the running summary) for any of your characters' names or aliases as whole words, with case sensibly disregarded; the responding character themselves and every present participant are excluded, as is your own persona. If nothing matches — the most ordinary state of affairs — the section is omitted altogether and the prompt continues as it always did. The dossier is appended *after* the ordinary system-prompt budget is reconciled, so even on long, crowded chats where the main prompt is shortened to fit, the mentioned characters' particulars are never the casualty.

### Context Management

For long conversations:

- **Summarization** — Old messages condensed to save tokens
- **Compression** — Context optimized for API limits
- **Token Display** — Monitor usage if enabled

### Tool Integration

Use AI tools during chat:

- **Image Generation** — Create images in conversation
- **Web Search** — Access current information
- **Scriptorium Document Tools** — Read, search, and write files in linked document stores
- **Memory Search** — Find past conversations

See [Using Tools](tools-usage.md) for tool details.

## Best Practices

### For Better Conversations

- **Be specific** — Clear requests get better responses
- **Provide context** — Help the AI understand the situation
- **Use character's style** — Match the tone they expect
- **Give feedback** — Edit or regenerate when responses miss the mark

### For Long-Running Chats

- **Name your chats** — Make them easy to find later
- **Use projects** — Organize related conversations
- **Monitor tokens** — Watch usage for cost management
- **Review memories** — Ensure important facts are captured

### For Roleplay

- **Establish scenes** — Set the stage clearly
- **Stay in character** — Consistent personas improve responses
- **Use templates** — Roleplay templates enhance formatting
- **Add participants** — Multi-character chats for ensemble scenes

## Troubleshooting

### Character not responding

**Causes:**

- Connection profile not configured
- API key invalid or missing
- Rate limit reached
- Network issues

**Solutions:**

- Check character's connection profile in settings
- Verify API key in The Forge > API Keys
- Wait and try again if rate limited
- Check internet connection

### Messages not saving

**Causes:**

- Network interruption
- Server issue
- Storage full

**Solutions:**

- Refresh the page
- Check internet connection
- Try again in a few moments
- Check server status if self-hosting

### Chat is slow

**Causes:**

- Large context (long conversation)
- Complex model being used
- Many tools enabled
- Server load

**Solutions:**

- Start a new chat for fresh context
- Use a faster model
- Disable unnecessary tools
- Wait for server load to decrease

### Can't find a chat

**Causes:**

- Chat was deleted
- Chat is in a project you're not viewing
- Search terms don't match

**Solutions:**

- Check all projects, not just current one
- Try different search terms
- Check recently deleted if available

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon")`

## Related Pages

- [Multi-Character Chats](chat-multi-character.md) — Conversations with multiple AI characters
- [Turn Manager](chat-turn-manager.md) — How speaking turns work in group chats
- [Message Actions](chat-message-actions.md) — Edit, regenerate, and manage messages
- [Mathematical Notation](math-notation.md) — Typeset LaTeX mathematics in messages
- [Chat Sidebar](chat-participants.md) — Managing chat participants and per-chat settings
- [Chat Settings](chat-settings.md) — Global chat configuration
- [Using Tools](tools-usage.md) — AI tools available during chat
- [Characters](characters.md) — Create and manage chat participants
- [Projects](projects.md) — Organize chats by project
