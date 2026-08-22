/**
 * System Prompt Builder
 *
 * Builds system prompts for characters in both single-character
 * and multi-character chat scenarios.
 */

import type { Character, ChatParticipantBase, TimestampConfig } from '@/lib/schemas/types'
import { type ParticipantStatus } from '@/lib/schemas/types'
import { calculateCurrentTimestamp, shouldInjectTimestamp } from '@/lib/chat/timestamp-utils'
import { processTemplate, type TemplateContext } from '@/lib/templates/processor'

/**
 * Universal formatting note appended to every character's system prompt,
 * independent of the selected roleplay template. Salon messages render as
 * Markdown with KaTeX math (see `lib/markdown/math.ts`), and the renderer only
 * recognizes double-dollar `$$...$$` (both inline and block) — single-dollar
 * `$x$` is deliberately disabled so ordinary prose like "$50 ... $20" isn't
 * swallowed as math. Without this note, models default to single-`$`/`\(...\)`
 * habits and their formulas render as literal text.
 */
const MATH_FORMATTING_INSTRUCTION = `[FORMATTING: MATHEMATICAL NOTATION]
Responses render as Markdown with KaTeX math support. To display a formula, wrap the LaTeX in DOUBLE dollar signs — $$...$$ — which renders correctly both inline within a sentence and as its own centered block. Do NOT use single dollar signs ($x$), single quotes, or backticks for math; only $$...$$ is recognized.
- Inline example: The area of a circle is $$A = \\pi r^2$$ for radius r.
- Block example:
$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$`

/**
 * Preamble of the Taboo section — the instance-wide list of phrases no
 * character may utter (Settings → Chat → Taboo,
 * `instance_settings['taboo']`).
 *
 * DO NOT "simplify" this into a bare list of banned strings. Every clause is
 * load-bearing against a known failure mode:
 *
 *  - *"worn-out clichés, beneath you"* — printing the forbidden tokens into
 *    every context raises their salience (the pink-elephant effect), and
 *    weaker models parrot what they have just read. An aversive frame beats a
 *    neutral mention.
 *  - *"say what you actually mean in plain, specific words"* — prohibition
 *    alone leaves a vacuum the model refills with the banned phrase's nearest
 *    neighbour. Pairing the ban with a positive instruction outperforms it.
 *  - *"not as inflections, rewordings, or near-variants"* — banning the exact
 *    string invites trivial dodges ("load-bearing" for "weight-bearing"). The
 *    blanket preamble generalizes each entry so the settings UI can keep
 *    asking users for bare phrases rather than hand-written variant lists.
 *  - *"Never mention, quote, or allude to this list"* — without it, characters
 *    start joking about the phrases they are not allowed to say.
 *
 * Voice follows the universal-section precedent set by
 * {@link MATH_FORMATTING_INSTRUCTION}: bracketed all-caps tag, imperative,
 * addressed to the speaking character.
 */
const TABOO_SECTION_PREAMBLE = `[STYLE: FORBIDDEN PHRASES]
The phrases below are worn-out clichés, beneath you. They never appear in anything you say — not verbatim, and not as inflections, rewordings, or near-variants of the same formula. When one of them would be the easy thing to reach for, say what you actually mean in plain, specific words instead. Never mention, quote, or allude to this list.`

/**
 * Render the Taboo section, or `null` when there is nothing to forbid.
 *
 * An empty list yields no section at all — no header, no blank block — so an
 * instance that never touches the feature produces a byte-identical prompt to
 * one built before the feature existed.
 *
 * Phrases are emitted verbatim in stored order and deliberately NOT run
 * through `processTemplate`: a user phrase may legitimately contain `{{...}}`
 * and must reach the model literally. (The math note sets the same
 * template-free precedent.)
 */
export function renderTabooSection(phrases: string[] | undefined | null): string | null {
  if (!phrases || phrases.length === 0) return null
  const bullets: string[] = []
  for (const phrase of phrases) {
    const trimmed = typeof phrase === 'string' ? phrase.trim() : ''
    if (!trimmed) continue
    bullets.push(`- "${trimmed}"`)
  }
  if (bullets.length === 0) return null
  return `${TABOO_SECTION_PREAMBLE}\n${bullets.join('\n')}`
}

/**
 * Other participant info for multi-character system prompts.
 *
 * Phase C moved the multi-character roster out of the system prompt and into
 * Host whispers in the transcript, but this type is still consumed by the
 * orchestrator → context-builder pipeline for non-prompt purposes (mentioned-
 * characters scan, identity reinforcement names) so it stays exported.
 */
