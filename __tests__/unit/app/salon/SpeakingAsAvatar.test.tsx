/**
 * Unit tests for the SpeakingAsAvatar composer cue.
 *
 * Covers the two behaviours the feature promises:
 * - it always names the character the human is speaking as (title/aria-label)
 *   and shows their portrait,
 * - it renders at full brightness when the human may type and dims to near-dark
 *   while a reply is in flight (Bug 46 cue).
 */

import { describe, it, expect } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { SpeakingAsAvatar } from '@/app/salon/[id]/components/SpeakingAsAvatar'

describe('SpeakingAsAvatar', () => {
  it('names and pictures the character being spoken as, bright when the human may type', () => {
    render(
      <SpeakingAsAvatar
        name="Charlie"
        src={{ avatarUrl: '/files/charlie.webp' }}
        canType
      />,
    )

    const cue = screen.getByLabelText('Speaking as Charlie')
    expect(cue).toHaveAttribute('title', 'Speaking as Charlie')
    expect(cue.className).toContain('opacity-100')
    expect(cue.className).not.toContain('brightness-50')

    const img = screen.getByAltText('Charlie') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/files/charlie.webp')
  })

  it('dims to near-dark while a reply is in flight', () => {
    render(<SpeakingAsAvatar name="Charlie" canType={false} />)

    const cue = screen.getByLabelText('Speaking as Charlie, waiting for the room')
    expect(cue).toHaveAttribute('title', 'Speaking as Charlie — waiting for the room')
    expect(cue.className).toContain('brightness-50')
  })

  it('falls back to the initial when there is no portrait', () => {
    render(<SpeakingAsAvatar name="Charlie" canType />)
    expect(screen.getByText('C')).toBeInTheDocument()
  })
})
