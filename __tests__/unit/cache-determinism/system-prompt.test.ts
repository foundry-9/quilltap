/**
 * Phase 3d: System-prompt determinism CI test.
 *
 * The provider prompt-cache architecture (Anthropic ephemeral, OpenAI
 * `prompt_cache_key`, Grok per-server cache, Gemini auto-cache) hinges on
 * the system block being byte-identical across turns within a chat. Any
 * non-determinism in `buildSystemPrompt` — Map iteration order, Date.now()
 * leaking through templates, etc. — defeats the cache.
 *
 * These tests assert two invariants for a fixed fixture:
 *
 * 1. `buildSystemPrompt(ctx)` is byte-identical when called twice in a row
 *    (no internal randomness).
 * 2. The hash of `buildSystemPrompt(ctx)` for the fixture matches a
 *    checked-in golden hash. Any drift fails CI; updating the golden is
 *    the explicit signal that an intentional structural change shipped.
 */

import { createHash } from 'node:crypto'
import {
  buildSystemPrompt,
  buildIdentityStack,
  type BuildSystemPromptOptions,
} from '@/lib/chat/context/system-prompt-builder'
import type { Character } from '@/lib/schemas/types'

const FIXTURE_CHARACTER: Character = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Iris Volney',
  description: 'A junior cartographer with a keen eye for geometric anomalies.',
  personality: 'Methodical, sceptical, and easily charmed by elegant proofs.',
  aliases: ['Vee', 'The Mapmaker'],
  pronouns: { subject: 'she', object: 'her', possessive: 'hers' },
  systemPrompts: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'default',
      content: 'You are a careful cartographer; you reason from triangulation, not flourish.',
      isDefault: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
  ],
  scenarios: [],
  exampleDialogues: '"Two readings off — never one." Iris tapped the brass dial of her sextant.',
  physicalDescription: {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'standard',
    shortPrompt: 'auburn hair, ink-stained fingers, brass goggles around her neck',
    mediumPrompt: '',
    longPrompt: '',
    completePrompt: '',
    fullDescription: '',
    usageContext: 'general',
  } as NonNullable<Character['physicalDescription']>,
  defaultImageProfileId: null,
  imageProfileId: null,
  defaultConnectionProfileId: null,
  selectedSystemPromptId: '22222222-2222-2222-2222-222222222222',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
} as unknown as Character

const FIXTURE_OPTIONS: BuildSystemPromptOptions = {
  character: FIXTURE_CHARACTER,
  userCharacter: { name: 'Wren', description: 'a passing scholar' },
  roleplayTemplate: { systemPrompt: 'Respond in measured prose. Do not break role.' },
  toolInstructions: 'When invoking tools, do so via tool_use blocks; never narrate the call.',
  selectedSystemPromptId: '22222222-2222-2222-2222-222222222222',
  scenarioText: 'A draughty observatory two hours past midnight.',
  precompiledIdentityStack: null,
}

/**
 * The same fixture with a Taboo list. The base fixture deliberately carries no
 * `tabooPhrases` — an instance that never touches the feature must keep the
 * golden above unchanged — so the rendered section needs a golden of its own.
 */
const FIXTURE_OPTIONS_WITH_TABOO: BuildSystemPromptOptions = {
  ...FIXTURE_OPTIONS,
  tabooPhrases: ["that's not nothing", 'weight-bearing'],
}

function hash(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)
}

