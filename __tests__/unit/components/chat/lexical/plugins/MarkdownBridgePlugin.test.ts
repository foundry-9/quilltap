import { stripMarkdownEscapes } from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'

describe('stripMarkdownEscapes', () => {
  it('strips backslash escapes for configured characters', () => {
    const input = 'keep \\[this\\], strip \\*stars\\*, \\_underscores\\_, \\~tildes\\~, and \\`ticks\\`'
    const out = stripMarkdownEscapes(input, ['*', '_', '~', '`'])

    expect(out).toBe('keep \\[this\\], strip *stars*, _underscores_, ~tildes~, and `ticks`')
  })

  it('preserves escapes for characters not configured', () => {
    const input = '\\*star\\* \\_under\\_ \\~tilde\\~ \\`tick\\` \\[link\\]'
    const out = stripMarkdownEscapes(input, ['*'])

    expect(out).toBe('*star* \\_under\\_ \\~tilde\\~ \\`tick\\` \\[link\\]')
  })

  it('ignores invalid selector entries safely', () => {
    const input = String.raw`\*x\* \_y\_`
    const out = stripMarkdownEscapes(input, ['', '\\', 'ab', '*'])

    expect(out).toBe(String.raw`*x* \_y\_`)
  })
})
