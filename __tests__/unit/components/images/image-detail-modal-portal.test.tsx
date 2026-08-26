/**
 * Regression coverage for bug 99 — the gallery's image-detail overlay rendered
 * in place, so inside `/workspace` it landed within `.qt-workspace`, whose
 * `isolation: isolate` trapped its `z-[60]` in the workspace's own stacking
 * context. The sticky `.qt-page-toolbar` (z-30) then painted over the top-right
 * Download / Copy / Close controls: under the Electron shell, which has no
 * right-click "Save Image", a picture in a character's album could not be
 * saved at all. The affordance was in the DOM the whole time, merely covered.
 *
 * The fix portals the overlay to `document.body`, escaping the isolating
 * ancestor entirely. That is a structural property, not a visual one, so it is
 * assertable here: the overlay's parent chain must not pass through the mount.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import ImageDetailModal from '@/components/images/image-detail/ImageDetailModal'
import type { ImageData } from '@/components/images/image-detail/types'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/hooks/useImageNavigation', () => ({
  useImageNavigation: jest.fn(),
}))

jest.mock('@/components/images/image-detail/hooks/useImageActions', () => ({
  useImageActions: () => ({
    characterGalleryLinks: [],
    savingToGalleryFor: null,
    settingAvatar: false,
    addToCharacterGallery: jest.fn(),
    removeFromCharacterGallery: jest.fn(),
    setAsAvatar: jest.fn(),
    handleDownload: jest.fn(),
    handleCopyToClipboard: jest.fn(),
    handleSaveToGallery: jest.fn(),
    savingToGallery: false,
    updateCharacterGalleryLinks: jest.fn(),
  }),
}))

jest.mock('@/components/images/image-detail/ImageActions', () => ({
  ImageActions: () => <div data-testid="image-actions">actions</div>,
}))

jest.mock('@/components/images/image-detail/ImageMetadata', () => ({
  ImageMetadata: () => <div data-testid="image-metadata">metadata</div>,
}))

jest.mock('@/components/images/DeletedImagePlaceholder', () => ({
  __esModule: true,
  default: () => <div>deleted</div>,
}))

const image: ImageData = {
  id: 'img-1',
  filename: 'conservatory.webp',
  filepath: '/files/conservatory.webp',
  mimeType: 'image/webp',
  size: 1024,
  createdAt: '2026-08-01T00:00:00.000Z',
}

function renderInIsolatingWorkspace(isOpen = true) {
  // Stand in for the real `/workspace` shell: an `isolation: isolate` ancestor
  // is exactly what turned the overlay's z-index into a local ordinal.
  const workspace = document.createElement('div')
  workspace.className = 'qt-workspace'
  workspace.style.isolation = 'isolate'
  document.body.appendChild(workspace)

  const view = render(
    <ImageDetailModal isOpen={isOpen} image={image} onClose={jest.fn()} />,
    { container: workspace }
  )
  return { workspace, view }
}

describe('ImageDetailModal — bug 99 (controls painted over by the page toolbar)', () => {
  it('renders its overlay outside the isolating workspace mount, not inside it', () => {
    const { workspace } = renderInIsolatingWorkspace()

    const actions = screen.getByTestId('image-actions')
    expect(actions).toBeInTheDocument()
    // The bug in one line: before the portal, the controls lived under the
    // isolating ancestor and could never outrank its sticky toolbar.
    expect(workspace.contains(actions)).toBe(false)
  })

  it('portals the overlay to document.body so no ancestor can trap its stacking context', () => {
    renderInIsolatingWorkspace()

    const overlay = screen.getByTestId('image-actions').closest('.fixed')
    expect(overlay).not.toBeNull()
    expect(overlay!.parentElement).toBe(document.body)
  })

  it('renders nothing at all when closed', () => {
    const { workspace } = renderInIsolatingWorkspace(false)
    expect(workspace.innerHTML).toBe('')
  })
})
