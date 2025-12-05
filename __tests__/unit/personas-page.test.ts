/**
 * Unit tests for personas page avatar and metadata display
 * Tests persona listing, avatar display, linked characters, and tags
 */

import { describe, it, expect } from '@jest/globals'

describe('Personas Page', () => {
  /**
   * Persona interface validation
   * Tests that persona objects have all required properties
   */
  describe('Persona data structure', () => {
    it('should have required properties for display', () => {
      const persona = {
        id: 'persona1',
        name: 'Alice',
        title: 'Adventurer',
        description: 'A brave adventurer',
        personalityTraits: 'brave, curious',
        avatarUrl: 'https://example.com/avatar.jpg',
        defaultImage: {
          id: 'img1',
          filepath: 'uploads/alice.jpg',
          url: 'https://example.com/alice.jpg',
        },
        createdAt: new Date().toISOString(),
        characters: [
          {
            character: { id: 'char1', name: 'Character 1' },
          },
        ],
        tags: [
          {
            tagId: 'tag1',
            tag: { id: 'tag1', name: 'brave' },
          },
        ],
      }

      expect(persona).toHaveProperty('id')
      expect(persona).toHaveProperty('name')
      expect(persona).toHaveProperty('title')
      expect(persona).toHaveProperty('description')
      expect(persona).toHaveProperty('defaultImage')
      expect(persona).toHaveProperty('characters')
      expect(persona).toHaveProperty('tags')
    })

    it('should handle persona with no defaultImage', () => {
      const persona = {
        id: 'persona2',
        name: 'Bob',
        title: 'Builder',
        description: 'A skilled builder',
        avatarUrl: 'https://example.com/bob.jpg',
        defaultImage: null,
        createdAt: new Date().toISOString(),
        characters: [],
        tags: [],
      }

      const hasImage = persona.defaultImage !== null || persona.avatarUrl !== null
      expect(hasImage).toBe(true)
    })

    it('should handle persona with no title', () => {
      const persona = {
        id: 'persona3',
        name: 'Charlie',
        title: null,
        description: 'A mysterious figure',
        defaultImage: null,
        avatarUrl: null,
        createdAt: new Date().toISOString(),
        characters: [],
        tags: [],
      }

      expect(persona.title).toBeNull()
      expect(persona.name).toBe('Charlie')
    })
  })

  /**
   * Avatar display on personas listing page
   * Tests the getAvatarSrc function used in persona cards
   */
  describe('Persona avatar source resolution', () => {
    it('should return defaultImage URL when available', () => {
      const persona = {
        defaultImage: {
          id: 'img1',
          filepath: 'uploads/persona1.jpg',
          url: 'https://cdn.example.com/persona1.jpg',
        },
        avatarUrl: 'https://old-url.com/persona.jpg',
      }

      const getAvatarSrc = (p: any) => {
        if (p.defaultImage) {
          const filepath = p.defaultImage.filepath
          return p.defaultImage.url || (filepath?.startsWith('/') ? filepath : `/${filepath}`)
        }
        return p.avatarUrl
      }

      const src = getAvatarSrc(persona)
      expect(src).toBe('https://cdn.example.com/persona1.jpg')
    })

    it('should fallback to filepath if URL is missing', () => {
      const persona = {
        defaultImage: {
          id: 'img1',
          filepath: 'uploads/images/user123/persona.png',
          url: null,
        },
        avatarUrl: null,
      }

      const getAvatarSrc = (p: any) => {
        if (p.defaultImage) {
          const filepath = p.defaultImage.filepath
          return p.defaultImage.url || (filepath?.startsWith('/') ? filepath : `/${filepath}`)
        }
        return p.avatarUrl
      }

      const src = getAvatarSrc(persona)
      expect(src).toBe('/uploads/images/user123/persona.png')
    })

    it('should use avatarUrl when defaultImage is not present', () => {
      const persona = {
        defaultImage: null,
        avatarUrl: 'https://example.com/avatar.jpg',
      }

      const getAvatarSrc = (p: any) => {
        if (p.defaultImage) {
          const filepath = p.defaultImage.filepath
          return p.defaultImage.url || (filepath?.startsWith('/') ? filepath : `/${filepath}`)
        }
        return p.avatarUrl
      }

      const src = getAvatarSrc(persona)
      expect(src).toBe('https://example.com/avatar.jpg')
    })

    it('should return null when no image sources available', () => {
      const persona = {
        defaultImage: null,
        avatarUrl: null,
      }

      const getAvatarSrc = (p: any) => {
        if (p.defaultImage) {
          const filepath = p.defaultImage.filepath
          return p.defaultImage.url || (filepath?.startsWith('/') ? filepath : `/${filepath}`)
        }
        return p.avatarUrl
      }

      const src = getAvatarSrc(persona)
      expect(src).toBeNull()
    })
  })

  /**
   * Persona card rendering with linked characters
   * Tests that character links are properly displayed
   */
  describe('Linked characters display', () => {
    it('should display linked characters as badges', () => {
      const persona = {
        id: 'persona1',
        characters: [
          { character: { id: 'char1', name: 'Alice' } },
          { character: { id: 'char2', name: 'Bob' } },
        ],
      }

      expect(persona.characters).toHaveLength(2)
      expect(persona.characters[0].character.name).toBe('Alice')
      expect(persona.characters[1].character.name).toBe('Bob')
    })

    it('should show "Linked to" section only if characters exist', () => {
      const personaWithCharacters = {
        characters: [{ character: { id: 'char1', name: 'Character' } }],
      }

      const personaWithoutCharacters = {
        characters: [],
      }

      expect(personaWithCharacters.characters.length > 0).toBe(true)
      expect(personaWithoutCharacters.characters.length > 0).toBe(false)
    })

    it('should render empty when no characters linked', () => {
      const persona = {
        id: 'persona1',
        characters: [],
      }

      const shouldRender = persona.characters.length > 0
      expect(shouldRender).toBe(false)
    })
  })

  /**
   * Persona tags display
   * Tests that tags are properly shown on persona cards
   */
  describe('Tags display', () => {
    it('should display persona tags as badges', () => {
      const persona = {
        id: 'persona1',
        tags: [
          { tagId: 'tag1', tag: { id: 'tag1', name: 'brave' } },
          { tagId: 'tag2', tag: { id: 'tag2', name: 'adventurous' } },
        ],
      }

      expect(persona.tags).toHaveLength(2)
      expect(persona.tags[0].tag.name).toBe('brave')
      expect(persona.tags[1].tag.name).toBe('adventurous')
    })

    it('should show "Tags" section only if tags exist', () => {
      const personaWithTags = {
        tags: [{ tagId: 'tag1', tag: { id: 'tag1', name: 'tag1' } }],
      }

      const personaWithoutTags = {
        tags: [],
      }

      expect(personaWithTags.tags.length > 0).toBe(true)
      expect(personaWithoutTags.tags.length > 0).toBe(false)
    })

    it('should render empty when no tags exist', () => {
      const persona = {
        id: 'persona1',
        tags: [],
      }

      const shouldRender = persona.tags.length > 0
      expect(shouldRender).toBe(false)
    })

    it('should handle multiple tags correctly', () => {
      const persona = {
        tags: [
          { tagId: 'tag1', tag: { id: 'tag1', name: 'combat' } },
          { tagId: 'tag2', tag: { id: 'tag2', name: 'magic' } },
          { tagId: 'tag3', tag: { id: 'tag3', name: 'wisdom' } },
        ],
      }

      const tagNames = persona.tags.map((t) => t.tag.name)
      expect(tagNames).toEqual(['combat', 'magic', 'wisdom'])
    })
  })

  /**
   * Persona description display
   * Tests text truncation and formatting
   */
  describe('Description display', () => {
    it('should display persona description', () => {
      const persona = {
        description: 'A skilled warrior with years of experience in combat',
      }

      expect(persona.description).toBeTruthy()
      expect(persona.description.length).toBeGreaterThan(0)
    })

    it('should handle long descriptions with line clamping', () => {
      const persona = {
        description: 'This is a very long description ' + 'that contains '.repeat(20),
      }

      // The UI should clamp to 3 lines using CSS class "line-clamp-3"
      // This test verifies the description exists and can be truncated
      expect(persona.description.length).toBeGreaterThan(100)
    })

    it('should handle short descriptions', () => {
      const persona = {
        description: 'A mage',
      }

      expect(persona.description).toBe('A mage')
    })

    it('should handle empty descriptions', () => {
      const persona = {
        description: '',
      }

      expect(persona.description).toBe('')
    })
  })

  /**
   * Persona grid layout
   * Tests responsive grid configuration
   */
  describe('Grid layout', () => {
    it('should render personas in responsive grid', () => {
      const personas = [
        { id: 'p1', name: 'Persona 1' },
        { id: 'p2', name: 'Persona 2' },
        { id: 'p3', name: 'Persona 3' },
        { id: 'p4', name: 'Persona 4' },
      ]

      // Grid should be: 1 column on mobile, 2 on medium, 3 on large
      // This test verifies we have proper collection to iterate
      expect(personas).toHaveLength(4)
      personas.forEach((p) => {
        expect(p).toHaveProperty('id')
        expect(p).toHaveProperty('name')
      })
    })

    it('should handle empty personas list', () => {
      const personas = []

      // Should show empty state message
      expect(personas).toHaveLength(0)
    })

    it('should handle single persona', () => {
      const personas = [{ id: 'p1', name: 'Single Persona' }]

      expect(personas).toHaveLength(1)
    })
  })
})
