'use client'

/**
 * Run Tool Modal
 *
 * Two-phase modal for user-initiated tool execution:
 * Phase 1: Tool selection from available tools list
 * Phase 2: Parameter form + execute button
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import JsonSchemaForm from '@/components/chat/JsonSchemaForm'
import { showErrorToast } from '@/lib/toast'
import type { AvailableTool } from '@/app/api/v1/tools/route'
import type { Participant } from '@/app/salon/[id]/types'

interface RunToolModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  /** Chat participants for character context selection */
  participants: Participant[]
  /** Called after successful tool execution so the chat can refresh */
  onToolExecuted: () => void
}

/** Category display info */
const CATEGORY_INFO: Record<string, { label: string; icon: string }> = {
  media: { label: 'Media', icon: '🎨' },
  memory: { label: 'Memory', icon: '🧠' },
  search: { label: 'Search', icon: '🔍' },
  project: { label: 'Project', icon: '📋' },
  files: { label: 'Files', icon: '📁' },
  help: { label: 'Help', icon: '📖' },
  utility: { label: 'Utility', icon: '🔧' },
  shell: { label: 'Shell', icon: '💻' },
  plugin: { label: 'Plugin', icon: '🔌' },
}

export default function RunToolModal({
  isOpen,
  onClose,
  chatId,
  participants,
  onToolExecuted,
}: RunToolModalProps) {
  const [tools, setTools] = useState<AvailableTool[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTool, setSelectedTool] = useState<AvailableTool | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formValid, setFormValid] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [isPrivate, setIsPrivate] = useState(false)

  // Active character participants for the character selector
  const activeCharacters = useMemo(() =>
    participants.filter(p => p.type === 'CHARACTER' && p.isActive && !p.removedAt),
    [participants]
  )

  // Stable identifier for the default character (avoids array ref in useEffect deps).
  // The enriched participant doesn't expose a top-level characterId, only `character.id`.
  const defaultCharacterId = activeCharacters[0]?.character?.id || null

  // Fetch tools when modal opens and reset form state
  useEffect(() => {
    if (!isOpen) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset on open + data fetch; parent renders unconditionally
    setLoading(true)
    setSelectedTool(null)
    setSearchQuery('')
    setFormValues({})
    setSelectedCharacterId(defaultCharacterId)
    setIsPrivate(false)

    fetch(`/api/v1/tools?chatId=${chatId}&includeSchemas=true`)
      .then(res => res.json())
      .then(data => {
        if (data.tools) {
          // Filter to only user-invocable tools
          const invocable = (data.tools as AvailableTool[]).filter(t => t.userInvocable !== false)
          setTools(invocable)
        }
      })
      .catch(err => {
        console.error('Failed to load tools:', err)
        showErrorToast('Failed to load available tools')
      })
      .finally(() => setLoading(false))
  }, [isOpen, chatId, defaultCharacterId])

  const handleSelectTool = useCallback((tool: AvailableTool) => {
    if (tool.available === false) return
    setSelectedTool(tool)
    // Pre-populate defaults from schema
    const defaults: Record<string, unknown> = {}
    if (tool.parameters && typeof tool.parameters === 'object') {
      const params = tool.parameters as { properties?: Record<string, { default?: unknown }> }
      if (params.properties) {
        for (const [key, prop] of Object.entries(params.properties)) {
          if (prop.default !== undefined) {
            defaults[key] = prop.default
          }
        }
      }
    }
    setFormValues(defaults)
    setFormValid(false)
  }, [])

  const handleBack = useCallback(() => {
    setSelectedTool(null)
    setFormValues({})
    setFormValid(false)
  }, [])

  const handleExecute = useCallback(async () => {
    if (!selectedTool) return
    setExecuting(true)

    try {
      // Build clean arguments: only include fields that have values
      const cleanArgs: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(formValues)) {
        if (value !== undefined && value !== null && value !== '') {
          cleanArgs[key] = value
        }
      }

      const res = await fetch(`/api/v1/chats/${chatId}?action=run-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: selectedTool.id,
          arguments: cleanArgs,
          characterId: selectedCharacterId || undefined,
          private: isPrivate,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        showErrorToast(data.error || data.message || 'Tool execution failed')
        return
      }

      onToolExecuted()
      onClose()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to execute tool')
    } finally {
      setExecuting(false)
    }
  }, [selectedTool, formValues, chatId, selectedCharacterId, isPrivate, onToolExecuted, onClose])

  // Group tools by category
  const filteredTools = tools.filter(t => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
  })

  const groupedTools = filteredTools.reduce<Record<string, AvailableTool[]>>((acc, tool) => {
    const cat = tool.category || 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(tool)
    return acc
  }, {})

  // Check if the selected tool has a valid schema for the form
  const hasSchema = !!(selectedTool?.parameters &&
    typeof selectedTool.parameters === 'object' &&
    (selectedTool.parameters as { properties?: unknown }).properties &&
    Object.keys((selectedTool.parameters as { properties: Record<string, unknown> }).properties).length > 0)

  // Build JSON preview of current arguments
  const cleanPreviewArgs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(formValues)) {
    if (value !== undefined && value !== null && value !== '') {
      cleanPreviewArgs[key] = value
    }
  }

  const title = selectedTool
    ? `Run Tool: ${selectedTool.name}`
    : 'Run Tool'

  const footer = selectedTool ? (
    <div className="flex justify-between items-center w-full">
      <button
        type="button"
        onClick={handleBack}
        className="qt-button qt-button-secondary"
        disabled={executing}
      >
        Back
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="qt-button qt-button-secondary"
          disabled={executing}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleExecute}
          className="qt-button qt-button-primary"
          disabled={executing || (hasSchema && !formValid)}
        >
          {executing ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Running...
            </span>
          ) : 'Run Tool'}
        </button>
      </div>
    </div>
  ) : (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClose}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="xl"
      showCloseButton
      footer={footer}
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <svg className="animate-spin h-6 w-6 qt-text-secondary" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : !selectedTool ? (
        /* Phase 1: Tool Selection */
        <div className="space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 qt-text-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tools..."
              className="qt-input w-full pl-9 text-sm"
              autoFocus
            />
          </div>

          {/* Tool list grouped by category */}
          {Object.keys(groupedTools).length === 0 ? (
            <p className="text-sm qt-text-secondary text-center py-4">
              {searchQuery ? 'No tools match your search.' : 'No tools available.'}
            </p>
          ) : (
            Object.entries(groupedTools).map(([category, categoryTools]) => {
              const catInfo = CATEGORY_INFO[category] || { label: category.charAt(0).toUpperCase() + category.slice(1), icon: '⚙️' }
              return (
                <div key={category}>
                  <div className="text-xs font-semibold qt-text-secondary uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                    <span>{catInfo.icon}</span>
                    <span>{catInfo.label}</span>
                  </div>
                  <div className="space-y-1">
                    {categoryTools.map((tool) => {
                      const isUnavailable = tool.available === false
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => handleSelectTool(tool)}
                          disabled={isUnavailable}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                            isUnavailable
                              ? 'opacity-50 cursor-not-allowed qt-bg-surface'
                              : 'qt-bg-surface hover:qt-bg-surface-hover cursor-pointer'
                          }`}
                          title={isUnavailable ? tool.unavailableReason : tool.description}
                        >
                          <div className="font-medium qt-text">{tool.name}</div>
                          <div className="text-xs qt-text-secondary mt-0.5">
                            {isUnavailable ? (
                              <span className="qt-text-warning">{tool.unavailableReason}</span>
                            ) : (
                              tool.description
                            )}
                          </div>
                          {tool.source === 'plugin' && (
                            <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded qt-bg-muted qt-text-secondary">
                              plugin{tool.pluginName ? `: ${tool.pluginName}` : ''}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : (
        /* Phase 2: Parameter Form + Execute */
        <div className="space-y-4">
          {/* Tool description */}
          <div className="text-sm qt-text-secondary">
            {selectedTool.description}
          </div>

          {/* Character selector */}
          {activeCharacters.length > 0 && (
            <div className="border-t qt-border pt-3">
              <label className="block text-sm font-medium qt-text mb-1">Run as character</label>
              <select
                className="qt-input w-full text-sm"
                value={selectedCharacterId || ''}
                onChange={(e) => setSelectedCharacterId(e.target.value || null)}
              >
                {activeCharacters.map(p => (
                  <option key={p.id} value={p.character?.id || ''}>
                    {p.character?.name || 'Unknown'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Private (whisper) toggle */}
          <div className="border-t qt-border pt-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm font-medium qt-text">Private (whisper)</div>
                <div className="text-xs qt-text-secondary">
                  Excluded from every character&apos;s context — the run stays between
                  you and Prospero, and remains in your own view of the salon.
                </div>
              </div>
            </label>
          </div>

          {/* Parameter form */}
          {hasSchema ? (
            <>
              <div className="border-t qt-border pt-3">
                <h4 className="text-sm font-medium qt-text mb-3">Parameters</h4>
                <JsonSchemaForm
                  schema={selectedTool.parameters as {
                    type: string
                    properties: Record<string, any>
                    required?: string[]
                  }}
                  values={formValues}
                  onChange={setFormValues}
                  onValidChange={setFormValid}
                />
              </div>

              {/* JSON preview */}
              <details className="border-t qt-border pt-3">
                <summary className="text-xs qt-text-secondary cursor-pointer select-none">
                  Arguments preview {formValid ? '(valid)' : '(incomplete)'}
                </summary>
                <pre className="mt-2 text-xs qt-bg-muted p-2 rounded overflow-x-auto font-mono max-h-32">
                  {JSON.stringify(cleanPreviewArgs, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <p className="text-sm qt-text-secondary italic">
              This tool requires no parameters.
            </p>
          )}
        </div>
      )}
    </BaseModal>
  )
}
