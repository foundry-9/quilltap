# Image Prompt Expansion with Physical Descriptions

This feature allows you to use placeholders in image generation prompts that automatically expand to include physical descriptions of characters and personas.

## Overview

When generating images, you can reference characters and personas using `{{placeholders}}` in your prompts. The system will:

1. Detect placeholders in the prompt (e.g., `{{Mirel}}`, `{{me}}`, `{{I}}`)
2. Retrieve ALL physical description tiers for those entities (short, medium, long, complete)
3. Send all available tiers to a cheap LLM
4. The cheap LLM intelligently selects/combines content from the tiers to maximize detail while staying within the provider's character limit
5. The LLM crafts a cohesive, natural-sounding prompt
6. Send the expanded prompt to the image generator

## Provider Limits

Different image generation providers have different prompt length limits:

| Provider | Character Limit | Notes |
|----------|----------------|-------|
| **Grok** | 700 characters | Conservative limit for optimal results |
| **Google Imagen** | ~1,920 characters | Approximately 480 tokens |
| **OpenAI DALL-E 3** | 4,000 characters | Most generous limit |

The system automatically adjusts the description length to fit within these limits.

## Physical Description Tiers

Characters and personas can have multiple description tiers:

- **Short Prompt** (max 350 chars) - Minimal essential features
- **Medium Prompt** (max 500 chars) - Balanced description
- **Long Prompt** (max 750 chars) - Detailed description
- **Complete Prompt** (max 1000 chars) - Full detailed description

The system selects the longest description that fits within the available space.

## Placeholder Syntax

### Character Placeholders

Use the character's name in double curly braces:

```
{{CharacterName}}
```

Example:
```
{{Mirel}} in a bathing suit on a beach
{{Elena}} wearing an elegant evening dress
portrait of {{Sarah}} with sunset lighting
```

### Self-Reference Placeholders (Context-Aware)

The `{{me}}`, `{{I}}`, or `{{user}}` placeholders are **context-aware** and resolve based on who is calling the tool:

**When a CHARACTER participant calls the tool (in chat):**
- `{{me}}`/`{{I}}` → The character's physical description

**When a PERSONA/USER calls the tool (manually or in chat):**
- `{{me}}`/`{{I}}` → The user's persona physical description

```
{{me}}
{{I}}
{{user}}
```

Examples:
```
{{me}} and {{Mirel}} having coffee together
{{I}} exploring an ancient temple
portrait of {{me}} in formal attire
```

This means if a character in chat uses the tool with the prompt "{{me}} fighting a dragon", it will use THAT CHARACTER's description, not the user's.

### Multiple Placeholders

You can use multiple placeholders in one prompt:

```
{{Mirel}} and {{Elena}} dancing at a party
{{Character1}}, {{Character2}}, and {{me}} on an adventure
```

## API Usage

### Endpoint

```
POST /api/image-profiles/[profileId]/generate
```

### Request Body

```json
{
  "prompt": "{{Mirel}} in a bathing suit on a beach",
  "chatId": "optional-chat-uuid-for-me-context",
  "count": 1,
  "size": "1024x1024",
  "quality": "hd",
  "style": "vivid"
}
```

### Parameters

