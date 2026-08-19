/**
 * Image, scene, and attachment-focused cheap LLM tasks.
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { logger } from '@/lib/logger'
import { describeOutfit, buildOutfitSlotValues } from '@/lib/wardrobe/outfit-description'
import { stripCodeFences } from '@/lib/services/ai-import.service'
import { executeCheapLLMTask } from './core-execution'
import type {
  AppearanceResolutionItem,
  Attachment,
  CharacterAppearanceInput,
  ChatMessage,
  CheapLLMTaskResult,
  DeriveSceneContextInput,
  ImagePromptExpansionContext,
  SceneStateInput,
  StoryBackgroundPromptContext,
  UncensoredFallbackOptions,
} from './types'

interface AestheticPromptInputs {
  sceneAesthetic?: string | null
  characterAesthetic?: string | null
  depictionGuidelines?: Array<{ characterName: string; content: string }> | null
}

/**
 * Build the labelled aesthetic + Ariel-Clause block appended to a crafting
 * call's user message. Returns '' when nothing is set, so existing behaviour is
 * unchanged. Per-character depiction guidelines are flagged MANDATORY and the
 * matching system-prompt section instructs the model to treat them as binding.
 */
function buildAestheticSection(inputs: AestheticPromptInputs): string {
  const parts: string[] = []
  if (inputs.sceneAesthetic) {
    parts.push(`Overall image aesthetic (apply this style to the whole image):\n${inputs.sceneAesthetic}`)
  }
  if (inputs.characterAesthetic) {
    parts.push(`Character depiction aesthetic (how people and clothing should look):\n${inputs.characterAesthetic}`)
  }
  if (inputs.depictionGuidelines && inputs.depictionGuidelines.length > 0) {
    const lines = inputs.depictionGuidelines
      .map(g => `- ${g.characterName}: ${g.content}`)
      .join('\n')
    parts.push(
      `Per-character depiction guidelines (MANDATORY — follow exactly for the named character, overriding the general aesthetic on conflict):\n${lines}`,
    )
  }
  if (parts.length === 0) return ''
  return `\n${parts.join('\n\n')}\n`
}

/**
 * Attachment description prompt template
 */
const ATTACHMENT_DESCRIPTION_PROMPT = `Describe this file attachment briefly for memory/search purposes.
Focus on what the content shows or contains.
Keep the description under 100 words.
Respond with only the description text.`

/**
 * Image prompt crafting prompt template
 */
const IMAGE_PROMPT_CRAFTING_PROMPT = `You are an expert image prompt writer. Your job is to craft coherent, well-structured image generation prompts by integrating physical descriptions of people into a scene description.

You will receive:
- An original prompt describing a scene with {{placeholders}} for people
- Physical descriptions for each person (in multiple detail levels: short, medium, long, complete)
- Optional usage context for each person indicating when that appearance is most appropriate
- A character limit for the final prompt
- Optionally, a style trigger phrase that MUST be incorporated into the prompt

Your task is to write a SINGLE COHERENT PARAGRAPH that:
1. Describes the scene and what is happening
2. Introduces each person naturally with their physical details woven into the narrative
3. Maintains proper sentence structure and flow
4. If a style trigger phrase is provided, incorporates it naturally (typically at the beginning of the prompt)

CRITICAL WRITING GUIDELINES:
- Write in a cinematic, descriptive style suitable for image generation
- If a person's gender is specified (e.g., [man] or [woman]), ALWAYS refer to them using that gender term (e.g., "a man with...", "a woman with...")
- Introduce people with phrases like "A young woman with...", "Beside her, a middle-aged man with..."
- NEVER just concatenate descriptions - write flowing prose that a human would write
- Use transitional phrases to connect people: "sitting on the lap of", "next to", "holding hands with", etc.
- Keep the scene context (location, mood, lighting) as a frame around the people descriptions
- Each person must be clearly distinct and identifiable in the description

STYLE TRIGGER PHRASE:
- If provided, the style trigger phrase is REQUIRED for the image to render correctly with the selected style
- Place it naturally, typically at the beginning (e.g., "DB4RZ Daubrez style painting of a young woman...")
- Do NOT omit or modify the trigger phrase - use it exactly as provided

AESTHETIC & DEPICTION GUIDELINES:
- You may receive an overall image aesthetic and/or a character depiction aesthetic. Apply these as the consistent visual style for the whole image (medium, era, palette, rendering).
- You may also receive per-character depiction guidelines. These are MANDATORY, binding constraints for the named character and OVERRIDE the general aesthetic wherever they conflict. Never omit, soften, or contradict them.

STRUCTURE EXAMPLE:
BAD (concatenated): "Woman with red hair, hazel eyes, fair skin. sitting on Man with gray hair, glasses, plaid shirt.'s lap on a bench"
GOOD (coherent): "On a sunlit park bench, a young woman with flowing red-orange hair and warm hazel eyes sits comfortably on the lap of a middle-aged man wearing rectangular glasses and a cozy sweater vest. Dappled light filters through the leaves above them."
GOOD (with trigger): "DB4RZ Daubrez style painting of a sunlit park bench scene, where a young woman with flowing red-orange hair..."

For the descriptions:
- Use the most detailed tier that fits within the limit
- You may condense or paraphrase descriptions to fit naturally
- Prioritize the most visually distinctive features (hair color, eye color, notable clothing, distinguishing features)
- Don't include every detail if it makes the text awkward - focus on what matters visually
- If a usage context is provided, use it to inform which appearance details are most relevant to the scene

The final prompt MUST be under the character limit.

Respond with ONLY the final image prompt - no explanations, no markdown, no quotes around it.`

