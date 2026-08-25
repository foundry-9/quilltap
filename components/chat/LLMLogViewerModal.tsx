'use client'

import { useState, useMemo } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import type { LLMLog } from '@/lib/schemas/types'

interface LLMLogViewerModalProps {
  isOpen: boolean
  onClose: () => void
  logs: LLMLog[]
  messageId?: string
}

type TabType = 'request' | 'response' | 'usage'

export default function LLMLogViewerModal({
  isOpen,
  onClose,
  logs,
}: Readonly<LLMLogViewerModalProps>) {
  const [activeTab, setActiveTab] = useState<TabType>('request')
  const [selectedLogIndex, setSelectedLogIndex] = useState(0)

  // Ensure selectedLogIndex is valid for current logs
  const safeLogIndex = useMemo(() => {
    if (logs.length === 0) return 0
    return Math.min(selectedLogIndex, logs.length - 1)
  }, [selectedLogIndex, logs.length])

  if (!isOpen || logs.length === 0) return null

  const currentLog = logs[safeLogIndex]

  // Format JSON for display with proper indentation
  const formatJSON = (data: unknown): string => {
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return 'Unable to format data'
    }
  }

  // Render request tab content
  const renderRequestTab = () => (
    <div className="space-y-4">
      <div>
        <h4 className="qt-label qt-text mb-2">Provider & Model</h4>
        <div className="qt-bg-surface-alt p-3 rounded space-y-1">
          <div className="flex justify-between">
            <span className="qt-text-secondary">Provider:</span>
            <span className="qt-text font-mono text-sm">{currentLog.provider}</span>
          </div>
          <div className="flex justify-between">
            <span className="qt-text-secondary">Model:</span>
            <span className="qt-text font-mono text-sm">{currentLog.modelName}</span>
          </div>
          <div className="flex justify-between">
            <span className="qt-text-secondary">Type:</span>
            <span className="qt-text font-mono text-sm">{currentLog.type}</span>
          </div>
        </div>
      </div>

      <div>
        <h4 className="qt-label qt-text mb-2">Request Configuration</h4>
        <div className="qt-bg-surface-alt p-3 rounded space-y-1">
          <div className="flex justify-between">
            <span className="qt-text-secondary">Messages:</span>
            <span className="qt-text font-mono text-sm">{currentLog.request.messageCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="qt-text-secondary">Temperature:</span>
            <span className="qt-text font-mono text-sm">
              {currentLog.request.temperature !== null && currentLog.request.temperature !== undefined
                ? currentLog.request.temperature
                : 'default'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="qt-text-secondary">Max Tokens:</span>
            <span className="qt-text font-mono text-sm">
              {currentLog.request.maxTokens !== null && currentLog.request.maxTokens !== undefined
                ? currentLog.request.maxTokens
                : 'default'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="qt-text-secondary">Tools:</span>
            <span className="qt-text font-mono text-sm">{currentLog.request.toolCount}</span>
          </div>
        </div>
      </div>

      <div>
        <h4 className="qt-label qt-text mb-2">Message Summary</h4>
        <div className="space-y-2">
          {currentLog.request.messages.map((msg, idx) => (
            <div key={idx} className="qt-bg-surface-alt p-2 rounded text-sm">
              <div className="flex justify-between mb-1">
                <span className="qt-text-secondary font-mono">{msg.role}</span>
                <span className="qt-text-secondary text-xs">
                  {msg.contentLength} chars
                  {msg.hasAttachments && ' (with attachments)'}
                </span>
              </div>
              <p className="qt-text text-xs whitespace-pre-wrap break-words">
                {msg.contentPreview}
                {msg.contentLength > 500 && '...'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {currentLog.request.fullMessages && (
        <div>
          <h4 className="qt-label qt-text mb-2">Full Messages (Verbose)</h4>
          <pre className="font-mono text-xs whitespace-pre-wrap overflow-auto max-h-96 p-3 qt-bg-surface-alt rounded">
            {formatJSON(currentLog.request.fullMessages)}
          </pre>
        </div>
      )}
    </div>
  )

  // Render response tab content
  const renderResponseTab = () => (
    <div className="space-y-4">
      {currentLog.response.error && (
        <div className="p-3 qt-bg-destructive/10 border qt-border-destructive/20 rounded">
          <h4 className="qt-label qt-text-destructive mb-1">Error</h4>
          <p className="text-sm qt-text">{currentLog.response.error}</p>
        </div>
      )}

      {!currentLog.response.error && (
        <div className="p-3 qt-bg-success/10 border qt-border-success/20 rounded">
          <p className="text-sm qt-text font-medium">Request completed successfully</p>
        </div>
      )}

      <div>
        <h4 className="qt-label qt-text mb-2">
          Content Preview ({currentLog.response.contentLength} chars)
        </h4>
        <pre className="font-mono text-xs whitespace-pre-wrap overflow-auto max-h-64 p-3 qt-bg-surface-alt rounded">
          {currentLog.response.contentPreview}
          {currentLog.response.contentLength > 500 && '\n\n[... truncated ...]'}
        </pre>
      </div>

      {currentLog.response.fullContent && (
        <div>
          <h4 className="qt-label qt-text mb-2">Full Content (Verbose)</h4>
          <pre className="font-mono text-xs whitespace-pre-wrap overflow-auto max-h-96 p-3 qt-bg-surface-alt rounded">
            {currentLog.response.fullContent}
          </pre>
        </div>
      )}
    </div>
  )

  // Render usage tab content
  const renderUsageTab = () => (
    <div className="space-y-4">
      {currentLog.usage && (
        <div>
          <h4 className="qt-label qt-text mb-2">Token Usage</h4>
          <div className="qt-bg-surface-alt p-4 rounded grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="qt-heading-2 qt-text">
                {currentLog.usage.promptTokens.toLocaleString()}
              </p>
              <p className="text-xs qt-text-secondary mt-1">Prompt Tokens</p>
            </div>
            <div className="text-center">
              <p className="qt-heading-2 qt-text">
                {currentLog.usage.completionTokens.toLocaleString()}
              </p>
              <p className="text-xs qt-text-secondary mt-1">Completion Tokens</p>
            </div>
            <div className="text-center">
              <p className="qt-heading-2 qt-text">
                {currentLog.usage.totalTokens.toLocaleString()}
              </p>
              <p className="text-xs qt-text-secondary mt-1">Total Tokens</p>
            </div>
          </div>
        </div>
      )}

      {currentLog.cacheUsage && (
        <div>
          <h4 className="qt-label qt-text mb-2">Cache Usage</h4>
          <div className="qt-bg-surface-alt p-3 rounded space-y-2">
            {currentLog.cacheUsage.cacheCreationInputTokens !== undefined && (
              <div className="flex justify-between">
                <span className="qt-text-secondary">Cache Creation:</span>
                <span className="qt-text font-mono text-sm">
                  {currentLog.cacheUsage.cacheCreationInputTokens.toLocaleString()} tokens
                </span>
              </div>
            )}
            {currentLog.cacheUsage.cacheReadInputTokens !== undefined && (
              <div className="flex justify-between">
                <span className="qt-text-secondary">Cache Read:</span>
                <span className="qt-text font-mono text-sm">
                  {currentLog.cacheUsage.cacheReadInputTokens.toLocaleString()} tokens
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {currentLog.durationMs !== null && currentLog.durationMs !== undefined && (
        <div>
          <h4 className="qt-label qt-text mb-2">Timing</h4>
          <div className="qt-bg-surface-alt p-3 rounded">
            <div className="flex justify-between">
              <span className="qt-text-secondary">Duration:</span>
              <span className="qt-text font-mono text-sm">
                {(currentLog.durationMs / 1000).toFixed(2)}s
              </span>
            </div>
          </div>
        </div>
      )}

      {!currentLog.usage && !currentLog.cacheUsage && !currentLog.durationMs && (
        <p className="qt-text-secondary text-sm p-3 qt-bg-surface-alt rounded text-center">
          No usage data available for this log
        </p>
      )}
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="LLM Request/Response Log"
      maxWidth="3xl"
      showCloseButton
      className="flex flex-col"
    >
      <div className="flex flex-col h-full">
        {/* Log selector if multiple logs */}
        {logs.length > 1 && (
          <div className="px-4 py-3 border-b qt-border mb-4">
            <label htmlFor="log-select" className="block text-sm qt-text-secondary mb-2">
              Select Log
            </label>
            <select
              id="log-select"
              value={safeLogIndex}
              onChange={(e) => setSelectedLogIndex(parseInt(e.target.value, 10))}
              className="w-full qt-input"
            >
              {logs.map((log, index) => (
                <option key={log.id} value={index}>
                  {new Date(log.createdAt).toLocaleTimeString()} - {log.type} ({log.provider}/{log.modelName})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Log metadata */}
        <div className="px-4 py-2 border-b qt-border text-xs qt-text-secondary">
          {new Date(currentLog.createdAt).toLocaleString()}
        </div>

        {/* Tabs */}
        <div className="flex border-b qt-border">
          {(['request', 'response', 'usage'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 qt-label transition-colors border-b-2 ${
                activeTab === tab
                  ? 'qt-border-primary qt-text'
                  : 'border-transparent qt-text-secondary hover:qt-text'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {activeTab === 'request' && renderRequestTab()}
          {activeTab === 'response' && renderResponseTab()}
          {activeTab === 'usage' && renderUsageTab()}
        </div>
      </div>
    </BaseModal>
  )
}
