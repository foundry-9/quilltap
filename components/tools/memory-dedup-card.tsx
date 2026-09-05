'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'

interface CharacterResult {
  characterId: string
  characterName: string
  originalCount: number
  withEmbeddings: number
  withoutEmbeddings: number
  clustersFound: number
  memoriesInClusters: number
  removedCount: number
  mergedDetailCount: number
  finalCount: number
}

interface DedupPreview {
  threshold: number
  dryRun: boolean
  characters: CharacterResult[]
  totalOriginal: number
  totalRemoved: number
  totalMergedDetails: number
  totalFinal: number
  processedAt: string
}

type Step = 'idle' | 'analyzing' | 'preview' | 'running' | 'complete'

export function MemoryDedupCard() {
  const [showDialog, setShowDialog] = useState(false)
  const [step, setStep] = useState<Step>('idle')
  const [threshold, setThreshold] = useState(0.80)
  const [preview, setPreview] = useState<DedupPreview | null>(null)
  const [result, setResult] = useState<DedupPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = async () => {
    setShowDialog(true)
    setStep('analyzing')
    setPreview(null)
    setResult(null)
    setError(null)

    try {
      const response = await fetch(
        `/api/v1/system/tools?action=memory-dedup-preview&threshold=${threshold}`
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to analyze memories')
      }
      const data = await response.json()
      setPreview(data.result)
      setStep('preview')
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to analyze memories')
      setError(errorMessage)
      setStep('preview')
      console.error('Memory dedup preview failed', { error: errorMessage })
    }
  }

  const handleRun = async () => {
    if (!preview) return
    setStep('running')
    setError(null)

    try {
      const response = await fetch('/api/v1/system/tools?action=memory-dedup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to deduplicate memories')
      }

      const data = await response.json()
      setResult(data.result)
      setStep('complete')
      showSuccessToast(
        `Removed ${data.result.totalRemoved} duplicate memories, merged ${data.result.totalMergedDetails} details`
      )
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to deduplicate memories')
      setError(errorMessage)
      setStep('preview')
      console.error('Memory dedup failed', { error: errorMessage })
      showErrorToast(errorMessage)
    }
  }

  const handleClose = () => {
    setShowDialog(false)
    setStep('idle')
    setPreview(null)
    setResult(null)
    setError(null)
  }

  const totalRemovable = preview?.totalRemoved ?? 0

  return (
    <>
      {/* Card */}
      <div className="qt-card p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-1">
            <h2 className="qt-heading-2 mb-1">
              Memory Deduplication
            </h2>
            <p className="qt-text-small">
              Find and merge duplicate memories across all characters. Semantically similar
              memories are clustered, the best version is kept, and unique details from
              duplicates are preserved as footnotes.
            </p>
          </div>
          <div className="flex-shrink-0 text-primary">
            <Icon name="cpu" className="w-8 h-8" />
          </div>
        </div>

        {/* Threshold Slider */}
        <div className="mb-4">
          <label className="qt-text-small font-medium block mb-2">
            Similarity Threshold: {threshold.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.70"
            max="0.95"
            step="0.01"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="qt-range w-full"
          />
          <div className="flex justify-between qt-text-xs mt-1">
            <span>0.70 (more aggressive)</span>
            <span>0.95 (more conservative)</span>
          </div>
        </div>

        <button onClick={handleAnalyze} className="qt-button qt-button-primary">
          Analyze Memories
        </button>
      </div>

      {/* Dialog */}
      {showDialog && (
        <>
          {/* Overlay */}
          <button
            className="qt-dialog-overlay z-40 cursor-default border-none p-0"
            onClick={handleClose}
            aria-label="Close dialog"
            type="button"
          />

          {/* Dialog */}
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto">
            <div className="qt-bg-card rounded-lg qt-shadow-lg w-full max-w-lg">
              {/* Header */}
              <div className="px-6 py-4 border-b qt-border-default">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 qt-bg-primary/10 rounded-full flex items-center justify-center">
                      <Icon name="cpu" className="w-5 h-5 text-primary" />
                    </div>
                    <h2 className="qt-heading-4">
                      {step === 'complete' ? 'Deduplication Complete' : 'Memory Deduplication'}
                    </h2>
                  </div>
                  <button
                    onClick={handleClose}
                    className="qt-button qt-button-ghost qt-text-secondary hover:text-foreground p-1"
                    aria-label="Close dialog"
                  >
                    <Icon name="close" className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-6">
                {/* Analyzing step */}
                {step === 'analyzing' && (
                  <div className="flex flex-col items-center justify-center py-8 space-y-4">
                    <svg className="w-12 h-12 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="qt-text-small">Analyzing memories for duplicates...</p>
                  </div>
                )}

                {/* Preview step */}
                {step === 'preview' && (
                  <>
                    {error ? (
                      <div className="p-3 qt-bg-destructive/10 border qt-border-destructive/30 rounded-lg">
                        <p className="text-sm qt-text-destructive">{error}</p>
                      </div>
                    ) : preview ? (
                      <div className="space-y-4">
                        <p className="qt-text-small">
                          Analysis at threshold <span className="font-semibold">{preview.threshold.toFixed(2)}</span>:
                        </p>

                        {/* Results table */}
                        <div className="max-h-64 overflow-y-auto border qt-border-default rounded-lg">
                          <table className="w-full text-sm">
                            <thead className="qt-bg-muted sticky top-0">
                              <tr>
                                <th className="text-left px-3 py-2 qt-text-secondary font-medium">Character</th>
                                <th className="text-right px-3 py-2 qt-text-secondary font-medium">Memories</th>
                                <th className="text-right px-3 py-2 qt-text-secondary font-medium">Clusters</th>
                                <th className="text-right px-3 py-2 qt-text-secondary font-medium">Removable</th>
                                <th className="text-right px-3 py-2 qt-text-secondary font-medium">Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {preview.characters.map((char) => (
                                <tr
                                  key={char.characterId}
                                  className={char.clustersFound === 0 ? 'opacity-50' : ''}
                                >
                                  <td className="px-3 py-2 text-foreground truncate max-w-[150px]">{char.characterName}</td>
                                  <td className="text-right px-3 py-2 qt-text-primary">{char.originalCount}</td>
                                  <td className="text-right px-3 py-2 qt-text-primary">{char.clustersFound}</td>
                                  <td className="text-right px-3 py-2 qt-text-primary">{char.removedCount}</td>
                                  <td className="text-right px-3 py-2 qt-text-primary">{char.mergedDetailCount}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="qt-bg-muted border-t qt-border-default">
                              <tr className="font-semibold">
                                <td className="px-3 py-2 text-foreground">Total</td>
                                <td className="text-right px-3 py-2 text-foreground">{preview.totalOriginal}</td>
                                <td className="text-right px-3 py-2 text-foreground">
                                  {preview.characters.reduce((sum, c) => sum + c.clustersFound, 0)}
                                </td>
                                <td className="text-right px-3 py-2 text-foreground">{preview.totalRemoved}</td>
                                <td className="text-right px-3 py-2 text-foreground">{preview.totalMergedDetails}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>

                        {totalRemovable > 0 && (
                          <div className="qt-bg-primary/10 border qt-border-primary/30 rounded-lg p-3">
                            <p className="text-sm text-foreground">
                              <span className="font-semibold">{preview.totalRemoved}</span> duplicate memories
                              can be removed. <span className="font-semibold">{preview.totalMergedDetails}</span> unique
                              details will be preserved as footnotes in surviving memories.
                            </p>
                          </div>
                        )}

                        {totalRemovable === 0 && (
                          <div className="qt-bg-muted rounded-lg p-3">
                            <p className="text-sm qt-text-secondary">
                              No duplicate memories found at this threshold. Try lowering the threshold to find more matches.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </>
                )}

                {/* Running step */}
                {step === 'running' && (
                  <div className="flex flex-col items-center justify-center py-8 space-y-4">
                    <svg className="w-12 h-12 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="qt-text-small">Deduplicating memories...</p>
                    <p className="qt-text-xs">Merging unique details and removing duplicates</p>
                  </div>
                )}

                {/* Complete step */}
                {step === 'complete' && result && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center">
                      <div className="w-16 h-16 qt-bg-success/10 rounded-full flex items-center justify-center">
                        <Icon name="check" className="w-8 h-8 qt-text-success" />
                      </div>
                    </div>

                    {/* Results table */}
                    <div className="max-h-64 overflow-y-auto border qt-border-default rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="qt-bg-muted sticky top-0">
                          <tr>
                            <th className="text-left px-3 py-2 qt-text-secondary font-medium">Character</th>
                            <th className="text-right px-3 py-2 qt-text-secondary font-medium">Before</th>
                            <th className="text-right px-3 py-2 qt-text-secondary font-medium">Removed</th>
                            <th className="text-right px-3 py-2 qt-text-secondary font-medium">After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.characters.filter(c => c.removedCount > 0).map((char) => (
                            <tr key={char.characterId}>
                              <td className="px-3 py-2 text-foreground truncate max-w-[150px]">{char.characterName}</td>
                              <td className="text-right px-3 py-2 qt-text-primary">{char.originalCount}</td>
                              <td className="text-right px-3 py-2 qt-text-destructive">{char.removedCount}</td>
                              <td className="text-right px-3 py-2 qt-text-primary">{char.finalCount}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="qt-bg-muted border-t qt-border-default">
                          <tr className="font-semibold">
                            <td className="px-3 py-2 text-foreground">Total</td>
                            <td className="text-right px-3 py-2 text-foreground">{result.totalOriginal}</td>
                            <td className="text-right px-3 py-2 qt-text-destructive">{result.totalRemoved}</td>
                            <td className="text-right px-3 py-2 text-foreground">{result.totalFinal}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <p className="text-center qt-text-xs">
                      {result.totalMergedDetails} unique details preserved as footnotes in surviving memories.
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 qt-bg-muted border-t qt-border-default flex gap-3 justify-end">
                {step === 'preview' && (
                  <>
                    <button onClick={handleClose} className="qt-button qt-button-secondary">
                      Cancel
                    </button>
                    <button
                      onClick={handleRun}
                      disabled={!preview || totalRemovable === 0}
                      className="qt-button qt-button-primary"
                    >
                      Run Deduplication
                    </button>
                  </>
                )}

                {step === 'complete' && (
                  <button onClick={handleClose} className="qt-button qt-button-primary">
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