/**
 * Scene context derivation system prompt
 * Analyzes chat history to derive a rich scene description for image generation
 */
const SCENE_CONTEXT_DERIVATION_PROMPT = `You are a creative writer skilled at interpreting conversations and imagining vivid scenes.

Your task is to analyze a conversation and derive a scene context that captures what the characters might be experiencing or witnessing together.

GUIDELINES:
- Consider what the characters are currently discussing or doing
- Interpret the emotional tone and implied setting
- Be imaginative: if they're discussing a book, story, or historical event, imagine them as observers or participants in that world
- If the conversation is casual or abstract, capture the mood and implied environment
- Focus on visual, atmospheric details that would translate well to an image
- Keep your description concise (1-3 sentences)

EXAMPLES:

Conversation about the book of Exodus:
"Two figures huddle together examining ancient scrolls by lamplight, the distant silhouette of pyramids visible through a tent opening, desert stars glittering overhead."

Casual friendly conversation:
"Friends share comfortable conversation in a cozy space, warm lighting casting gentle shadows as they lean toward each other with easy familiarity."

Discussion about space exploration:
"Two companions gaze up at a star-filled sky, the Milky Way stretching above them, their faces illuminated by the soft glow of a campfire."

Respond with ONLY the scene description - no explanations, no quotes, no formatting.`

/**
 * Concise clothing summaries in the scene state are capped so a verbose cheap
 * LLM can't bloat the `Current State` whisper. The prompts ask for ≤200 chars;
 * this is the defensive cap applied in code after the model returns.
 */
export const SCENE_CLOTHING_MAX_CHARS = 200

/**
 * Defensively enforce the {@link SCENE_CLOTHING_MAX_CHARS} cap on a clothing
 * summary the LLM returned. Trims whitespace, then truncates at the cap with a
 * trailing ellipsis so the total never exceeds the limit. Non-strings collapse
 * to an empty string.
 */
export function capClothingSummary(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length <= SCENE_CLOTHING_MAX_CHARS) return text
  return text.slice(0, SCENE_CLOTHING_MAX_CHARS - 1).trimEnd() + '…'
}

/**
 * Scene state tracking prompt for first turn
 * Analyzes conversation and character data to produce a structured scene state
 */
const SCENE_STATE_FIRST_TURN_PROMPT = `You are a scene state tracker for a roleplay chat. Read the scenario setup and conversation, then produce a structured JSON snapshot of the current scene.

Output ONLY valid JSON with this exact schema:
{
  "location": "where the scene takes place right now",
  "characters": [
    {
      "characterId": "the character's ID (from baselines)",
      "characterName": "the character's name",
      "action": "what the character is doing right now",
      "appearance": "what the character currently looks like",
      "clothing": "describe current clothing state — see rules below"
    }
  ]
}

CRITICAL RULES — read carefully:
- The CONVERSATION and SCENARIO are the primary authority. Character baselines are only defaults.
- If the scenario or conversation describes a character wearing something specific, USE THAT, not the baseline clothing.
- If the scenario or conversation describes a character's appearance differently from baseline, USE THAT.
- If a character undresses, is described as nude/naked, or removes clothing in the narrative, clothing should reflect that accurately — do not fall back to baseline clothing. Undressing removes clothing but does NOT remove a hairstyle; keep the hairstyle in the summary unless the narrative explicitly changes it (hair let down, ribbon pulled loose).
- Baselines are ONLY used when the conversation gives NO information about a character's current state.
- location: concise (1-2 sentences). Derive from scenario and conversation context.
- action: what the character is doing RIGHT NOW at the end of the conversation.
- appearance: complete snapshot of current state. Use baseline if the conversation provides no appearance info.
- clothing: a concise, salience-based summary of what the character is visibly wearing RIGHT NOW. It MUST be a single short sentence of plain prose, **200 characters or fewer**, describing only what is visually prominent (an outer layer may hide what is under it — summarise the look, do not rattle off every piece, and drop per-item trivia and style commentary). No markdown, no bullet lists, no parentheticals, no quoted item names. ALWAYS provide a string; NEVER use null. If the character has undressed or is naked, say so plainly (e.g. "nude", "naked", "wearing only underwear"). Only lean on the baseline clothing when the conversation has not described any clothing change. Use "unknown" only when neither the conversation nor the baseline gives any clothing information. Include the character's current hairstyle in this summary ONLY when one is actually set (e.g. "hair in a tight braid"). If no hairstyle is set, say NOTHING about hair at all — do not write "no hairstyle", "hair down", "unstyled", or anything implying the character lacks hair; their natural hair is already covered by their physical description.
- Be concise and accurate. Output ONLY the JSON object.`

