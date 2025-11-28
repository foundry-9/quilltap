/**
 * Unit tests for tag style helpers introduced after 1.3
 */

import { describe, it, expect } from '@jest/globals'
import { DEFAULT_TAG_STYLE, mergeWithDefaultTagStyle } from '@/lib/tags/styles'

describe('mergeWithDefaultTagStyle', () => {
  it('should return a copy of the default style when no overrides are provided', () => {
    const merged = mergeWithDefaultTagStyle()

    expect(merged).toEqual(DEFAULT_TAG_STYLE)
    expect(merged).not.toBe(DEFAULT_TAG_STYLE)
  })

  it('should merge provided overrides with defaults', () => {
    const merged = mergeWithDefaultTagStyle({
      emoji: '🔥',
      foregroundColor: '#ffffff',
      italic: true,
    })

    expect(merged).toEqual({
      emoji: '🔥',
      foregroundColor: '#ffffff',
      backgroundColor: DEFAULT_TAG_STYLE.backgroundColor,
      emojiOnly: DEFAULT_TAG_STYLE.emojiOnly,
      bold: DEFAULT_TAG_STYLE.bold,
      italic: true,
      strikethrough: DEFAULT_TAG_STYLE.strikethrough,
    })
  })

  it('should normalize falsy emoji values to null', () => {
    expect(mergeWithDefaultTagStyle({ emoji: '' }).emoji).toBeNull()
    expect(mergeWithDefaultTagStyle({ emoji: undefined }).emoji).toBeNull()
  })

  it('should keep the DEFAULT_TAG_STYLE object immutable', () => {
    const merged = mergeWithDefaultTagStyle()
    merged.backgroundColor = '#000000'
    merged.bold = true

    expect(DEFAULT_TAG_STYLE.backgroundColor).toBe('#e5e7eb')
    expect(DEFAULT_TAG_STYLE.bold).toBe(false)
  })
})
