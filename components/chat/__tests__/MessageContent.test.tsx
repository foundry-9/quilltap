import React from 'react'
import { render, screen } from '@testing-library/react'
import MessageContent from '@/components/chat/MessageContent'
import { QtapLinkContext, type QtapLinkOpener } from '@/components/qtap/QtapLinkContext'

jest.mock('remark-gfm', () => () => undefined)
jest.mock('remark-breaks', () => () => undefined)
jest.mock('remark-math', () => () => undefined)
jest.mock('rehype-katex', () => () => undefined)
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