/**
 * Scene state tracking prompt for subsequent turns
 * Updates the scene state based on new messages
 */
const SCENE_STATE_UPDATE_PROMPT = `You are a scene state tracker for a roleplay chat. Given the previous scene state and new messages, produce an updated scene state.

Output ONLY valid JSON with this exact schema:
{
  "location": "where the scene takes place right now",
  "characters": [
    {
      "characterId": "the character's ID",
      "characterName": "the character's name",
      "action": "what the character is doing right now",
      "appearance": "what the character currently looks like",
      "clothing": "describe current clothing state — see rules below"
    }
  ]
}

CRITICAL RULES — read carefully:
- The NEW MESSAGES are the primary authority. They override the previous state.
- If new messages describe a character changing clothes, undressing, or altering appearance, UPDATE those fields.
- If a character is described as nude/naked or removes clothing, reflect that accurately — do not revert to previous clothing.
- Every field is a COMPLETE snapshot, not a diff.
- If nothing changed for a field, carry it forward from the previous state.
- Update location if the scene has moved.
- Update action to reflect what each character is doing NOW at the end of the new messages.
- clothing: a concise, salience-based summary of what the character is visibly wearing RIGHT NOW. It MUST be a single short sentence of plain prose, **200 characters or fewer**, describing only what is visually prominent (an outer layer may hide what is under it — summarise the look, do not rattle off every piece, and drop per-item trivia and style commentary). No markdown, no bullet lists, no parentheticals, no quoted item names. ALWAYS provide a string; NEVER use null. If a character has undressed or is naked, say so plainly (e.g. "nude", "naked", "wearing only underwear"). If the previous state had clothing as null or missing, check the character baselines and new messages to determine the current clothing state. Include the character's current hairstyle in this summary ONLY when one is actually set (e.g. "hair in a tight braid"). If no hairstyle is set, say NOTHING about hair at all — do not write "no hairstyle", "hair down", "unstyled", or anything implying the character lacks hair; their natural hair is already covered by their physical description.
- Character baselines are provided for reference — use them to fill in null or missing fields from the previous state, but the new messages always take priority.
- Be concise and accurate. Output ONLY the JSON object.`

/**
 * Story background prompt crafting system prompt — shared opening.
 *
 * The intimacy guidance that follows it is NOT fixed: it swaps depending on
 * whether the crafted prompt is bound for a moderated image provider or for a
 * Concierge uncensored one. Assembled by `buildStoryBackgroundPrompt`.
 */
const STORY_BACKGROUND_PROMPT_HEAD = `You are a skilled visual artist and prompt engineer specializing in atmospheric landscape scenes for story backgrounds.

You will receive:
- A scene context (typically a chat title or summary describing the story)
- A list of characters with their brief physical descriptions
- The target image generation provider

Your task is to create a SINGLE image generation prompt that:
1. Depicts a scene suitable as a background
2. Captures the mood and setting implied by the scene context
3. Places characters as figures in the scene
4. Uses cinematic composition with the characters positioned naturally in the scene, usually conversing

CRITICAL GUIDELINES:
- This is for a BACKGROUND image, not a portrait - the scene/environment is primary
- Characters should be toward the left and right of the frame, not centered
- If a character description begins with a gender term like "A man" or "A woman", always include that term when describing the character in the prompt
- Characters should be described briefly, focusing on visual traits (hair color, clothing style, notable features)
- Focus on atmospheric qualities: lighting, weather, time of day, mood
- Include environmental details: location type, architectural elements, nature
- Avoid cluttered compositions - keep it visually calm for use as a background
- Write in a flowing, descriptive style suitable for image generation`

/**
 * Intimacy guidance for a MODERATED image provider (the default). Teaches the
 * crafter to translate narrative nudity into cinematic concealment rather than
 * either rendering explicit anatomy (which the provider rejects) or sanitizing
 * the scene into a different one.
 */
