---
url: /aurora/new
---

# Creating Characters

> **[Open this page in Quilltap](/aurora)**

This guide walks you through creating new characters in Quilltap, from simple characters to fully detailed personas.

## Getting Started with Character Creation

### Accessing Character Creation

1. Click **Characters** in the left sidebar
2. Click **Create Character** or **+ New Character** button
3. Character creation form appears
4. Fill in desired fields
5. Click **Create** to save

**Quick tip:** You can create a character with just a name and description!

## Character Creation Form Fields

### Essential Information

**Character Name** (required)

- What the character is called
- Used throughout the system
- Examples: "Alice", "Lord Blackthorne", "Captain Nova"

**Title** (optional)

- Subtitle or role description
- Appears with name in lists
- Examples: "The Wanderer", "CEO of TechCorp", "Royal Advisor"

**Description** (required for non-wizard)

- Long-form narrative about the character
- Who they are, their story, background
- Can include personality, motivations, history
- Examples:
  - "A clever detective from Victorian London"
  - "An ancient dragon with a love of riddles"
  - "A cheerful barista who writes poetry in free time"

### Character Details

**Personality**

- Key personality traits and characteristics
- How they typically behave
- Their temperament and attitude
- Examples: "Sarcastic but kind", "Serious and professional", "Playful and mischievous"

**Scenarios**

- A collection of named scenes, each with a title and descriptive content
- Each scenario sets the stage for a particular conversation context or campaign
- A character may have any number of scenarios — or none at all, if they prefer to remain contextually mysterious
- The active scenario provides context to the AI during conversation
- Examples of scenario titles: "The Brass Lantern Tavern", "Aboard the *Perseverance*", "The Detective's Office, 1923"
- When starting a new chat, you may select which scenario applies — or leave all scenarios to their own devices and let the character roam free of fixed context

**First Message**

- What the character says when you start chatting
- Sets tone for conversation
- Examples:
  - "Well, well... another visitor. What brings you to my domain?"
  - "Oh, hey! Haven't seen you in forever. What's up?"
  - "Greetings, traveler. You look like you have a story to tell."

**Example Dialogues**

- Sample conversations showing character speech
- Helps AI understand conversation style
- Format: Multiple exchanges showing typical dialogue
- Shows personality and vocabulary through examples

### Configuration

**System Prompt** (optional)

- Instructions for AI on how to behave as character
- Detailed behavior guidelines
- Can be edited later in System Prompts tab
- If not provided, AI generates one based on description

**Connection Profile** (optional)

- Which LLM to use for this character
- Can change per-chat later
- If not selected, uses system default

**Default Image Generation Profile** (optional)

- Which image service for generating images
- Only matters if you ask AI to generate images
- Can override per-chat

**Avatar** (optional)

- Profile picture or icon for character
- Can upload image file
- Can select from existing images
- Can use URL

**Tags** (optional)

- Organize character with labels
- Multiple tags supported
- Examples: "Fantasy", "Allies", "Main Characters", "NPCs"

## Creating Characters: Step-by-Step

### Method 1: Quick Create (Fastest)

If you want to create a character and start chatting right away:

1. Go to **Characters** page
2. Click **Create Character**
3. Enter:
   - **Name:** "Alice"
   - **Description:** "A curious young woman who asks lots of questions"
4. Click **Create**
5. Character created! Start chatting immediately

**Time:** < 1 minute
**Best for:** Quick roleplay, testing ideas, temporary characters

### Method 2: Detailed Create (Recommended)

For a well-developed character:

1. Click **Create Character**
2. **Fill basic information:**
   - Name: "Captain Vex"
   - Title: "Space Pirate"
   - Description: "Veteran space pirate with a hidden heart of gold..."
3. **Fill personality details:**
   - Personality: "Bold, cunning, secretly honorable"
   - Scenarios: Add one titled "Commanding the *Rattlesnake*" — "Aboard a fast merchant vessel with a crew of six and secrets in the hold"
4. **Add conversation starters:**
   - First Message: "Well, what brings you aboard me ship?"
   - Example Dialogues:

     ```
     Me: "Why become a pirate?"
     Vex: "Because the galaxy doesn't belong to the wealthy. It belongs to those bold enough to take it."
     ```

5. **Configure profile:**
   - Select Connection Profile (if you have multiple)
   - Add Tags: "Scifi", "Antiheroes", "Main Characters"
   - Upload or select Avatar
6. Click **Create**

**Time:** 5-15 minutes
**Best for:** Characters you'll chat with regularly

### Method 3: Using AI Wizard (Easiest Writing)

If you want AI to generate content:

1. Click **Create Character**
2. Optionally enter **Name** (or let wizard generate)
3. Enter short **Description** (or let wizard generate)
4. Click **AI Wizard** button
5. **Step 1: Select LLM Profile**
   - Choose which AI to use for generation
   - Click **Next**
6. **Step 2: Physical Description Source**
   - Choose one:
     - Use existing character data (AI creates from description/personality)
     - Upload a new image (AI analyzes image)
     - Select from gallery (use existing image)
     - Upload a document (text, Markdown, or PDF with character details)
     - Skip (no description)
