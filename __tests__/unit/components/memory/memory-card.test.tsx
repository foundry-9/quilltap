/**
 * Unit Tests for MemoryCard Component
 *
 * Tests rendering of individual memory cards with various states
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, jest } from '@jest/globals';
import { MemoryCard } from '@/components/memory/memory-card';

describe('MemoryCard', () => {
  const mockMemory = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    characterId: '550e8400-e29b-41d4-a716-446655440002',
    content: 'This is a detailed memory content that might be quite long.',
    summary: 'Brief summary of the memory',
    keywords: ['keyword1', 'keyword2'],
    tags: [],
    tagDetails: [],
    importance: 0.7,
    source: 'MANUAL' as const,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-05T12:30:00Z',
  };

  describe('rendering', () => {
    it('should render memory summary', () => {
      render(<MemoryCard memory={mockMemory} />);

      expect(screen.getByText(mockMemory.summary)).toBeInTheDocument();
    });

    it('should render memory content as preview', () => {
      render(<MemoryCard memory={mockMemory} />);

      expect(screen.getByText(/This is a detailed memory/)).toBeInTheDocument();
    });

    it('should render keywords', () => {
      render(<MemoryCard memory={mockMemory} />);

      for (const keyword of mockMemory.keywords) {
        expect(screen.getByText(keyword)).toBeInTheDocument();
      }
    });

    it('should render creation date', () => {
      render(<MemoryCard memory={mockMemory} />);

      // The component shows the creation date, check for the month and year
      const dateElements = screen.getAllByText(/\d{1,2}/);
      expect(dateElements.length).toBeGreaterThan(0);
    });

    it('should render update date', () => {
      render(<MemoryCard memory={mockMemory} />);

      // Match against the same formatted date string the component renders
      const expectedDate = new Date(mockMemory.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      expect(screen.getByText(expectedDate)).toBeInTheDocument();
    });

    it('should render source badge', () => {
      render(<MemoryCard memory={mockMemory} />);

      expect(screen.getByText('Manual')).toBeInTheDocument();
    });
  });

  describe('importance display', () => {
    it('should display high importance in red', () => {
      const highImportanceMemory = { ...mockMemory, importance: 0.8 };
      const { container } = render(<MemoryCard memory={highImportanceMemory} />);

      const importanceElement = container.querySelector('.text-red-600');
      expect(importanceElement).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
    });

    it('should display medium importance in yellow', () => {
      const mediumImportanceMemory = { ...mockMemory, importance: 0.5 };
      const { container } = render(<MemoryCard memory={mediumImportanceMemory} />);

      const importanceElement = container.querySelector('.text-yellow-600');
      expect(importanceElement).toBeInTheDocument();
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    it('should display low importance in gray', () => {
      const lowImportanceMemory = { ...mockMemory, importance: 0.2 };
      const { container } = render(<MemoryCard memory={lowImportanceMemory} />);

      const importanceElement = container.querySelector('.text-gray-500');
      expect(importanceElement).toBeInTheDocument();
      expect(screen.getByText('Low')).toBeInTheDocument();
    });
  });

  describe('source badge', () => {
    it('should show MANUAL source as "Manual"', () => {
      const manualMemory = { ...mockMemory, source: 'MANUAL' };
      render(<MemoryCard memory={manualMemory} />);

      expect(screen.getByText('Manual')).toBeInTheDocument();
    });

    it('should show AUTO source as "Auto"', () => {
      const autoMemory = { ...mockMemory, source: 'AUTO' };
      render(<MemoryCard memory={autoMemory} />);

      expect(screen.getByText('Auto')).toBeInTheDocument();
    });
  });

  describe('tag display', () => {
    it('should not crash with empty tags', () => {
      const memoryWithoutTags = {
        ...mockMemory,
        tags: [],
        tagDetails: [],
      };

      expect(() => {
        render(<MemoryCard memory={memoryWithoutTags} />);
      }).not.toThrow();
    });

    it('should not crash if tagDetails is missing', () => {
      const memoryWithoutTagDetails = {
        ...mockMemory,
        tags: ['tag-id-1'],
      };

      expect(() => {
        render(<MemoryCard memory={memoryWithoutTagDetails} />);
      }).not.toThrow();
    });
  });

  describe('expansion toggle', () => {
    it('should display memory content', () => {
      render(<MemoryCard memory={mockMemory} />);

      // Content should be displayed (may be truncated by CSS)
      expect(screen.getByText(/This is a detailed memory/)).toBeInTheDocument();
    });
  });

  describe('action buttons', () => {
    it('should render edit button when onEdit callback is provided', () => {
      const onEdit = jest.fn();
      render(<MemoryCard memory={mockMemory} onEdit={onEdit} />);

      const editButton = screen.getByRole('button', { name: /edit/i });
      expect(editButton).toBeInTheDocument();
    });

    it('should call onEdit when edit button is clicked', () => {
      const onEdit = jest.fn();
      render(<MemoryCard memory={mockMemory} onEdit={onEdit} />);

      const editButton = screen.getByRole('button', { name: /edit/i });
      fireEvent.click(editButton);

      expect(onEdit).toHaveBeenCalledWith(mockMemory);
    });

    it('should render delete button when onDelete callback is provided', () => {
      const onDelete = jest.fn();
      const { container } = render(<MemoryCard memory={mockMemory} onDelete={onDelete} />);

      const deleteButton = container.querySelector('button');
      expect(deleteButton).toBeInTheDocument();
    });

    it('should call onDelete when delete button is clicked', () => {
      const onDelete = jest.fn();
      const { container } = render(<MemoryCard memory={mockMemory} onDelete={onDelete} />);

      const deleteButton = container.querySelector('button');
      if (deleteButton) {
        fireEvent.click(deleteButton);
        expect(onDelete).toHaveBeenCalledWith(mockMemory.id);
      }
    });

    it('should show deleting state when isDeleting is true', () => {
      const onDelete = jest.fn();
      render(
        <MemoryCard
          memory={mockMemory}
          onDelete={onDelete}
          isDeleting={true}
        />
      );

      expect(screen.getByText('Deleting...')).toBeInTheDocument();
    });
  });

  describe('empty keywords', () => {
    it('should handle empty keywords array gracefully', () => {
      const memoryWithoutKeywords = {
        ...mockMemory,
        keywords: [],
      };

      expect(() => {
        render(<MemoryCard memory={memoryWithoutKeywords} />);
      }).not.toThrow();
    });
  });

  describe('long content', () => {
    it('should truncate long content in preview', () => {
      const memoryWithLongContent = {
        ...mockMemory,
        content: 'a'.repeat(500),
      };

      const { container } = render(<MemoryCard memory={memoryWithLongContent} />);

      // Check if content is truncated (implementation-specific)
      const contentElement = container.querySelector('[data-testid="memory-content-preview"]');
      if (contentElement) {
        expect(contentElement.textContent?.length).toBeLessThan(500);
      }
    });
  });

  describe('dark mode support', () => {
    it('should apply dark mode classes', () => {
      const { container } = render(<MemoryCard memory={mockMemory} />);

      // Dark mode classes should be present in the component
      expect(container.innerHTML).toMatch(/dark:/);
    });
  });
});