const STORY_BACKGROUND_CONCEALED_INTIMACY = `DEPICTING INTIMATE OR UNCLOTHED STATES:
When the scene context or a character description implies someone is undressed, partially clothed, or in an intimate state, do NOT render explicit nudity. Instead, use cinematic concealment to preserve the narrative truth while keeping the image renderable. The figure is still nude in the story — the camera is just polite about it. Choose whichever technique fits the scene most naturally, and you may combine them:
- Drapery: a sheet, blanket, towel, or robe carelessly arranged, falling just where it needs to fall; a quilt pulled up to the collarbone; a towel knotted at the chest
- Composition & framing: crop from the shoulders up, shoot from behind, use a side silhouette, or frame so the figure is partly off-canvas
- Foreground occlusion: furniture, a bedpost, hanging plants, a doorframe, billowing curtains, steam, mist, smoke, snowfall
- Lighting: backlighting to reduce the figure to silhouette; low-key candlelight or firelight casting shadow across the body; dim ambient light with only selective highlights
- Pose: limbs drawn up, body turned away, side profile, knees folded, hair falling forward over the shoulders
- Environment: water (bath, pool, sea, hot spring) at a discreet level; tall grass; deep snow; a steamed-over mirror
- Implied context: tousled bedding, discarded clothing on the floor, a robe thrown over a chair — let the surroundings tell the story while the figure itself is shown with tasteful concealment

The intent of the scene MUST come through. Use evocative mood language — "intimate", "tender", "vulnerable", "private moment", "morning after", "candlelit", "bare-shouldered", "barefoot", "freshly bathed" — to preserve the meaning. Do NOT erase the narrative by substituting fully-clothed alternatives ("wearing pajamas", "in casual clothes"); that destroys the scene. The reader of the final image should understand exactly what is happening; only the explicit anatomy is held back.`

/**
 * Intimacy guidance for a Concierge UNCENSORED image provider. The concealment
 * techniques above exist to get a prompt past moderation the target provider
 * does not apply, so drop them: depict the scene as the narrative actually has
 * it. This is still a background image, so the framing rules stay in force.
 */
const STORY_BACKGROUND_CANDID_INTIMACY = `DEPICTING INTIMATE OR UNCLOTHED STATES:
The target image provider accepts adult content, so depict the scene as the narrative actually has it. When the scene context or a character description implies someone is undressed, partially clothed, or in an intimate state, say so plainly — "nude", "naked", "bare", "undressed" — and describe pose, skin, and light honestly.

Do NOT reach for coy substitutes you were not asked for: no sheet draped precisely where it is needed, no steam or convenient furniture parked over a body, no silhouette-only framing, unless the scene itself genuinely calls for them. Equally, do NOT erase the narrative by re-dressing a character the story undressed ("wearing pajamas", "in casual clothes"); that destroys the scene.

The BACKGROUND framing rules still apply in full: figures toward the left and right of the frame, the environment primary, the composition visually calm. Nudity is a plain fact of the scene, not its subject — this is a wide atmospheric shot, never an anatomical close-up.`

/**
 * Aesthetic handling and the framing examples, shared by both variants.
 */
const STORY_BACKGROUND_PROMPT_TAIL = `AESTHETIC & DEPICTION GUIDELINES:
- You may receive an overall image aesthetic and/or a character depiction aesthetic. Apply these as the consistent visual style (medium, era, palette, rendering) across the whole scene and its figures.
- You may also receive per-character depiction guidelines. These are MANDATORY, binding constraints for the named character and OVERRIDE the general aesthetic wherever they conflict. Never omit, soften, or contradict them.

GOOD EXAMPLE OUTPUT:
"A misty forest clearing at twilight. A woman with flowing dark hair in a simple dress stands near a weathered stone bridge at the left of the frame, a man in traveler's clothes paused at the right edge. Soft golden light filters through ancient oaks; fog drifts across the mossy ground; fireflies just beginning to glow. Painterly, calm, atmospheric."

BAD EXAMPLE OUTPUT:
"Close-up of two people talking face-to-face in the center of the frame, the woman's smile filling most of the image, fine detail on her green eyes."`

/** Worked intimate-scene example matching the concealed guidance. */
const STORY_BACKGROUND_CONCEALED_EXAMPLE = `INTIMATE-SCENE EXAMPLE:
SCENE INPUT: "After their first night together, she lies in bed, nude and half-asleep, while he watches her from the window."
GOOD: "A woman half-asleep in a tousled bed, a white sheet draped loosely across her hips and trailing off the mattress, bare shoulders catching the soft dawn light. A man stands silhouetted at the window in a half-buttoned shirt, watching her. Clothing scattered across the floor. Intimate, candlelit-into-morning mood."
BAD (too explicit, will be rejected): "A nude woman naked in bed..."
BAD (sanitized into a different scene): "A woman in pajamas sitting up in bed while a fully-dressed man stands at the window."`

/** Worked intimate-scene example matching the candid guidance. */
const STORY_BACKGROUND_CANDID_EXAMPLE = `INTIMATE-SCENE EXAMPLE:
SCENE INPUT: "After their first night together, she lies in bed, nude and half-asleep, while he watches her from the window."
GOOD: "A bedroom at dawn, wide and quiet. At the left of the frame a woman lies nude on her side in tousled sheets, half-asleep, soft morning light across her bare skin. At the right a man stands at the window in a half-buttoned shirt, watching her. Clothing scattered across the floorboards. Warm, still, morning-after mood."
BAD (needlessly coy — the provider did not ask for this): "A woman with a sheet draped carefully across her hips, only her bare shoulders showing."
BAD (sanitized into a different scene): "A woman in pajamas sitting up in bed while a fully-dressed man stands at the window."`

