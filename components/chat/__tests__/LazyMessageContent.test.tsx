import React from 'react'
import { render, screen } from '@testing-library/react'
import LazyMessageContent from '@/components/chat/LazyMessageContent'

jest.mock('@/components/chat/MessageContent', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: ({ content }: { content: string }) => (
      <div data-testid="message-content-fallback">{content}</div>
    ),
  }
})

describe('LazyMessageContent qtap renderedHtml behavior', () => {
  it('falls back to MessageContent when content has qtap:// but renderedHtml is stale', () => {
    render(
      <LazyMessageContent
        content={'The Librarian noted qtap://Notes/today.md.'}
        renderedHtml={'<p>The Librarian noted qtap://Notes/today.md.</p>'}
      />
    )

    expect(screen.getByTestId('message-content-fallback')).toBeInTheDocument()
    expect(screen.queryByText('The Librarian noted qtap://Notes/today.md.')).toBeInTheDocument()
  })

  it('still falls back to MessageContent even when renderedHtml already has a qtap link', () => {
    render(
      <LazyMessageContent
        content={'The Librarian noted qtap://Notes/today.md.'}
        renderedHtml={'<p>The Librarian noted <a href="qtap://Notes/today.md">qtap://Notes/today.md</a>.</p>'}
      />
    )

    expect(screen.getByTestId('message-content-fallback')).toBeInTheDocument()
  })
})
