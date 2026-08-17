/**
 * Tests for character optimizer helper functions
 */

import {
  buildCharacterContext,
  buildMemoryContext,
  getAnalysisPrompt,
  getGeneralFieldsSuggestionsPrompt,
  getScenarioSuggestionPrompt,
  getSystemPromptSuggestionPrompt,
  getPhysicalDescriptionSuggestionPrompt,
  getWardrobeSuggestionPrompt,
  getPropertiesSuggestionPrompt,
  getNewSystemPromptsSuggestionPrompt,
} from '@/lib/services/character-optimizer.service'
import { createMockCharacter, createMockMemory } from '../fixtures/test-factories'
import type { OptimizerAnalysis } from '@/lib/services/character-optimizer.service'
import type { CharacterScenario, CharacterSystemPrompt, PhysicalDescription } from '@/lib/schemas/types'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

describe('buildCharacterContext', () => {
  it('includes character name', () => {
    const character = createMockCharacter({ name: 'Aria' })
    const result = buildCharacterContext(character)
    expect(result).toContain('=== Character: Aria ===')
  })

  it('includes description or (empty)', () => {
    const characterWithDesc = createMockCharacter({ description: 'A mysterious figure' })
    const resultWith = buildCharacterContext(characterWithDesc)
    expect(resultWith).toContain('A mysterious figure')

    const characterNoDesc = createMockCharacter({ description: null })
    const resultWithout = buildCharacterContext(characterNoDesc)
    expect(resultWithout).toContain('(empty)')
  })

  it('includes personality or (empty)', () => {
    const characterWithPersonality = createMockCharacter({ personality: 'Witty and clever' })
    const resultWith = buildCharacterContext(characterWithPersonality)
    expect(resultWith).toContain('Witty and clever')

    const characterNoPersonality = createMockCharacter({ personality: null })
    const resultWithout = buildCharacterContext(characterNoPersonality)
    expect(resultWithout).toContain('(empty)')
  })

  it('includes scenario or (empty)', () => {
    const characterWithScenario = createMockCharacter({ scenarios: [{ id: 'test-scenario-id', title: 'Default', content: 'A tavern in a fantasy world', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }] })
    const resultWith = buildCharacterContext(characterWithScenario)
    expect(resultWith).toContain('A tavern in a fantasy world')

    const characterNoScenario = createMockCharacter({ scenarios: [] })
    const resultWithout = buildCharacterContext(characterNoScenario)
    expect(resultWithout).toContain('Scenario')
  })

  it('includes talkativeness value', () => {
    const character = createMockCharacter({ talkativeness: 0.7 })
    const result = buildCharacterContext(character)
    expect(result).toContain('Talkativeness: 0.7')
  })

  it('includes system prompts section when present', () => {
    const character = createMockCharacter({
      systemPrompts: [
        { id: '1', name: 'Behavior', content: 'Act naturally' }
      ]
    })
    const result = buildCharacterContext(character)
    expect(result).toContain('=== System Prompts ===')
    expect(result).toContain('Behavior')
    expect(result).toContain('Act naturally')
  })

  it('excludes system prompts section when empty', () => {
    const character = createMockCharacter({ systemPrompts: [] })
    const result = buildCharacterContext(character)
    expect(result).not.toContain('=== System Prompts ===')
  })

  it('includes physical description when present', () => {
    // physicalDescriptions[] collapsed to physicalDescription (singular) in
    // the 4.6 vault cutover. Section header is now "Physical Description"
    // — production code renders it from character.physicalDescription.
    const character = createMockCharacter({
      physicalDescription: {
        id: '1',
        name: 'Appearance',
        usageContext: null,
        shortPrompt: 'Tall',
        mediumPrompt: 'Tall and dark-haired',
        longPrompt: 'A tall figure with dark hair',
        completePrompt: 'Complete description',
        fullDescription: 'Full description here',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }
    })
    const result = buildCharacterContext(character)
    expect(result).toContain('=== Physical Description ===')
    expect(result).toContain('Appearance')
    expect(result).toContain('Tall')
  })

  // The standalone "clothing records when present" test was removed when the
  // Character.clothingRecords field was deleted (wardrobe items now live in
  // their own repository, not on the Character row).

  it('includes identity when set', () => {
    const character = createMockCharacter({ identity: 'A renowned alchemist of the northern court.' })
    const result = buildCharacterContext(character)
    expect(result).toContain('Identity:')
    expect(result).toContain('A renowned alchemist of the northern court.')
  })

  it('shows (empty) for identity when null', () => {
    const character = createMockCharacter({ identity: null })
    const result = buildCharacterContext(character)
    expect(result).toContain('Identity:')
    expect(result).toContain('(empty)')
  })

  it('identity section appears before description section', () => {
    const character = createMockCharacter({
      identity: 'Public persona.',
      description: 'Observed behaviour.',
    })
    const result = buildCharacterContext(character)
    const identityIdx = result.indexOf('Identity:')
    const descriptionIdx = result.indexOf('Description:')
    expect(identityIdx).toBeGreaterThanOrEqual(0)
    expect(descriptionIdx).toBeGreaterThan(identityIdx)
  })
})