const STORY_BACKGROUND_PROMPT_CLOSING = `Respond with ONLY the final prompt - no explanations, no markdown formatting, no quotes.`

/**
 * Assembles the story-background crafter's system prompt.
 *
 * @param uncensoredImageTarget - True when the crafted prompt is bound for a
 *   Concierge uncensored image provider, which swaps cinematic concealment for
 *   a candid depiction. Defaults to false: concealment is the default.
 */
function buildStoryBackgroundPrompt(uncensoredImageTarget: boolean): string {
  const intimacy = uncensoredImageTarget
    ? STORY_BACKGROUND_CANDID_INTIMACY
    : STORY_BACKGROUND_CONCEALED_INTIMACY
  const example = uncensoredImageTarget
    ? STORY_BACKGROUND_CANDID_EXAMPLE
    : STORY_BACKGROUND_CONCEALED_EXAMPLE
  return [
    STORY_BACKGROUND_PROMPT_HEAD,
    intimacy,
    STORY_BACKGROUND_PROMPT_TAIL,
    example,
    STORY_BACKGROUND_PROMPT_CLOSING,
  ].join('\n\n')
}

/**
 * Appearance resolution system prompt
 * Analyzes chat context to determine what each character currently looks like
 */
const APPEARANCE_RESOLUTION_PROMPT = `You are analyzing a conversation to determine what each character currently looks like and is wearing.

You will receive:
- Recent conversation messages
- An image prompt that is about to be used for image generation
- For each character: their available physical descriptions (with usage contexts) and the items they currently have equipped in their wardrobe

Your task is to determine for each character:
1. Which physical description best matches the current scene context (by usage context)
2. What the character is currently wearing

CLOTHING PRIORITY (highest to lowest):
1. NARRATIVE: If the conversation explicitly describes what a character changed into or is currently wearing, use the conversation's wording — paraphrased into a single concise visual sentence (not copied verbatim).
2. IMAGE PROMPT: If the image prompt specifies clothing for a character, use that.
3. STORED: Otherwise, summarize the character's equipped wardrobe items into a single concise visual sentence.
4. DEFAULT: If none of the above apply, respond with an empty string.

Respond with a JSON array, one entry per character:
[
  {
    "characterId": "uuid-here",
    "selectedDescriptionId": "uuid-of-best-matching-description-or-null",
    "clothingDescription": "what they are wearing right now",
    "clothingSource": "narrative" | "stored" | "default"
  }
]

IMPORTANT:
- For selectedDescriptionId, pick the description whose usageContext best fits the current scene. Use null to indicate the first/default.
- clothingDescription MUST be a single short sentence of plain prose, **200 characters or fewer**, describing only what is visible (garment + color/material + any standout detail). No markdown, no bullet lists, no parentheticals, no commentary about purpose or feel, no quoted item names.
- clothingSource must be "narrative" if from conversation, "stored" if from equipped wardrobe, "default" if using first/fallback.

JSON only - no other text.`

/**
 * Appearance sanitization system prompt
 * Rewrites explicit/dangerous appearance descriptions into safe alternatives
 */
const APPEARANCE_SANITIZATION_PROMPT = `You are a content safety filter for image generation prompts. You will receive character appearance descriptions that have been flagged as potentially explicit or inappropriate for a standard image generation provider.

Your task is to rewrite ONLY the problematic parts to make them safe for image generation while preserving as much visual detail as possible.

GUIDELINES:
- Replace explicit clothing descriptions with neutral alternatives (e.g., "wearing nothing" → "wearing casual clothes", "lingerie" → "comfortable loungewear")
- Keep hair color, eye color, body type, and other non-explicit physical traits unchanged
- Preserve the character's overall aesthetic and style where possible
- Keep descriptions concise and suitable for image generation
- Do NOT add new details that weren't implied by the original

You will receive a JSON array of objects with characterId and appearanceText.
Respond with the SAME JSON array but with sanitized appearanceText values.

JSON only - no other text.`

/**
 * Generates a description for a file attachment
 * Note: Only works with providers that support vision/multimodal
 *
 * @param attachment - The attachment to describe
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A description of the attachment
 */
