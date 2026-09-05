---
url: /settings?tab=templates&section=prompts
---

# Prompts

> **[Open this page in Quilltap](/settings?tab=templates&section=prompts)**

The Prompts tab lets you create and manage reusable prompt templates. These templates can be used with characters and in chats to provide consistent instructions to the AI.

## Understanding Prompts

Prompts are instructions you give to the AI. They can be:

- **System prompts** — Instructions that define AI behavior
- **Character prompts** — Specific instructions for a character
- **Task prompts** — Instructions for specific jobs
- **Style guides** — How the AI should write or respond

By creating templates, you can:

- Reuse the same prompt across multiple characters
- Quickly apply consistent instructions
- Iterate and improve prompts over time
- Share prompts with other users

## Accessing Prompts

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **Prompts** tab
3. You'll see two sections: **Sample Prompts** and **My Prompts**

## Understanding the Two Sections

### Sample Prompts

These are built-in, read-only templates provided by Quilltap:

- **Examples:** System prompt examples, common use cases
- **Reference:** Shows what good prompts look like
- **Copyable:** Can create new custom prompts based on samples
- **Learning:** Helpful for understanding prompt structure

#### What's in the sample cabinet

The samples arrive in three drawers, and choosing the right drawer is half the trick:

- **MODERN** — Written for the large-context models of the present day (128K and upward), and indifferent to which house made them. **MODERN General** takes no position on the relationship at all: your character definition and the story between you settle that question. **MODERN Romantic** leans frankly romantic, with a firm hand on pacing and a standing objection to love-bombing and purple excess. **MODERN Platonic** keeps the affection warm and the romance firmly off the table — and does so by writing that boundary into the character's own sense of self, which holds far better over a long evening than a list of forbidden acts.
- **Model-specific** — One Companion and one Romantic apiece for Claude, GPT-5, GPT-4o, Gemini, Grok, DeepSeek, Mistral, and Ollama. Each is built around the particular way its family tends to wander off: assistant reflexes, tidy summaries, flattery, overwriting, runaway escalation, or flat economy. Reach for these when you know which model will be answering.
- **GENERIC** — The elder pair, kept for the sake of prompts already built upon them. For anything new, MODERN is the better starting point.

Whichever you choose, none of them will ever write words for you: every sample instructs the character to speak only for itself.

### My Prompts

These are custom prompts you've created:

- **Editable:** Can modify any of your prompts
- **Deletable:** Can remove prompts you no longer need
- **Usable:** Can apply to characters or use in chats
- **Personal:** Private to your Quilltap instance

## Viewing Prompts

Both Sample and My Prompts sections show:

- **Prompt Name** — What you call it
- **Description** — What the prompt does
- **Content Preview** — First line or few words
- **Actions** — View, copy, or manage (varies by section)

## Creating a New Prompt

### Method 1: From Scratch

1. In the **My Prompts** section
2. Click **Create New Prompt**
3. A form appears with:

   - **Prompt Name** — Give it a clear name (e.g., "Fantasy Character", "Technical Expert")
   - **Description** — Explain what this prompt does
   - **Content** — Write the actual prompt text
   - **Tags** (optional) — Organize with tags

4. Click **Save**

### Method 2: Copy a Sample

1. Find a sample prompt in **Sample Prompts**
2. Click **Copy as New**
3. Creates a new prompt in **My Prompts** with sample content
4. Edit the name, description, and content
5. Click **Save**

### Method 3: Copy to Clipboard

To quickly reuse a prompt content:

1. Find the prompt (sample or custom)
2. Click **Copy to Clipboard**
3. Paste into character definition, chat, etc.
4. Not a template, but content is copied

## Editing a Prompt

To modify a custom prompt:

1. Find it in **My Prompts**
2. Click **Edit** button (pencil icon)
3. Update:
   - Name
   - Description
   - Content
   - Tags
4. Click **Save Changes**

**Note:** Sample prompts can't be edited directly, but can be copied and then edited.

## Previewing a Prompt

To see the full text of a prompt:

1. Click **Preview** button
2. A modal opens showing:
   - Full prompt name
   - Complete description
   - Entire prompt content
3. Can copy from preview modal
4. Click **Close** when done

**Useful for:**

- Reading full prompt before copying
- Reviewing long prompts
- Comparing multiple prompts

## Deleting a Prompt

To remove a custom prompt:

1. Find it in **My Prompts**
2. Click **Delete** button (trash icon)
3. Confirm deletion dialog
4. Prompt is removed

**Note:** Can only delete custom prompts, not samples.

## Using Prompts with Characters

### Setting a Character Prompt

When creating or editing a character:

1. Go to character settings
2. Find the **Prompt** or **System Prompt** field
3. Click to select from your templates
4. Choose a prompt from **My Prompts**
5. Content is inserted into character definition
6. Can further customize if needed

### Overriding in Chats

Even if character has a default prompt:

1. Open a chat with that character
2. Chat settings may allow changing prompt
3. Select different prompt for this chat only
4. Doesn't affect character definition
5. Other chats with same character use original prompt

## Prompt Writing Tips

### Structure of a Good Prompt

