'use client'

import { useState, useEffect } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface HousekeepingDetail {
  memoryId: string
  action: 'deleted' | 'merged' | 'kept'
  reason: string
  summary?: string
}

interface HousekeepingPreview {
  wouldDelete: number
  wouldMerge: number
  wouldKeep: number
  totalBefore: number
  totalAfter: number
  details: HousekeepingDetail[]
}

interface HousekeepingDialogProps {
  characterId: string
  onClose: () => void
  onComplete: () => void
}

export function HousekeepingDialog({ characterId, onClose, onComplete }: HousekeepingDialogProps) {
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [preview, setPreview] = useState<HousekeepingPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Options state
  const [maxMemories, setMaxMemories] = useState(1000)
  const [maxAgeMonths, setMaxAgeMonths] = useState(6)
  const [minImportance, setMinImportance] = useState(0.3)
  const [mergeSimilar, setMergeSimilar] = useState(false)

  // Fetch preview when options change
  useEffect(() => {
    const fetchPreview = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          maxMemories: maxMemories.toString(),
          maxAgeMonths: maxAgeMonths.toString(),
          minImportance: minImportance.toString(),
          mergeSimilar: mergeSimilar.toString(),
        })

        const res = await fetch(`/api/characters/${characterId}/memories/housekeep?${params}`)
        if (!res.ok) throw new Error('Failed to fetch preview')

        const data = await res.json()
        setPreview(data.preview)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load preview')
      } finally {
        setLoading(false)
      }
    }

    const debounce = setTimeout(fetchPreview, 300)
    return () => clearTimeout(debounce)
  }, [characterId, maxMemories, maxAgeMonths, minImportance, mergeSimilar])

  const handleRun = async () => {
    setRunning(true)
    try {
      const res = await fetch(`/api/characters/${characterId}/memories/housekeep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxMemories,
          maxAgeMonths,
          minImportance,
          mergeSimilar,
          dryRun: false,
        }),
      })

      if (!res.ok) throw new Error('Failed to run housekeeping')

      const data = await res.json()
      showSuccessToast(`Cleaned up ${data.result.deleted} memories`)
      onComplete()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to run cleanup')
    } finally {
      setRunning(false)
    }
  }

  const actionCounts = preview?.details.reduce(
    (acc, d) => {
      acc[d.action] = (acc[d.action] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  ) || {}

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Memory Cleanup
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Clean up old and low-importance memories to stay within limits.
          </p>
        </div>

        {/* Options */}
        <div className="p-6 border-b border-gray-200 dark:border-slate-700 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Max Memories
              </label>
              <input
                type="number"
                value={maxMemories}
                onChange={(e) => setMaxMemories(parseInt(e.target.value) || 1000)}
                min={10}
                max={10000}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Hard cap on total memories
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Max Age (months)
              </label>
              <input
                type="number"
                value={maxAgeMonths}
                onChange={(e) => setMaxAgeMonths(parseInt(e.target.value) || 6)}
                min={1}
                max={120}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Delete old low-importance memories
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Min Importance: {(minImportance * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              value={minImportance}
              onChange={(e) => setMinImportance(parseFloat(e.target.value))}
              min={0}
              max={0.7}
              step={0.1}
              className="w-full h-2 bg-gray-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>0%</span>
              <span>Threshold for deletion</span>
              <span>70%</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mergeSimilar"
              checked={mergeSimilar}
              onChange={(e) => setMergeSimilar(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <label htmlFor="mergeSimilar" className="text-sm text-gray-700 dark:text-gray-300">
              Merge similar memories (requires embeddings)
            </label>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-gray-500 dark:text-gray-400">Loading preview...</p>
            </div>
          ) : error ? (
            <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded">
              {error}
            </div>
          ) : preview ? (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                    {preview.wouldKeep}
                  </p>
                  <p className="text-sm text-green-600 dark:text-green-500">Keep</p>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                    {preview.wouldDelete}
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-500">Delete</p>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">
                    {preview.wouldMerge}
                  </p>
                  <p className="text-sm text-yellow-600 dark:text-yellow-500">Merge</p>
                </div>
              </div>

              {/* Details */}
              {preview.wouldDelete > 0 || preview.wouldMerge > 0 ? (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Changes Preview
                  </h3>
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {preview.details
                      .filter(d => d.action !== 'kept')
                      .map((detail) => (
                        <div
                          key={detail.memoryId}
                          className={`p-3 rounded-lg text-sm ${
                            detail.action === 'deleted'
                              ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                              : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
                          }`}
                        >
                          <p className="font-medium text-gray-900 dark:text-white line-clamp-1">
                            {detail.summary || 'Untitled memory'}
                          </p>
                          <p className="text-gray-600 dark:text-gray-400 text-xs mt-1">
                            {detail.reason}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p>No memories to clean up with current settings.</p>
                  <p className="text-sm mt-1">All memories are within retention policy.</p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-slate-700 flex gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={running || loading || !preview || (preview.wouldDelete === 0 && preview.wouldMerge === 0)}
            className="flex-1 px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-800 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed font-medium"
          >
            {running ? 'Running...' : `Delete ${preview?.wouldDelete || 0} Memories`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
