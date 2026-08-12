'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { Icon } from '@/components/ui/icon'
import { useModalState } from '@/hooks/useModalState'
import type { LLMLog } from '@/lib/schemas/types'
import { getErrorMessage } from '@/lib/error-utils'
import LLMLogViewerModal from '@/components/chat/LLMLogViewerModal'
import { formatDateTime } from '@/lib/format-time'

export default function LLMLogsCard() {
  const { data, isLoading, error: loadError, refetch: mutateLogs } = useQuery({
    queryKey: queryKeys.llmLogs.recent(20),
    queryFn: ({ signal }) => apiFetch<{ logs: LLMLog[] }>('/api/v1/llm-logs?limit=20', { signal }),
  })
  const logs = data?.logs ?? []

  const {
    isOpen: isModalOpen,
    payload: selectedLog,
    openModal,
    closeModal: handleCloseModal,
  } = useModalState<LLMLog>()

  const handleViewLog = (log: LLMLog) => openModal(log)

  const formatDate = (dateString: string): string =>
    formatDateTime(dateString, { includeYear: false })

  const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      'CHAT_MESSAGE': 'Chat',
      'TOOL_CONTINUATION': 'Tool',
      'MEMORY_EXTRACTION': 'Memory',
      'TITLE_GENERATION': 'Title',
      'CONTEXT_COMPRESSION': 'Compression',
      'SUMMARIZATION': 'Summary',
      'IMAGE_PROMPT_CRAFTING': 'Image Prompt',
      'CHARACTER_WIZARD': 'Wizard',
      'IMAGE_DESCRIPTION': 'Image Desc',
      'CUSTOM_TOOL_CONSULT': 'Custom Tool',
    }
    return labels[type] || type
  }

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="qt-heading-2 text-foreground mb-1">
            LLM Logs
          </h2>
          <p className="qt-text-small">
            Recent LLM API requests and responses
          </p>
        </div>
        <div className="flex-shrink-0 text-primary">
          <Icon name="cpu" className="w-8 h-8" />
        </div>
      </div>

      {/* Error Message */}
      {loadError && (
        <div className="qt-bg-destructive/10 border qt-border-destructive qt-text-destructive px-4 py-3 rounded mb-4">
          {getErrorMessage(loadError, 'Failed to fetch logs')}
        </div>
      )}

      {/* Refresh Button */}
      <div className="mb-4">
        <button
          onClick={() => mutateLogs()}
          disabled={isLoading}
          className="qt-button qt-button-secondary flex items-center gap-2"
        >
          <Icon name="refresh" className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Logs List */}
      {isLoading ? (
        <div className="text-center py-6 qt-text-secondary">
          <svg className="animate-spin h-6 w-6 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading logs...
        </div>
      ) : logs.length === 0 ? (
        <div className="qt-card p-6 text-center">
          <Icon name="cpu" className="w-12 h-12 mx-auto mb-3 qt-text-secondary/50" />
          <p className="qt-text-small">No LLM logs yet. Send a message or use other LLM features to generate logs.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {logs.map((log) => (
            <div
              key={log.id}
              onClick={() => handleViewLog(log)}
              className="qt-card p-3 flex items-center justify-between hover:qt-bg-muted/50 transition-colors cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-xs rounded qt-bg-primary/10 text-primary">
                    {getTypeLabel(log.type)}
                  </span>
                  <span className="qt-text-primary truncate text-sm">
                    {log.provider}/{log.modelName}
                  </span>
                </div>
                <div className="flex gap-4 mt-1 qt-text-small">
                  <span>{formatDate(log.createdAt)}</span>
                  {log.usage && (
                    <span>{log.usage.totalTokens.toLocaleString()} tokens</span>
                  )}
                  {log.durationMs && (
                    <span>{(log.durationMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              </div>
              <div className="ml-4">
                <Icon name="chevron-right" className="w-5 h-5 qt-text-secondary" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Log Viewer Modal */}
      <LLMLogViewerModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        logs={selectedLog ? [selectedLog] : []}
      />
    </div>
  )
}
