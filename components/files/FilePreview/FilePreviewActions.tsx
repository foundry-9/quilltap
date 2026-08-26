'use client'

/**
 * FilePreviewActions Component
 *
 * Action bar for the file preview modal with navigation and file operations.
 */

import { useEffect, useCallback } from 'react'
import { FilePreviewActionsProps } from './types'

export default function FilePreviewActions({
  file,
  currentIndex,
  totalFiles,
  onPrevious,
  onNext,
  onDownload,
  onDelete,
  onMoveToProject,
  onClose,
  isDeleting = false,
  canMoveToProject = false,
}: Readonly<FilePreviewActionsProps>) {
  const hasPrevious = currentIndex > 0
  const hasNext = currentIndex < totalFiles - 1

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowLeft':
          if (hasPrevious) onPrevious()
          break
        case 'ArrowRight':
          if (hasNext) onNext()
          break
      }
    },
    [onClose, onPrevious, onNext, hasPrevious, hasNext]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    // Actions bar rendered
  }, [file.id, currentIndex, totalFiles])

  return (
    <div className="flex items-center justify-between p-4 border-b qt-border-default">
      {/* Left: Navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={onPrevious}
          disabled={!hasPrevious}
          className="qt-button qt-button-secondary p-2 disabled:opacity-50"
          title="Previous file (Left arrow)"
        >
          {'\u2190'} {/* left arrow */}
        </button>
        <span className="qt-text-small qt-text-secondary">
          {currentIndex + 1} of {totalFiles}
        </span>
        <button
          onClick={onNext}
          disabled={!hasNext}
          className="qt-button qt-button-secondary p-2 disabled:opacity-50"
          title="Next file (Right arrow)"
        >
          {'\u2192'} {/* right arrow */}
        </button>
      </div>

      {/* Center: Filename */}
      <div className="flex-1 text-center px-4 truncate">
        <span className="font-medium" title={file.originalFilename || file.filename}>
          {file.originalFilename || file.filename}
        </span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onDownload}
          className="qt-button qt-button-secondary p-2"
          title="Download"
        >
          {'\u2B07\uFE0F'} {/* download arrow */}
        </button>
        {canMoveToProject && onMoveToProject && (
          <button
            onClick={onMoveToProject}
            className="qt-button qt-button-secondary p-2"
            title="Move to Project"
          >
            {'\u{1F4C1}'} {/* folder icon */}
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="qt-button qt-button-secondary p-2 qt-text-destructive hover:qt-bg-destructive hover:qt-text-on-destructive disabled:opacity-50"
          title="Delete"
        >
          {isDeleting ? '\u23F3' : '\u{1F5D1}\uFE0F'} {/* hourglass or trash */}
        </button>
        <button
          onClick={onClose}
          className="qt-button qt-button-secondary p-2"
          title="Close (Escape)"
        >
          {'\u2715'} {/* X */}
        </button>
      </div>
    </div>
  )
}