- **prompt** (required, string): The prompt with placeholders
- **chatId** (optional, UUID): Chat context for resolving `{{me}}`
- **count** (optional, number): Number of images to generate (1-10, default: 1)
- **size** (optional, string): Image size (provider-specific)
- **quality** (optional, enum): `'standard'` or `'hd'`
- **style** (optional, enum): `'vivid'` or `'natural'`
- **aspectRatio** (optional, string): Aspect ratio (provider-specific)
- **negativePrompt** (optional, string): Negative prompt (if supported)

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "image-uuid",
      "url": "/api/images/image-uuid",
      "filename": "generated_image.png",
      "filepath": "uploads/generated/user-id/image.png",
      "revisedPrompt": "beautiful redhead woman with...",
      "mimeType": "image/png",
      "size": 1234567,
      "width": 1024,
      "height": 1024,
      "sha256": "abc123..."
    }
  ],
  "metadata": {
    "originalPrompt": "{{Mirel}} in a bathing suit on a beach",
    "provider": "OPENAI",
    "model": "dall-e-3",
    "count": 1
  }
}
```

## Tool Usage (from Chat)

When using the image generation tool from within a chat:

```javascript
{
  "tool": "generate_image",
  "parameters": {
    "prompt": "{{Mirel}} and {{me}} in swimwear on a beach"
  }
}
```

The chat context is automatically provided, so `{{me}}` will be resolved to the chat's persona.

## Example Workflows

### 1. Single Character Portrait

```json
POST /api/image-profiles/{profileId}/generate
{
  "prompt": "portrait of {{Mirel}}, professional photography, studio lighting"
}
```

If Mirel's physical description is:
> "beautiful redhead with a curvaceous body, long flowing red hair, parted on one side, green eyes"

The expanded prompt might be:
> "portrait of a beautiful redhead with a curvaceous body, long flowing red hair parted on one side, and striking green eyes, professional photography, studio lighting"

### 2. Multiple Characters

```json
{
  "prompt": "{{Mirel}} and {{Elena}} dancing at a masquerade ball, elegant lighting, cinematic"
}
```

The system will:
1. Retrieve descriptions for both characters
2. Calculate available space for each
3. Select appropriate description tiers
4. Craft a cohesive prompt that naturally describes both characters

### 3. User + Character Scene

```json
{
  "prompt": "{{me}} and {{Mirel}} watching the sunset on a beach, romantic atmosphere",
  "chatId": "chat-uuid-123"
}
```

Requires a chat context to resolve `{{me}}` to the user's persona description.

## How It Works

### 1. Placeholder Detection

The system scans the prompt for `{{placeholder}}` patterns:

```typescript
const placeholders = parsePlaceholders(prompt);
// Returns: [{ placeholder: "{{Mirel}}", name: "Mirel" }]
```

### 2. Entity Resolution

For each placeholder:
- Checks if it's a user reference (`{{me}}`, `{{user}}`)
- Searches for matching character by name
- Searches for matching persona by name
- Retrieves all physical descriptions for the entity

### 3. Send All Description Tiers

Instead of pre-selecting which tier to use, ALL available tiers are sent to the cheap LLM:

```
{{Mirel}}:
  Complete: "beautiful redhead woman with long flowing red hair..."
  Long: "redhead with long flowing hair parted on one side..."
  Medium: "attractive redhead with green eyes and..."
  Short: "redhead with green eyes"
```

### 4. Cheap LLM Intelligent Selection

The cheap LLM receives:
- The original prompt
- ALL description tiers for each placeholder
- The provider's character limit

The LLM then:
- Intelligently selects OR combines content from different tiers
- Maximizes detail while staying under the limit
- Can mix details from long and complete, or use complete if it fits
- Crafts a grammatically correct, natural-sounding prompt

Example:

```
System: You are crafting an image generation prompt...
Select or combine from the available tiers to maximize detail.

User:
Original prompt: {{Mirel}} in a bathing suit on a beach

Available descriptions:
{{Mirel}} (Mirel):
  Complete: "beautiful redhead woman with long flowing red hair that cascades past her shoulders, parted elegantly on one side, captivating green eyes, athletic yet curvaceous figure, warm and friendly expression"
  Long: "beautiful redhead with long flowing hair parted on one side, striking green eyes, athletic and curvaceous figure"
  Medium: "attractive redhead with green eyes, athletic build"
  Short: "redhead with green eyes"

Target length: 700 characters (for GROK)