Effective prompts usually include:

1. **Role/Identity** — Who or what the AI is
   - Example: "You are a fantasy elf warrior"

2. **Background** — Context about the character
   - Example: "You've traveled for 100 years"

3. **Personality** — How they should behave
   - Example: "You're wise but also mischievous"

4. **Communication Style** — How they should speak
   - Example: "Use archaic English sometimes"

5. **Constraints** — What they should/shouldn't do
   - Example: "Avoid breaking character"

### Example Prompt Structure

```
You are an ancient dragon named Smaug. You've guarded your treasure hoard for millennia and are proud of your intelligence and power.

Personality:
- Proud and somewhat arrogant
- Intelligent and strategic
- Enjoys riddles and clever conversation
- Protective of your hoard
- Respectful to those who show proper deference

Communication Style:
- Speak in formal, eloquent language
- Occasionally use archaic words
- Be verbose when describing your treasure
- Show disdain for smaller creatures

Constraints:
- Never admit weakness or fear
- Don't give away your hoard
- Maintain your dignified demeanor
- Stay in character at all times
```

### Tips for Better Prompts

- **Be specific** — "A helpful librarian" works better than "A librarian"
- **Give examples** — Show example speech or behavior
- **Set constraints** — Tell AI what not to do
- **Use natural language** — Write like you're giving instructions
- **Test and iterate** — Refine prompts based on results
- **Keep it concise** — Shorter is often better than longer
- **Be consistent** — Use same terms and concepts throughout

### What Works Best

**Effective:**

- Clear role definition
- Specific personality traits
- Examples of desired behavior
- Specific communication style
- Clear boundaries

**Less Effective:**

- Vague descriptions
- Too many conflicting instructions
- Overly long prompts
- Contradictory directions

## Common Prompt Templates

### Character Roleplay Prompts

Template for creating character prompts:

```
You are [character name], a [brief description].

Background:
[Character's history and experience]

Personality Traits:
- [Trait 1]
- [Trait 2]
- [Trait 3]

Goals/Motivations:
[What drives this character]

Communication Style:
[How they speak and act]

Important Constraints:
[What to avoid or remember]
```

### Expert System Prompts

Template for creating expert AI assistants:

```
You are an expert [field] professional with [years] of experience.

Expertise:
- [Area 1]
- [Area 2]
- [Area 3]

Approach:
- Always [desired behavior 1]
- Provide [type of response]
- Focus on [priority]

Communication:
- Use [tone] tone
- Explain [complex things] clearly
- Include examples when helpful
```

### Creative Writing Prompts

Template for writing assistance:

```
You are a creative writing assistant specialized in [genre].

Your role:
- Help develop [type of content]
- Suggest [specific improvements]
- Maintain [specific qualities]

Writing Style Guide:
- Tone: [tone]
- Pacing: [pacing preference]
- Descriptions: [level of detail]

Writing Aids:
- Provide writing examples when asked
- Suggest dialogue improvements
- Help with plot development
```

## Prompt Management

### Organizing Prompts

**Using names:**

- Clear naming makes finding prompts easy
- Use prefixes like "Character: ", "System: ", "Task: "
- Example: "Character: Wizard - Ancient", "Task: Code Review"

**Using descriptions:**

- Write clear descriptions
- Include use case
- Note any special features

**Using tags:**

- Organize by category
- Tag by role type
- Tag by domain/purpose

### Best Practices

- **Save variations** — Create versions for different contexts
- **Document usage** — Note where prompts are used
- **Test regularly** — Re-use and refine prompts
- **Share knowledge** — Keep library of working prompts
- **Version control** — Track changes to important prompts

## Troubleshooting Prompts

### Prompt changes aren't showing in chat

**Causes:**

- Changes not saved
- Chat still using old version
- Refreshing needed

**Solutions:**

- Verify prompt is saved
- Close and reopen chat
- Refresh page (Ctrl+R or Cmd+R)
- Create new chat with updated prompt

### AI not following prompt instructions

**Causes:**

- Prompt isn't clear enough
- Instructions conflict with each other
- Prompt is too long and gets truncated
- Connection profile too simple

**Solutions:**

- Make prompt more specific
- Remove conflicting instructions
- Simplify or shorten prompt
- Use higher-quality connection profile (Better LLM)
- Test with different prompt

### Can't use prompt in character

**Causes:**

- Prompt might be deleted
- Character field doesn't support templates
- Prompt selection not available

**Solutions:**

- Create new prompt if deleted
- Check character settings for prompt field
- Try copying prompt text manually

### Prompts taking too long to affect chat

**Causes:**

- Current chat remembers old instructions
- Token usage high
- Model needs restart

**Solutions:**

- Start new chat with prompt
- Shorten prompt if too long
- Clear chat history
- Try different connection profile

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=templates&section=prompts")`

## Related Settings

- [Connection Profiles](connection-profiles.md) — Quality of LLM affects how well prompts are followed
- [Chat Settings](chat-settings.md) — Memory and context affect prompt effectiveness
- **Characters** — Where prompts are most commonly used
- **Chat Tools** — Interact with prompts and instructions
