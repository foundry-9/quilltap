'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { SlideOverPanel } from '@/components/ui/SlideOverPanel'
import { Icon } from '@/components/ui/icon'
import LLMInspectorEntry from './LLMInspectorEntry'
import type { LLMLog, LLMLogType } from '@/lib/schemas/types'

type FilterCategory = 'all' | 'chat' | 'memory' | 'system' | 'image' | 'safety' | 'other'

const FILTER_GROUPS: Record<FilterCategory, LLMLogType[] | null> = {
  all: null,
  chat: ['CHAT_MESSAGE', 'TOOL_CONTINUATION'],
  memory: ['MEMORY_EXTRACTION'],
  system: ['TITLE_GENERATION', 'SUMMARIZATION', 'CONTEXT_COMPRESSION'],
  image: ['IMAGE_PROMPT_CRAFTING', 'IMAGE_DESCRIPTION', 'APPEARANCE_RESOLUTION'],
  safety: ['DANGER_CLASSIFICATION'],
  other: ['CHARACTER_WIZARD', 'AI_IMPORT', 'CUSTOM_TOOL_CONSULT'],
}

const FILTER_LABELS: Record<FilterCategory, string> = {
  all: 'All',
  chat: 'Chat Messages',
  memory: 'Memory',
  system: 'System Ops',
  image: 'Image',
  safety: 'Safety',
  other: 'Other',
}

interface LLMInspectorPanelProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  logs: LLMLog[]
  loading: boolean
  scrollToMessageId?: string | null
  onRefresh: () => void
  loggingEnabled: boolean
}

export default function LLMInspectorPanel({
  isOpen,
  onClose,
  logs,
  loading,
  scrollToMessageId,
  onRefresh,
  loggingEnabled,
}: Readonly<LLMInspectorPanelProps>) {
  const [filter, setFilter] = useState<FilterCategory>('all')
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Chronological order (oldest first) - logs come sorted DESC, so reverse
  const chronologicalLogs = useMemo(() => [...logs].reverse(), [logs])

  // Filter logs client-side
  const filteredLogs = useMemo(() => {
    const types = FILTER_GROUPS[filter]
    if (!types) return chronologicalLogs
    return chronologicalLogs.filter(log => types.includes(log.type))
  }, [chronologicalLogs, filter])

  // Scroll to entry when opened from a per-message button
  // Uses data-log-message-id attribute on DOM elements instead of refs
  useEffect(() => {
    if (!isOpen || !scrollToMessageId || filteredLogs.length === 0) return

    // Find the target log to confirm it exists in filtered results
    const targetLog = filteredLogs.find(log => log.messageId === scrollToMessageId)
    if (!targetLog) return

    // Delay to allow panel animation and render to complete
    const timer = setTimeout(() => {
      const container = scrollContainerRef.current
      if (!container) return

      const targetEl = container.querySelector(`[data-log-id="${targetLog.id}"]`)
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [isOpen, scrollToMessageId, filteredLogs])

  const headerActions = (
    <div className="flex items-center gap-2">
      {/* Entry count */}
      <span className="text-xs qt-text-secondary">
        {filteredLogs.length} {filteredLogs.length === 1 ? 'entry' : 'entries'}
      </span>

      {/* Filter select */}
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as FilterCategory)}
        className="qt-input text-xs py-1 px-2 h-auto"
        aria-label="Filter log entries"
      >
        {Object.entries(FILTER_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      {/* Refresh button */}
      <button
        type="button"
        onClick={onRefresh}
        className="qt-text-secondary hover:qt-text transition-colors p-1"
        aria-label="Refresh logs"
        title="Refresh logs"
      >
        <Icon name="refresh" className="w-4 h-4" />
      </button>
    </div>
  )

  return (
    <SlideOverPanel
      isOpen={isOpen}
      onClose={onClose}
      title="LLM Inspector"
      headerActions={headerActions}
      ariaLabel="LLM Inspector Panel"
    >
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-3"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 qt-border-primary" />
          </div>
        ) : !loggingEnabled ? (
          <div className="text-center py-12 px-4">
            <Icon name="ban" className="w-10 h-10 mx-auto mb-3 qt-text-muted" />
            <p className="text-sm qt-text-secondary">LLM logging is disabled.</p>
            <p className="text-xs qt-text-muted mt-1">Enable it in Chat Settings to record API interactions.</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Icon name="file" className="w-10 h-10 mx-auto mb-3 qt-text-muted" />
            <p className="text-sm qt-text-secondary">No log entries yet.</p>
            <p className="text-xs qt-text-muted mt-1">Send a message to start recording LLM interactions.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredLogs.map((log) => (
              <LLMInspectorEntry
                key={log.id}
                log={log}
                isHighlighted={scrollToMessageId ? log.messageId === scrollToMessageId : false}
              />
            ))}
          </div>
        )}
      </div>
    </SlideOverPanel>
  )
}
