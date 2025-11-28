/**
 * Unit tests for DeletedImagePlaceholder component
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DeletedImagePlaceholder from '@/components/images/DeletedImagePlaceholder'

// Mock the alert and toast utilities
jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn(),
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
}))

// Mock fetch
global.fetch = jest.fn()

describe('DeletedImagePlaceholder', () => {
  const mockImageId = 'test-image-id'
  const mockFilename = 'test-image.png'
  const mockOnCleanup = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockClear()
  })

  describe('Rendering', () => {
    it('should render with default (non-compact) styling', () => {
      render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
        />
      )

      expect(screen.getByText('Image Deleted')).toBeInTheDocument()
      expect(screen.getByText(mockFilename)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    })

    it('should render with compact styling when !p-2 class is present', () => {
      render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
          className="!p-2"
        />
      )

      expect(screen.getByText('Image Deleted')).toBeInTheDocument()
      // Filename should be hidden in compact mode
      expect(screen.queryByText(mockFilename)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    })

    it('should apply custom width and height when provided', () => {
      const { container } = render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
          width={500}
          height={300}
        />
      )

      const element = container.firstChild as HTMLElement
      expect(element.style.width).toBe('500px')
      expect(element.style.height).toBe('300px')
    })

    it('should not apply width/height when w-full and h-full classes are present', () => {
      const { container } = render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
          width={500}
          height={300}
          className="w-full h-full"
        />
      )

      const element = container.firstChild as HTMLElement
      expect(element.style.width).toBe('')
      expect(element.style.height).toBe('')
    })

    it('should render with custom className', () => {
      const { container } = render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
          className="custom-class"
        />
      )

      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  describe('Cleanup functionality', () => {
    it('should call onCleanup after successful deletion', async () => {
      const { showConfirmation } = require('@/lib/alert')
      showConfirmation.mockResolvedValue(true)
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      })

      render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
        />
      )

      const removeButton = screen.getByRole('button', { name: /remove/i })
      fireEvent.click(removeButton)

      await waitFor(() => {
        expect(showConfirmation).toHaveBeenCalledWith(
          'This image file has been deleted. Remove this reference from the database?'
        )
      })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(`/api/images/${mockImageId}`, {
          method: 'DELETE',
        })
      })

      await waitFor(() => {
        expect(mockOnCleanup).toHaveBeenCalled()
      })
    })

    it('should not proceed if user cancels confirmation', async () => {
      const { showConfirmation } = require('@/lib/alert')
      showConfirmation.mockResolvedValue(false)

      render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
        />
      )

      const removeButton = screen.getByRole('button', { name: /remove/i })
      fireEvent.click(removeButton)

      await waitFor(() => {
        expect(showConfirmation).toHaveBeenCalled()
      })

      expect(global.fetch).not.toHaveBeenCalled()
      expect(mockOnCleanup).not.toHaveBeenCalled()
    })

    it('should show error toast on deletion failure', async () => {
      const { showConfirmation } = require('@/lib/alert')
      const { showErrorToast } = require('@/lib/toast')
      showConfirmation.mockResolvedValue(true)
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Failed to delete image' }),
      })

      render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
        />
      )

      const removeButton = screen.getByRole('button', { name: /remove/i })
      fireEvent.click(removeButton)

      await waitFor(() => {
        expect(showErrorToast).toHaveBeenCalledWith('Failed to delete image')
      })

      expect(mockOnCleanup).not.toHaveBeenCalled()
    })

    it('should handle network errors gracefully', async () => {
      const { showConfirmation } = require('@/lib/alert')
      const { showErrorToast } = require('@/lib/toast')
      showConfirmation.mockResolvedValue(true)
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'))

      render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
        />
      )

      const removeButton = screen.getByRole('button', { name: /remove/i })
      fireEvent.click(removeButton)

      await waitFor(() => {
        expect(showErrorToast).toHaveBeenCalledWith('Network error')
      })

      expect(mockOnCleanup).not.toHaveBeenCalled()
    })

    it('should work without onCleanup callback', async () => {
      const { showConfirmation } = require('@/lib/alert')
      showConfirmation.mockResolvedValue(true)
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      })

      render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
        />
      )

      const removeButton = screen.getByRole('button', { name: /remove/i })
      fireEvent.click(removeButton)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      // Should not throw error when onCleanup is undefined
    })
  })

  describe('Accessibility', () => {
    it('should have proper button role', () => {
      render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
        />
      )

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should have descriptive text for screen readers', () => {
      render(
        <DeletedImagePlaceholder
          imageId={mockImageId}
          filename={mockFilename}
          onCleanup={mockOnCleanup}
        />
      )

      expect(screen.getByText('Image Deleted')).toBeInTheDocument()
    })
  })
})