export interface OtherParticipantInfo {
  name: string
  aliases?: string[]
  pronouns?: { subject: string; object: string; possessive: string }
  description?: string
  type: 'CHARACTER'
  /** Current participation status */
  status?: 'active' | 'silent' | 'absent' | 'removed'
}

/**
 * Inputs that uniquely determine a character's static identity stack within a
 * given chat. The stack is the bulk of the per-turn system prompt — identity
 * preamble, base prompt, personality, aliases, pronouns, physical appearance,
 * example dialogues — with `{{user}}` / `{{scenario}}` / `{{persona}}`
 * resolved at compile time.
 *
 * Phase H caches the result of `buildIdentityStack` on
 * `chats.compiledIdentityStacks` keyed by participantId, so the per-turn
 * `buildSystemPrompt` can skip the rebuild work and the LLM provider sees a
 * stable cache-friendly prefix.
 */
export interface BuildIdentityStackOptions {
  character: Character
  userCharacter?: { name: string; description: string } | null
  selectedSystemPromptId?: string | null
  scenarioText?: string | null
}

/**
 * Version of `buildIdentityStack`'s OUTPUT — the wording and layout of the
 * blocks it emits. The system-prompt compiler
 * (`lib/services/system-prompt-compiler/compiler.ts`) stamps this into
 * `chats.compiledIdentityStacks` on write and requires strict equality on
 * read: a stored stack with an absent, older, or newer stamp is treated as
 * missing, so the read-through fallback rebuilds it with the current wording.
 * (Newer matters on a downgrade — a rolled-back build must not consume stacks
 * a later build wrote.) Rows written before the stamp existed are bare
 * participantId→stack maps with no `version` key; they read as stale
 * (effectively version 0) and rebuild lazily. No migration needed.
 *
 * Bump this whenever an edit to `buildIdentityStack` changes its output for
 * unchanged inputs — wording, ordering, blocks added or removed. Forgetting is
 * not an option: `__tests__/unit/cache-determinism/system-prompt.test.ts`
 * binds this constant to a golden hash of the function's output
 * (`IDENTITY_STACK_GOLDENS`), so editing without bumping fails on the hash
 * and bumping without registering a new golden fails on the lookup.
 *
 * Distinct from `PROMPT_CACHE_STRUCTURE_VERSION` (`lib/llm/cache-key.ts`),
 * which versions the whole prompt shape for PROVIDER caches. This constant
 * versions one function's output for OUR compiled-stack cache; colocation
 * with the function is deliberate so whoever edits the strings sees it.
 */
export const IDENTITY_STACK_BUILDER_VERSION = 2

/**
 * Build just the static character-identity portion of the system prompt,
 * with chat-level template variables resolved. The result is suitable for
 * caching across turns within a chat.
 */
