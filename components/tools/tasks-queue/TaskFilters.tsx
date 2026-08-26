'use client'

import { Icon } from '@/components/ui/icon'
import type { QueueData } from './types'

interface TaskFiltersProps {
  data: QueueData | null
  loading: boolean
  controlLoading: boolean
  autoRefresh: boolean
  onRefresh: () => void
  onStart: () => void
  onStop: () => void
  onAutoRefreshChange: (checked: boolean) => void
}

export function TaskFilters({
  data,
  loading,
  controlLoading,
  autoRefresh,
  onRefresh,
  onStart,
  onStop,
  onAutoRefreshChange,
}: TaskFiltersProps) {
  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <button
        onClick={onRefresh}
        disabled={loading}
        className="qt-button qt-button-secondary"
      >
        {loading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <Icon name="refresh" className="w-4 h-4" />
        )}
        Refresh
      </button>

      {/* Queue Control Buttons */}
      <button
        onClick={onStart}
        disabled={controlLoading || data?.processorStatus?.running || !data?.stats?.activeTotal}
        className="qt-button qt-button-primary"
      >
        {controlLoading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <Icon name="play" className="w-4 h-4" />
        )}
        Start Queue
      </button>

      <button
        onClick={onStop}
        disabled={controlLoading || !data?.processorStatus?.running || !data?.stats?.activeTotal}
        className="qt-button qt-button-secondary"
      >
        {controlLoading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <Icon name="stop" className="w-4 h-4" />
        )}
        Stop Queue
      </button>

      {/*
        The queue keeps itself current over the realtime socket; this switch
        governs the fallback poll, which only runs when that socket is down.
      */}
      <label
        className="flex items-center gap-2 qt-text-small cursor-pointer"
        title="Should the ledger be re-read every five seconds whenever the live wire is down?"
      >
        <input
          type="checkbox"
          checked={autoRefresh}
          onChange={(e) => onAutoRefreshChange(e.target.checked)}
          className="rounded qt-border-default text-primary focus:ring-ring"
        />
        Fallback polling (5s)
      </label>

      {/* Processor Status Indicator */}
      {data && (
        <span
          className={`qt-text-small flex items-center gap-1.5 ml-auto ${
            data.processorStatus?.running
              ? 'qt-text-success'
              : 'qt-text-secondary'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              data.processorStatus?.running
                ? 'bg-success animate-pulse'
                : 'qt-bg-muted-foreground'
            }`}
          />
          {data.processorStatus?.running ? 'Queue Running' : 'Queue Stopped'}
        </span>
      )}
    </div>
  )
}
