'use client'

/**
 * FileConflictDialog Component
 *
 * Modal dialog for handling duplicate file conflicts when uploading
 * to project chats. Offers options to Replace, Keep Both, or Skip.
 */

import { useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { formatBytes } from '@/lib/utils/format-bytes'
import { formatDateTime } from '@/lib/format-time'

/**
 * Information about a file conflict
 */
export interface FileConflictInfo {
  conflictType: 'filename' | 'content' | 'both'
  existingFile: {
    id: string
    filename: string
    size: number
    createdAt: string
    sha256: string
  }
  newFile: {
    filename: string
    size: number
    sha256: string
  }
}

/**
 * Resolution options for duplicate conflicts
 */
export type ConflictResolution = 'replace' | 'keepBoth' | 'skip'

interface FileConflictDialogProps {
  isOpen: boolean
  onClose: () => void
  conflict: FileConflictInfo | null
  onResolve: (resolution: ConflictResolution) => void
  resolving?: boolean
}

/**
 * Get user-friendly conflict description
 */
function getConflictDescription(conflictType: 'filename' | 'content' | 'both'): string {
  switch (conflictType) {
    case 'filename':
      return 'A file with this name already exists in the project.'
    case 'content':
      return 'This exact file already exists in the project (with a different name).'
    case 'both':
      return 'This exact file already exists with the same name.'
  }
}

export default function FileConflictDialog({
  isOpen,
  onClose,
  conflict,
  onResolve,
  resolving = false,
}: Readonly<FileConflictDialogProps>) {
  const [selectedResolution, setSelectedResolution] = useState<ConflictResolution | null>(null)

  if (!conflict) return null

  const handleResolve = (resolution: ConflictResolution) => {
    onResolve(resolution)
  }

  const handleClose = () => {
    setSelectedResolution(null)
    onClose()
  }

  const footer = (
    <div className="flex flex-col sm:flex-row justify-end gap-2">
      <button
        onClick={handleClose}
        disabled={resolving}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      <button
        onClick={() => handleResolve('skip')}
        disabled={resolving}
        className="qt-button qt-button-secondary"
      >
        {resolving && selectedResolution === 'skip' ? 'Skipping...' : 'Skip Upload'}
      </button>
      <button
        onClick={() => {
          setSelectedResolution('keepBoth')
          handleResolve('keepBoth')
        }}
        disabled={resolving}
        className="qt-button qt-button-secondary"
      >
        {resolving && selectedResolution === 'keepBoth' ? 'Uploading...' : 'Keep Both'}
      </button>
      <button
        onClick={() => {
          setSelectedResolution('replace')
          handleResolve('replace')
        }}
        disabled={resolving}
        className="qt-button qt-button-primary"
      >
        {resolving && selectedResolution === 'replace' ? 'Replacing...' : 'Replace'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="File Already Exists"
      footer={footer}
      closeOnClickOutside={!resolving}
      closeOnEscape={!resolving}
    >
      <div className="space-y-4">
        {/* Conflict explanation */}
        <p className="qt-text-secondary">
          {getConflictDescription(conflict.conflictType)}
        </p>

        {/* Existing file info */}
        <div className="p-3 qt-bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">📄</span>
            <span className="font-medium">Existing File</span>
          </div>
          <div className="text-sm space-y-1 ml-7">
            <div className="font-medium">{conflict.existingFile.filename}</div>
            <div className="qt-text-xs qt-text-secondary">
              {formatBytes(conflict.existingFile.size)} • Uploaded {formatDateTime(conflict.existingFile.createdAt)}
            </div>
          </div>
        </div>

        {/* New file info */}
        <div className="p-3 qt-bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">📎</span>
            <span className="font-medium">New File</span>
          </div>
          <div className="text-sm space-y-1 ml-7">
            <div className="font-medium">{conflict.newFile.filename}</div>
            <div className="qt-text-xs qt-text-secondary">
              {formatBytes(conflict.newFile.size)}
            </div>
          </div>
        </div>

        {/* Resolution options explanation */}
        <div className="qt-text-xs qt-text-secondary space-y-1 border-t pt-3">
          <p><strong>Replace:</strong> Delete the existing file and upload the new one.</p>
          <p><strong>Keep Both:</strong> Upload the new file with a modified name (e.g., &quot;file (1).pdf&quot;).</p>
          <p><strong>Skip Upload:</strong> Cancel and keep the existing file.</p>
        </div>
      </div>
    </BaseModal>
  )
}
