import React from 'react'
import { screen } from '@testing-library/react'
import MessageContent from '@/components/chat/MessageContent'
import { QtapLinkContext, type QtapLinkOpener } from '@/components/qtap/QtapLinkContext'
// MessageContent reads the smart-typography display setting through TanStack
// Query, so it needs a QueryClientProvider around it.
import { renderWithQuery as render } from '../../../__tests__/helpers/renderWithQuery'

jest.mock('remark-gfm', () => () => undefined)
jest.mock('remark-breaks', () => () => undefined)
jest.mock('remark-math', () => () => undefined)
jest.mock('rehype-katex', () => () => undefined)
jest.mock('remark-smartypants', () => () => undefined)
jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}))
jest.mock('react-syntax-highlighter/dist/cjs/styles/prism', () => ({ oneDark: {} }))
jest.mock('react-markdown', () => {
  const React = require('react')

  function renderInline(content: string, components: Record<string, any>) {
    const parts = content.split(/(\[[^\]]+\]\([^\)]+\)|`[^`\n]*`)/g)
    return parts.filter(Boolean).map((part: string, index: number) => {
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^\)]+)\)$/)
      if (linkMatch) {
        const [, text, href] = linkMatch
        const LinkComp = components.a ?? ((props: any) => React.createElement('a', props, props.children))
        return React.createElement(LinkComp, { key: index, href }, text)
      }

      const codeMatch = part.match(/^`([^`\n]*)`$/)
      if (codeMatch) {
        const CodeComp = components.code ?? ((props: any) => React.createElement('code', props, props.children))
        return React.createElement(CodeComp, { key: index }, codeMatch[1])
      }

      return part
    })
  }

  function ReactMarkdownMock({ children, components = {} }: { children: React.ReactNode; components?: Record<string, any> }) {
    const content = typeof children === 'string' ? children : String(children ?? '')
    const Paragraph = components.p ?? ((props: any) => React.createElement('p', props, props.children))
    return React.createElement(Paragraph, null, renderInline(content, components))
  }

  return {
    __esModule: true,
    default: ReactMarkdownMock,
    defaultUrlTransform: (url: string) => url,
  }
})

describe('MessageContent qtap autolinking', () => {
  it('turns a bare surfaced qtap:// URI into a clickable in-app link', async () => {
    const opener: QtapLinkOpener = {
      resolve: jest.fn().mockResolvedValue({ exists: true, kind: 'document' }),
      open: jest.fn(),
    }

    render(
      <QtapLinkContext.Provider value={opener}>
        <MessageContent content={'The Librarian notes qtap://Notes/today.md for later.'} />
      </QtapLinkContext.Provider>
    )

    const link = await screen.findByRole('link', { name: 'qtap://Notes/today.md' })
    expect(link).toHaveAttribute('href', 'qtap://Notes/today.md')
  })

  it('leaves qtap:// text inside inline code inert', () => {
    const opener: QtapLinkOpener = {
      resolve: jest.fn(),
      open: jest.fn(),
    }

    render(
      <QtapLinkContext.Provider value={opener}>
        <MessageContent content={'Use `qtap://Notes/today.md` if you must.'} />
      </QtapLinkContext.Provider>
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('qtap://Notes/today.md')).toBeInTheDocument()
  })
})
/**
 * Bug 62 regression: the CLIENT renderer's fallback dialogue defaults.
 *
 * `MessageContent` and `renderMarkdownToHtml` are duplicated by convention — one
 * emits React nodes mid-stream, the other an HTML string once the message
 * settles — so the server suite's matching `shared defaults (fallback path)`
 * block proves nothing about the streaming path, which is what a reader actually
 * watches a reply arrive in. These assert the client half: with NO
 * `renderingPatterns` / `dialogueDetection` prop (and with the empty-array /
 * null forms that fall through to the same place), curly-quoted dialogue gets
 * `qt-chat-dialogue`.
 *
 * Everything downstream of `components.p` is the real component; only the
 * ESM-only markdown stack is mocked (see the top of this file).
 */
