'use client';

/**
 * TagDropdown Component
 * A collapsible dropdown that displays tags and allows selection without taking up full width
 */

import { useState, useRef, useEffect } from 'react';
import { Tag } from './tag-editor';

interface TagDropdownProps {
  tags: Tag[];
  isOpen: boolean;
  onToggle: () => void;
  onTagRemove: (tagId: string) => void;
  onTagAdd: (tagName: string) => void;
  loading?: boolean;
}

export function TagDropdown({
  tags,
  isOpen,
  onToggle,
  onTagRemove,
  onTagAdd,
  loading = false,
}: TagDropdownProps) {
  const [inputValue, setInputValue] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        if (isOpen) {
          onToggle();
        }
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onToggle]);

  // Focus input when add mode is enabled
  useEffect(() => {
    if (showAddInput) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [showAddInput]);

  const handleAddTag = () => {
    if (inputValue.trim()) {
      onTagAdd(inputValue.trim());
      setInputValue('');
      setShowAddInput(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === 'Escape') {
      setShowAddInput(false);
      setInputValue('');
    }
  };

  const tagCount = tags.length;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700"
        aria-label={`${isOpen ? 'Close' : 'Open'} tags dropdown`}
        title={`Tags (${tagCount})`}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
        <span className="text-xs font-medium bg-gray-200 dark:bg-slate-700 px-2 py-0.5 rounded">
          {tagCount}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 14l-7 7m0 0l-7-7m7 7V3"
          />
        </svg>
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute left-0 mt-2 w-64 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-50">
          <div className="p-3 space-y-3 max-h-64 overflow-y-auto">
            {/* Tags List */}
            {tagCount > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  Tags ({tagCount})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <div
                      key={tag.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                    >
                      <span>{tag.name}</span>
                      <button
                        onClick={() => onTagRemove(tag.id)}
                        disabled={loading}
                        className="inline-flex items-center justify-center rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 focus:outline-none disabled:opacity-50"
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
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                No tags yet
              </p>
            )}

            {/* Divider */}
            <div className="border-t border-gray-200 dark:border-slate-700" />

            {/* Add Tag Section */}
            {!showAddInput ? (
              <button
                onClick={() => setShowAddInput(true)}
                disabled={loading}
                className="w-full px-2 py-1.5 text-xs font-medium text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
              >
                + Add Tag
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter tag name..."
                  disabled={loading}
                  className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white disabled:opacity-50"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={handleAddTag}
                    disabled={loading || !inputValue.trim()}
                    className="flex-1 px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setShowAddInput(false);
                      setInputValue('');
                    }}
                    disabled={loading}
                    className="flex-1 px-2 py-1 text-xs font-medium bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
