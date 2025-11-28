/**
 * Unit tests for PhotoGalleryModal component's deleted image handling
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PhotoGalleryModal from '@/components/images/PhotoGalleryModal'

// Mock the dependencies
jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

jest.mock('@/components/chat/ChatGalleryImageViewModal', () => ({
  __esModule: true,
  default: () => <div>ChatGalleryImageViewModal</div>,
}))

jest.mock('@/components/images/ImageDetailModal', () => ({
  __esModule: true,
  default: () => <div>ImageDetailModal</div>,
}))

jest.mock('@/components/images/DeletedImagePlaceholder', () => ({
  __esModule: true,
  default: ({ imageId, filename, onCleanup }: any) => (
    <div data-testid={`deleted-placeholder-${imageId}`}>
      <span>Image Deleted: {filename}</span>
      <button onClick={onCleanup}>Remove</button>
    </div>
  ),
}))

// Mock fetch
global.fetch = jest.fn()

describe('PhotoGalleryModal - Deleted Image Handling', () => {
  const mockChatFiles = [
    {
      id: 'file-1',
      filename: 'valid.png',
      filepath: '/uploads/valid.png',
      mimeType: 'image/png',
      size: 1024,
      url: '/uploads/valid.png',
      createdAt: '2025-01-01T00:00:00Z',
    },
    {
      id: 'file-2',
      filename: 'missing.png',
      filepath: '/uploads/missing.png',
      mimeType: 'image/png',
      size: 1024,
      url: '/uploads/missing.png',
      createdAt: '2025-01-01T00:00:00Z',
    },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    document.body.style.overflow = '' // Reset overflow
    ;(global.fetch as jest.Mock).mockImplementation((url) => {
      if (url.includes('/api/chats/')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ files: mockChatFiles }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      })
    })
  })

  describe('Chat mode - deleted image handling', () => {
    it('should render chat photos and detect missing images', async () => {
      render(
        <PhotoGalleryModal
          mode="chat"
          isOpen={true}
          onClose={jest.fn()}
          chatId="chat-1"
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Chat Photos')).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(screen.getAllByRole('img')).toHaveLength(2)
      })

      const images = screen.getAllByRole('img')

      // Simulate error on second image
      fireEvent.error(images[1])

      await waitFor(() => {
        expect(screen.getByTestId('deleted-placeholder-file-2')).toBeInTheDocument()
        expect(screen.getByText(/Image Deleted: missing.png/)).toBeInTheDocument()
      })
    })

    it('should use div container for missing images (not button)', async () => {
      const { container } = render(
        <PhotoGalleryModal
          mode="chat"
          isOpen={true}
          onClose={jest.fn()}
          chatId="chat-1"
        />
      )

      await waitFor(() => {
        expect(screen.getAllByRole('img')).toHaveLength(2)
      })

      const images = screen.getAllByRole('img')

      // Trigger error
      fireEvent.error(images[1])

      await waitFor(() => {
        expect(screen.getByTestId('deleted-placeholder-file-2')).toBeInTheDocument()
      })

      // The container for the deleted image should be a div, not a button
      const placeholder = screen.getByTestId('deleted-placeholder-file-2')
      const containerElement = placeholder.closest('.relative.rounded')
      expect(containerElement?.tagName).toBe('DIV')
    })

    it('should use button container for valid images', async () => {
      render(
        <PhotoGalleryModal
          mode="chat"
          isOpen={true}
          onClose={jest.fn()}
          chatId="chat-1"
        />
      )

      await waitFor(() => {
        expect(screen.getAllByRole('img')).toHaveLength(2)
      })

      // Valid images should be in button containers
      const buttons = screen.getAllByRole('button').filter(
        (btn) => !btn.textContent?.includes('Remove') && !btn.textContent?.includes('Close')
      )
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should reload gallery after cleanup', async () => {
      render(
        <PhotoGalleryModal
          mode="chat"
          isOpen={true}
          onClose={jest.fn()}
          chatId="chat-1"
        />
      )

      await waitFor(() => {
        expect(screen.getAllByRole('img')).toHaveLength(2)
      })

      const images = screen.getAllByRole('img')
      fireEvent.error(images[1])

      await waitFor(() => {
        expect(screen.getByTestId('deleted-placeholder-file-2')).toBeInTheDocument()
      })

      // Clear fetch mock
      ;(global.fetch as jest.Mock).mockClear()

      // Click remove
      const removeButton = screen.getByText('Remove')
      fireEvent.click(removeButton)

      await waitFor(() => {
        // Should reload the gallery
        expect(global.fetch).toHaveBeenCalledWith('/api/chats/chat-1/files')
      })
    })
  })

  describe('Character mode - deleted image handling', () => {
    beforeEach(() => {
      ;(global.fetch as jest.Mock).mockImplementation((url) => {
        if (url.includes('/api/images')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: [
                {
                  id: 'img-1',
                  filename: 'char-img.png',
                  filepath: '/uploads/char-img.png',
                  url: '/uploads/char-img.png',
                  mimeType: 'image/png',
                  size: 1024,
                  createdAt: '2025-01-01T00:00:00Z',
                },
              ],
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        })
      })
    })

    it('should handle deleted images in character mode', async () => {
      render(
        <PhotoGalleryModal
          mode="character"
          isOpen={true}
          onClose={jest.fn()}
          characterId="char-1"
          characterName="Test Character"
        />
      )

      await waitFor(() => {
        expect(screen.getByText("Test Character's Photos")).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument()
      })

      const image = screen.getByRole('img')
      fireEvent.error(image)

      await waitFor(() => {
        expect(screen.getByTestId('deleted-placeholder-img-1')).toBeInTheDocument()
      })
    })
  })

  describe('Persona mode - deleted image handling', () => {
    beforeEach(() => {
      ;(global.fetch as jest.Mock).mockImplementation((url) => {
        if (url.includes('/api/images')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: [
                {
                  id: 'img-2',
                  filename: 'persona-img.png',
                  filepath: '/uploads/persona-img.png',
                  url: '/uploads/persona-img.png',
                  mimeType: 'image/png',
                  size: 1024,
                  createdAt: '2025-01-01T00:00:00Z',
                },
              ],
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        })
      })
    })

    it('should handle deleted images in persona mode', async () => {
      render(
        <PhotoGalleryModal
          mode="persona"
          isOpen={true}
          onClose={jest.fn()}
          personaId="persona-1"
          personaName="Test Persona"
        />
      )

      await waitFor(() => {
        expect(screen.getByText("Test Persona's Photos")).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument()
      })

      const image = screen.getByRole('img')
      fireEvent.error(image)

      await waitFor(() => {
        expect(screen.getByTestId('deleted-placeholder-img-2')).toBeInTheDocument()
      })
    })
  })

  describe('Modal behavior', () => {
    it('should close modal when close button is clicked', async () => {
      const mockOnClose = jest.fn()
      render(
        <PhotoGalleryModal
          mode="chat"
          isOpen={true}
          onClose={mockOnClose}
          chatId="chat-1"
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Chat Photos')).toBeInTheDocument()
      })

      const closeButton = screen.getByTitle('Close')
      fireEvent.click(closeButton)

      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should not render when isOpen is false', () => {
      render(
        <PhotoGalleryModal
          mode="chat"
          isOpen={false}
          onClose={jest.fn()}
          chatId="chat-1"
        />
      )

      expect(screen.queryByText('Chat Photos')).not.toBeInTheDocument()
    })

    it('should lock body overflow when open', async () => {
      render(
        <PhotoGalleryModal
          mode="chat"
          isOpen={true}
          onClose={jest.fn()}
          chatId="chat-1"
        />
      )

      await waitFor(() => {
        expect(document.body.style.overflow).toBe('hidden')
      })
    })
  })

  describe('Thumbnail sizing', () => {
    it('should support zoom in/out functionality', async () => {
      render(
        <PhotoGalleryModal
          mode="chat"
          isOpen={true}
          onClose={jest.fn()}
          chatId="chat-1"
        />
      )

      await waitFor(() => {
        expect(screen.getByTitle('Larger thumbnails')).toBeInTheDocument()
      })

      const zoomInButton = screen.getByTitle('Larger thumbnails')
      const zoomOutButton = screen.getByTitle('Smaller thumbnails')

      // Should be enabled initially (default is index 2)
      expect(zoomInButton).not.toBeDisabled()
      expect(zoomOutButton).not.toBeDisabled()
    })
  })
})
