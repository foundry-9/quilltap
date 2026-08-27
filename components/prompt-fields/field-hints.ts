/**
 * Prompt-field hint strings — the single source for the label, helper, and
 * worked-example copy shown above every prompt-bearing field in the UI.
 *
 * This is the CLIENT mirror of `lib/services/character-field-semantics.ts`
 * (the server-side single source for AI generation systems). Keep the two
 * aligned: when a field's vantage point or voice guidance changes there,
 * change it here in the same pass, and vice versa.
 *
 * The `example` lines model the correct form of address for each field
 * without ever naming grammatical person — models and people alike copy the
 * shape of an example more reliably than they follow terminology. Fields
 * whose referent is the speaking character are exampled in second person
 * ("You keep your worry behind your teeth"); fields read only by others are
 * exampled from outside ("Ariadne is a research librarian…"); physical
 * descriptions stay noun phrases because they also feed the image pipelines.
 * See docs/developer/features/complete/prompt-person-consistency.md §5.
 *
 * Voice: labels and helpers stay in the house register; examples stay plain —
 * their job is to model a sentence shape, and ornament would defeat that.
 */

export interface PromptFieldHint {
  /** The `qt-label` line. */
  label: string
  /** The `text-xs qt-text-secondary` helper paragraph (house voice). */
  helper: string
  /**
   * A worked example in the field's correct form of address (plain voice).
   * Omitted where the field's format already constrains the shape
   * (example dialogues) or no example is useful.
   */
  example?: string
}

export const PROMPT_FIELD_HINTS = {
  identity: {
    label: 'Identity',
    helper:
      'What strangers know about the character on sight or by reputation — name, station, occupation, public reputation. The shallow first impression, and read only by others.',
    example:
      'Ariadne is a research librarian at the Athenaeum, known for finding what others gave up on.',
  },
  description: {
    label: 'Description',
    helper:
      'How acquaintances perceive the character — behaviour, mannerisms, frequent verbal patterns. Not physical appearance (that lives in physical descriptions), and never the inner monologue.',
    example: 'She finishes other people’s sentences, then apologises for it.',
  },
  manifesto: {
    label: 'Manifesto',
    helper:
      'The foundational tenets of this character — the basic truths that anchor everything else, delivered to the character alone. What this character is, at root.',
    example: 'You do not lie to Charlie, not even kindly.',
  },
  personality: {
    label: 'Personality',
    helper:
      'What the character knows about themselves — the inner drivers of speech and behaviour. Other characters don’t see it unless the character shows them.',
    example:
      'You keep your worry behind your teeth. You have never once asked for help first.',
  },
  scenario: {
    label: 'Scenario',
    helper:
      'The setting and circumstances for conversations — the stage, never the actor.',
    example: 'The reading room is empty at this hour, rain against the high windows.',
  },
  firstMessage: {
    label: 'First Message',
    helper: 'The character’s opening message to start conversations, in their own voice.',
  },
  exampleDialogues: {
    label: 'Example Dialogues',
    helper:
      'Example conversations that model the character’s voice, as {{char}}: / {{user}}: exchanges — each line exactly as that speaker would say it.',
  },
  systemPrompt: {
    label: 'System Prompt',
    helper:
      'Stage direction for the model playing the character — voice, pacing, boundaries, interaction style — addressed to the character directly.',
    example: 'You are Ariadne. You answer plainly and you never flatter.',
  },
  physicalDescription: {
    label: 'Physical Description',
    helper:
      'Descriptive phrases only — this text also drives image generation, so keep to what a lens would record, never a sentence addressed to anyone.',
    example: 'auburn hair cut short; grey eyes; a scar across the left knuckle',
  },
  projectInstructions: {
    label: 'Project Instructions',
    helper:
      'Standing instructions folded into the prompt of every character working in this project, addressed to the character they reach.',
    example: 'You are helping Charlie draft sermon material; cite chapter and verse.',
  },
  groupInstructions: {
    label: 'Group Instructions',
    helper:
      'Standing instructions folded into the prompt of every member of this group, addressed to the character they reach.',
    example:
      'You have known the others here for years; you do not explain yourselves to each other.',
  },
  wardrobeInstructions: {
    label: 'Dressing Instructions',
    helper:
      'Standing guidance for a character choosing their own opening outfit, addressed to the character in the second person. Consulted only when a chat begins with “Let character choose” — the nearest copy wins (a character’s own over their group’s, a group’s over the project’s, the project’s over Quilltap General) and the search stops there.',
    example:
      'You prefer practical tweeds for fieldwork, and reserve the brass-buttoned frock coat for occasions with an audience.',
  },
  roleplayTemplatePrompt: {
    label: 'LLM Prompt',
    helper:
      'Formatting instructions delivered with every character’s prompt in chats using this template.',
    example: 'Wrap narration in asterisks; keep replies to three paragraphs or fewer.',
  },
} satisfies Record<string, PromptFieldHint>

export type PromptFieldHintKey = keyof typeof PROMPT_FIELD_HINTS

/**
 * Character-record field key → `PROMPT_FIELD_HINTS` entry, for surfaces that
 * look hints up by the field names character data actually uses (the AI
 * Wizard's field checkboxes and review pane, the optimizer's suggestion
 * cards). Includes the `systemPrompts` alias the optimizer emits for
 * system-prompt collections. Fields absent here (name, title, properties,
 * wardrobeItems, talkativeness, aliases) have no prompt-voice hint.
 */
export const FIELD_HINT_KEYS: Partial<Record<string, PromptFieldHintKey>> = {
  identity: 'identity',
  description: 'description',
  manifesto: 'manifesto',
  personality: 'personality',
  scenarios: 'scenario',
  exampleDialogues: 'exampleDialogues',
  firstMessage: 'firstMessage',
  systemPrompt: 'systemPrompt',
  systemPrompts: 'systemPrompt',
  physicalDescription: 'physicalDescription',
}
