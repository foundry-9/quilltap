'use client'

import { useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { triggerUrlDownload } from '@/lib/download-utils'
import { Icon } from '@/components/ui/icon'

interface BackupDialogProps {
  isOpen: boolean
  onClose: () => void
  onBackupComplete: () => void
}

export function BackupDialog({ isOpen, onClose, onBackupComplete }: BackupDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Full fidelity is the default: a backup restores the same instance, so its
  // search indexes are still valid on arrival and rebuilding them costs real
  // time and money exactly when the user is recovering from something.
  const [compact, setCompact] = useState(false)

  if (!isOpen) return null

  const handleCreateBackup = async () => {
    setError(null)
    setLoading(true)

    try {
      const response = await fetch('/api/v1/system/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compact }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create backup')
      }

      if (data.backupId) {
        const downloadUrl = `/api/v1/system/backup/${data.backupId}`
        const filename = data.filename || `quilltap-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
        await triggerUrlDownload(downloadUrl, filename)

        showSuccessToast('Backup downloaded successfully')
      }

      // Call completion callback
      onBackupComplete()

      // Close dialog
      onClose()
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to create backup')
      setError(errorMessage)
      console.error('Backup creation failed', {
        error: errorMessage,
        errorType: err instanceof Error ? err.name : typeof err,
      })
      showErrorToast(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setError(null)
    onClose()
  }

  return (
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={handleClose}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto">
        <div className="qt-dialog max-w-md">
          {/* Header */}
          <div className="qt-dialog-header">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">Create Backup</h2>
              <button
                onClick={handleClose}
                className="qt-text-secondary hover:text-foreground"
                aria-label="Close dialog"
              >
                <Icon name="close" className="w-6 h-6" />
              </button>
            </div>
            <p className="qt-dialog-description qt-text-small">
              Create a complete backup of your Quilltap data
            </p>
          </div>

          {/* Body */}
          <div className="qt-dialog-body space-y-4">
            <div className="p-4 qt-bg-muted/50 rounded-lg">
              <p className="text-sm qt-text-primary mb-2">
                Your backup will include:
              </p>
              <ul className="qt-text-small space-y-1 list-disc list-inside">
                <li>All characters, chats, and messages</li>
                <li>Memories and relationships</li>
                <li>All uploaded files and images</li>
                <li>Connection, image, and embedding profiles</li>
                <li>Templates, projects, and character groups</li>
                <li>Plugin configurations and npm plugins</li>
              </ul>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact(e.target.checked)}
                disabled={loading}
                className="w-4 h-4 mt-0.5"
              />
              <span>
                <span className="text-sm qt-text-primary">Compact backup</span>
                <span className="block qt-text-small qt-text-secondary">
                  A considerably slimmer archive — the search indexes are left behind and
                  rebuilt after restoring. Everything you have written travels either way.
                </span>
              </span>
            </label>

            {/* Error Display */}
            {error && (
              <div className="p-3 qt-bg-destructive/10 border qt-border-destructive rounded-lg">
                <p className="text-sm qt-text-destructive">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer">
            <button
              onClick={handleClose}
              disabled={loading}
              className="qt-button qt-button-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateBackup}
              disabled={loading}
              className="qt-button qt-button-primary"
            >
              {loading && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {loading ? 'Creating Backup...' : 'Download Backup'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
