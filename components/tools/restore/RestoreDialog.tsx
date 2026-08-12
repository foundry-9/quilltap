'use client'

import { Icon } from '@/components/ui/icon'
import { useRestoreData } from './hooks/useRestoreData'
import { RestoreItemSelector } from './RestoreItemSelector'
import { RestoreProgress } from './RestoreProgress'
import type { RestoreDialogProps } from './types'

function LoadingSpinner({ size = 4 }: { size?: number }) {
  return (
    <svg
      className={`w-${size} h-${size} animate-spin`}
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
  )
}

export function RestoreDialog({
  isOpen,
  onClose,
  onRestoreComplete,
}: RestoreDialogProps) {
  const { state, fileInputRef, actions } = useRestoreData(isOpen)

  if (!isOpen) return null

  const handleClose = () => {
    if (!state.restoring && !state.uploading) {
      actions.resetDialog()
      onClose()
    }
  }

  const handleCloseAfterRestore = () => {
    actions.resetDialog()
    onRestoreComplete()
    onClose()
  }

  const getStepNumber = (): number => {
    switch (state.step) {
      case 'source':
        return 1
      case 'preview':
        return 2
      case 'mode':
        return 3
      case 'progress':
        return 4
      default:
        return 1
    }
  }

  const renderModeSelection = () => (
    <div className="space-y-4">
      <div className="space-y-3">
        {/* Replace Mode */}
        <label
          className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${
            state.restoreMode === 'replace'
              ? 'qt-border-destructive qt-bg-destructive/10'
              : 'qt-border-default bg-background'
          }`}
        >
          <input
            type="radio"
            name="mode"
            value="replace"
            checked={state.restoreMode === 'replace'}
            onChange={(e) => {
              actions.setRestoreMode(e.target.value as 'replace' | 'import')
            }}
            className="mt-1"
          />
          <div className="ml-3 flex-1">
            <p className="text-sm qt-text-primary">Replace Existing Data</p>
            <p className="qt-text-xs mt-1">
              Delete all your current data and replace with backup
            </p>
          </div>
        </label>

        {/* Import Mode */}
        <label
          className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${
            state.restoreMode === 'import'
              ? 'qt-border-primary qt-bg-primary/10'
              : 'qt-border-default bg-background'
          }`}
        >
          <input
            type="radio"
            name="mode"
            value="import"
            checked={state.restoreMode === 'import'}
            onChange={(e) => {
              actions.setRestoreMode(e.target.value as 'replace' | 'import')
            }}
            className="mt-1"
          />
          <div className="ml-3 flex-1">
            <p className="text-sm qt-text-primary">Import as New Data</p>
            <p className="qt-text-xs mt-1">
              Keep your existing data and import backup with regenerated IDs
            </p>
          </div>
        </label>
      </div>

      {/* Replace Mode Warning */}
      {state.restoreMode === 'replace' && (
        <>
          <div className="qt-bg-destructive/10 border qt-border-destructive rounded-lg p-4">
            <p className="qt-text-destructive mb-3">
              Warning: This will DELETE all your current data!
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.confirmReplace}
                onChange={(e) => actions.setConfirmReplace(e.target.checked)}
                className="w-4 h-4 qt-text-destructive rounded focus:ring-ring"
              />
              <span className="text-sm qt-text-destructive">
                I understand this action cannot be undone
              </span>
            </label>
          </div>
          <div className="qt-bg-muted/50 border qt-border-default rounded-lg p-4 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.keepArchiveBundles}
                onChange={(e) => actions.setKeepArchiveBundles(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded focus:ring-ring"
              />
              <span className="text-sm qt-text-primary">
                Leave any archived-character bundles on the shelf
              </span>
            </label>
            <p className="qt-text-xs qt-text-secondary">
              The wipe that precedes the restore will spare each archived character&apos;s
              .qtap bundle. Their character records are replaced with the backup&apos;s like
              everything else, so a spared bundle is a loose one — importable afresh, but
              not simply woken. Untick to sweep the shelf bare as well.
            </p>
          </div>
        </>
      )}

      {state.error && (
        <div className="p-3 qt-bg-destructive/10 border qt-border-destructive rounded-lg">
          <p className="text-sm qt-text-destructive">{state.error}</p>
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={handleClose}
        disabled={state.restoring || state.uploading}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto w-[90vw] max-w-2xl">
        <div className="qt-dialog w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="qt-dialog-header flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="qt-dialog-title">Restore Backup</h2>
                <p className="qt-dialog-description mt-0.5">
                  Step {getStepNumber()} of 4
                </p>
              </div>
              <button
                onClick={handleClose}
                disabled={state.restoring || state.uploading}
                className="qt-text-secondary hover:text-foreground disabled:opacity-50"
                aria-label="Close dialog"
              >
                <Icon name="close" className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="qt-dialog-body overflow-y-auto flex-1">
            {state.step === 'source' && (
              <RestoreItemSelector
                selectedFile={state.selectedFile}
                error={state.error}
                onFileSelect={actions.handleFileSelect}
              />
            )}
            {state.step === 'preview' && (
              <RestoreProgress
                restoring={false}
                restoreSummary={null}
                error={state.error}
                preview={state.preview}
                loadingPreview={state.loadingPreview}
              />
            )}
            {state.step === 'mode' && renderModeSelection()}
            {state.step === 'progress' && (
              <RestoreProgress
                restoring={state.restoring}
                restoreSummary={state.restoreSummary}
                error={state.error}
              />
            )}
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer flex gap-3 justify-between flex-shrink-0">
            {state.step === 'progress' && state.restoreSummary ? (
              <button
                onClick={handleCloseAfterRestore}
                className="flex-1 qt-button qt-button-primary"
              >
                Close
              </button>
            ) : (
              <>
                <button
                  onClick={actions.handleBack}
                  disabled={state.step === 'source' || state.restoring || state.uploading}
                  className="qt-button qt-button-secondary"
                >
                  Back
                </button>

                {state.step === 'progress' ? null : (
                  <>
                    <button
                      onClick={handleClose}
                      disabled={state.restoring || state.uploading}
                      className="qt-button qt-button-secondary"
                    >
                      Cancel
                    </button>

                    {state.step === 'mode' ? (
                      <button
                        onClick={actions.handleStartRestore}
                        disabled={
                          state.restoring ||
                          (state.restoreMode === 'replace' &&
                            !state.confirmReplace)
                        }
                        className="qt-button qt-button-primary"
                      >
                        {state.restoring ? (
                          <>
                            <LoadingSpinner size={4} />
                            Restoring...
                          </>
                        ) : (
                          'Start Restore'
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={actions.handleNext}
                        disabled={
                          state.uploading ||
                          state.loadingPreview ||
                          (state.step === 'source' && !state.selectedFile)
                        }
                        className="qt-button qt-button-primary"
                      >
                        {state.uploading ? (
                          <>
                            <LoadingSpinner size={4} />
                            Uploading... {state.uploadProgress}%
                          </>
                        ) : state.loadingPreview ? (
                          <>
                            <LoadingSpinner size={4} />
                            Analyzing...
                          </>
                        ) : (
                          'Next'
                        )}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
