'use client'

import { useState, useRef, useEffect } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { Icon } from '@/components/ui/icon'

// Model warning types (matching server-side types)
export interface ModelWarning {
  level: 'info' | 'warning' | 'error'
  message: string
  documentationUrl?: string
}

export interface ModelInfo {
  id: string
  displayName?: string
  warnings?: ModelWarning[]
  deprecated?: boolean
  experimental?: boolean
  missingCapabilities?: string[]
  maxOutputTokens?: number
  contextWindow?: number
  /** Whether the model can run a reasoning turn at all. */
  supportsThinking?: boolean
  /** Whether it reasons without the profile asking it to (bug 85). */
  thinksByDefault?: boolean
}

interface ModelSelectorProps {
  readonly models: string[]
  readonly modelsWithInfo?: ModelInfo[]
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly required?: boolean
  readonly showFetchedCount?: boolean
}

export function ModelSelector({
  models,
  modelsWithInfo,
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

  // Helper to get model info
  const getModelInfo = (modelId: string): ModelInfo | undefined => {
    return modelsWithInfo?.find(m => m.id === modelId)
  }

  // Get the currently selected model's info for displaying warnings
  const selectedModelInfo = value ? getModelInfo(value) : undefined

  // Helper to render warning icon based on level
  const getWarningIcon = (level: 'info' | 'warning' | 'error') => {
    switch (level) {
      case 'error':
        return '🚫'
      case 'warning':
        return '⚠️'
      case 'info':
      default:
        return 'ℹ️'
    }
  }

  // Helper to get warning color classes
  const getWarningClasses = (level: 'info' | 'warning' | 'error') => {
    switch (level) {
      case 'error':
        return 'qt-alert-error'
      case 'warning':
        return 'qt-alert-warning'
      case 'info':
      default:
        return 'qt-alert-info'
    }
  }
  const useSearchMode = models.length > 10

  // Filter models based on search input
  const filteredModels = searchInput
    ? sortedModels.filter(model =>
        model.toLowerCase().includes(searchInput.toLowerCase())
      )
    : sortedModels

  // Close dropdown when clicking outside
  useClickOutside(containerRef, () => setIsOpen(false), { enabled: isOpen })

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

  // Helper to get model suffix for dropdown options
  const getModelSuffix = (info: ModelInfo | undefined): string => {
    if (info?.experimental) return ' (experimental)'
    if (info?.deprecated) return ' (deprecated)'
    return ''
  }

  // Render warnings for selected model
  const renderWarnings = () => {
    if (!selectedModelInfo?.warnings || selectedModelInfo.warnings.length === 0) {
      return null
    }

    return (
      <div className="mt-2 space-y-1">
        {selectedModelInfo.warnings.map((warning) => (
          <div
            key={`${warning.level}-${warning.message.substring(0, 20)}`}
            className={getWarningClasses(warning.level)}
          >
            <span className="mr-2">{getWarningIcon(warning.level)}</span>
            {warning.message}
          </div>
        ))}
      </div>
    )
  }

  // Render badges for model info in dropdown list
  const renderModelBadges = (modelId: string) => {
    const info = getModelInfo(modelId)
    if (!info) return null

    return (
      <span className="ml-2 inline-flex gap-1">
        {info.experimental && (
          <span className="text-xs px-1.5 py-0.5 rounded qt-bg-primary/10 text-primary">
            experimental
          </span>
        )}
        {info.deprecated && (
          <span className="text-xs px-1.5 py-0.5 rounded qt-bg-destructive/10 qt-text-destructive">
            deprecated
          </span>
        )}
        {info.warnings && info.warnings.some(w => w.level === 'warning') && (
          <span className="text-xs">⚠️</span>
        )}
      </span>
    )
  }

  if (!useSearchMode) {
    // Simple dropdown for <= 10 models
    return (
      <div>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          required={required}
          className="qt-select"
        >
          <option value="">{placeholder}</option>
          {sortedModels.map(model => {
            const info = getModelInfo(model)
            const suffix = getModelSuffix(info)
            return (
              <option key={model} value={model}>
                {model}{suffix}
              </option>
            )
          })}
        </select>
        {renderWarnings()}
      </div>
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
          className="qt-input pr-8"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 qt-hover-accent rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon
            name="arrow-down"
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 qt-bg-card border qt-border-default rounded-lg qt-shadow-lg z-10 max-h-64 overflow-y-auto">
          {filteredModels.length > 0 ? (
            <ul className="py-1">
              {filteredModels.map(model => (
                <li key={model}>
                  <button
                    type="button"
                    onClick={() => handleSelect(model)}
                    className={`w-full text-left px-3 py-2 qt-hover-accent transition-colors ${
                      value === model
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground'
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      <span>{model}</span>
                      {renderModelBadges(model)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-2 qt-text-small">
              No models match &quot;{searchInput}&quot;
            </div>
          )}
        </div>
      )}

      {showFetchedCount && models.length > 0 && (
        <p className="qt-text-xs mt-1">
          Showing {models.length} fetched models from provider
        </p>
      )}

      {renderWarnings()}
    </div>
  )
}