export function buildIdentityStack(options: BuildIdentityStackOptions): string {
  const { character, userCharacter, selectedSystemPromptId, scenarioText } = options
  const parts: string[] = []

  const templateContext: TemplateContext = {
    char: character.name,
    user: userCharacter?.name || 'User',
    description: character.description || '',
    personality: character.personality || '',
    scenario: scenarioText || character.scenarios?.[0]?.content || '',
    persona: userCharacter?.description || '',
  }

  // Identity preamble — anchors the LLM's identity from the very first tokens.
  parts.push(processTemplate(
    '## Character Identity\nYou are {{char}}. Everything that follows defines who you are and how you behave. Stay in character at all times.',
    templateContext
  ))

  // Base system prompt — selected > default > nothing.
  let systemPromptContent: string | null = null
  if (selectedSystemPromptId && character.systemPrompts) {
    const selectedPrompt = character.systemPrompts.find(p => p.id === selectedSystemPromptId)
    if (selectedPrompt) {
      systemPromptContent = selectedPrompt.content
    }
  }
  if (!systemPromptContent && character.systemPrompts) {
    const defaultPrompt = character.systemPrompts.find(p => p.isDefault)
    if (defaultPrompt) {
      systemPromptContent = defaultPrompt.content
    }
  }
  if (systemPromptContent) {
    parts.push(processTemplate(systemPromptContent, templateContext))
  }

  // WHY the wrappers and second person throughout: the preamble above binds
  // the model's identity slot with "You are {{char}}", so every block whose
  // referent is the speaking character stays in the same register — a
  // third-person sentence in this position reads as lore about someone else.
  // Author-carried fields (manifesto, personality, example dialogues) get a
  // referent-fixing wrapper instead of policing the author's own person: a
  // body written as "Friday is warm" under "what you know about yourself"
  // still lands in the right place. Outward-facing consumers
  // (buildPublicIdentityCard, buildOtherParticipantsInfo, Host whispers)
  // stay third person — their referent is someone other than the reader.
  // See docs/developer/features/complete/prompt-person-consistency.md.
  if (character.manifesto) {
    parts.push(`\n## Character Manifesto\nThe following you hold as true about yourself, without question.\n${processTemplate(character.manifesto, templateContext)}`)
  }

  if (character.personality) {
    parts.push(`\n## Character Personality\nThe following is what you know about yourself. Others do not see it unless you show them.\n${processTemplate(character.personality, templateContext)}`)
  }

  if (character.aliases && character.aliases.length > 0) {
    parts.push(`\n## Character Aliases\nYou also go by: ${character.aliases.join(', ')}. Others may address you by any of these names.`)
  }

  // The "refer to yourself in narration" clause is what justifies this block:
  // characters routinely narrate their own actions in third person ("Ariadne
  // reaches for the folder"), and this is what makes that narration use the
  // right pronouns.
  if (character.pronouns) {
    parts.push(`\n## Character Pronouns\nYour pronouns are ${character.pronouns.subject}/${character.pronouns.object}/${character.pronouns.possessive}. Use them whenever you refer to yourself in narration, and expect others to use them for you.`)
  }

  // Second-person WRAPPER only — the body stays third-person noun phrases,
  // because the stored physicalDescription text is shared with the image
  // pipelines (avatar prompts, appearance resolution, story backgrounds),
  // and diffusion models take noun phrases, not "you have auburn hair".
  if (character.physicalDescription) {
    const desc = character.physicalDescription
    const contextNote = desc.usageContext ? ` (best used: ${desc.usageContext})` : ''
    const descText = desc.shortPrompt || desc.mediumPrompt || desc.longPrompt
      || desc.completePrompt || desc.fullDescription || ''
    if (descText) {
      parts.push(`\n## Physical Appearance\nThis is how you look — "${desc.name}"${contextNote}: ${descText}`)
    }
  }

  if (character.exampleDialogues) {
    parts.push(`\n## Example Dialogue Style\nThis is how you speak.\n${processTemplate(character.exampleDialogues, templateContext)}`)
  }

  return parts.join('\n\n').trim()
}

/**
 * Standard placeholder shown in place of a character's surface `identity` when
 * none is recorded — so another character is never handed a bare name with no
 * context. Mirrors the off-scene roster's instinct to always say *something*.
 */
export const NO_PUBLIC_IDENTITY_FALLBACK =
  '(no public identity on record — known to others only by the name above)'

/**
 * Build a compact, SURFACE-LEVEL identity card for `character`: the public view
 * one character would have of another who has just addressed them — name, title,
 * pronouns, aliases, and the `identity` field (the project's "what strangers
 * know" vantage point), falling back to `description` (the acquaintance view) and
 * then {@link NO_PUBLIC_IDENTITY_FALLBACK} when neither is set.
 *
 * Deliberately omits `personality` and `manifesto` — the character's PRIVATE
 * vantage points — so surfacing the card to a third party never leaks what others
 * are not meant to see. `{{char}}` resolves to this character; `{{user}}` to
 * `userName` (their own name when they are the user-controlled persona, else the
 * generic "User").
 */
export function buildPublicIdentityCard(character: Character, userName?: string | null): string {
  const templateContext: TemplateContext = { char: character.name, user: userName || 'User' }
  const render = (value: string) => processTemplate(value, templateContext).trim()

  const lines: string[] = [`**${character.name}**`]
  if (character.title) {
    const title = render(character.title)
    if (title) lines.push(`Title: ${title}`)
  }
  if (character.pronouns) {
    lines.push(
      `Pronouns: ${character.pronouns.subject}/${character.pronouns.object}/${character.pronouns.possessive}`,
    )
  }
  if (character.aliases && character.aliases.length > 0) {
    lines.push(`Also known as: ${character.aliases.join(', ')}`)
  }
  const body = render(character.identity?.trim() || character.description?.trim() || '')
  lines.push(body || NO_PUBLIC_IDENTITY_FALLBACK)
  return lines.join('\n')
}

/**
 * Build the system prompt for a character.
 *
 * After the Phase A–G refactor, the per-turn system prompt only carries the
 * character's identity stack (preamble, base prompt, personality, aliases,
 * pronouns, physical appearance, example dialogue) plus the chat-level
 * roleplay template, tool instructions, and tool reinforcement. Everything
 * dynamic — scenario, user-character intro, multi-character roster, status,
 * silent-mode rule, status-change notes, project context, current outfit /
 * wardrobe, outfit-change notices, conversation summary, memory tail,
 * timestamp — has been moved to Staff-authored whispers in the transcript.
 *
 * Phase H: the static identity-stack portion may be supplied via
 * `precompiledIdentityStack`; when present it replaces the rebuild. This is
 * the cache-hit path. When absent, the stack is built fresh (read-through
 * fallback) using the same `buildIdentityStack` helper.
 */
