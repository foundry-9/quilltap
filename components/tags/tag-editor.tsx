'use client';

/**
 * TagEditor Component
 * Allows viewing, adding, and removing tags for any entity
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { showAlert } from '@/lib/alert';

export interface Tag {
  id: string;
  name: string;
  createdAt?: string;
}

interface TagEditorProps {
  entityType: 'character' | 'persona' | 'chat' | 'profile';
  entityId: string;
  onTagsChange?: (tags: Tag[]) => void;
}

export function TagEditor({ entityType, entityId, onTagsChange }: TagEditorProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Map entity type to API endpoint
  const getApiPath = useCallback(() => {
    switch (entityType) {
      case 'character':
        return `/api/characters/${entityId}/tags`;
      case 'persona':
        return `/api/personas/${entityId}/tags`;
      case 'chat':
        return `/api/chats/${entityId}/tags`;
      case 'profile':
        return `/api/profiles/${entityId}/tags`;
    }
  }, [entityType, entityId]);

  // Load tags for this entity
  useEffect(() => {
    if (!entityId) return;

    const loadTags = async () => {
      try {
        const res = await fetch(getApiPath());
        if (res.ok) {
          const data = await res.json();
          setTags(data.tags || []);
          onTagsChange?.(data.tags || []);
        }
      } catch (error) {
        console.error('Error loading tags:', error);
      }
    };

    loadTags();
  }, [entityId, getApiPath, onTagsChange]);

  // Load all available tags when input is focused
  useEffect(() => {
    if (!showSuggestions) return;

    const loadAllTags = async () => {
      try {
        const res = await fetch('/api/tags');
        if (res.ok) {
          const data = await res.json();
          setAllTags(data.tags || []);
        }
      } catch (error) {
        console.error('Error loading all tags:', error);
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
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addTag = async (tagName: string) => {
    if (!tagName.trim() || loading) return;

    setLoading(true);
    try {
      // First, create or get the tag
      const tagRes = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tagName.trim() }),
      });

      if (!tagRes.ok) {
        throw new Error('Failed to create tag');
      }

      const { tag } = await tagRes.json();

      // Then attach it to the entity
      const apiPath = getApiPath();
      const attachRes = await fetch(apiPath, {
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
    } catch (error) {
      console.error('Error adding tag:', error);
      showAlert('Failed to add tag. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const removeTag = async (tagId: string) => {
    if (loading) return;

    setLoading(true);
    try {
      const apiPath = getApiPath();
      const res = await fetch(`${apiPath}?tagId=${tagId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to remove tag');
      }

      const newTags = tags.filter((t) => t.id !== tagId);
      setTags(newTags);
      onTagsChange?.(newTags);
    } catch (error) {
      console.error('Error removing tag:', error);
      showAlert('Failed to remove tag. Please try again.');
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
      setShowSuggestions(false);
      setInputValue('');
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Tags
      </label>

      {/* Display existing tags */}
      <div className="flex flex-wrap gap-2 mb-2">
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
          >
            {tag.name}
            <button
              type="button"
              onClick={() => removeTag(tag.id)}
              disabled={loading}
              className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 focus:outline-none disabled:opacity-50"
              aria-label={`Remove ${tag.name} tag`}
            >
              <svg
                className="w-3 h-3"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </span>
        ))}
      </div>

      {/* Input for adding new tags */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder="Add a tag..."
          disabled={loading}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white disabled:opacity-50"
        />

        {/* Suggestions dropdown */}
        {showSuggestions && (filteredSuggestions.length > 0 || inputValue.trim()) && (
          <div
            ref={suggestionsRef}
            className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto"
          >
            {filteredSuggestions.length > 0 ? (
              <ul className="py-1">
                {filteredSuggestions.map((tag) => (
                  <li key={tag.id}>
                    <button
                      type="button"
                      onClick={() => addTag(tag.name)}
                      disabled={loading}
                      className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
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
                  className="w-full text-left text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50"
                >
                  Create &quot;{inputValue.trim()}&quot;
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Press Enter to add a tag, or select from suggestions
      </p>
    </div>
  );
}
