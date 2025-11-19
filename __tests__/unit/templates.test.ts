/**
 * Unit tests for template processing
 */

import {
  processTemplate,
  buildTemplateContext,
  processCharacterTemplates,
  type TemplateContext,
} from '@/lib/templates/processor'

describe('Template Processing', () => {
  describe('processTemplate', () => {
    it('should replace {{char}} with character name', () => {
      const template = 'Hello, I am {{char}}!'
      const context: TemplateContext = {
        char: 'Alice',
        user: 'Bob',
      }

      const result = processTemplate(template, context)
      expect(result).toBe('Hello, I am Alice!')
    })

    it('should replace {{user}} with user name', () => {
      const template = 'Nice to meet you, {{user}}!'
      const context: TemplateContext = {
        char: 'Alice',
        user: 'Bob',
      }

      const result = processTemplate(template, context)
      expect(result).toBe('Nice to meet you, Bob!')
    })

    it('should replace multiple template variables', () => {
      const template = '{{char}} greets {{user}} warmly.'
      const context: TemplateContext = {
        char: 'Alice',
        user: 'Bob',
      }

      const result = processTemplate(template, context)
      expect(result).toBe('Alice greets Bob warmly.')
    })

    it('should replace {{description}}, {{personality}}, and {{scenario}}', () => {
      const template = 'Character: {{description}}\nPersonality: {{personality}}\nScenario: {{scenario}}'
      const context: TemplateContext = {
        char: 'Alice',
        user: 'Bob',
        description: 'A brave warrior',
        personality: 'Courageous and kind',
        scenario: 'In a medieval castle',
      }

      const result = processTemplate(template, context)
      expect(result).toBe(
        'Character: A brave warrior\nPersonality: Courageous and kind\nScenario: In a medieval castle'
      )
    })

    it('should handle undefined variables by replacing with empty string', () => {
      const template = 'Hello {{char}}, welcome to {{scenario}}!'
      const context: TemplateContext = {
        char: 'Alice',
        user: 'Bob',
        // scenario is undefined
      }

      const result = processTemplate(template, context)
      expect(result).toBe('Hello Alice, welcome to !')
    })

    it('should handle empty template', () => {
      const template = ''
      const context: TemplateContext = {
        char: 'Alice',
      }

      const result = processTemplate(template, context)
      expect(result).toBe('')
    })

    it('should handle template with no variables', () => {
      const template = 'Just a normal string'
      const context: TemplateContext = {
        char: 'Alice',
      }

      const result = processTemplate(template, context)
      expect(result).toBe('Just a normal string')
    })

    it('should support SillyTavern example dialogue format', () => {
      const template = '<START>\n{{char}}: Example dialogue\n{{user}}: Example response'
      const context: TemplateContext = {
        char: 'Alice',
        user: 'Bob',
      }

      const result = processTemplate(template, context)
      expect(result).toBe('<START>\nAlice: Example dialogue\nBob: Example response')
    })

    it('should handle {{system}} variable', () => {
      const template = 'System: {{system}}'
      const context: TemplateContext = {
        system: 'You are a helpful assistant',
      }

      const result = processTemplate(template, context)
      expect(result).toBe('System: You are a helpful assistant')
    })

    it('should handle {{persona}} variable', () => {
      const template = '{{char}} is talking to someone who is {{persona}}'
      const context: TemplateContext = {
        char: 'Alice',
        persona: 'a curious traveler',
      }

      const result = processTemplate(template, context)
      expect(result).toBe('Alice is talking to someone who is a curious traveler')
    })

    it('should handle world info variables (empty for now)', () => {
      const template = 'Before: {{wiBefore}}, After: {{wiAfter}}'
      const context: TemplateContext = {
        wiBefore: '',
        wiAfter: '',
      }

      const result = processTemplate(template, context)
      expect(result).toBe('Before: , After: ')
    })
  })

  describe('buildTemplateContext', () => {
    it('should build context from character and persona', () => {
      const character = {
        name: 'Alice',
        description: 'A brave warrior',
        personality: 'Courageous and kind',
        scenario: 'In a medieval castle',
        exampleDialogues: 'Example dialogue',
        systemPrompt: 'System prompt',
      }

      const persona = {
        name: 'Bob',
        description: 'A curious traveler',
      }

      const context = buildTemplateContext({
        character,
        persona,
      })

      expect(context.char).toBe('Alice')
      expect(context.user).toBe('Bob')
      expect(context.description).toBe('A brave warrior')
      expect(context.personality).toBe('Courageous and kind')
      expect(context.scenario).toBe('In a medieval castle')
      expect(context.persona).toBe('A curious traveler')
      expect(context.system).toBe('System prompt')
      expect(context.mesExamplesRaw).toBe('Example dialogue')
    })

    it('should handle missing persona', () => {
      const character = {
        name: 'Alice',
        description: 'A brave warrior',
        personality: 'Courageous and kind',
        scenario: 'In a medieval castle',
        exampleDialogues: null,
        systemPrompt: null,
      }

      const context = buildTemplateContext({
        character,
        persona: null,
      })

      expect(context.char).toBe('Alice')
      expect(context.user).toBe('User')
      expect(context.persona).toBe('')
    })

    it('should handle custom scenario override', () => {
      const character = {
        name: 'Alice',
        description: 'A brave warrior',
        personality: 'Courageous and kind',
        scenario: 'In a medieval castle',
        exampleDialogues: null,
        systemPrompt: null,
      }

      const context = buildTemplateContext({
        character,
        scenario: 'In a modern city',
      })

      expect(context.scenario).toBe('In a modern city')
    })
  })

  describe('processCharacterTemplates', () => {
    it('should process all character fields with templates', () => {
      const character = {
        name: 'Alice',
        description: 'I am {{char}}, a brave warrior.',
        personality: '{{char}} is courageous and kind.',
        scenario: '{{char}} meets {{user}} in a medieval castle.',
        firstMessage: 'Hello {{user}}, I am {{char}}!',
        exampleDialogues: '<START>\n{{char}}: Example dialogue\n{{user}}: Example response',
        systemPrompt: 'You are {{char}}, talking to {{user}}.',
      }

      const persona = {
        name: 'Bob',
        description: 'A curious traveler',
      }

      const result = processCharacterTemplates({
        character,
        persona,
      })

      expect(result.description).toBe('I am Alice, a brave warrior.')
      expect(result.personality).toBe('Alice is courageous and kind.')
      expect(result.scenario).toBe('Alice meets Bob in a medieval castle.')
      expect(result.firstMessage).toBe('Hello Bob, I am Alice!')
      expect(result.exampleDialogues).toBe('<START>\nAlice: Example dialogue\nBob: Example response')
      expect(result.systemPrompt).toBe('You are Alice, talking to Bob.')
    })

    it('should handle null/empty fields gracefully', () => {
      const character = {
        name: 'Alice',
        description: null,
        personality: null,
        scenario: null,
        firstMessage: null,
        exampleDialogues: null,
        systemPrompt: null,
      }

      const result = processCharacterTemplates({
        character,
        persona: null,
      })

      expect(result.description).toBe('')
      expect(result.personality).toBe('')
      expect(result.scenario).toBe('')
      expect(result.firstMessage).toBe('')
      expect(result.exampleDialogues).toBe('')
      expect(result.systemPrompt).toBe('')
    })

    it('should support complex nested templates', () => {
      const character = {
        name: 'Alice',
        description: '{{char}} is a {{personality}}',
        personality: 'brave warrior',
        scenario: '{{char}} meets {{user}} who is {{persona}}',
        firstMessage: null,
        exampleDialogues: null,
        systemPrompt: null,
      }

      const persona = {
        name: 'Bob',
        description: 'a curious traveler',
      }

      const result = processCharacterTemplates({
        character,
        persona,
      })

      expect(result.description).toBe('Alice is a brave warrior')
      expect(result.scenario).toBe('Alice meets Bob who is a curious traveler')
    })
  })

  describe('SillyTavern compatibility', () => {
    it('should match SillyTavern V2 format example', () => {
      // This is the format used in SillyTavern tests
      const exampleDialogues = '<START>\n{{char}}: Hello there!\n{{user}}: Hi!'

      const context: TemplateContext = {
        char: 'Alice',
        user: 'Bob',
      }

      const result = processTemplate(exampleDialogues, context)
      expect(result).toBe('<START>\nAlice: Hello there!\nBob: Hi!')
    })

    it('should handle all documented SillyTavern variables', () => {
      const template = `
System: {{system}}
Character: {{char}} - {{description}}
Personality: {{personality}}
Scenario: {{scenario}}
User: {{user}} - {{persona}}
Examples: {{mesExamplesRaw}}
      `.trim()

      const context: TemplateContext = {
        system: 'System prompt',
        char: 'Alice',
        description: 'A brave warrior',
        personality: 'Courageous',
        scenario: 'Medieval castle',
        user: 'Bob',
        persona: 'A traveler',
        mesExamplesRaw: 'Example dialogue',
      }

      const result = processTemplate(template, context)
      expect(result).toContain('System: System prompt')
      expect(result).toContain('Character: Alice - A brave warrior')
      expect(result).toContain('User: Bob - A traveler')
    })
  })
})
