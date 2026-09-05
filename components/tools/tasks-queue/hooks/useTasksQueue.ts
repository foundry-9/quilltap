'use client'

import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import { getErrorMessage } from '@/lib/error-utils'
import type { QueueData, FullJobDetail } from '../types'

/** Fallback poll cadence, used only while the realtime socket is down. */
const FALLBACK_POLL_INTERVAL_MS = 5000

export function useTasksQueue() {
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [controlLoading, setControlLoading] = useState(false)
  const [selectedJob, setSelectedJob] = useState<FullJobDetail | null>(null)
  const [jobActionLoading, setJobActionLoading] = useState<string | null>(null)
  const [showJobDialog, setShowJobDialog] = useState(false)

  // Fetch queue status via TanStack Query.
  //
  // The queue is pushed: the server's `jobs` topic fires on every enqueue,
  // claim, completion, failure and cancellation, and the realtime provider
  // invalidates this key. `autoRefresh` is therefore no longer the thing that
  // keeps the list current — it is the fallback-poll switch, and only does
  // anything while the socket is down.
  //
  // `mutateQueue` is the query's refetch — handlers call it to revalidate after writes.
  const fallbackInterval = useRealtimeRefetchInterval(autoRefresh ? FALLBACK_POLL_INTERVAL_MS : false)
  const { data: swrData, isLoading: loading, error: loadError, refetch: mutateQueue } = useQuery({
    queryKey: queryKeys.system.tasksQueue,
    queryFn: ({ signal }) => apiFetch<QueueData>('/api/v1/system/tools?action=tasks-queue', { signal }),
    refetchInterval: fallbackInterval,
  })

  const data = swrData ?? null

  const [error, setError] = useState<string | null>(null)

  // Sync error from SWR
  useEffect(() => {
    if (loadError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync SWR error to local error state so handlers can also set errors
      setError(getErrorMessage(loadError))
    } else {
      setError(null)
    }
  }, [loadError])
  const fetchQueueStatus = useCallback(async () => {
    await mutateQueue()
  }, [mutateQueue])

  const controlQueue = useCallback(
    async (action: 'start' | 'stop') => {
      try {
        setControlLoading(true)
        setError(null)

        const res = await fetch('/api/v1/system/tools?action=tasks-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })

        if (!res.ok) {
          throw new Error(`Failed to ${action} queue`)
        }

        await res.json()

        // Refresh the queue status to get updated processor state
        await mutateQueue()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        setError(errorMessage)
        console.error(`Failed to ${action} queue`, { error: errorMessage })
      } finally {
        setControlLoading(false)
      }
    },
    [mutateQueue]
  )

  const saveConcurrency = useCallback(
    async (value: number) => {
      try {
        setError(null)
        const res = await fetch('/api/v1/system/tools?action=job-concurrency', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ concurrency: value }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to set concurrency')
        }

        await mutateQueue()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        setError(errorMessage)
        console.error('Failed to set job concurrency', { error: errorMessage })
      }
    },
    [mutateQueue]
  )

  const viewJob = useCallback(async (jobId: string) => {
    try {
      setJobActionLoading(jobId)
      const res = await fetch(`/api/v1/system/jobs/${jobId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch job details')
      }

      const data = await res.json()
      setSelectedJob(data.job)
      setShowJobDialog(true)
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      console.error('Failed to fetch job details', { error: errorMessage })
    } finally {
      setJobActionLoading(null)
    }
  }, [])

  const pauseJob = useCallback(
    async (jobId: string) => {
      try {
        setJobActionLoading(jobId)

        const res = await fetch(`/api/v1/system/jobs/${jobId}?action=pause`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to pause job')
        }

        await mutateQueue()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        console.error('Failed to pause job', { error: errorMessage })
      } finally {
        setJobActionLoading(null)
      }
    },
    [mutateQueue]
  )

  const resumeJob = useCallback(
    async (jobId: string) => {
      try {
        setJobActionLoading(jobId)

        const res = await fetch(`/api/v1/system/jobs/${jobId}?action=resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to resume job')
        }

        await mutateQueue()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        console.error('Failed to resume job', { error: errorMessage })
      } finally {
        setJobActionLoading(null)
      }
    },
    [mutateQueue]
  )

  const deleteJob = async (jobId: string) => {
    try {
      setJobActionLoading(jobId)

      const res = await fetch(`/api/v1/system/jobs/${jobId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete job')
      }

      // Close dialog if we deleted the selected job
      if (selectedJob?.id === jobId) {
        setShowJobDialog(false)
        setSelectedJob(null)
      }

      await mutateQueue()
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      console.error('Failed to delete job', { error: errorMessage })
    } finally {
      setJobActionLoading(null)
    }
  }

  return {
    data,
    loading,
    error,
    autoRefresh,
    setAutoRefresh,
    controlLoading,
    selectedJob,
    setSelectedJob,
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
  }
}
