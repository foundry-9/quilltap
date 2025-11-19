/**
 * Tests for multi-persona import functionality
 */

import { describe, it, expect } from '@jest/globals'
import {
  isMultiPersonaBackup,
  convertMultiPersonaBackup,
  type MultiPersonaBackup,
} from '@/lib/sillytavern/persona'

describe('Multi-Persona Import', () => {
  const sampleMultiPersonaBackup: MultiPersonaBackup = {
    personas: {
      'user-default.png': 'Charlie',
      '1761928412142-CharlieF.png': 'Charlie',
      '1761928542165-CharlieM.png': 'Charlie',
    },
    persona_descriptions: {
      'user-default.png': {
        description: 'Test description 1',
        position: 0,
        title: 'The Writer/Chief',
        connections: [
          {
            type: 'character',
            id: 'Friday.png',
          },
        ],
      },
      '1761928412142-CharlieF.png': {
        description: 'Test description 2',
        position: 0,
        depth: 2,
        role: 0,
        title: 'Alternate Universe',
      },
      '1761928542165-CharlieM.png': {
        description: 'Test description 3',
        position: 0,
        depth: 2,
        role: 0,
        lorebook: 'Murel AI',
        title: 'The Real Me',
      },
    },
    default_persona: '1761928542165-CharlieM.png',
  }

  describe('isMultiPersonaBackup', () => {
    it('should return true for valid multi-persona backup format', () => {
      expect(isMultiPersonaBackup(sampleMultiPersonaBackup)).toBe(true)
    })

    it('should return false for single persona format', () => {
      const singlePersona = {
        name: 'Test',
        description: 'Test description',
      }
      expect(isMultiPersonaBackup(singlePersona)).toBe(false)
    })

    it('should return false for invalid format', () => {
      expect(isMultiPersonaBackup(null)).toBe(false)
      expect(isMultiPersonaBackup(undefined)).toBe(false)
      expect(isMultiPersonaBackup('string')).toBe(false)
      expect(isMultiPersonaBackup(123)).toBe(false)
      expect(isMultiPersonaBackup({})).toBe(false)
    })

    it('should return false if personas field is missing', () => {
      const missingPersonas = {
        persona_descriptions: {},
      }
      expect(isMultiPersonaBackup(missingPersonas)).toBe(false)
    })

    it('should return false if persona_descriptions field is missing', () => {
      const missingDescriptions = {
        personas: {},
      }
      expect(isMultiPersonaBackup(missingDescriptions)).toBe(false)
    })
  })

  describe('convertMultiPersonaBackup', () => {
    it('should convert multi-persona backup to array of personas', () => {
      const result = convertMultiPersonaBackup(sampleMultiPersonaBackup)

      expect(result).toHaveLength(3)
      expect(result[0].name).toBe('Charlie')
      expect(result[0].description).toBe('Test description 1')
      expect(result[0].title).toBe('The Writer/Chief')
    })

    it('should preserve all persona description fields', () => {
      const result = convertMultiPersonaBackup(sampleMultiPersonaBackup)

      const personaWithLorebook = result.find((p) => p.filename === '1761928542165-CharlieM.png')
      expect(personaWithLorebook).toBeDefined()
      expect(personaWithLorebook?.lorebook).toBe('Murel AI')
      expect(personaWithLorebook?.title).toBe('The Real Me')
      expect(personaWithLorebook?.depth).toBe(2)
    })

    it('should mark default persona correctly', () => {
      const result = convertMultiPersonaBackup(sampleMultiPersonaBackup)

      const defaultPersona = result.find((p) => p.isDefault)
      expect(defaultPersona).toBeDefined()
      expect(defaultPersona?.filename).toBe('1761928542165-CharlieM.png')
    })

    it('should handle connections array', () => {
      const result = convertMultiPersonaBackup(sampleMultiPersonaBackup)

      const personaWithConnections = result.find((p) => p.filename === 'user-default.png')
      expect(personaWithConnections?.connections).toBeDefined()
      expect(personaWithConnections?.connections).toHaveLength(1)
      expect(personaWithConnections?.connections?.[0].type).toBe('character')
      expect(personaWithConnections?.connections?.[0].id).toBe('Friday.png')
    })

    it('should return empty array for backup with no personas', () => {
      const emptyBackup: MultiPersonaBackup = {
        personas: {},
        persona_descriptions: {},
      }

      const result = convertMultiPersonaBackup(emptyBackup)
      expect(result).toHaveLength(0)
    })

    it('should skip personas without descriptions', () => {
      const partialBackup: MultiPersonaBackup = {
        personas: {
          'persona1.png': 'Name1',
          'persona2.png': 'Name2',
        },
        persona_descriptions: {
          'persona1.png': {
            description: 'Description 1',
          },
          // persona2.png has no description
        },
      }

      const result = convertMultiPersonaBackup(partialBackup)
      expect(result).toHaveLength(1)
      expect(result[0].filename).toBe('persona1.png')
    })
  })
})
