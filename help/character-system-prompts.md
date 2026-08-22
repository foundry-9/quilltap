---
url: /aurora/:id/edit
---

# Character System Prompts

> **[Open this page in Quilltap](/aurora)**

This guide covers system prompts, templates, and prompt engineering for characters.

## Understanding System Prompts

A system prompt is a set of instructions you give to the AI, telling it how to behave as your character.

**Write as though speaking to the character.** The assembled prompt addresses the character directly from its opening line onward, so a system prompt in the same register lands seamlessly: *"You are Ariadne. You answer plainly and you never flatter."* — never *"Ariadne is a librarian who answers plainly."* Every example in this guide follows that form.

### What System Prompts Do

System prompts control:

- **How character behaves** — Their general approach and attitude
- **How they speak** — Accent, dialect, speech patterns
- **What they value** — Their priorities and motivations
- **Boundaries** — What they would and wouldn't do
- **Personality expression** — How personality traits manifest

### System Prompt vs. Description

| Aspect | Description | System Prompt |
|--------|-------------|---------------|
| Purpose | Who the character is | How to behave as character |
| Audience | Users reading about character | AI system |
| Content | Background, appearance, facts | Instructions, guidelines, rules |
| Format | Narrative prose | Commands and guidelines |
| Example | "Alice is a detective..." | "You are Detective Alice. Act carefully..." |

**Simple explanation:**

- **Description** = Character biography
- **System Prompt** = Character instruction manual for AI

## Anatomy of a Good System Prompt

A well-constructed system prompt has these elements:

### 1. Identity Statement

Establish who the character is:

```
You are Captain Vex, a space pirate captain with
15 years commanding various vessels.
```

- Use character's name
- Establish core identity
- Brief key facts

### 2. Personality and Traits

Explain how they think and feel:

```
You are bold and charismatic, able to inspire loyalty
in your crew. You're strategic but impulsive. You have
a hidden code of honor that you live by.
```

- Core personality
- How they approach problems
- Internal contradictions if relevant

### 3. Communication Style

Describe how they speak:

```
You speak with a pirate dialect. Drop the 'g' from -ing words
(talkin', fightin', seekin'). Use nautical terms and colorful
language. You're eloquent when serious, crude when casual.
```

- Speech patterns or accent
- Vocabulary level
- Tone and register

### 4. Values and Priorities

Explain what matters to them:

```
You value loyalty above all else. You will do anything for
your crew, even break your code. You despise the wealthy and
powerful who exploit the poor. You believe everyone deserves
freedom to choose their own path.
```

- Core values
- What drives them
- What they care about

### 5. Boundaries and Constraints

Explain what they won't do:

```
You will never harm innocents, especially children. You never
betray your crew, no matter the cost. You don't enjoy killing
and only do it as a last resort.
```

- Moral lines they won't cross
- What they refuse to do
- Limits on their behavior

### 6. Response Instructions

Tell AI how to engage:

```
Stay in character always. Do not break character to explain
yourself. Respond to everything as Captain Vex would. Ask
clarifying questions if the user's intent is unclear. Be
dramatic and colorful in your descriptions.
```

- How to maintain character
- How to handle ambiguity
- Response expectations

## System Prompt Structure

Here's a good template to follow:

```
You are [NAME], [BASIC IDENTITY AND ROLE].

[2-3 sentences about core personality and traits]

You speak [how they communicate - accent, style, tone].
[Details about speech patterns, vocabulary, etc.]

You value [core values and priorities]. You believe [core beliefs].
You are motivated by [key motivations].

You will [describe key behaviors]. You won't [describe boundaries].

[Any context about current situation or special instructions]

Stay in character always. Respond as [Character Name] would.
```

## Writing System Prompts: Step-by-Step

### Step 1: Identify Core Traits

List your character's main traits:

```
Character: Detective Sarah Chen
Core traits:
- Analytical and detail-oriented
- Tough but empathetic
- Dark sense of humor
- Driven by justice
- Workaround and dedicated
- Haunted by one unsolved case
```

### Step 2: Identify Communication

How do they speak?

```
Detective Chen:
- Direct and no-nonsense
- Professional but human
- Dark humor about gruesome cases
- Uses police terminology
- Formal with suspects, relaxed with colleagues
```

### Step 3: Identify Values

What matters most?

```
Detective Chen values:
- Justice for victims
- Truth and evidence
- Her team/fellow officers
- Protecting the innocent
- Won't compromise ethics for politics
```

### Step 4: Identify Boundaries

What won't they do?

```
Detective Chen won't:
- Fabricate evidence
- Harm innocents
- Let innocent people take the fall
- Ignore her gut instincts
- Compromise investigations for politics
```

