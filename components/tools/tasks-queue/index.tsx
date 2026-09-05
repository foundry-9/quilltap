'use client'

import { useState } from 'react'
import { TaskFilters } from './TaskFilters'
import { TaskItem } from './TaskItem'
import { TaskDetails } from './TaskDetails'
import { useTasksQueue } from './hooks/useTasksQueue'
import { formatRelativeDate } from '@/lib/format-time'
import { useNow } from '@/hooks/useNow'
import { Icon } from '@/components/ui/icon'

const DEFAULT_CONCURRENCY = 4
const MIN_CONCURRENCY = 1
const MAX_CONCURRENCY = 32

export function TasksQueueCard() {
  const {
    data,
    loading,
    error,
    autoRefresh,
    setAutoRefresh,
    controlLoading,
    selectedJob,
    jobActionLoading,
    showJobDialog,
    setShowJobDialog,
    fetchQueueStatus,
    controlQueue,
    saveConcurrency,
    viewJob,
    pauseJob,
    resumeJob,
    deleteJob,
  } = useTasksQueue()

  // While dragging the concurrency slider, show the local value for a smooth
  // drag; otherwise reflect the persisted setting from the queue status.
  const persistedConcurrency = data?.maxConcurrentJobs ?? DEFAULT_CONCURRENCY
  const [dragConcurrency, setDragConcurrency] = useState<number | null>(null)
  const displayConcurrency = dragConcurrency ?? persistedConcurrency

  const handleConcurrencyCommit = () => {
    const value = dragConcurrency
    setDragConcurrency(null)
    if (value !== null && value !== persistedConcurrency) {
      void saveConcurrency(value)
    }
  }

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`
    }
    return tokens.toString()
  }

  // One shared minute tick drives every relative timestamp in the card,
  // including the ones TaskDetails renders through this same callback.
  const nowMs = useNow(60_000)
  const formatDate = (dateString: string | null | undefined) =>
    formatRelativeDate(dateString, nowMs)

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="qt-heading-2 text-foreground mb-1">Tasks Queue</h2>
          <p className="qt-text-small">
            Background job queue for memory extraction and other LLM tasks
          </p>
        </div>
        <div className="flex-shrink-0 text-primary">
          <Icon name="layers" className="w-8 h-8" />
        </div>
      </div>

      {/* Simultaneous Labours — global background-job concurrency cap */}
      <div className="qt-card p-4 mb-6">
        <label htmlFor="maxConcurrentJobs" className="qt-body text-foreground font-medium">
          Simultaneous Labours — {displayConcurrency}
        </label>
        <input
          id="maxConcurrentJobs"
          type="range"
          min={MIN_CONCURRENCY}
          max={MAX_CONCURRENCY}
          step={1}
          value={displayConcurrency}
          onMouseDown={() => setDragConcurrency(persistedConcurrency)}
          onTouchStart={() => setDragConcurrency(persistedConcurrency)}
          onChange={(e) => setDragConcurrency(parseInt(e.target.value, 10))}
          onMouseUp={handleConcurrencyCommit}
          onTouchEnd={handleConcurrencyCommit}
          className="qt-range w-full mt-2"
        />
        <p className="qt-text-small qt-text-muted mt-1">
          How many background errands the engine may undertake at once. Four suits most
          households; a stouter machine may shoulder up to two-and-thirty. Mind that a single
          ravenous task type may then monopolise the works.
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="qt-bg-destructive/10 border qt-border-destructive qt-text-destructive px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Filters and Controls */}
      <TaskFilters
        data={data}
        loading={loading}
        controlLoading={controlLoading}
        autoRefresh={autoRefresh}
        onRefresh={fetchQueueStatus}
        onStart={() => controlQueue('start')}
        onStop={() => controlQueue('stop')}
        onAutoRefreshChange={setAutoRefresh}
      />

      {/* Stats Summary */}
      {data && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="qt-card p-3 text-center">
            <div className="qt-heading-2 text-foreground">
              {data.stats.activeTotal}
            </div>
            <div className="qt-text-xs">Active Jobs</div>
          </div>
          <div className="qt-card p-3 text-center">
            <div className="qt-heading-2 text-foreground">
              ~{formatTokens(data.totalEstimatedTokens)}
            </div>
            <div className="qt-text-xs">Est. Tokens</div>
          </div>
          <div className="qt-card p-3 text-center">
            <div className="qt-heading-2 qt-text-success">
              {data.stats.completed}
            </div>
            <div className="qt-text-xs">Completed</div>
          </div>
        </div>
      )}

      {/* Detailed Stats Row */}
      {data && (
        <div className="flex flex-wrap gap-4 qt-text-small mb-4">
          <span>
            <span className="qt-text-info font-medium">
              {data.stats.processing}
            </span>{' '}
            processing
          </span>
          <span>
            <span className="qt-text-warning font-medium">
              {data.stats.pending}
            </span>{' '}
            pending
          </span>
          <span>
            <span className="qt-text-destructive font-medium">
              {data.stats.failed}
            </span>{' '}
            failed
          </span>
          {data.stats.paused > 0 && (
            <span>
              <span className="qt-text-warning font-medium">
                {data.stats.paused}
              </span>{' '}
              paused
            </span>
          )}
          {data.stats.dead > 0 && (
            <span>
              <span className="qt-text-secondary font-medium">{data.stats.dead}</span> dead
            </span>
          )}
        </div>
      )}

      {/* Jobs List */}
      <div>
        <h3 className="qt-heading-4 text-foreground mb-3">Queue Items</h3>

        {loading && !data ? (
          <div className="text-center py-6 qt-text-secondary">
            <svg
              className="animate-spin h-6 w-6 mx-auto mb-2"
              fill="none"
              viewBox="0 0 24 24"
            >
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
            Loading queue...
          </div>
        ) : !data || data.jobs.length === 0 ? (
          <div className="qt-card p-6 text-center">
            <svg
              className="w-12 h-12 mx-auto mb-3 qt-text-secondary/50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
            <p className="qt-text-secondary">Queue is empty. All tasks completed!</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {data.jobs.map((job) => (
              <TaskItem
                key={job.id}
                job={job}
                jobActionLoading={jobActionLoading}
                onView={viewJob}
                onPause={pauseJob}
                onResume={resumeJob}
                onDelete={deleteJob}
              />
            ))}
          </div>
        )}
      </div>

      {/* Job Detail Dialog */}
      {showJobDialog && selectedJob && (
        <TaskDetails
          job={selectedJob}
          isOpen={showJobDialog}
          jobActionLoading={jobActionLoading}
          onClose={() => setShowJobDialog(false)}
          onDelete={() => {
            deleteJob(selectedJob.id)
          }}
          formatDate={formatDate}
        />
      )}
    </div>
  )
}
