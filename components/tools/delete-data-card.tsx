'use client'

import { useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { Icon } from '@/components/ui/icon'

interface DeleteSummary {
  characters: number
  chats: number
  tags: number
  files: number
  memories: number
  apiKeys: number
  backups: number
  personas?: number
  archiveBundles?: number
  archiveBundlesKept?: boolean
  profiles: {
    connection: number
    image: number
    embedding: number
  }
  templates?: {
    prompt: number
    roleplay: number
  }
  sync?: {
    instances: number
    mappings: number
    operations: number
    syncApiKeys: number
  }
}

export function DeleteDataCard() {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [step, setStep] = useState<'preview' | 'confirm' | 'deleting' | 'complete'>('preview')
  const [preview, setPreview] = useState<DeleteSummary | null>(null)
  const [deleteSummary, setDeleteSummary] = useState<DeleteSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [keepArchives, setKeepArchives] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleOpenDialog = async () => {
    setShowConfirmDialog(true)
    setStep('preview')
    setPreview(null)
    setDeleteSummary(null)
    setConfirmText('')
    setKeepArchives(true)
    setError(null)
    setLoading(true)

    try {
      const response = await fetch('/api/v1/system/tools?action=delete-data-preview')
      if (!response.ok) {
        throw new Error('Failed to load data preview')
      }
      const data = await response.json()
      setPreview(data.summary)
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to load preview')
      setError(errorMessage)
      console.error('Failed to load delete preview', { error: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setShowConfirmDialog(false)
    setStep('preview')
    setPreview(null)
    setDeleteSummary(null)
    setConfirmText('')
    setKeepArchives(true)
    setError(null)
  }

  const handleProceedToConfirm = () => {
    setStep('confirm')
    setConfirmText('')
  }

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') {
      setError('Please type DELETE to confirm')
      return
    }

    setStep('deleting')
    setError(null)

    try {
      const response = await fetch('/api/v1/system/tools?action=delete-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: 'DELETE_ALL_MY_DATA',
          keepArchivedCharacterBundles: keepArchives,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete data')
      }

      const data = await response.json()
      setDeleteSummary(data.summary)
      setStep('complete')
      showSuccessToast('All data has been deleted')
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to delete data')
      setError(errorMessage)
      setStep('confirm')
      console.error('Data deletion failed', { error: errorMessage })
      showErrorToast(errorMessage)
    }
  }

  const getTotalCount = (summary: DeleteSummary): number => {
    // `personas` and `sync` are legacy shape — the current API never returns
    // them, and an undefined addend turned the whole total into NaN.
    return (
      summary.characters +
      (summary.personas ?? 0) +
      summary.chats +
      summary.tags +
      summary.files +
      summary.memories +
      summary.apiKeys +
      summary.backups +
      summary.profiles.connection +
      summary.profiles.image +
      summary.profiles.embedding +
      (summary.templates?.prompt ?? 0) +
      (summary.templates?.roleplay ?? 0) +
      (summary.sync?.instances ?? 0) +
      (summary.sync?.mappings ?? 0) +
      (summary.sync?.operations ?? 0) +
      (summary.sync?.syncApiKeys ?? 0)
    )
  }

  return (
    <>
      {/* Card */}
      <div className="qt-card p-6">
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-1">
            <h2 className="qt-heading-2 text-foreground mb-1">
              Delete All Data
            </h2>
            <p className="qt-text-small">
              Permanently delete all your data including characters, personas, chats, files, API keys, and backups. This action cannot be undone.
            </p>
          </div>
          <div className="flex-shrink-0 qt-text-destructive">
            <Icon name="trash" className="w-8 h-8" />
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={handleOpenDialog}
          className="qt-button qt-button-destructive"
        >
          Delete All Data
        </button>
      </div>

      {/* Dialog */}
      {showConfirmDialog && (
        <>
          {/* Overlay */}
          <button
            className="qt-dialog-overlay z-40 cursor-default border-none p-0"
            onClick={handleClose}
            aria-label="Close dialog"
            type="button"
          />

          {/* Dialog */}
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto w-full max-w-md">
            <div className="qt-bg-card rounded-lg qt-shadow-lg w-full max-h-[85vh] flex flex-col">
              {/* Header */}
              <div className="px-6 py-4 border-b qt-border-default flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 qt-bg-destructive/10 rounded-full flex items-center justify-center">
                      <Icon name="alert-triangle" className="w-5 h-5 qt-text-destructive" />
                    </div>
                    <h2 className="qt-dialog-title text-foreground">
                      {step === 'complete' ? 'Deletion Complete' : 'Delete All Data'}
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
              <div className="px-6 py-6 overflow-y-auto flex-1">
                {step === 'preview' && (
                  <>
                    {loading ? (
                      <div className="flex items-center justify-center py-8">
                        <svg className="w-8 h-8 animate-spin qt-text-secondary" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      </div>
                    ) : preview ? (
                      <div className="space-y-4">
                        <p className="qt-text-small">
                          The following data will be permanently deleted:
                        </p>
                        <div className="qt-bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="qt-text-secondary">Characters</span>
                            <span className="qt-text-primary">{preview.characters}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="qt-text-secondary">Chats</span>
                            <span className="qt-text-primary">{preview.chats}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="qt-text-secondary">Tags</span>
                            <span className="qt-text-primary">{preview.tags}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="qt-text-secondary">Files</span>
                            <span className="qt-text-primary">{preview.files}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="qt-text-secondary">Memories</span>
                            <span className="qt-text-primary">{preview.memories}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="qt-text-secondary">API Keys</span>
                            <span className="qt-text-primary">{preview.apiKeys}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="qt-text-secondary">Backups</span>
                            <span className="qt-text-primary">{preview.backups}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="qt-text-secondary">Connection Profiles</span>
                            <span className="qt-text-primary">{preview.profiles.connection}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="qt-text-secondary">Image Profiles</span>
                            <span className="qt-text-primary">{preview.profiles.image}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="qt-text-secondary">Embedding Profiles</span>
                            <span className="qt-text-primary">{preview.profiles.embedding}</span>
                          </div>
                          {preview.templates && (preview.templates.prompt > 0 || preview.templates.roleplay > 0) && (
                            <>
                              <div className="flex justify-between">
                                <span className="qt-text-secondary">Prompt Templates</span>
                                <span className="qt-text-primary">{preview.templates.prompt}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="qt-text-secondary">Roleplay Templates</span>
                                <span className="qt-text-primary">{preview.templates.roleplay}</span>
                              </div>
                            </>
                          )}
                          {preview.sync && (preview.sync.instances > 0 || preview.sync.mappings > 0 || preview.sync.operations > 0) && (
                            <>
                              <div className="flex justify-between">
                                <span className="qt-text-secondary">Sync Instances (reset)</span>
                                <span className="qt-text-primary">{preview.sync.instances}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="qt-text-secondary">Sync Mappings</span>
                                <span className="qt-text-primary">{preview.sync.mappings}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="qt-text-secondary">Sync Operations</span>
                                <span className="qt-text-primary">{preview.sync.operations}</span>
                              </div>
                              <div className="text-xs qt-text-secondary mt-1 italic">
                                Sync instances will be reset (not deleted) - you can sync again to restore data from remote
                              </div>
                            </>
                          )}
                          {(preview.archiveBundles ?? 0) > 0 && (
                            <div className="flex justify-between">
                              <span className="qt-text-secondary">Archived Character Bundles</span>
                              <span className="qt-text-primary">
                                {preview.archiveBundles} {keepArchives ? '(kept)' : ''}
                              </span>
                            </div>
                          )}
                          <div className="border-t qt-border-default pt-2 mt-2">
                            <div className="flex justify-between font-semibold">
                              <span className="text-foreground">Total Items</span>
                              <span className="qt-text-destructive">{getTotalCount(preview)}</span>
                            </div>
                          </div>
                        </div>
                        {(preview.archiveBundles ?? 0) > 0 && (
                          <div className="qt-bg-muted/50 border qt-border-default rounded-lg p-3 space-y-2">
                            <label className="flex items-start gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={keepArchives}
                                onChange={(e) => setKeepArchives(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded focus:ring-ring"
                              />
                              <span className="text-sm qt-text-primary">
                                Leave the archived-character bundles on the shelf ({preview.archiveBundles}{' '}
                                {preview.archiveBundles === 1 ? 'file' : 'files'})
                              </span>
                            </label>
                            <p className="qt-text-xs qt-text-secondary">
                              Their character records perish with everything else, so what remains is a
                              loose bundle apiece — each may be imported afresh, but none can simply be
                              woken. Untick to sweep the shelf bare as well.
                            </p>
                          </div>
                        )}
                        <div className="qt-bg-destructive/10 border qt-border-destructive/30 rounded-lg p-3">
                          <p className="text-sm qt-text-destructive font-medium">
                            This action cannot be undone. All your data will be permanently deleted.
                          </p>
                        </div>
                      </div>
                    ) : error ? (
                      <div className="p-3 qt-bg-destructive/10 border qt-border-destructive/30 rounded-lg">
                        <p className="text-sm qt-text-destructive">{error}</p>
                      </div>
                    ) : null}
                  </>
                )}

                {step === 'confirm' && (
                  <div className="space-y-4">
                    <p className="qt-text-small">
                      To confirm deletion, please type <span className="font-mono font-semibold qt-text-destructive">DELETE</span> below:
                    </p>
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                      placeholder="Type DELETE to confirm"
                      className="qt-input"
                      autoFocus
                    />
                    {error && (
                      <div className="p-3 qt-bg-destructive/10 border qt-border-destructive/30 rounded-lg">
                        <p className="text-sm qt-text-destructive">{error}</p>
                      </div>
                    )}
                  </div>
                )}

                {step === 'deleting' && (
                  <div className="flex flex-col items-center justify-center py-8 space-y-4">
                    <svg className="w-12 h-12 animate-spin qt-text-destructive" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="qt-text-small">Deleting all data...</p>
                  </div>
                )}

                {step === 'complete' && deleteSummary && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center">
                      <div className="w-16 h-16 qt-bg-success/10 rounded-full flex items-center justify-center">
                        <Icon name="check" className="w-8 h-8 qt-text-success" />
                      </div>
                    </div>
                    <p className="text-center qt-text-small">
                      Successfully deleted {getTotalCount(deleteSummary)} items from your account.
                    </p>
                    {deleteSummary.archiveBundlesKept && (deleteSummary.archiveBundles ?? 0) > 0 && (
                      <p className="text-center qt-text-xs">
                        {deleteSummary.archiveBundles} archived-character{' '}
                        {deleteSummary.archiveBundles === 1 ? 'bundle remains' : 'bundles remain'} on the
                        shelf, ready for import.
                      </p>
                    )}
                    <p className="text-center qt-text-xs">
                      Your account is now clean. You can start fresh or restore from a backup.
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 qt-bg-muted border-t qt-border-default flex gap-3 justify-end flex-shrink-0 rounded-b-lg">
                {step === 'preview' && (
                  <>
                    <button
                      onClick={handleClose}
                      className="qt-button qt-button-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleProceedToConfirm}
                      disabled={loading || !preview || getTotalCount(preview) === 0}
                      className="qt-button qt-button-destructive"
                    >
                      Continue
                    </button>
                  </>
                )}

                {step === 'confirm' && (
                  <>
                    <button
                      onClick={() => setStep('preview')}
                      className="qt-button qt-button-secondary"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={confirmText !== 'DELETE'}
                      className="qt-button qt-button-destructive"
                    >
                      Delete Everything
                    </button>
                  </>
                )}

                {step === 'complete' && (
                  <button
                    onClick={handleClose}
                    className="qt-button qt-button-primary"
                  >
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
