---
url: /salon/:id
---

# Message Actions

> **[Open this page in Quilltap](/salon)**

Message actions are the tools available for managing individual messages in your chats. They let you edit, regenerate, delete, and otherwise modify messages to shape your conversations.

## Overview of Message Actions

Every message in a chat has actions you can perform. The available actions depend on:

- **Message Type** — Your messages vs. character messages
- **Chat Type** — Single-character vs. multi-character
- **Message State** — Normal, edited, part of a swipe group

## Accessing Message Actions

### Hover Actions

Most message actions appear when you hover over a message:

1. Move your mouse over a message
2. Action buttons appear (usually in the corner)
3. Click the desired action
4. Or click the **more options** menu (three dots) for additional actions

### Context Menu

Right-click a message for a context menu with all available actions.

### Touch Devices

On touch devices:

1. Long-press the message
2. Action menu appears
3. Tap the desired action

## Actions for Your Messages

### Edit Your Message

Modify what you said:

1. Hover over your message
2. Click **Edit** (pencil icon)
3. Message text becomes editable
4. Make your changes
5. Click **Save** to confirm or **Cancel** to discard

**What happens:**
- Your edited message replaces the original
- Timestamp and metadata preserved
- If a character already responded, their response remains unchanged

**Use cases:**
- Fix typos or errors
- Clarify what you meant
- Add forgotten details

### Delete Your Message

Remove your message from the conversation:

1. Hover over your message
2. Click **Delete** (trash icon)
3. Confirm the deletion

**What happens:**
- Message is permanently removed
- Any response that followed may become orphaned
- Cannot be undone

**Memory handling:**
If your message triggered memory extraction:

- You may be asked about associated memories
- Choose to delete memories with the message or keep them
- See [Memory Cascade](#memory-cascade-on-deletion) for details

### Resend Your Message

Send the same message again:

1. Hover over your message
2. Click **Resend** (arrow icon)
3. Message is copied to input field
4. Optionally modify before sending
5. Press Enter to send

**What happens:**
- Original message remains
- You can edit before resending
- Useful for trying different phrasings

**Special behavior:**
- If there's a blank/failed response after the original, it may be removed
- Helps recover from failed generations

## Actions for Character Messages

### Generate Swipe (Regenerate)

Get an alternative response:

1. Hover over the character's message
2. Click **Regenerate** or **Swipe** (refresh icon)
3. Character generates a new response
4. New response appears, original is saved

**Swipe navigation:**
- Arrow buttons appear to navigate between versions
- All alternatives are kept
- Switch freely between swipes
- Current swipe position shown (e.g., "2 of 3")

**What happens:**
- The same character regenerates — in a multi-character scene the new version is spoken and attributed by the very character whose message you regenerated, with their full persona, memory, and the scene's context
- The newest version is shown in place; the original is kept one swipe away in the same group
- Token usage counts for each generation

**Use cases:**
- Response doesn't fit the character
- Want to see different approaches
- Response quality was poor
- Looking for the perfect reaction

### Navigate Swipes

When a message has multiple versions:

1. Look for arrow buttons on the message
2. Click **left arrow** for previous swipe
3. Click **right arrow** for next swipe
4. Counter shows current position

**Tip:** All swipes are permanent — switching doesn't delete other versions.

### Edit Character Message

Modify what the character said:

1. Hover over the character's message
2. Click **Edit** (pencil icon)
3. Text becomes editable
4. Make changes
5. Click **Save** or **Cancel**

**What happens:**
- Message content is updated
- Original is not preserved (unlike swipes)
- Character "remembers" the edited version going forward

**Use cases:**
- Fix minor issues in an otherwise good response
- Adjust character voice or tone
- Remove unwanted content
- Add missing details

### Delete Character Message

Remove a character's message:

1. Hover over the message
2. Click **Delete** (trash icon)
3. Confirm deletion

**What happens:**
- Message permanently removed
- All swipes in the group are deleted
- Conversation continues from remaining messages

**Memory cascade:**
- May prompt about associated memories
- See [Memory Cascade](#memory-cascade-on-deletion) for details

### Save Image to a Photo Album

When a message has an image pinned beneath it — whether the Lantern just lit a new backdrop, Aurora unveiled a fresh portrait, a character offered an attached snapshot, or you yourself uploaded one — the toolbar gains a small bookmark. Press it, and a dialog presents itself:

1. **Pick the album.** Your own persona's photo album sits at the top, already chosen for you. Beneath it you'll find each other character in the chat, the project's own album (if the project keeps one), every linked document store, and the universal "Quilltap General" cabinet at the foot of the list.
2. **Add a caption, if you fancy.** A short remembrance — what you wanted to keep this image *for*. Left blank, the original generation notes stand in for you.
3. **Press Save.** The image is hard-linked into the chosen album's `photos/` folder, indexed for search, and quietly retired from the perils of garbage collection.

The same image saved twice into the same album is politely refused — you'll see a small note explaining when it was first kept. Save it to a different album and you'll have two records, both pointing at the same underlying bytes (Quilltap does not waste storage on duplication).

This is the operator-facing twin of the characters' own `keep_image` tool; everything an LLM can preserve, you can now preserve too.

### Reattribute Message (Multi-Character)

Change which character "said" a message:

1. Hover over the message
2. Click **Reattribute** or find in more options
3. Select a different character from the list
4. Confirm the change

**What happens:**
- Message now appears from the selected character
- Avatar and name update
- Context for future messages reflects the change

**Use cases:**
- AI responded as wrong character
- Response fits another character better
- Correcting turn order mistakes
- Reorganizing a scene

**Requirements:**
- Only available in multi-character chats
- Target character must be in the chat

## Swipe Groups

### What Are Swipe Groups?

A swipe group is a collection of alternative responses for the same prompt:

- **Original Response** — First generated response
- **Swipes** — Alternative versions created via regenerate
- **All Preserved** — Every version is kept

### Managing Swipes

**Adding swipes:**
- Click Regenerate to add another option
- No limit on number of swipes

**Viewing swipes:**
- Use arrows to navigate
- Position indicator shows current/total

**Deleting swipes:**
- Deleting the message deletes ALL swipes
- Cannot delete individual swipes from a group

### Swipe Best Practices

- **Generate multiple** — Compare options before continuing
- **Don't settle** — If none are right, edit or generate more
- **Use for variety** — See different character interpretations
- **Save good ones** — The current swipe is what's used for context

## Memory Cascade on Deletion

When deleting messages that have associated memories:

### What Triggers Memory Cascade

- Messages that were processed for memory extraction
- Important facts or information in the message
- Character knowledge derived from the message

### Options Presented

When deleting such messages, you may see:

1. **Delete memories too** — Remove the memories with the message
2. **Keep memories** — Preserve the memories even though message is gone
3. **Ask every time** — Get prompted for each deletion (default)

### Configuring Behavior

Set your default preference in Chat Settings:

1. Go to **Settings** > **Chat Settings**
2. Find **Memory Cascade** settings
3. Choose default behavior for deletions

## Bulk Actions

### Search and Replace

Find and replace text across all messages:

1. Open chat action menu (three dots in header)
2. Select **Search and Replace**
3. Enter text to find
4. Enter replacement text
5. Preview changes
6. Apply to selected or all messages

**Use cases:**
- Correct repeated spelling errors
- Update character names
- Fix terminology across conversation

### Bulk Character Replace

Reassign messages between characters:

1. Open chat action menu
2. Select **Bulk Character Replace** or similar
3. Choose source character
4. Choose destination character
5. Preview and confirm

**Use cases:**
- Swap which character said what
- Combine messages from removed character
- Correct systematic attribution errors

## Chat-Level Message Tools

These operate on the chat as a whole:

### Export Chat

Save the conversation:

1. Open chat action menu
2. Select **Export**
3. Choose format
4. File downloads

Includes all messages, swipes, and metadata.

### Clear Chat

Remove all messages (if available):

1. Open chat action menu
2. Select **Clear** or **Clear Messages**
3. Confirm action
4. All messages removed, chat remains

**Warning:** This is permanent and removes all content.

### Regenerate Last Response

Quick action to regenerate the most recent character message:

1. Look for regenerate button near input area
2. Or use keyboard shortcut if configured
3. Last character message regenerates

Faster than finding the message and clicking regenerate.

## Keyboard Shortcuts

Common message action shortcuts (may vary by configuration):

- **Ctrl/Cmd + E** — Edit selected message
- **Delete** — Delete selected message (with confirmation)
- **R** — Regenerate last response
- **Left/Right Arrows** — Navigate swipes (when focused on a swipe group)

Check Settings for your configured shortcuts.

## Message Action Tips

### For Roleplay Quality

- **Regenerate freely** — Don't settle for mediocre responses
- **Edit for polish** — Fine-tune good responses
- **Reattribute carefully** — Ensure character voices match
- **Delete sparingly** — Holes in context can confuse the AI

### For Conversation Flow

- **Use swipes** — Explore different directions
- **Edit over delete** — Preserve context when possible
- **Resend with tweaks** — Try different approaches to your message
- **Check swipe history** — Good alternatives might be in earlier swipes

### For Cost Management

- **Regenerate strategically** — Each swipe uses tokens
- **Edit instead of regenerate** — Minor fixes don't need new generation
- **Delete rather than regenerate repeatedly** — Start fresh if nothing works

### For Context Management

- **Edited messages become "truth"** — AI sees edited version
- **Deleted messages create gaps** — Subsequent messages may not make sense
- **Swipe selection matters** — Only current swipe is in context

## Troubleshooting

### Can't edit message

**Causes:**
- Message is currently generating
- Message is a system message
- UI issue

**Solutions:**
- Wait for generation to complete
- System messages can't be edited
- Refresh the page

### Regenerate produces same response

**Causes:**
- Temperature set too low
- Very specific prompt
- Limited valid responses

**Solutions:**
- Adjust temperature in connection profile
- Modify the prompt slightly
- Edit your preceding message to give more direction

### Swipe arrows not appearing

**Causes:**
- Only one version exists
- UI not updated
- Single-swipe message

**Solutions:**
- Generate a swipe first
- Refresh the page
- Check if message has alternatives

### Reattribute option missing

**Causes:**
- Single-character chat
- Only one character in chat
- Message type doesn't support reattribution

**Solutions:**
- Only works in multi-character chats
- Add another character to enable
- Check message is from a character (not system)

### Deleted message won't go away

**Causes:**
- Confirmation dialog waiting
- Network issue
- UI not refreshed

**Solutions:**
- Complete the confirmation
- Check network and try again
- Refresh the page

### Edit not saving

**Causes:**
- Network issue
- Validation error
- Concurrent edit

**Solutions:**
- Check network connection
- Try simpler edit
- Refresh and try again

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Pages

- [Chats Overview](chats.md) — Basic chat functionality
- [Multi-Character Chats](chat-multi-character.md) — Group conversations
- [Turn Manager](chat-turn-manager.md) — Turn-based chat flow
- [Chat Sidebar](chat-participants.md) — Managing participants and per-chat settings
- [Chat Settings](chat-settings.md) — Memory and other settings