describe('cache-determinism: system prompt', () => {
  it('buildSystemPrompt is byte-identical across consecutive calls', () => {
    const a = buildSystemPrompt(FIXTURE_OPTIONS)
    const b = buildSystemPrompt(FIXTURE_OPTIONS)
    expect(b).toBe(a)
  })

  it('buildIdentityStack is byte-identical across consecutive calls', () => {
    const a = buildIdentityStack({
      character: FIXTURE_CHARACTER,
      userCharacter: FIXTURE_OPTIONS.userCharacter,
      selectedSystemPromptId: FIXTURE_OPTIONS.selectedSystemPromptId,
      scenarioText: FIXTURE_OPTIONS.scenarioText,
    })
    const b = buildIdentityStack({
      character: FIXTURE_CHARACTER,
      userCharacter: FIXTURE_OPTIONS.userCharacter,
      selectedSystemPromptId: FIXTURE_OPTIONS.selectedSystemPromptId,
      scenarioText: FIXTURE_OPTIONS.scenarioText,
    })
    expect(b).toBe(a)
  })

  // Golden history — each entry is an intentional wording/structure change.
  //   bd27b1ca407d9901 → 7517f7d9b496d20b  (2026-08-22) tool reinforcement moved
  //     to second person: "When you use workspace tools, you CALL them — you do
  //     not merely describe calling them." Previously third person via a pronoun
  //     lookup whose `|| 'they'` default rendered the ungrammatical "they CALLS
  //     them". Verified as the sole delta: the diff touches only comments and
  //     that one template literal, and the prompt is otherwise byte-identical.
  //     See docs/developer/features/prompt-person-consistency.md §3.1a.
  it('buildSystemPrompt fixture hash matches checked-in golden', () => {
    const golden = process.env.UPDATE_GOLDEN_PROMPT_HASH === '1'
      ? hash(buildSystemPrompt(FIXTURE_OPTIONS))
      : '7517f7d9b496d20b'
    const actual = hash(buildSystemPrompt(FIXTURE_OPTIONS))
    if (actual !== golden) {
      // Surface the new hash so the engineer can update the golden
      // intentionally if the change was meant.
      console.error(
        '[cache-determinism] system-prompt hash drift\n' +
        `  expected: ${golden}\n` +
        `  actual:   ${actual}\n` +
        '  Update the golden (after confirming the change is intentional) by\n' +
        '  re-running the test with UPDATE_GOLDEN_PROMPT_HASH=1 and copying\n' +
        '  the printed hash into the test source.',
      )
    }
    expect(actual).toBe(golden)
  })

  it('buildSystemPrompt with a Taboo list is byte-identical across consecutive calls', () => {
    const a = buildSystemPrompt(FIXTURE_OPTIONS_WITH_TABOO)
    const b = buildSystemPrompt(FIXTURE_OPTIONS_WITH_TABOO)
    expect(b).toBe(a)
  })

  // Golden history: 911204033cd41164 → 74c9b488b4a1517c (2026-08-22), the same
  // second-person tool-reinforcement change as the base golden above.
  it('buildSystemPrompt with a Taboo list matches its own checked-in golden', () => {
    const golden = process.env.UPDATE_GOLDEN_PROMPT_HASH === '1'
      ? hash(buildSystemPrompt(FIXTURE_OPTIONS_WITH_TABOO))
      : '74c9b488b4a1517c'
    const actual = hash(buildSystemPrompt(FIXTURE_OPTIONS_WITH_TABOO))
    if (actual !== golden) {
      console.error(
        '[cache-determinism] system-prompt (with Taboo) hash drift\n' +
        `  expected: ${golden}\n` +
        `  actual:   ${actual}\n` +
        '  Update the golden (after confirming the change is intentional) by\n' +
        '  re-running the test with UPDATE_GOLDEN_PROMPT_HASH=1 and copying\n' +
        '  the printed hash into the test source.',
      )
    }
    expect(actual).toBe(golden)
  })

  it('the tool reinforcement addresses the character directly, with no pronoun lookup', () => {
    // Pinned separately from the hash so a regression to third person fails with
    // a readable message instead of an opaque digest. The fixture carries
    // she/her/hers, so any reintroduced pronoun lookup would surface here as
    // "she CALLS them"; the old no-pronoun default produced "they CALLS them",
    // which did not agree with its own verb.
    const prompt = buildSystemPrompt(FIXTURE_OPTIONS)
    expect(prompt).toContain('When you use workspace tools, you CALL them')
    expect(prompt).not.toContain('CALLS them')
    expect(prompt).not.toContain(FIXTURE_CHARACTER.name + ' uses workspace tools')
  })

  it('an empty Taboo list leaves the prompt byte-identical to no Taboo option at all', () => {
    // This is what keeps the golden above stable for every instance that never
    // touches the feature: empty ⇒ the section is omitted entirely, header and
    // all, rather than rendered as an empty block.
    const empty = buildSystemPrompt({ ...FIXTURE_OPTIONS, tabooPhrases: [] })
    expect(empty).toBe(buildSystemPrompt(FIXTURE_OPTIONS))
  })
})