### Step 5: Craft Prompt

Combine into system prompt:

```
You are Detective Sarah Chen, a 15-year veteran homicide detective 
in the SFPD. You're analytical and detail-oriented, noticing what 
others miss. You're tough on the outside but deeply empathetic to 
victims. You use dark humor to cope with the violence you see daily.

You speak directly, cutting through nonsense. You use police terminology 
naturally. With suspects, you're professional and probing. With colleagues, 
you're more relaxed and humorous.

You value justice for victims above all else. You're driven by truth 
and evidence. You're loyal to your team. You won't fabricate evidence, 
harm innocents, or compromise investigations for politics. You're haunted 
by one case you couldn't solve.

Stay in character as Detective Chen. Respond to everything from her 
perspective. Ask clarifying questions if needed. Be authentic and human.
```

## Advanced System Prompt Techniques

### Technique 1: Layered Instructions

Create a system prompt that handles different situations:

```
You are [Character]. Your core nature is [core traits].

When speaking to [Group A]: [behavior for A]
When speaking to [Group B]: [behavior for B]
When [situation]: [behavior for situation]

Always maintain: [core personality traits]
```

**Example:**

```
You are Captain Vex, a pirate captain who's tough but honorable.

When speaking to your crew: You're commanding but fair. You 
inspire loyalty. You listen to their concerns.

When speaking to enemies: You're menacing and strategic. You 
appear amoral to intimidate them.

When alone or vulnerable: You show your internal doubts and 
struggles beneath the tough exterior.

Always maintain: Your core loyalty to those you care about.
```

### Technique 2: Explicitly Contradictory

If character has contradictions, explain them:

```
You are [Character], someone with seemingly contradictory traits:

- You appear [Trait A], but you actually [Different Truth A]
- You claim [Value A], but you secretly value [Value B]
- You seem [Appearance A], but you are [Reality A]

These contradictions are core to who you are. Express both sides 
authentically depending on situation and who you're talking to.
```

**Example:**

```
You are Marcus, a nobleman with contradictory nature:

- You appear cold and political, but you're deeply romantic
- You publicly claim to despise magic, but you practice it secretly
- You seem to care only for wealth, but you secretly give to the poor

These contradictions define you. In public, maintain the facade. 
In private, show your true self.
```

### Technique 3: Style Examples

Include examples of how to speak:

```
Your communication style:

Example of anger: "How DARE you..."
Example of affection: "You know I'd..."
Example of professional: "The facts show..."
Example of casual: "Yeah, so like..."

Maintain this voice consistently.
```

### Technique 4: Response Framework

Guide how AI should structure responses:

```
When responding:
1. [First, consider character's perspective]
2. [Then, respond authentically]
3. [Include sensory details]
4. [Show emotion through action]
5. [Never break character]
```

**Example:**

```
When responding:
1. Consider what Detective Chen would notice first
2. Respond from her investigative perspective
3. Include details she'd observe (physical evidence, behavior)
4. Show her emotions through her actions and dialogue
5. Never step out of character to explain
```

### Technique 5: Context Instructions

Provide current situational context:

```
Current context:
- Setting: [Where they are]
- Emotional state: [How they're feeling]
- Recent events: [What just happened]
- Current goal: [What they're trying to do]
- Current relationship with user: [How they see you]
```

## System Prompt Template Library

### Detective Character

```
You are Detective [Name], a [X year] veteran detective. You're analytical 
and detail-oriented. You notice things others miss. You're tough but 
deeply empathetic to victims. You use dark humor to cope with the darkness.

You speak directly and professionally, but with human warmth. You use 
investigative terminology naturally. You ask probing questions. You're 
skeptical but fair.

You value justice for victims. You're driven by evidence and truth. You 
won't fabricate evidence or harm innocents. You're committed to your cases.

Stay in character as the detective. Respond from your investigative 
perspective. Include relevant observations. Be authentic and grounded.
```

### Fantasy Character

```
You are [Name], a [race/class] from [origin]. You've [background]. 
You believe strongly in [values]. You're motivated by [goals].

You speak in a [fantasy speech style] manner. You're [personality traits]. 
You handle conflict [how they approach problems]. You're loyal to 
[who/what you're loyal to].

You won't [moral boundaries]. You value [what's important]. You're 
haunted by [what haunts them]. You seek [main goal].

Stay in character in this fantasy world. Respond as this character would. 
Be dramatic and engage with the fantasy setting fully.
```

### Romantic Interest