export async function describeAttachment(
  attachment: Attachment,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<string>> {
  // Check if we have image data
  if (!attachment.data) {
    return {
      success: false,
      error: 'No attachment data provided',
    }
  }

  // Check if the provider supports vision
  const isImage = attachment.mimeType.startsWith('image/')
  if (isImage) {
    // For images, we need a vision-capable model
    // This is a simplified check - in production you'd verify model capabilities
    const llmMessages: LLMMessage[] = [
      {
        role: 'system',
        content: ATTACHMENT_DESCRIPTION_PROMPT,
      },
      {
        role: 'user',
        content: `Please describe this image: ${attachment.filename}`,
        attachments: [
          {
            id: attachment.id,
            filepath: '',
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.data.length,
            data: attachment.data,
          },
        ],
      },
    ]

    return executeCheapLLMTask(
      selection,
      llmMessages,
      userId,
      (content: string): string => content.trim(),
      'describe-attachment',
      chatId
    )
  }

  // For non-image files, return a basic description
  return {
    success: true,
    result: `File: ${attachment.filename} (${attachment.mimeType})`,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }
}

/**
 * Crafts an image generation prompt by expanding placeholders with descriptions
 *
 * @param expansionContext - Context with original prompt and all description tiers
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns The crafted image prompt
 */
export async function craftImagePrompt(
  expansionContext: ImagePromptExpansionContext,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<string>> {
  // Format placeholder data for the LLM
  const placeholderDetails = expansionContext.placeholders
    .map(p => {
      const genderHint = p.gender === 'male' ? ' [man]' : p.gender === 'female' ? ' [woman]' : '';
      const parts: string[] = [`${p.placeholder} (${p.name}${genderHint}):`];

      if (p.gender) {
        parts.push(`  Gender: ${p.gender === 'male' ? 'man' : 'woman'} — always refer to this person as a ${p.gender === 'male' ? 'man' : 'woman'} in the prompt`);
      }

      if (p.usageContext) {
        parts.push(`  Usage context: ${p.usageContext}`);
      }

      if (p.tiers.complete) {
        parts.push(`  Complete: "${p.tiers.complete}"`);
      }
      if (p.tiers.long) {
        parts.push(`  Long: "${p.tiers.long}"`);
      }
      if (p.tiers.medium) {
        parts.push(`  Medium: "${p.tiers.medium}"`);
      }
      if (p.tiers.short) {
        parts.push(`  Short: "${p.tiers.short}"`);
      }

      // Include clothing/outfit details if available
      if (p.clothing && p.clothing.length > 0) {
        parts.push(`  Clothing/Outfits:`);
        for (const outfit of p.clothing) {
          const contextHint = outfit.usageContext ? ` (when: ${outfit.usageContext})` : '';
          const desc = outfit.description ? `: ${outfit.description}` : '';
          parts.push(`    - "${outfit.name}"${contextHint}${desc}`);
        }
      }

      if (parts.length === 1) {
        // No descriptions available
        parts.push(`  (No descriptions available - use name only)`);
      }

      return parts.join('\n');
    })
    .join('\n\n');

  // Build the style trigger section if provided
  let styleTriggerSection = ''
  if (expansionContext.styleTriggerPhrase) {
    styleTriggerSection = `
Style trigger phrase (MUST include exactly as shown): "${expansionContext.styleTriggerPhrase}"${expansionContext.styleName ? ` (for "${expansionContext.styleName}" style)` : ''}
`
  }

  // Default aesthetics + the Ariel Clause (empty unless any are set).
  const aestheticSection = buildAestheticSection(expansionContext)

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: IMAGE_PROMPT_CRAFTING_PROMPT,
    },
    {
      role: 'user',
      content: `Original prompt: ${expansionContext.originalPrompt}

Available descriptions:
${placeholderDetails}
${styleTriggerSection}${aestheticSection}
Target length: ${expansionContext.targetLength} characters (for ${expansionContext.provider})

Create the final image prompt (maximize detail while staying under the limit):`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      let prompt = content.trim()

      // Remove quotes if the LLM wrapped the response
      prompt = prompt.replace(/^["']|["']$/g, '')

      // Truncate if it exceeds the target length
      if (prompt.length > expansionContext.targetLength) {
        prompt = prompt.substring(0, expansionContext.targetLength - 3) + '...'
      }

      return prompt
    },
    'craft-image-prompt',
    chatId,
    undefined,
    undefined,
    4000
  )
}

/**
 * Derives a rich scene context from chat history for story background generation
 *
 * This function analyzes the conversation to understand what characters are doing
 * or discussing, and creates an imaginative scene description that captures the
 * mood and setting implied by the conversation.
 *
 * @param input - Context including chat title, messages, and character names
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns A scene description suitable for image prompt generation
 */
export async function deriveSceneContext(
  input: DeriveSceneContextInput,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<string>> {
  // Format recent messages for the prompt
  const messageText = input.recentMessages
    .map(m => {
      const speaker = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Character' : 'System'
      // Truncate long messages to keep context manageable
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content
      return `${speaker}: ${content}`
    })
    .join('\n\n')

  // Build the context section
  let contextInfo = `Chat Title: "${input.chatTitle}"`
  if (input.contextSummary) {
    contextInfo += `\n\nExisting Summary:\n${input.contextSummary}`
  }
  if (input.characterNames.length > 0) {
    contextInfo += `\n\nCharacters present: ${input.characterNames.join(', ')}`
  }

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: SCENE_CONTEXT_DERIVATION_PROMPT,
    },
    {
      role: 'user',
      content: `${contextInfo}

Recent Conversation:
${messageText}

Based on this conversation, describe the scene these characters might be in:`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      let result = content.trim()

      // Remove quotes if the LLM wrapped the response
      result = result.replace(/^["']|["']$/g, '')

      // Remove any markdown formatting
      result = result.replace(/^```[a-z]*\s*/g, '').replace(/\s*```$/g, '')

      return result
    },
    'derive-scene-context',
    chatId
  )
}

/**
 * Updates scene state based on conversation messages
 *
 * Tracks the current state of a scene including location, character actions,
 * appearance, and clothing. On the first turn, establishes the initial state.
 * On subsequent turns, updates based on new messages.
 *
 * @param input - Scene state input including messages, character data, and previous state
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param chatId - Optional chat ID for logging
 * @returns Updated scene state as structured JSON
 */
export async function updateSceneState(
  input: SceneStateInput,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  uncensoredFallback?: UncensoredFallbackOptions
): Promise<CheapLLMTaskResult<Record<string, unknown>>> {
  // Format recent messages for the prompt — no truncation for scene state tracking,
  // because clothing/appearance details often appear deep in longer messages
  const messageText = input.recentMessages
    .map(m => {
      const speaker = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Character' : 'System'
      return `${speaker}: ${m.content}`
    })
    .join('\n\n')

  // Build character baseline section
  const characterBaselines = input.characters
    .map(char => {
      return `${char.characterName} (ID: ${char.characterId}):
  - Appearance: ${char.physicalDescription}
  - Clothing: ${char.clothingDescription}${char.scenario ? `\n  - Scenario context: ${char.scenario}` : ''}`
    })
    .join('\n\n')

  let llmMessages: LLMMessage[]

  // Build optional scenario section
  const scenarioSection = input.chatScenario
    ? `\nScenario / Opening Setup:\n${input.chatScenario}\n`
    : ''

  if (input.previousSceneState === null) {
    // First turn: establish initial scene state
    llmMessages = [
      {
        role: 'system',
        content: SCENE_STATE_FIRST_TURN_PROMPT,
      },
      {
        role: 'user',
        content: `Character Baselines (defaults only — the conversation and scenario override these):
${characterBaselines}
${scenarioSection}
Conversation (the primary source of truth):
${messageText}

Based on the scenario and conversation above, what is the current scene state?`,
      },
    ]
  } else {
    // Subsequent turns: update scene state with new messages + baselines for recovery
    llmMessages = [
      {
        role: 'system',
        content: SCENE_STATE_UPDATE_PROMPT,
      },
      {
        role: 'user',
        content: `Character Baselines (defaults only — use these to fill in gaps where the previous state has null or missing fields):
${characterBaselines}

Previous Scene State:
${JSON.stringify(input.previousSceneState, null, 2)}

New Messages (the primary source of truth — these override previous state where applicable):
${messageText}

Update the scene state based on these new messages:`,
      },
    ]
  }

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): Record<string, unknown> => {
      const rawContent = content.trim()

      // Empty or near-empty response = content refusal
      if (!rawContent || rawContent.length < 10) {
        logger.warn('[SceneStateTracking] Empty or near-empty LLM response, likely content refusal', {
          contentLength: rawContent.length,
          content: rawContent.substring(0, 100),
        })
        throw new Error('Empty LLM response (likely content refusal)')
      }

      const cleanContent = stripCodeFences(content)
      const parsed = JSON.parse(cleanContent)

      // Validate the parsed result has meaningful content
      if (!parsed.location || parsed.location === 'Unknown' || parsed.location === 'unknown') {
        logger.warn('[SceneStateTracking] LLM returned unknown location, likely content refusal', {
          location: parsed.location,
          characterCount: parsed.characters?.length,
        })
      }

      // Defensively cap each character's clothing summary to the ≤200-char
      // budget the prompt requests, so a verbose model can't bloat the whisper.
      if (Array.isArray(parsed.characters)) {
        for (const ch of parsed.characters) {
          if (ch && typeof ch === 'object' && 'clothing' in ch) {
            ;(ch as { clothing?: unknown }).clothing = capClothingSummary(
              (ch as { clothing?: unknown }).clothing,
            )
          }
        }
      }

      return parsed
    },
    'scene-state-tracking',
    chatId,
    undefined,
    uncensoredFallback,
    4000
  )
}

/**
 * Crafts a story background image prompt using the cheap LLM
 *
 * @param context - Context with scene and character information
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns The crafted background prompt
 */
export async function craftStoryBackgroundPrompt(
  context: StoryBackgroundPromptContext,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<string>> {
  // Build character descriptions section
  const characterSection = context.characters.length > 0
    ? `\nCharacters to include as figures in the scene:\n${context.characters.map(c => `- ${c.name}: ${c.description}`).join('\n')}`
    : '\nNo specific characters to include - create an atmospheric scene matching the context.'

  // Provider-specific length guidance
  let lengthGuidance = 'Keep the prompt under 1200 characters.'
  if (context.provider === 'GROK') {
    lengthGuidance = 'Keep the prompt under 1000 characters for Grok image generation.'
  }

  // Default aesthetics + the Ariel Clause (empty unless any are set).
  const aestheticSection = buildAestheticSection(context)

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: buildStoryBackgroundPrompt(context.uncensoredImageTarget === true),
    },
    {
      role: 'user',
      content: `Scene context: ${context.sceneContext}
${characterSection}
${aestheticSection}
Provider: ${context.provider}
${lengthGuidance}

Create the atmospheric background prompt:`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    llmMessages,
    userId,
    (content: string): string => {
      let prompt = content.trim()

      // Remove quotes if the LLM wrapped the response
      prompt = prompt.replace(/^["']|["']$/g, '')

      // Remove any markdown formatting
      prompt = prompt.replace(/^```[a-z]*\s*/g, '').replace(/\s*```$/g, '')

      return prompt
    },
    'craft-story-background-prompt',
    chatId,
    undefined,
    undefined,
    4000
  )
}

/**
 * Resolves character appearances based on chat context using a cheap LLM
 *
 * @param characters - Characters with their available descriptions and clothing
 * @param recentMessages - Recent chat messages for context
 * @param imagePrompt - The image prompt being generated
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param chatId - Optional chat ID for logging
 * @returns Array of resolved appearance items
 */
export async function resolveAppearance(
  characters: CharacterAppearanceInput[],
  recentMessages: ChatMessage[],
  imagePrompt: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<AppearanceResolutionItem[]>> {
  // Build character data section
  const characterSection = characters.map(char => {
    const descParts = char.physicalDescriptions.map(d => {
      const context = d.usageContext ? ` (context: ${d.usageContext})` : ''
      const preview = d.mediumPrompt || d.shortPrompt || '(no description text)'
      return `    - ID: ${d.id}, Name: "${d.name}"${context}: ${preview}`
    })

    // Build equipped wardrobe items section using canonical describeOutfit.
    // Multiple entries per slot represent layering; we feed describeOutfit
    // the per-slot title arrays in the order callers supplied them. Titles
    // only — the prose `description` field is for human readers and would
    // otherwise be echoed verbatim into the image prompt.
    let wardrobeSection = ''
    if (char.equippedWardrobeItems && char.equippedWardrobeItems.length > 0) {
      const outfitDescription = describeOutfit(
        buildOutfitSlotValues((slot) =>
          char.equippedWardrobeItems!
            .filter(i => i.slot === slot)
            .map(i => (i.imagePrompt?.trim() ? i.imagePrompt.trim() : i.title)),
        ),
      )
      wardrobeSection = `\n  Equipped Wardrobe (stored items the character currently has on — summarize as a brief visual sentence):\n${outfitDescription}`
    }

    return `  Character: ${char.characterName} (ID: ${char.characterId})
  Physical Descriptions:
${descParts.length > 0 ? descParts.join('\n') : '    (none)'}${wardrobeSection}`
  }).join('\n\n')

  // Format recent messages
  const messageText = recentMessages
    .slice(-20)
    .map(m => {
      const speaker = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Character' : 'System'
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content
      return `${speaker}: ${content}`
    })
    .join('\n\n')

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: APPEARANCE_RESOLUTION_PROMPT,
    },
    {
      role: 'user',
      content: `Image prompt: ${imagePrompt}

Characters:
${characterSection}

Recent Conversation:
${messageText || '(no messages yet)'}

Determine what each character currently looks like and is wearing:`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): AppearanceResolutionItem[] => {
      try {
        const cleanContent = stripCodeFences(content)
        const parsed = JSON.parse(cleanContent)
        if (!Array.isArray(parsed)) {
          return []
        }

        return parsed.map((item: Record<string, unknown>) => ({
          characterId: String(item.characterId || ''),
          selectedDescriptionId: item.selectedDescriptionId ? String(item.selectedDescriptionId) : null,
          clothingDescription: String(item.clothingDescription || ''),
          clothingSource: (['narrative', 'stored', 'default'].includes(String(item.clothingSource))
            ? String(item.clothingSource)
            : 'default') as 'narrative' | 'stored' | 'default',
        }))
      } catch {
        return []
      }
    },
    'resolve-character-appearances',
    chatId
  )
}

/**
 * Sanitizes appearance descriptions that contain dangerous content
 *
 * @param appearances - Array of character appearances to sanitize
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param chatId - Optional chat ID for logging
 * @returns Array of sanitized appearance texts keyed by characterId
 */
export async function sanitizeAppearance(
  appearances: Array<{ characterId: string; appearanceText: string }>,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<Array<{ characterId: string; appearanceText: string }>>> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: APPEARANCE_SANITIZATION_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify(appearances),
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): Array<{ characterId: string; appearanceText: string }> => {
      try {
        const cleanContent = stripCodeFences(content)
        const parsed = JSON.parse(cleanContent)
        if (!Array.isArray(parsed)) {
          return appearances // Return originals if parsing fails
        }

        return parsed.map((item: Record<string, unknown>) => ({
          characterId: String(item.characterId || ''),
          appearanceText: String(item.appearanceText || ''),
        }))
      } catch {
        return appearances // Return originals on error
      }
    },
    'sanitize-appearance',
    chatId
  )
}