describe('buildMemoryContext', () => {
  it('includes count in header', () => {
    const memories = [
      { memory: createMockMemory({ content: 'Memory 1' }) },
      { memory: createMockMemory({ content: 'Memory 2' }) }
    ]
    const result = buildMemoryContext(memories)
    expect(result).toContain('=== Reinforced Memories (top 2) ===')
  })

  it('includes each memory with index', () => {
    const memories = [
      { memory: createMockMemory({ content: 'First memory' }) },
      { memory: createMockMemory({ content: 'Second memory' }) }
    ]
    const result = buildMemoryContext(memories)
    expect(result).toContain('[Memory #1]')
    expect(result).toContain('[Memory #2]')
  })

  it('includes reinforcement count', () => {
    const memories = [
      { memory: createMockMemory({ reinforcementCount: 5, content: 'Important memory' }) }
    ]
    const result = buildMemoryContext(memories)
    expect(result).toContain('reinforced 5 times')
  })

  it('includes memory content', () => {
    const memories = [
      { memory: createMockMemory({ content: 'The character loves tea' }) }
    ]
    const result = buildMemoryContext(memories)
    expect(result).toContain('The character loves tea')
  })

  it('handles empty array', () => {
    const result = buildMemoryContext([])
    expect(result).toContain('=== Reinforced Memories (top 0) ===')
  })

  it('preserves memory order', () => {
    const memories = [
      { memory: createMockMemory({ content: 'First' }) },
      { memory: createMockMemory({ content: 'Second' }) },
      { memory: createMockMemory({ content: 'Third' }) }
    ]
    const result = buildMemoryContext(memories)
    const firstIndex = result.indexOf('First')
    const secondIndex = result.indexOf('Second')
    const thirdIndex = result.indexOf('Third')
    expect(firstIndex).toBeLessThan(secondIndex)
    expect(secondIndex).toBeLessThan(thirdIndex)
  })
})