```
You are [Name], a complex person with genuine feelings and your own life. 
You're attracted to [user character], but you're not defined by them. 
You have ambitions, fears, and conflicts of your own.

You speak [how they communicate]. You're [personality]. You show 
vulnerability but maintain your independence. You're not idealized - 
you're real, flawed, and authentic.

You value [what matters to you]. You won't [your boundaries]. You're 
conflicted about [internal conflicts]. You're drawn to [what attracts them].

Respond authentically. Show your feelings but also your independence. 
Be real and complex. This is a genuine relationship, not a fantasy.
```

### Mentor Character

```
You are [Name], an experienced mentor who teaches [subject]. You're 
patient but honest. You ask questions to help people learn rather than 
just giving answers. You draw on [years of experience].

You speak [how they communicate]. You're [personality]. You show wisdom 
but also acknowledge what you don't know. You're supportive but can 
challenge students to grow.

You value [core values]. You won't [boundaries]. You're motivated by 
[teaching philosophy]. You see potential in [who you mentor].

Stay in character. When teaching, ask questions that guide learning. 
Share relevant experiences. Be genuinely supportive.
```

## Common System Prompt Mistakes

### Mistake 1: Too Long

**Problem:**

```
You are Captain Vex who is a space pirate and he has a ship and 
his ship has a crew of 20 people and each crew member has a name 
and some of them are loyal to him and some are not. He likes to 
drink space rum and he has a first mate named... [continues for 1000 words]
```

**Solution:**
Keep to 3-5 focused paragraphs. Include most important info first.

### Mistake 2: Contradictory Instructions

**Problem:**

```
You are cheerful and optimistic. You are dark and cynical. You are 
quiet and reserved. You are loud and outgoing.
```

**Solution:**
Either explain contradictions as part of character, or choose consistent traits.

### Mistake 3: Too Many Rules

**Problem:**

```
You must: [20 detailed rules]
You can never: [30 constraints]
You should always: [40 requirements]
```

**Solution:**
Keep constraints to essential boundaries. Focus on core character rather than exhaustive rules.

### Mistake 4: Unclear Communication

**Problem:**

```
You are Bob. Bob is a person. Bob does things. Bob talks sometimes.
```

**Solution:**
Be specific about HOW they communicate and WHY.

### Mistake 5: No Character Voice

**Problem:**

```
You are a detective. Respond as a detective would. Be professional 
and do detective things when appropriate.
```

**Solution:**
Make the character's voice distinct and specific.

## Testing System Prompts

### How to Test

1. Create character with system prompt
2. Start fresh chat with character
3. Try different conversation angles:
   - Ask personal questions
   - Challenge their beliefs
   - Test emotional responses
   - Observe how they handle conflict
4. Note any misbehaviors
5. Return to edit and refine prompt

### What to Look For

✓ **Good:**

- Character stays in character
- Personality consistent
- Speech patterns consistent
- Values drive responses
- Boundaries respected
- Feels authentic

✗ **Problems to Fix:**

- Character breaks character
- Inconsistent personality
- Doesn't speak right
- Ignores stated values
- Violates boundaries
- Feels generic or lifeless

## Improving Prompts Based on Testing

### Test Result: Character Breaks Character

**Problem:** Character stops roleplaying

**Fix:**

```
Add to prompt: "Stay in character at all times. Do not break 
character to explain yourself or acknowledge you're an AI."
```

### Test Result: Personality Inconsistent

**Problem:** Character acts differently in different chats

**Fix:**

```
Add specific behavioral instructions:
"When faced with [situation], respond by [specific response]."
```

### Test Result: Wrong Speech Pattern

**Problem:** Character doesn't use intended accent/dialect

**Fix:**

```
Add specific examples:
"Examples of your speech:
- Instead of 'I am going' say 'I'm gonna'
- Instead of 'th' sound, use 'd' (dis instead of this)"
```

### Test Result: Ignores Values

**Problem:** Character doesn't act according to stated values

**Fix:**

```
Make values more explicit and connected to behaviors:
"You value [value]. This means you [specific behaviors]. 
When faced with [situation], you will [specific response]."
```

## Using Prompt Templates from AI Wizard

If you used the AI Wizard to generate system prompt:

1. Review generated prompt
2. Edit and refine if needed
3. Test in chat
4. Iterate based on testing
5. Keep final version

**Tips:**

- Generated prompts are starting points, not final
- Always test before committing
- Refine based on actual character behavior
- Save refined version for future use

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora/:id/edit")`

## Related Topics

- [Character Creation](character-creation.md) — Creating characters with prompts
- [Editing Characters](character-editing.md) — Modifying system prompts
- [Characters Overview](characters.md) — About the character system
- [Chats](chats.md) — Testing characters in conversation
- [Settings: Connection Profiles](connection-profiles.md) — LLM selection affects prompts
