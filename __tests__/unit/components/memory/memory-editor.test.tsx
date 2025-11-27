/**
 * Unit Tests for MemoryEditor Component
 *
 * Tests form validation, creation, and editing of memories
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, jest } from '@jest/globals';
import { MemoryEditor } from '@/components/memory/memory-editor';

// Mock the toast functions
jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}));

describe('MemoryEditor', () => {
  const mockCharacterId = '550e8400-e29b-41d4-a716-446655440001';
  const mockMemory = {
    id: '550e8400-e29b-41d4-a716-446655440002',
    characterId: mockCharacterId,
    content: 'Existing memory content',
    summary: 'Existing summary',
    keywords: ['keyword1', 'keyword2'],
    tags: [],
    tagDetails: [],
    importance: 0.7,
    source: 'MANUAL' as const,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const mockOnClose = jest.fn();
  const mockOnSave = jest.fn();

  describe('rendering', () => {
    it('should render editor modal', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const modal = container.querySelector('h2');
      expect(modal).toBeInTheDocument();
    });

    it('should render form fields', () => {
      render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByText(/Summary/)).toBeInTheDocument();
      expect(screen.getByText(/Full Content/)).toBeInTheDocument();
      expect(screen.getByText(/Keywords/)).toBeInTheDocument();
      expect(screen.getByText(/Importance/)).toBeInTheDocument();
    });

    it('should render action buttons', () => {
      render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByText(/Cancel/)).toBeInTheDocument();
      expect(screen.getByText(/Create|Save/)).toBeInTheDocument();
    });
  });

  describe('create mode', () => {
    it('should show create button text for new memory', () => {
      render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByText('Create Memory')).toBeInTheDocument();
    });

    it('should have empty form in create mode', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const contentInput = container.querySelector('textarea#content') as HTMLTextAreaElement;
      const summaryInput = container.querySelector('input#summary') as HTMLInputElement;

      expect(contentInput.value).toBe('');
      expect(summaryInput.value).toBe('');
    });
  });

  describe('edit mode', () => {
    it('should show edit button text for existing memory', () => {
      render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={mockMemory}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByText('Save Changes')).toBeInTheDocument();
    });

    it('should populate form with existing memory data', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={mockMemory}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const contentInput = container.querySelector('textarea#content') as HTMLTextAreaElement;
      const summaryInput = container.querySelector('input#summary') as HTMLInputElement;

      expect(contentInput.value).toBe(mockMemory.content);
      expect(summaryInput.value).toBe(mockMemory.summary);
    });

    it('should show importance value from existing memory', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={mockMemory}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const importanceSlider = container.querySelector('input#importance') as HTMLInputElement;
      expect(importanceSlider.value).toBe('0.7');
    });
  });

  describe('importance slider', () => {
    it('should display importance slider', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const importanceSlider = container.querySelector('input#importance') as HTMLInputElement;
      expect(importanceSlider).toBeInTheDocument();
      expect(importanceSlider.type).toBe('range');
    });

    it('should have valid importance range', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const importanceSlider = container.querySelector('input#importance') as HTMLInputElement;
      expect(importanceSlider.min).toBe('0');
      expect(importanceSlider.max).toBe('1');
    });

    it('should display importance level text', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const importanceLabel = container.querySelector('label[for="importance"]');
      expect(importanceLabel).toBeInTheDocument();
    });
  });

  describe('form labels and help text', () => {
    it('should show labels for all fields', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(container.querySelector('label[for="summary"]')).toBeInTheDocument();
      expect(container.querySelector('label[for="content"]')).toBeInTheDocument();
      expect(container.querySelector('label[for="keywords"]')).toBeInTheDocument();
    });

    it('should display help text for fields', () => {
      render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByText(/short description/i)).toBeInTheDocument();
      expect(screen.getByText(/full details/i)).toBeInTheDocument();
      expect(screen.getByText(/comma-separated keywords/i)).toBeInTheDocument();
    });
  });

  describe('cancel button', () => {
    it('should have cancel button', () => {
      render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const cancelButton = screen.getByText('Cancel');
      expect(cancelButton).toBeInTheDocument();
    });
  });

  describe('modal structure', () => {
    it('should render modal dialog', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const modal = container.querySelector('.fixed.inset-0');
      expect(modal).toBeInTheDocument();
    });

    it('should have form element', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const form = container.querySelector('form');
      expect(form).toBeInTheDocument();
    });

    it('should have all required input fields', () => {
      const { container } = render(
        <MemoryEditor
          characterId={mockCharacterId}
          memory={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(container.querySelector('input#summary')).toBeInTheDocument();
      expect(container.querySelector('textarea#content')).toBeInTheDocument();
      expect(container.querySelector('input#keywords')).toBeInTheDocument();
      expect(container.querySelector('input#importance')).toBeInTheDocument();
    });
  });
});