describe('getAnalysisPrompt', () => {
  it('returns non-empty string', () => {
    const result = getAnalysisPrompt()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('contains behavioral patterns', () => {
    const result = getAnalysisPrompt()
    expect(result).toContain('behavioral pattern')
  })

  it('contains JSON structure guidance', () => {
    const result = getAnalysisPrompt()
    expect(result).toContain('behavioralPatterns')
    expect(result).toContain('summary')
  })

  it('instructs on focus areas', () => {
    const result = getAnalysisPrompt()
    expect(result).toContain('Speech habits')
    expect(result).toContain('Emotional tendencies')
    expect(result).toContain('Relationship dynamics')
  })

  it('includes vantage-point field labels for IDENTITY, DESCRIPTION, PERSONALITY', () => {
    const result = getAnalysisPrompt()
    expect(result).toContain('IDENTITY')
    expect(result).toContain('DESCRIPTION')
    expect(result).toContain('PERSONALITY')
  })
})

describe('per-item suggestion prompts', () => {
  const mockAnalysis: OptimizerAnalysis = {
    behavioralPatterns: [
      {
        pattern: 'Speaks softly',
        evidence: 'Always whispers in conversations',
        frequency: 'Very often'
      }
    ],
    summary: 'The character is introverted'
  }

  describe('getGeneralFieldsSuggestionsPrompt', () => {
    it('contains the analysis JSON', () => {
      const result = getGeneralFieldsSuggestionsPrompt(mockAnalysis)
      expect(result).toContain(JSON.stringify(mockAnalysis, null, 2))
    })

    it('narrows scope to general fields only', () => {
      const result = getGeneralFieldsSuggestionsPrompt(mockAnalysis)
      expect(result).toContain('description')
      expect(result).toContain('personality')
      expect(result).toContain('exampleDialogues')
      expect(result).toContain('talkativeness')
      expect(result).toContain('0.1 and 1.0')
    })

    it('includes identity in the list of editable general fields', () => {
      const result = getGeneralFieldsSuggestionsPrompt(mockAnalysis)
      expect(result).toContain('identity')
    })

    it('contains field-semantics preamble with vantage-point rules', () => {
      const result = getGeneralFieldsSuggestionsPrompt(mockAnalysis)
      // The preamble distinguishes identity, description, and personality by
      // who is observing (stranger, acquaintance, self).
      expect(result).toContain('IDENTITY')
      expect(result).toContain('DESCRIPTION')
      expect(result).toContain('PERSONALITY')
    })

    it('contains significance score guidance', () => {
      const result = getGeneralFieldsSuggestionsPrompt(mockAnalysis)
      expect(result).toContain('significance')
      expect(result).toContain('0.3')
      expect(result).toContain('0.6')
    })

    it('instructs on memory excerpts', () => {
      const result = getGeneralFieldsSuggestionsPrompt(mockAnalysis)
      expect(result).toContain('memoryExcerpts')
    })
  })

  describe('getScenarioSuggestionPrompt', () => {
    const scenario: CharacterScenario = {
      id: 'scen-1',
      title: 'Tea Room',
      content: 'A quiet parlour with a crackling fire.',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }

    it('scopes to the provided scenario ID and title', () => {
      const result = getScenarioSuggestionPrompt(mockAnalysis, scenario)
      expect(result).toContain('scen-1')
      expect(result).toContain('Tea Room')
      expect(result).toContain('A quiet parlour with a crackling fire.')
    })

    it('instructs at most one suggestion', () => {
      const result = getScenarioSuggestionPrompt(mockAnalysis, scenario)
      expect(result.toLowerCase()).toContain('at most one suggestion')
    })
  })

  describe('getSystemPromptSuggestionPrompt', () => {
    const prompt: CharacterSystemPrompt = {
      id: 'sp-1',
      name: 'Default',
      content: 'Roleplay with decorum and wit.',
      isDefault: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }

    it('scopes to the provided prompt ID and name', () => {
      const result = getSystemPromptSuggestionPrompt(mockAnalysis, prompt)
      expect(result).toContain('sp-1')
      expect(result).toContain('Default')
      expect(result).toContain('Roleplay with decorum and wit.')
    })

    it('instructs at most one suggestion', () => {
      const result = getSystemPromptSuggestionPrompt(mockAnalysis, prompt)
      expect(result.toLowerCase()).toContain('at most one suggestion')
    })
  })

  describe('getPhysicalDescriptionSuggestionPrompt', () => {
    const physical: PhysicalDescription = {
      id: 'pd-1',
      name: 'Appearance',
      usageContext: null,
      shortPrompt: 'tall, dark hair',
      mediumPrompt: 'a tall figure with dark hair',
      longPrompt: 'a tall figure with long dark hair and grey eyes',
      completePrompt: 'complete prompt',
      fullDescription: 'A tall figure with dark hair.',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }

    it('lists the physical sub-field keys and includes the current values', () => {
      const result = getPhysicalDescriptionSuggestionPrompt(mockAnalysis, physical)
      expect(result).toContain('fullDescription')
      expect(result).toContain('shortPrompt')
      expect(result).toContain('mediumPrompt')
      expect(result).toContain('longPrompt')
      expect(result).toContain('completePrompt')
      expect(result).toContain('A tall figure with dark hair.')
      expect(result).toContain(JSON.stringify(mockAnalysis, null, 2))
    })

    it('handles a character with no physical description', () => {
      const result = getPhysicalDescriptionSuggestionPrompt(mockAnalysis, null)
      expect(result).toContain('no physical description yet')
      expect(result).toContain('field="physicalDescription"')
    })

    it('forbids brand-new scenarios via the shared schema preamble', () => {
      const result = getPhysicalDescriptionSuggestionPrompt(mockAnalysis, physical)
      expect(result.toLowerCase()).toContain('do not propose brand-new scenarios')
    })
  })

  describe('getWardrobeSuggestionPrompt', () => {
    const items: WardrobeItem[] = [
      {
        id: 'wi-1',
        characterId: 'char-1',
        title: 'Brass-Button Duster',
        description: 'A worn leather duster.',
        imagePrompt: null,
        types: ['top'],
        componentItemIds: [],
        appropriateness: 'travel',
        isDefault: true,
        replace: false,
        migratedFromClothingRecordId: null,
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]

    it('allows refinements by id and structured new items', () => {
      const result = getWardrobeSuggestionPrompt(mockAnalysis, items)
      expect(result).toContain('field="wardrobeItems"')
      expect(result).toContain('wardrobeItem')
      expect(result.toLowerCase()).toContain('refine')
      expect(result).toContain(JSON.stringify(mockAnalysis, null, 2))
    })

    it('keeps bodily features out of the wardrobe and forbids deletions', () => {
      const result = getWardrobeSuggestionPrompt(mockAnalysis, items)
      expect(result.toLowerCase()).toContain('physical description')
      expect(result.toLowerCase()).toContain('never propose deleting')
    })

    it('reports the count of active (non-archived) items', () => {
      const archived: WardrobeItem = { ...items[0], id: 'wi-2', archivedAt: '2026-01-02T00:00:00Z' }
      const result = getWardrobeSuggestionPrompt(mockAnalysis, [...items, archived])
      expect(result).toContain('1 wardrobe item(s)')
    })
  })

  describe('getPropertiesSuggestionPrompt', () => {
    it('proposes alias additions only and keeps pronouns read-only', () => {
      const character = createMockCharacter({ aliases: ['The Duchess'] })
      const result = getPropertiesSuggestionPrompt(mockAnalysis, character)
      expect(result).toContain('field="aliases"')
      expect(result).toContain('The Duchess')
      expect(result.toLowerCase()).toContain('never propose pronoun changes')
      expect(result.toLowerCase()).toContain('do not propose removing')
    })

    it('handles a character with no aliases', () => {
      const character = createMockCharacter({ aliases: [] })
      const result = getPropertiesSuggestionPrompt(mockAnalysis, character)
      expect(result).toContain('(none)')
    })
  })

  describe('getNewSystemPromptsSuggestionPrompt', () => {
    it('includes the analysis and guides system-prompt additions only', () => {
      const result = getNewSystemPromptsSuggestionPrompt(mockAnalysis)
      expect(result).toContain(JSON.stringify(mockAnalysis, null, 2))
      expect(result.toLowerCase()).toContain('new')
      expect(result.toLowerCase()).toContain('additions only')
      expect(result).toContain('field="systemPrompt"')
    })

    it('explicitly forbids proposing new scenarios', () => {
      const result = getNewSystemPromptsSuggestionPrompt(mockAnalysis)
      expect(result.toLowerCase()).toContain('do not propose new scenarios')
    })
  })
})