LLM Response:
"A beautiful redhead woman with long flowing red hair parted elegantly on one side in a bathing suit on a beach, her captivating green eyes gazing at the ocean horizon, athletic yet curvaceous figure catching the warm sunlight"
```

Note how the LLM selected parts from both the "complete" and "long" tiers to create the best possible description within the 700-character limit.

## Setting Up Physical Descriptions

### For Characters

1. Navigate to Character → Edit
2. Scroll to "Physical Descriptions" section
3. Click "Add Description"
4. Fill in the description tiers:
   - **Name**: Description set name (e.g., "Default Appearance")
   - **Short Prompt**: 50-350 characters
   - **Medium Prompt**: 300-500 characters
   - **Long Prompt**: 500-750 characters
   - **Complete Prompt**: 750-1000 characters
   - **Full Description**: Unlimited (for reference only)

### For Personas

Same process as characters:
1. Navigate to Persona → Edit
2. Add physical descriptions

## Best Practices

### 1. Create Multiple Description Tiers

Always provide multiple tiers - the cheap LLM can intelligently select OR combine content from different tiers:

```
Short: "redhead with green eyes, athletic build"
Medium: "beautiful redhead with long flowing hair parted on one side, striking green eyes, athletic and curvaceous figure"
Long: "beautiful redhead with long flowing red hair that cascades past her shoulders, parted elegantly on one side, captivating green eyes, athletic yet curvaceous figure, graceful posture"
Complete: "beautiful redhead woman with long flowing red hair that cascades past her shoulders, parted elegantly on one side, captivating green eyes that sparkle with intelligence, athletic yet curvaceous figure, graceful posture, warm and friendly expression"
```

The more tiers you provide, the more options the LLM has to optimize the description.

### 2. Be Specific but Flexible

- ✅ "long red hair parted on one side"
- ❌ "exactly 24 inches of crimson hair with a 3-inch side part"

### 3. Focus on Visual Elements

- ✅ "athletic build, graceful posture, warm smile"
- ❌ "kind personality, loves hiking, extroverted"

### 4. Use Natural Language

Descriptions should read naturally when inserted into prompts:

- ✅ "tall woman with elegant features and flowing auburn hair"
- ❌ "height: tall; features: elegant; hair: auburn, flowing"

### 5. Consider Different Contexts

The complete prompt can include details for full scenes:

```
Complete: "beautiful redhead woman with long flowing hair parted on one side, striking green eyes, athletic and curvaceous figure wearing casual modern clothing, warm and friendly expression"
```

While short prompt focuses on essentials:

```
Short: "redhead with green eyes and athletic build"
```

## Troubleshooting

### Placeholder Not Found

If a placeholder doesn't match any character/persona:
- The system will use the literal name
- Check spelling and capitalization
- Character names are case-insensitive

### {{me}}/{{I}} Resolves to Wrong Entity

`{{me}}`/`{{I}}` is context-aware:

- **If called by a character in chat**: Uses the character's description
- **If called by user/persona**: Uses the user's persona description
- If calling from API directly, provide `chatId` to get persona context
- Verify the calling entity has physical descriptions configured

### Prompt Too Long

If even the short description is too long:
- The system automatically truncates
- Consider reducing your short prompt length
- Use fewer placeholders per prompt

### Cheap LLM Not Available

If no cheap LLM is configured:
- The system falls back to simple substitution
- Placeholders are replaced directly with descriptions
- Results may be less grammatically smooth

## Configuration

### Cheap LLM Settings

Configure which LLM to use for prompt crafting:

**Settings → Chat Settings → Cheap LLM**

- **Provider Cheapest**: Automatically uses the cheapest model from your current provider
- **User Defined**: Select a specific connection profile
- **Local First**: Prefer local models (Ollama) if available

### Default Image Profile

Set a default image profile in:

**Settings → Image Profiles → [Profile] → Set as Default**

## Examples from Real Use

### Example 1: Character Portrait

```json
{
  "prompt": "professional headshot of {{Sarah Chen}}, studio lighting, neutral background"
}
```

**Expanded:**
```
professional headshot of an East Asian woman in her late twenties with shoulder-length black hair styled in a modern bob, intelligent dark eyes behind stylish rectangular glasses, and a confident professional demeanor, studio lighting, neutral background
```

### Example 2: Action Scene

```json
{
  "prompt": "{{Marcus}} and {{Diana}} in combat stance, epic battle scene, dramatic lighting"
}
```

**Expanded:**
```
A muscular man with short dark hair and battle scars and a tall athletic woman with long blonde hair in a warrior's braid both in combat stance, epic battle scene, dramatic lighting
```

### Example 3: Romantic Scene

```json
{
  "prompt": "{{me}} and {{Alex}} watching fireworks, New Year's Eve, romantic atmosphere",
  "chatId": "abc-123"
}
```

**Expanded:**
```
A young woman with curly brown hair and warm hazel eyes and a tall man with sandy blonde hair and blue eyes watching fireworks together, New Year's Eve, romantic atmosphere, intimate moment
```

## Architecture

### Files

- **`lib/image-gen/prompt-expansion.ts`** - Placeholder parsing and description selection
- **`lib/memory/cheap-llm-tasks.ts`** - Cheap LLM prompt crafting function
- **`lib/tools/handlers/image-generation-handler.ts`** - Image generation with expansion
- **`app/api/image-profiles/[id]/generate/route.ts`** - API endpoint

### Flow Diagram

```
User Prompt with {{placeholders}}
    ↓