7. **Step 3: Select Fields to Generate**
   - Check which fields AI should create:
     - ☐ Name (if not provided)
     - ☐ Title
     - ☐ Properties (pronouns and aliases — only what the source material supports; no invented placeholders)
     - ☐ Identity (outside view — what strangers know on sight)
     - ☐ Description (acquaintance view — behaviour and mannerisms, not appearance)
     - ☐ Manifesto (axiomatic core — load-bearing truths and basic tenets)
     - ☐ Personality (internal view — self-knowledge and inner drivers)
     - ☐ Scenarios
     - ☐ Example Dialogues
     - ☐ First Message (the character's opening message for new chats)
     - ☐ System Prompt
     - ☐ Physical Description (appearance only — nothing removable)
     - ☐ Wardrobe (slot-typed items with image cues, plus composite outfits; the everyday outfit is marked default)
   - Leave others blank for manual entry
   - The wizard treats Identity, Description, Manifesto, Personality, and Physical Description as distinct vantage points — the same trait won't be repeated across them — and keeps everything removable in the Wardrobe rather than the Physical Description.
8. **Step 4: Review and Generate**
   - AI generates selected content
   - Review generated text
   - Accept or edit
9. Click **Create**
10. Character created with generated content

**Time:** 2-5 minutes
**Best for:** When you have a concept but need help fleshing it out, or want a completely random character

## Character Fields: Detailed Guide

### Writing Effective Descriptions

**Good character description:**

```
Keira is a 35-year-old detective with 10 years on the force. 
Tough exterior, but deeply empathetic to victims. Driven by 
a need for justice, especially in cold cases. Divorced, no kids, 
workaholic. Has a dry sense of humor to cope with the darkness 
she sees daily. Haunted by one case she couldn't solve.
```

**Poor character description:**

```
A detective
```

**Tips:**

- Be specific about who they are
- Include notable characteristics
- Mention background/history
- Show what drives them
- At least 2-3 sentences

### Writing Effective Personality Traits

**List specific traits:**

```
Personality: Intelligent but insecure about it, uses humor as defense, 
loyal to a fault, perfectionist, anxious in social situations, 
passionate about learning, struggles with authority
```

**Avoid generic traits:**

```
Personality: Nice, smart, funny
```

**Better approach:**

- List 4-7 specific traits
- Include both strengths and flaws
- Show how they interact with others
- Mention internal conflicts

### Writing Effective First Messages

**Good first message:**

```
"Well, well... another visitor finds their way to my study. 
Most people find the old books boring, but I suspect you're 
not most people. Tea?"
```

**Poor first message:**

```
"Hi"
```

**Tips:**

- Show personality in the greeting
- Set tone for conversation
- Ask engaging question
- Make character voice clear
- 1-2 sentences usually best

### Writing Example Dialogues

**Format:**

```
You: [What someone might say to character]
Character: [What character would respond]

You: [Another example exchange]
Character: [Character response showing different aspect]
```

**Good example:**

```
You: "Why did you become a pirate?"
Captain Vex: "Aye, 'tis a fair question. The ocean called to me, 
and I wasn't one to ignore such a voice. Besides, the world's riches 
shouldn't belong to those born with silver spoons, should they?"

You: "That sounds dangerous."
Captain Vex: "Dangerous? Of course it is. The best things usually are. 
But I'll not lie to ye - there's nothing quite like the freedom of 
the open sea, the wind at your back, and no one to answer to but yourself."
```

**Poor example:**

```
Me: "Hi"
Character: "Hi"
```

**Tips:**

- Show 2-3 different conversation angles
- Let character voice shine through
- Show how they handle different topics
- Include personality quirks in responses
- Should be natural and realistic

### System Prompt Guidelines

System prompts give the AI detailed instructions on behavior. Well-written system prompts = better character roleplay.

**Good system prompt:**

```
You are Captain Vex, a hardened space pirate with a hidden sense of honor. 
Maintain a pirate dialect/accent (drop some g's, use nautical terms).
You're clever and strategic - you think before acting. You show loyalty to 
your crew above all else. You're cynical about authority but surprisingly 
compassionate to the underdog. Respond in character always, maintaining 
Captain Vex's voice and perspective.
```

**Poor system prompt:**

```
Be a pirate
```

**Best practices:**

- Describe the character clearly
- Explain key personality traits
- Mention communication style
- Set boundaries on behavior
- Give context for decision-making
- Keep to 3-5 paragraphs

## Quick Character Templates

Use these as starting points for common character types:

### Template: Detective

```
Name: [Detective Name]
Title: Detective / Private Investigator
Description: Seasoned detective with [X years] experience.
Personality traits include [traits]. Driven by [motivation].
Personality: [Specific traits - suspicious, analytical, intuitive, etc.]
Scenarios:
  - "[City/Setting], [Year]": Working cases in the city, office hours
  - "The Crime Scene": Called to an active investigation
First Message: "Another case lands on my desk. You look like
you've got something to tell me..."
```

### Template: Fantasy Character

```
Name: [Character Name]
Title: [Race/Class, e.g., "Elf Ranger"]
Description: [Character backstory in fantasy world]
Personality: [Personality in context of fantasy setting]
Scenarios:
  - "[Location of Current Quest]": [Quest/situation they're in]
  - "[Home Village or Base Camp]": At rest, between adventures
First Message: "[Greeting in character, hinting at current situation]"
Tags: Fantasy, [Faction/Group], [Role]
```

### Template: Modern Day

```
Name: [Character Name]
Title: [Job/Role, e.g., "Coffee Shop Owner"]
Description: [Who they are in modern setting]
Personality: [Contemporary personality traits]
Scenarios:
  - "[Workplace Name]": At work during regular hours
  - "After Hours": [Current life situation outside of work]
First Message: "[Natural modern greeting with personality]"
Tags: Modern, [Workplace/Circle], [Type]
```

### Template: Sci-Fi

```
Name: [Character Name]
Title: [Sci-Fi Role, e.g., "AI Assistant"]
Description: [Sci-Fi background and context]
Personality: [How they interact, AI quirks, etc.]
Scenarios:
  - "Aboard the [Ship/Station Name]": [Default shipboard situation]
  - "[Planet or Location]": [Planetside or mission scenario]
First Message: "[Sci-Fi greeting showing character]"
Tags: SciFi, [Setting/Faction], [Role]
```

## After Creating a Character

### What You Can Do Next

1. **Start Chatting**
   - Click "Chat" button to start conversation
   - Character will greet you with first message
   - Enjoy talking with your new character

2. **Refine Details**
   - Create more detailed system prompt
   - Add physical description
   - Upload better avatar
   - Add more example dialogues

3. **Set Up Relationships**
   - Assign default partner (for multi-character conversations)
   - Choose default connection profile
   - Configure image generation

4. **Organize**
   - Add tags for organization
   - Mark as favorite if frequently used
   - Set up quick-hide if needed

5. **Share**
   - Export character for sharing
   - Share with other Quilltap users
   - Import characters created by others

## Common Creation Mistakes

### Mistake 1: Too Generic

**Problem:**

```
Name: Hero
Description: A person who goes on adventures
```

**Solution:**

```
Name: Kael Stormborn
Description: A ranger from the northern highlands, haunted by a 
tragedy that took her family. Seeks redemption through protecting others.
```

### Mistake 2: Conflicting Personality

**Problem:** First message says character is shy, but personality is outgoing, and their scenario casts them as a bold pirate.

**Solution:** Ensure description, personality, scenarios, and first message all align with a consistent character.

### Mistake 3: System Prompt Too Long

**Problem:** 10+ paragraph system prompt that repeats itself

**Solution:** Keep to 3-5 focused paragraphs with most important information first.

### Mistake 4: No System Prompt at All

**Problem:** Character behaves inconsistently or not as intended

**Solution:** Even a brief system prompt helps AI understand character:

```
You are [Name], [basic description]. You speak [communication style]. 
Your priorities are [key motivations].
```

### Mistake 5: Not Testing

**Problem:** Create character but never chat with them

**Solution:** Start a chat right after creation to test how character behaves. Make adjustments based on what you see.

## Advanced: Physical Descriptions

### Why Physical Descriptions Matter

Physical descriptions help:

- AI understand how character looks
- Image generation create accurate images
- Consistency across conversations
- Contextual descriptions in messages

### Adding Physical Description

1. **During creation:** Use AI Wizard
   - Upload reference image
   - AI generates description
   - Accept or edit

2. **After creation:** Edit > Appearance tab
   - Generate new description
   - Edit manually
   - Save different length versions

### Physical Description Formats

Generated descriptions include multiple length options:

- **Short** (1 sentence) — Quick reference
- **Medium** (2-3 sentences) — Balanced detail
- **Long** (paragraph) — Detailed description
- **Complete** (2-3 paragraphs) — Very detailed
- **Full** (extensive) — Maximum detail for images

## Advanced: Clothing Records

### Why Clothing Records Matter

Clothing records describe what your character wears in different situations. They help:

- The LLM know what the character is currently wearing
- Image generators pick the right outfit for the scene
- Maintain consistency across conversations

### Adding Clothing Records

1. **Edit character** > **Appearance** tab > **Clothing & Outfits** section
2. Click **Add Outfit**
3. Fill in:
   - **Name** (required) — Display label, e.g. "Battle Armor", "Formal Gown"
   - **Usage Context** — When this outfit is worn, e.g. "in combat", "at formal events"
   - **Description** — Markdown description of the outfit details
4. Click **Create**

Clothing records appear in the system prompt as a `## Clothing / Outfits` section and are included in image generation context.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora/new")`

## Related Topics

- [Characters](characters.md) — Characters overview
- [Editing Characters](character-editing.md) — Modifying characters
- [AI Wizard](ai-character-import.md) — Using AI to generate content
- [System Prompts](character-system-prompts.md) — Advanced prompt configuration
- [Character Organization](character-organization.md) — Tags and management
- [Chats](chats.md) — Starting conversations with characters
