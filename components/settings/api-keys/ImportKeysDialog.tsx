'use client'

import { useRef, useEffect, useCallback } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { FormActions } from '@/components/ui/FormActions'
import ErrorAlert from '@/components/ui/ErrorAlert'
import { useImportKeys } from './hooks'
import { ImportKeysPreview } from './ImportKeysPreview'
import { showSuccessToast } from '@/lib/toast'
import type { DuplicateHandling, ProfileAssociation } from './types'

interface ImportKeysDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const DUPLICATE_OPTIONS: Array<{ value: DuplicateHandling; label: string; description: string }> = [
  {
    value: 'skip',
    label: 'Skip duplicates',
    description: 'Do not import keys that already exist',
  },
  {
    value: 'replace',
    label: 'Replace existing',
    description: 'Update existing keys with imported values',
  },
  {
    value: 'rename',
    label: 'Import as new',
    description: 'Create new keys with modified labels',
  },
]

export function ImportKeysDialog({
  isOpen,
  onClose,
  onSuccess,
}: ImportKeysDialogProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  const { state, fileInputRef, actions } = useImportKeys({
    isOpen,
    onSuccess,
  })

  useClickOutside(modalRef, onClose, {
    enabled: isOpen && state.step !== 'importing',
    onEscape: onClose,
  })

  // Don't call actions.reset() here - the !isOpen effect in useImportKeys handles that
  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  // Auto-close and show toasts when import is complete
  useEffect(() => {
    if (state.step === 'complete' && state.importResult) {

      // Show toasts for auto-associations
      if (state.importResult.associations && state.importResult.associations.length > 0) {
        state.importResult.associations.forEach((assoc: ProfileAssociation) => {
          showSuccessToast(
            `${assoc.profileName} linked to API key "${assoc.keyLabel}"`,
            4000
          )
        })
      }

      // Auto-close after a brief delay
      const timer = setTimeout(() => {
        handleClose()
      }, 1500)

      return () => clearTimeout(timer)
    }
  }, [state.step, state.importResult, handleClose])

  if (!isOpen) return null

  const getStepTitle = () => {
    switch (state.step) {
      case 'file':
        return 'Import API Keys'
      case 'passphrase':
        return 'Enter Passphrase'
      case 'preview':
        return 'Review Keys'
      case 'options':
        return 'Import Options'
      case 'importing':
        return 'Importing...'
      case 'complete':
        return 'Import Complete'
      case 'error':
        return 'Import Failed'
      default:
        return 'Import API Keys'
    }
  }

  return (
    <div className="qt-dialog-overlay">
      <div ref={modalRef} className="qt-dialog max-w-lg max-h-[80vh] flex flex-col">
        <div className="qt-dialog-header">
          <h2 className="qt-dialog-title">{getStepTitle()}</h2>
        </div>

        <div className="qt-dialog-body flex-1 overflow-y-auto">
          {state.error && (
            <ErrorAlert message={state.error} className="mb-4" />
          )}

          {/* Step: File Selection */}
          {state.step === 'file' && (
            <div className="space-y-4">
              <p className="qt-text-primary">
                Select a Quilltap API keys export file to import.
              </p>

              <div className="border-2 border-dashed qt-border-default rounded-lg p-8 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={actions.handleFileSelect}
                  className="hidden"
                  id="import-file"
                />
                <label
                  htmlFor="import-file"
                  className="cursor-pointer"
                >
                  <div className="text-4xl mb-2">📁</div>
                  <p className="qt-text-primary font-medium mb-1">
                    Click to select file
                  </p>
                  <p className="qt-text-xs">
                    Accepts .json export files
                  </p>
                </label>
              </div>
            </div>
          )}

          {/* Step: Passphrase Entry */}
          {state.step === 'passphrase' && (
            <div className="space-y-4">
              <p className="qt-text-primary">
                Enter the passphrase used to encrypt this export file.
              </p>

              {state.selectedFile && (
                <div className="p-3 rounded-lg qt-bg-surface-alt">
                  <p className="qt-text-small">
                    <strong>File:</strong> {state.selectedFile.name}
                  </p>
                  {state.fileData && (
                    <p className="qt-text-xs mt-1">
                      Exported: {new Date(state.fileData.exportedAt).toLocaleString()}
                      {' • '}
                      {state.fileData.keyCount} key{state.fileData.keyCount !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="import-passphrase" className="block qt-text-label mb-2">
                  Passphrase *
                </label>
                <input
                  type="password"
                  id="import-passphrase"
                  value={state.passphrase}
                  onChange={(e) => actions.setPassphrase(e.target.value)}
                  placeholder="Enter the export passphrase"
                  className="qt-input"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && state.passphrase) {
                      actions.handleVerify()
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* Step: Preview */}
          {state.step === 'preview' && (
            <ImportKeysPreview
              keys={state.keyPreviews}
              signatureValid={state.signatureValid}
            />
          )}

          {/* Step: Options (shown after preview if there are duplicates) */}
          {state.step === 'preview' && state.duplicateCount > 0 && (
            <div className="mt-6 pt-4 border-t qt-border-default">
              <p className="qt-text-label mb-3">How should duplicates be handled?</p>
              <div className="space-y-2">
                {DUPLICATE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      state.duplicateHandling === option.value
                        ? 'qt-border-primary qt-bg-primary/5'
                        : 'qt-border-default hover:qt-bg-surface-alt'
                    }`}
                  >
                    <input
                      type="radio"
                      name="duplicateHandling"
                      value={option.value}
                      checked={state.duplicateHandling === option.value}
                      onChange={() => actions.setDuplicateHandling(option.value)}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="qt-text-primary font-medium">{option.label}</p>
                      <p className="qt-text-xs">{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Step: Importing */}
          {state.step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 qt-border-primary mb-4" />
              <p className="qt-text-primary">Importing API keys...</p>
            </div>
          )}

          {/* Step: Complete */}
          {state.step === 'complete' && state.importResult && (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">✓</div>
              <p className="qt-text-primary font-medium mb-4">
                Import completed successfully!
              </p>
              <div className="space-y-1 qt-text-small">
                {state.importResult.imported > 0 && (
                  <p className="qt-text-success">
                    {state.importResult.imported} key{state.importResult.imported !== 1 ? 's' : ''} imported
                  </p>
                )}
                {state.importResult.replaced > 0 && (
                  <p className="qt-text-info">
                    {state.importResult.replaced} key{state.importResult.replaced !== 1 ? 's' : ''} replaced
                  </p>
                )}
                {state.importResult.skipped > 0 && (
                  <p className="qt-text-secondary">
                    {state.importResult.skipped} key{state.importResult.skipped !== 1 ? 's' : ''} skipped
                  </p>
                )}
                {state.importResult.errors.length > 0 && (
                  <p className="qt-text-destructive">
                    {state.importResult.errors.length} error{state.importResult.errors.length !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step: Error */}
          {state.step === 'error' && (
            <div className="text-center py-8">
              <p className="qt-text-primary mb-4">
                Import failed. Please try again.
              </p>
              <button
                onClick={actions.reset}
                className="qt-button-secondary"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        <div className="qt-dialog-footer">
          {state.step === 'file' && (
            <button onClick={handleClose} className="qt-button-secondary">
              Cancel
            </button>
          )}

          {state.step === 'passphrase' && (
            <FormActions
              onCancel={actions.goBack}
              onSubmit={actions.handleVerify}
              cancelLabel="Back"
              submitLabel="Verify"
              isLoading={false}
              isDisabled={!state.passphrase}
            />
          )}

          {state.step === 'preview' && (
            <FormActions
              onCancel={actions.goBack}
              onSubmit={actions.handleImport}
              cancelLabel="Back"
              submitLabel={`Import ${state.keyPreviews.length} Key${state.keyPreviews.length !== 1 ? 's' : ''}`}
              isLoading={false}
              isDisabled={false}
            />
          )}

          {(state.step === 'complete' || state.step === 'error') && (
            <button onClick={handleClose} className="qt-button-primary">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ImportKeysDialog