Parse placeholders
    ↓
Resolve to characters/personas
    ↓
Retrieve physical descriptions
    ↓
Calculate available space per placeholder
    ↓
Select best-fitting descriptions
    ↓
Build expansion context
    ↓
Cheap LLM crafts cohesive prompt
    ↓
Expanded prompt → Image Generator
    ↓
Generated Image(s)
```

## Future Enhancements

Potential improvements:

1. **Context-Aware Descriptions**: Different descriptions for different scenarios (formal, casual, action, etc.)
2. **Description Variants**: Support multiple description sets per character (summer outfit, winter outfit, etc.)
3. **Smart Truncation**: Better handling when descriptions don't fit
4. **Placeholder Aliases**: Support `{{char}}`, `{{persona}}` shortcuts
5. **Batch Generation**: Generate multiple variations with different description combinations
6. **Description Templates**: Pre-built templates for common scenarios

## Why Send All Tiers to the Cheap LLM?

Instead of pre-selecting which tier to use, we send all available tiers to the cheap LLM. This approach has several advantages:

### Maximum Detail Utilization

The LLM can mix and match details from different tiers to create the most detailed description possible:

**Example:**
```
Short: "redhead, athletic"
Medium: "beautiful redhead with green eyes, athletic build, warm smile"
Long: "beautiful redhead woman with long flowing red hair, captivating green eyes"
Complete: "beautiful redhead woman with long flowing red hair that cascades past shoulders, parted on one side, captivating green eyes that sparkle with intelligence"
```

For a 150-character limit, the LLM might create:
```
"beautiful redhead with long flowing red hair parted on one side, captivating green eyes that sparkle, athletic build, warm smile"
```

This combines:
- Hair description from "long"/"complete"
- Eyes from "complete"
- Build from "medium"
- Smile from "medium"

### Better Than Rigid Selection

A rigid tier-selection algorithm might choose "medium" for a 150-char limit, missing the richer eye description from "complete" and the hair details from "long".

### Contextual Optimization

The LLM can prioritize different details based on the prompt context:

**Prompt: "{{Mirel}} in elegant formal wear"**
- LLM prioritizes "graceful posture" and "elegant features" from the complete tier

**Prompt: "{{Mirel}} running on the beach"**
- LLM prioritizes "athletic build" and physical action-compatible details

### Graceful Degradation

If descriptions don't fit well, the LLM can:
- Abbreviate less critical details
- Remove redundant adjectives
- Prioritize most distinctive features

### Creative Combinations

For multiple characters, the LLM can balance descriptions:

**Prompt: "{{Tall Character}} and {{Short Character}} standing together"**
- The LLM naturally emphasizes the height contrast
- Balances detail levels between both characters
- Ensures total stays under limit

## See Also

- [Image Generation Overview](./IMAGE-GENERATION.md)
- [Physical Descriptions Setup](./PHYSICAL-DESCRIPTIONS.md)
- [Cheap LLM Configuration](./CHEAP-LLM.md)