export interface BuildSystemPromptOptions {
  character: Character
  userCharacter?: { name: string; description: string } | null
  /** Roleplay template to prepend (formatting instructions). */
  roleplayTemplate?: { systemPrompt: string } | null
  /** Tool instructions (native tool rules or text-block tool instructions). */
  toolInstructions?: string
  /** Selected system prompt ID from the character's `systemPrompts` array. */
  selectedSystemPromptId?: string | null
  /** Timestamp configuration. Used only for the `{{timestamp}}` template variable path. */
  timestampConfig?: TimestampConfig | null
  /** Whether this is the first message (for START_ONLY timestamp mode). */
  isInitialMessage?: boolean
  /** Resolved IANA timezone name for timestamp formatting. */
  timezone?: string
  /** Scenario text used to feed the `{{scenario}}` template variable. */
  scenarioText?: string | null
  /** Phase H: precompiled identity-stack from `chats.compiledIdentityStacks`. */
  precompiledIdentityStack?: string | null
  /**
   * Instance-wide Taboo phrases (`instance_settings['taboo']`), read by the
   * async caller and passed down because this builder is deliberately
   * synchronous. Omitting the option omits the section — which is the intended
   * default for the non-conversational call sites (the character-voiced
   * announcer, `self_inventory`).
   */
  tabooPhrases?: string[]
  /**
   * Rendered standing-instructions section (project + group `instructions`,
   * see `lib/chat/context/standing-instructions.ts`), resolved by the async
   * caller and passed down because this builder is deliberately synchronous.
   * Omitting the option omits the section. Unlike Taboo, the section IS
   * template-processed — a project/group prompt may address `{{char}}`.
   */
  standingInstructions?: string | null
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const {
    character,
    userCharacter,
    roleplayTemplate,
    toolInstructions,
    selectedSystemPromptId,
    timestampConfig,
    isInitialMessage,
    timezone,
    scenarioText,
    precompiledIdentityStack,
    tabooPhrases,
    standingInstructions,
  } = options

  const parts: string[] = []

  // Phase H: prefer the precompiled identity stack when supplied. Falls back
  // to building fresh so the function is safe to call on chats that haven't
  // had their stack compiled yet (legacy chats, missing key in the map).
  const identityStack = precompiledIdentityStack
    && precompiledIdentityStack.trim().length > 0
    ? precompiledIdentityStack
    : buildIdentityStack({ character, userCharacter, selectedSystemPromptId, scenarioText })

  // Template context for the per-turn additions (roleplay template, tool
  // instructions, tool reinforcement). The {{user}}/{{scenario}}/{{persona}}
  // substitutions in the identity stack are already resolved by the time we
  // get here (either via build-time compile or via the fallback path above).
  const templateContext: TemplateContext = {
    char: character.name,
    user: userCharacter?.name || 'User',
    description: character.description || '',
    personality: character.personality || '',
    scenario: scenarioText || character.scenarios?.[0]?.content || '',
    persona: userCharacter?.description || '',
  }

  // Phase G: timestamp template variable path remains for character/template
  // content that wants to inline the time directly. Only kicks in when
  // timestampConfig.autoPrepend is false (the auto-prepend path is now a
  // Host whisper).
  if (timestampConfig && shouldInjectTimestamp(timestampConfig, isInitialMessage ?? false)) {
    if (!timestampConfig.autoPrepend) {
      const timestamp = calculateCurrentTimestamp(timestampConfig, timezone)
      templateContext.timestamp = timestamp.formatted
    }
  }

  // Lead with the identity stack — bulk of the prompt, cache-friendly.
  parts.push(identityStack)

  // Roleplay template (chat-level formatting instructions).
  if (roleplayTemplate?.systemPrompt) {
    parts.push(processTemplate(roleplayTemplate.systemPrompt, templateContext))
  }

  // Universal math-notation formatting note — applies to every character
  // regardless of the selected roleplay template.
  parts.push(MATH_FORMATTING_INSTRUCTION)

  // Universal Taboo section — instance-wide, character-independent, and stable
  // between edits, so it belongs here with the other universal material rather
  // than down among the per-turn additions. Sits inside system block 1 (the
  // cacheable prefix) and never passes through `processTemplate`.
  const tabooSection = renderTabooSection(tabooPhrases)
  if (tabooSection) {
    parts.push(tabooSection)
  }

