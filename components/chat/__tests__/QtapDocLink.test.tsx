/**
 * Unit tests for the shared qtap:// link renderer.
 *
 * Parse failure / pending / missing → plain text; existing targets become
 * active in-app links and carry their resolved target kind through to the
 * opener so Document Mode, the image viewer, and unsupported-target warnings
 * can all share one clickable surface.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import { QtapLink } from '@/components/qtap/QtapLink'
import { QtapLinkContext, type QtapLinkOpener } from '@/components/qtap/QtapLinkContext'

function renderWithOpener(href: string, opener: QtapLinkOpener) {
  return render(
    <QtapLinkContext.Provider value={opener}>
      <QtapLink href={href}>the doc</QtapLink>
    </QtapLinkContext.Provider>
  )
}

describe('QtapLink', () => {
  it('renders plain text (no link) when the URI fails to parse', () => {
    const opener: QtapLinkOpener = { resolve: jest.fn(), open: jest.fn() }
    // Not a qtap:// URI at all → parseQtapUri throws → plain text.
    render(
      <QtapLinkContext.Provider value={opener}>
        <QtapLink href={'https://example.com'}>the doc</QtapLink>
      </QtapLinkContext.Provider>
    )
    expect(screen.getByText('the doc')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(opener.resolve).not.toHaveBeenCalled()
  })

  it('renders inert (non-link) text while the existence check is pending', () => {
    let resolve!: (v: { exists: boolean; kind: 'document' | 'image' | 'other' }) => void
    const opener: QtapLinkOpener = {
      resolve: jest.fn(() => new Promise((r) => { resolve = r })),
      open: jest.fn(),
    }
    renderWithOpener('qtap://Notes/today.md', opener)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    const span = screen.getByText('the doc')
    expect(span.tagName).toBe('SPAN')
    expect(span).toHaveClass('qt-qtap-doc--inert')
    resolve({ exists: true, kind: 'document' })
  })

  it('upgrades to an active link when the document exists, and opens Document Mode on click', async () => {
    const open = jest.fn()
    const opener: QtapLinkOpener = {
      resolve: jest.fn().mockResolvedValue({ exists: true, kind: 'document' }),
      open,
    }
    renderWithOpener('qtap://Notes/today.md', opener)
    const link = await screen.findByRole('link')
    expect(link).toHaveAttribute('href', 'qtap://Notes/today.md')

    fireEvent.click(link)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'document_store', mountPoint: 'Notes', path: 'today.md' }),
      { exists: true, kind: 'document' },
      'qtap://Notes/today.md',
    )
  })

  it('opens image qtap:// links with the resolved image target kind', async () => {
    const open = jest.fn()
    const opener: QtapLinkOpener = {
      resolve: jest.fn().mockResolvedValue({ exists: true, kind: 'image' }),
      open,
    }
    renderWithOpener('qtap://Notes/cover.webp', opener)

    const link = await screen.findByRole('link')
    fireEvent.click(link)

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'document_store', mountPoint: 'Notes', path: 'cover.webp' }),
      { exists: true, kind: 'image' },
      'qtap://Notes/cover.webp',
    )
  })

  it('stays plain text when the document does not exist / is inaccessible', async () => {
    const opener: QtapLinkOpener = {
      resolve: jest.fn().mockResolvedValue({ exists: false, kind: 'other' }),
      open: jest.fn(),
    }
    renderWithOpener('qtap://Notes/missing.md', opener)
    await waitFor(() => expect(opener.resolve).toHaveBeenCalled())
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('the doc').tagName).toBe('SPAN')
  })

  it('keeps unsupported but existing qtap:// targets clickable so the opener can warn', async () => {
    const open = jest.fn()
    const opener: QtapLinkOpener = {
      resolve: jest.fn().mockResolvedValue({ exists: true, kind: 'other' }),
      open,
    }
    renderWithOpener('qtap://Notes/archive.pdf', opener)

    const link = await screen.findByRole('link')
    fireEvent.click(link)

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'document_store', mountPoint: 'Notes', path: 'archive.pdf' }),
      { exists: true, kind: 'other' },
      'qtap://Notes/archive.pdf',
    )
  })

  it('renders plain text when there is no qtap link context', () => {
    render(
      <QtapLinkContext.Provider value={null}>
        <QtapLink href={'qtap://Notes/today.md'}>the doc</QtapLink>
      </QtapLinkContext.Provider>
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('the doc')).toBeInTheDocument()
  })
})
