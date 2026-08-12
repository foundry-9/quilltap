/**
 * Tests for the composer gutter palette's Compose Mail button and the
 * custom-tools slot.
 *
 * Verifies the mail button fires `onComposeMailClick` and respects `disabled`,
 * and that the custom-tools dropdown appears only when a roster resolved.
 */

import { describe, it, expect, jest as jestGlobal } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ComposerGutterTools from '@/components/chat/ComposerGutterTools'

// RngDropdown makes API calls and manages its own popover — out of scope here.
jest.mock('@/components/chat/RngDropdown', () => ({
  __esModule: true,
  default: () => <div data-testid="rng-dropdown" />,
}))

// Likewise CustomToolsButton: its dialog needs a QueryClient and fetches a
// roster. Here we only care whether the gutter gives it a slot at all.
jest.mock('@/components/chat/CustomToolsButton', () => ({
  __esModule: true,
  default: () => <div data-testid="custom-tools-button" />,
}))

function renderTools(overrides: Partial<React.ComponentProps<typeof ComposerGutterTools>> = {}) {
  const onComposeMailClick = jestGlobal.fn()
  render(
    <ComposerGutterTools
      onAttachFileClick={() => {}}
      onLibraryFileClick={() => {}}
      onStandaloneGenerateImageClick={() => {}}
      onInsertAnnouncementClick={() => {}}
      onComposeMailClick={onComposeMailClick}
      chatId="chat-1"
      {...overrides}
    />,
  )
  return { onComposeMailClick }
}

describe('ComposerGutterTools — Compose Mail button', () => {
  it('fires onComposeMailClick when clicked', () => {
    const { onComposeMailClick } = renderTools()
    fireEvent.click(screen.getByRole('button', { name: 'Post a letter' }))
    expect(onComposeMailClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled (and does not fire) when the palette is disabled', () => {
    const { onComposeMailClick } = renderTools({ disabled: true })
    const button = screen.getByRole('button', { name: 'Post a letter' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onComposeMailClick).not.toHaveBeenCalled()
  })
})

describe('ComposerGutterTools — custom tools slot', () => {
  it('omits the custom tools button when no roster resolved', () => {
    renderTools()
    expect(screen.queryByTestId('custom-tools-button')).toBeNull()
  })

  it('renders the custom tools button when a roster is available', () => {
    renderTools({ customToolsAvailable: true })
    expect(screen.getByTestId('custom-tools-button')).toBeTruthy()
  })
})
