'use client';

/**
 * TagEditor Component
 * Allows viewing, adding, and removing tags for any entity
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '@/components/ui/icon';
import { showErrorToast } from '@/lib/toast';
import { useClickOutside } from '@/hooks/useClickOutside';
import { TagBadge } from '@/components/tags/tag-badge';

export interface Tag {
  id: string;
  name: string;
  createdAt?: string;
  quickHide?: boolean;
}

interface TagEditorProps {
  // EntityType - personas have been migrated to characters with controlledBy: 'user'
  entityType: 'character' | 'chat' | 'profile';
  entityId: string;
  onTagsChange?: (tags: Tag[]) => void;
}

export function TagEditor({ entityType, entityId, onTagsChange }: TagEditorProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Map entity type to API endpoint base path
  const getApiBasePath = useCallback(() => {
    switch (entityType) {
      case 'character':
        return `/api/v1/characters/${entityId}`;
      case 'chat':
        return `/api/v1/chats/${entityId}`;
      case 'profile':
        // Connection profiles are served from `/api/v1/connection-profiles`;
        // there has never been an `/api/v1/profiles` route (Bug 74).
        return `/api/v1/connection-profiles/${entityId}`;
    }
  }, [entityType, entityId]);

  // Load tags for this entity
  useEffect(() => {
    if (!entityId) return;

    const loadTags = async () => {
      try {
        const basePath = getApiBasePath();
        const res = await fetch(`${basePath}?action=get-tags`);
        if (res.ok) {
          const data = await res.json();
          setTags(data.tags || []);
          onTagsChange?.(data.tags || []);
        }
      } catch (error) {
        console.error('Error loading tags:', { error: error instanceof Error ? error.message : String(error) });
      }
    };

    loadTags();
  }, [entityId, getApiBasePath, onTagsChange]);

  // Load all available tags when input is focused
  useEffect(() => {
    if (!showSuggestions) return;

    const loadAllTags = async () => {
      try {
        const res = await fetch('/api/v1/tags');
        if (res.ok) {
          const data = await res.json();
          setAllTags(data.tags || []);
        }
      } catch (error) {
        console.error('Error loading all tags:', { error: error instanceof Error ? error.message : String(error) });
      }
    };

    loadAllTags();
  }, [showSuggestions]);

  // Filter suggestions based on input
  const filteredSuggestions = allTags.filter(
    (tag) =>
      tag.name.toLowerCase().includes(inputValue.toLowerCase()) &&
      !tags.some((t) => t.id === tag.id)
  );

  // Close suggestions when clicking outside
  useClickOutside(suggestionsRef, () => setShowSuggestions(false), {
    excludeRefs: [inputRef]
  });

  const addTag = async (tagName: string) => {
    if (!tagName.trim() || loading) return;

    setLoading(true);
    try {
      // First, create or get the tag
      const tagRes = await fetch('/api/v1/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tagName.trim() }),
      });

      if (!tagRes.ok) {
        throw new Error('Failed to create tag');
      }

      const { tag } = await tagRes.json();

      // Then attach it to the entity
      const basePath = getApiBasePath();
      const attachRes = await fetch(`${basePath}?action=add-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: tag.id }),
      });

      if (!attachRes.ok) {
        throw new Error('Failed to attach tag');
      }

      const newTags = [...tags, tag];
      setTags(newTags);
      onTagsChange?.(newTags);
      setInputValue('');
      setShowSuggestions(false);
      setIsAddingTag(false);
    } catch (error) {
      console.error('Error adding tag:', { error: error instanceof Error ? error.message : String(error) });
      showErrorToast('Failed to add tag. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const removeTag = async (tagId: string) => {
    if (loading) return;

    setLoading(true);
    try {
      const basePath = getApiBasePath();
      const res = await fetch(`${basePath}?action=remove-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId }),
      });

      if (!res.ok) {
        throw new Error('Failed to remove tag');
      }

      const newTags = tags.filter((t) => t.id !== tagId);
      setTags(newTags);
      onTagsChange?.(newTags);
    } catch (error) {
      console.error('Error removing tag:', { error: error instanceof Error ? error.message : String(error) });
      showErrorToast('Failed to remove tag. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredSuggestions.length > 0) {
        addTag(filteredSuggestions[0].name);
      } else if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'Escape') {
      cancelAddTag();
    }
  };

  const cancelAddTag = () => {
    setInputValue('');
    setShowSuggestions(false);
    setIsAddingTag(false);
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm qt-text-primary">
        Tags
      </label>

      {/* Tags container - inline block */}
      <div className="inline-flex flex-wrap gap-2 w-auto">
        {/* Display existing tags */}
        {tags.map((tag) => (
          <TagBadge
            key={tag.id}
            tag={tag}
            onRemove={() => removeTag(tag.id)}
            disabled={loading}
          />
        ))}

        {/* View/Delete mode - Add Tag button */}
        {!isAddingTag && (
          <button
            type="button"
            onClick={() => {
              setIsAddingTag(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            disabled={loading}
            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium qt-bg-muted text-foreground qt-hover-accent focus:outline-none disabled:opacity-50"
          >
            + Add Tag
          </button>
        )}

        {/* Add Tag mode - Input field with cancel button */}
        {isAddingTag && (
          <div className="relative inline-flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={handleKeyDown}
              placeholder="Add a tag..."
              disabled={loading}
              className="qt-input py-1 px-3 qt-shadow-sm focus:border-transparent"
            />
            <button
              type="button"
              onClick={cancelAddTag}
              disabled={loading}
              className="inline-flex items-center justify-center w-5 h-5 qt-text-secondary hover:text-foreground focus:outline-none disabled:opacity-50"
              aria-label="Cancel adding tag"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>

            {/* Suggestions dropdown */}
            {showSuggestions && (filteredSuggestions.length > 0 || inputValue.trim()) && (
              <div
                ref={suggestionsRef}
                className="absolute z-10 top-full left-0 mt-1 qt-bg-card border border-input rounded-md qt-shadow-lg max-h-60 overflow-y-auto"
              >
                {filteredSuggestions.length > 0 ? (
                  <ul className="py-1">
                    {filteredSuggestions.map((tag) => (
                      <li key={tag.id}>
                        <button
                          type="button"
                          onClick={() => addTag(tag.name)}
                          disabled={loading}
                          className="w-full px-4 py-2 text-left qt-text-small qt-hover-accent text-foreground disabled:opacity-50 whitespace-nowrap"
                        >
                          {tag.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : inputValue.trim() ? (
                  <div className="py-2 px-4">
                    <button
                      type="button"
                      onClick={() => addTag(inputValue)}
                      disabled={loading}
                      className="text-left qt-text-small text-primary hover:text-primary/80 disabled:opacity-50 whitespace-nowrap"
                    >
                      Create &quot;{inputValue.trim()}&quot;
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>

      {isAddingTag && (
        <p className="qt-text-xs">
          Press Enter to add a tag, or select from suggestions. Press Esc to cancel.
        </p>
      )}
    </div>
  );
}
