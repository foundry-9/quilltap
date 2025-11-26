'use client'

import { useState, useRef, useEffect } from 'react'

interface ModelSelectorProps {
  readonly models: string[]
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly required?: boolean
  readonly showFetchedCount?: boolean
}

export function ModelSelector({
  models,
  value,
  onChange,
  placeholder = 'Select or search a model',
  disabled = false,
  required = false,
  showFetchedCount = false,
}: ModelSelectorProps) {
  const [searchInput, setSearchInput] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const sortedModels = [...models].sort((a, b) => a.localeCompare(b))
  const useSearchMode = models.length > 10

  // Filter models based on search input
  const filteredModels = searchInput
    ? sortedModels.filter(model =>
        model.toLowerCase().includes(searchInput.toLowerCase())
      )
    : sortedModels

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && useSearchMode && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isOpen, useSearchMode])

  const handleSelect = (model: string) => {
    onChange(model)
    setIsOpen(false)
    setSearchInput('')
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setSearchInput('')
    }
  }

  if (!useSearchMode) {
    // Simple dropdown for <= 10 models
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
      >
        <option value="">{placeholder}</option>
        {sortedModels.map(model => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    )
  }

  // Search box + dropdown for > 10 models
  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={searchInputRef}
          type="text"
          value={isOpen ? searchInput : value}
          onChange={handleSearchChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          required={required && !value}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 pr-8"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
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
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
          {filteredModels.length > 0 ? (
            <ul className="py-1">
              {filteredModels.map(model => (
                <li key={model}>
                  <button
                    type="button"
                    onClick={() => handleSelect(model)}
                    className={`w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors ${
                      value === model
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {model}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              No models match &quot;{searchInput}&quot;
            </div>
          )}
        </div>
      )}

      {showFetchedCount && models.length > 0 && (
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          Showing {models.length} fetched models from provider
        </p>
      )}
    </div>
  )
}
