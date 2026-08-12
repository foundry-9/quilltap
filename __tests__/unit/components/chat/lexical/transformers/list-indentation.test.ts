import {
  applyListIndentUnit,
  detectListIndentUnit,
  indentSourceLines,
  normalizeListIndentForLexical,
  outdentSourceLines,
} from '@/components/chat/lexical/transformers/list-indentation'

describe('normalizeListIndentForLexical', () => {
  it('lifts two-space nesting onto the four-space grid Lexical counts in', () => {
    const source = ['- Jackie (3 nodes)', '  - Implant', '  - Notation Engine', '- Charlie'].join('\n')

    expect(normalizeListIndentForLexical(source)).toBe(
      ['- Jackie (3 nodes)', '    - Implant', '    - Notation Engine', '- Charlie'].join('\n'),
    )
  })

  it('handles three-space, tab, and already-four-space nesting', () => {
    expect(normalizeListIndentForLexical('- a\n   - b')).toBe('- a\n    - b')
    expect(normalizeListIndentForLexical('- a\n\t- b')).toBe('- a\n    - b')
    expect(normalizeListIndentForLexical('- a\n    - b')).toBe('- a\n    - b')
  })

  it('resolves depth from structure, not from the raw column count', () => {
    const source = ['- a', '  - b', '    - c', '  - d', '- e'].join('\n')

    expect(normalizeListIndentForLexical(source)).toBe(
      ['- a', '    - b', '        - c', '    - d', '- e'].join('\n'),
    )
  })

  it('nests ordered lists and mixed markers', () => {
    expect(normalizeListIndentForLexical('1. a\n   1. b\n2. c')).toBe('1. a\n    1. b\n2. c')
    expect(normalizeListIndentForLexical('1. a\n   - b')).toBe('1. a\n    - b')
  })

  it('starts a fresh list after an intervening block', () => {
    const source = ['- a', '  - b', '', 'Some prose.', '', '- c', '  - d'].join('\n')

    expect(normalizeListIndentForLexical(source)).toBe(
      ['- a', '    - b', '', 'Some prose.', '', '- c', '    - d'].join('\n'),
    )
  })

  it('leaves fenced code blocks and frontmatter untouched', () => {
    const source = [
      '---',
      'tags:',
      '  - alpha',
      '  - beta',
      '---',
      '',
      '```yaml',
      'list:',
      '  - not a bullet',
      '```',
      '',
      '- a',
      '  - b',
    ].join('\n')

    expect(applyListIndentUnit(normalizeListIndentForLexical(source), 2)).toBe(source)
  })

  it('leaves thematic breaks and emphasis alone', () => {
    const source = ['---', '', '*emphasis* and text', '', '- a'].join('\n')
    expect(normalizeListIndentForLexical(source)).toBe(source)
  })
})

describe('detectListIndentUnit', () => {
  it.each([
    ['two-space bullets', '- a\n  - b', 2],
    ['three-space bullets', '- a\n   - b', 3],
    ['four-space bullets', '- a\n    - b', 4],
    ['tab bullets', '- a\n\t- b', 4],
    ['no nesting at all', '- a\n- b', 2],
    ['no lists at all', 'Just prose.', 2],
  ])('reads %s as %s', (_label, source, expected) => {
    expect(detectListIndentUnit(source)).toBe(expected)
  })

  it('reads a three-column step under an ordered parent as the two-space style', () => {
    // `1. ` is three columns wide, so its children cannot sit at two — three
    // here means the conventional style, not a three-space preference.
    expect(detectListIndentUnit('1. a\n   - b')).toBe(2)
  })

  it('prefers the bullet-parented step when both kinds are present', () => {
    expect(detectListIndentUnit('1. a\n     - b\n\n- c\n    - d')).toBe(4)
  })
})

describe('applyListIndentUnit', () => {
  it('re-indents Lexical output back to the document unit', () => {
    const exported = ['- Jackie (3 nodes)', '    - Implant', '    - Notation Engine'].join('\n')

    expect(applyListIndentUnit(exported, 2)).toBe(
      ['- Jackie (3 nodes)', '  - Implant', '  - Notation Engine'].join('\n'),
    )
  })

  it('never indents a child narrower than its parent marker', () => {
    // Two-space style, but `1. ` needs three columns for the child to parse
    // as a sub-list rather than a sibling.
    expect(applyListIndentUnit('1. a\n    - b', 2)).toBe('1. a\n   - b')
    expect(applyListIndentUnit('10. a\n    - b', 2)).toBe('10. a\n    - b')
  })

  it('accumulates nested levels from the emitted parent indent', () => {
    const exported = ['- a', '    - b', '        - c'].join('\n')
    expect(applyListIndentUnit(exported, 2)).toBe(['- a', '  - b', '    - c'].join('\n'))
  })

  it('round-trips a document at its own unit', () => {
    for (const source of [
      '- a\n  - b\n    - c\n- d',
      '- a\n    - b\n        - c\n- d',
      '1. a\n   1. b\n2. c',
    ]) {
      const unit = detectListIndentUnit(source)
      expect(applyListIndentUnit(normalizeListIndentForLexical(source), unit)).toBe(source)
    }
  })
})

describe('source-mode indent helpers', () => {
  const value = ['- a', '- b', '- c'].join('\n')

  it('indents the line the caret sits on', () => {
    const result = indentSourceLines({ value, start: 5, end: 5 }, 2)
    expect(result.value).toBe(['- a', '  - b', '- c'].join('\n'))
  })

  it('indents every list line the selection touches', () => {
    const result = indentSourceLines({ value, start: 1, end: 9 }, 2)
    expect(result.value).toBe(['  - a', '  - b', '  - c'].join('\n'))
  })

  it('outdents by at most one unit and stops at column zero', () => {
    const indented = ['- a', '    - b'].join('\n')
    const once = outdentSourceLines({ value: indented, start: 6, end: 6 }, 2)
    expect(once.value).toBe(['- a', '  - b'].join('\n'))

    const twice = outdentSourceLines({ value: once.value, start: 6, end: 6 }, 2)
    expect(twice.value).toBe(['- a', '- b'].join('\n'))

    const thrice = outdentSourceLines({ value: twice.value, start: 5, end: 5 }, 2)
    expect(thrice.value).toBe(['- a', '- b'].join('\n'))
  })

  it('leaves non-list lines alone', () => {
    const prose = ['Some prose.', '- a'].join('\n')
    expect(indentSourceLines({ value: prose, start: 0, end: 0 }, 2).value).toBe(prose)
  })

  it('outdents a tab-indented line', () => {
    expect(outdentSourceLines({ value: '- a\n\t- b', start: 5, end: 5 }, 2).value).toBe('- a\n- b')
  })
})