  // Standing instructions (project + group `instructions`). Stable per
  // character per chat — it changes only when the user edits a project/group
  // or a membership — so it lives here in the cacheable prefix, after the
  // universal material and before the per-turn tool instructions. Emits
  // nothing when absent (the Taboo byte-identity contract). Template-processed
  // like the roleplay template so `{{char}}`/`{{user}}` resolve.
  if (standingInstructions && standingInstructions.trim().length > 0) {
    parts.push(processTemplate(standingInstructions, templateContext))
  }

  // Tool instructions (per-turn dynamic — varies with enabled tools, danger
  // routing, provider tool support).
  if (toolInstructions) {
    parts.push(processTemplate(toolInstructions, templateContext))
  }

  // Tool reinforcement (only when tools are available).
  //
  // WHY second person: this is the LAST block in the prompt — the recency slot —
  // and everything above it addresses the character directly ("You are {{char}}",
  // Taboo's "anything you say", the standing-instructions preamble). It was third
  // person only by inheritance: it went in (3f4d7a78a, 2026-02-05) with literal
  // "his/her ... he/she" placeholders, and the fix that followed (11c4d6c2d,
  // 2026-03-19) was aimed at the *pronoun* being generic, not at the person — the
  // very same commit added the second-person identity preamble above, creating the
  // disagreement without noticing it. Third person here was never a model finding.
  //
  // Flipping it also retires the pronoun lookup entirely, which killed a real bug:
  // the `|| 'they'` default rendered "they CALLS them ... they does not", so every
  // character with no pronouns recorded ended its prompt on an ungrammatical
  // sentence. Second person needs no pronoun at all.
  if (toolInstructions) {
    const toolReinforcement = processTemplate(
      `When you use workspace tools, you CALL them — you do not merely describe calling them. Every tool action produces a tool_use block, not prose.`,
      templateContext
    )
    parts.push(toolReinforcement)
  }

  return parts.join('\n\n').trim()
}

/**
 * Build other participants info for system prompt
 * Supports CHARACTER participants (both LLM and user-controlled)
 */
export function buildOtherParticipantsInfo(
  respondingParticipantId: string,
  allParticipants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>
): OtherParticipantInfo[] {
  const otherParticipants: OtherParticipantInfo[] = []

  for (const participant of allParticipants) {
    // Skip the responding participant
    if (participant.id === respondingParticipantId) {
      continue
    }

    // Skip removed participants
    if (participant.status === 'removed') {
      continue
    }

    // CHARACTER participants (both LLM and user-controlled)
    if (participant.type === 'CHARACTER' && participant.characterId) {
      const character = participantCharacters.get(participant.characterId)
      if (character) {
        otherParticipants.push({
          name: character.name,
          aliases: character.aliases && character.aliases.length > 0 ? character.aliases : undefined,
          pronouns: character.pronouns || undefined,
          description: character.title || character.description || undefined,
          type: 'CHARACTER',
          status: participant.status as ParticipantStatus,
        })
      }
    }
  }

  return otherParticipants
}

/**
 * Build an identity reinforcement block emitted as a separate, fully-static
 * system message. The text deliberately avoids naming individual participants
 * — those join/leave the chat via Host announcements that already live in the
 * conversation history, and every history message carries `name` attribution
 * — so this block can sit downstream of a prompt-cache breakpoint without
 * invalidating it on participant changes.
 */
export function buildIdentityReinforcement(
  characterName: string,
): string {
  // WHY static: any inline list of "other participants" is the kind of
  // turn-variable content that bisects provider prompt caching. The model
  // already knows who is in the scene from Host roster announcements and
  // per-message name attribution; the reminder only needs to emphasise
  // staying in {{char}}'s voice.
  const template = `## Identity Reminder\nYou are {{char}}, and you control ONLY {{char}}. Respond as {{char}} and no one else. Write only {{char}}'s own speech, actions, and inner thoughts for this single turn, then stop and let the others act.\nNEVER write dialogue, actions, thoughts, or narration on behalf of any other character or the user. NEVER continue the scene from another character's point of view, and NEVER label a block of text with another character's name — do not emit speaker tags like "[Another Name]" or "Another Name:" for anyone but yourself. Writing another participant's turn is a serious error; let each of them speak for themselves.\nDo not prefix or label your response with your own name either (e.g., do not start with "[{{char}}]" or "{{char}}:"). Simply respond in character directly.`

  return processTemplate(template, {
    char: characterName,
  })
}