describe('MessageContent fallback dialogue defaults (bug 62)', () => {
  /** The rendered paragraph element, for block-level class assertions. */
  function paragraph(): HTMLElement {
    const p = document.querySelector('p')
    if (!p) throw new Error('MessageContent rendered no paragraph')
    return p
  }

  /** Every class on the styled inline spans inside the message. */
  function spanClasses(): string[] {
    return Array.from(document.querySelectorAll('span[class]')).map((el) => el.className)
  }

  describe('with no rendering props at all', () => {
    it('styles curly-quoted dialogue inline', () => {
      render(<MessageContent content={'\u201cGet down,\u201d she said.'} />)
      expect(screen.getByText('\u201cGet down,\u201d')).toHaveClass('qt-chat-dialogue')
    })

    it('still styles straight-quoted dialogue inline', () => {
      render(<MessageContent content={'"Get down," she said.'} />)
      expect(screen.getByText('"Get down,"')).toHaveClass('qt-chat-dialogue')
    })

    it('tags a wholly curly-quoted paragraph at the block level', () => {
      render(<MessageContent content={'\u201cGet down.\u201d'} />)
      expect(paragraph()).toHaveClass('qt-chat-dialogue')
    })

    it('tags a wholly straight-quoted paragraph at the block level', () => {
      render(<MessageContent content={'"Get down."'} />)
      expect(paragraph()).toHaveClass('qt-chat-dialogue')
    })

    it('leaves a narrative paragraph unstyled', () => {
      render(<MessageContent content={'She said nothing at all.'} />)
      expect(paragraph()).not.toHaveClass('qt-chat-dialogue')
      expect(spanClasses()).not.toContain('qt-chat-dialogue')
    })

    it('leaves apostrophes alone, single quotes being deliberately not dialogue', () => {
      render(<MessageContent content={"She didn't move; the writers' room was quiet."} />)
      expect(paragraph()).not.toHaveClass('qt-chat-dialogue')
      expect(spanClasses()).not.toContain('qt-chat-dialogue')
    })

    it('leaves curly apostrophes alone', () => {
      render(<MessageContent content={'She didn\u2019t move.'} />)
      expect(spanClasses()).not.toContain('qt-chat-dialogue')
    })
  })

  describe('empty / null props fall through to the same defaults', () => {
    it('an empty renderingPatterns array still styles curly dialogue', () => {
      render(<MessageContent content={'\u201cGet down,\u201d she said.'} renderingPatterns={[]} />)
      expect(screen.getByText('\u201cGet down,\u201d')).toHaveClass('qt-chat-dialogue')
    })

    it('a null dialogueDetection still tags a curly-quoted paragraph', () => {
      render(<MessageContent content={'\u201cGet down.\u201d'} dialogueDetection={null} />)
      expect(paragraph()).toHaveClass('qt-chat-dialogue')
    })
  })

  describe('the template path must not move', () => {
    // Standard Roleplay's stored dialogue config, copied from
    // lib/database/repositories/roleplay-templates.repository.ts.
    const SEEDED_PATTERNS = [
      { pattern: '["\u201c][^"\u201d]+["\u201d]', className: 'qt-chat-dialogue' },
    ]
    const SEEDED_DETECTION = {
      openingChars: ['"', '\u201c'],
      closingChars: ['"', '\u201d'],
      className: 'qt-chat-dialogue',
    }

    it.each([
      ['\u201cGet down,\u201d she said.'],
      ['"Get down," she said.'],
      ['\u201cGet down.\u201d'],
      ['"Get down."'],
      ['She said nothing at all.'],
    ])('the defaults now render %p identically to the seeded template', (content) => {
      const { container: withDefaults, unmount } = render(<MessageContent content={content} />)
      const defaultsHtml = withDefaults.innerHTML
      unmount()

      const { container: withTemplate } = render(
        <MessageContent
          content={content}
          renderingPatterns={SEEDED_PATTERNS}
          dialogueDetection={SEEDED_DETECTION}
        />
      )
      expect(defaultsHtml).toBe(withTemplate.innerHTML)
    })
  })
})
