'use client'

import { showConfirmation } from '@/lib/alert'
import { showErrorToast } from '@/lib/toast'
import { Icon } from '@/components/ui/icon'

interface DeletedImagePlaceholderProps {
  imageId: string
  filename: string
  onCleanup?: () => void
  width?: number
  height?: number
  className?: string
}

export default function DeletedImagePlaceholder({
  imageId,
  filename,
  onCleanup,
  width = 400,
  height = 300,
  className = '',
}: DeletedImagePlaceholderProps) {
  const handleCleanup = async () => {
    if (
      !(await showConfirmation(
        'This image file has been deleted. Remove this reference from the database?'
      ))
    ) {
      return
    }

    try {
      const response = await fetch(`/api/v1/images/${imageId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove image reference')
      }

      onCleanup?.()
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to remove image reference')
    }
  }

  // Only apply width/height if not using a fill class
  const shouldApplyDimensions = !className.includes('w-full') && !className.includes('h-full')
  const style = shouldApplyDimensions ? { width, height } : undefined

  // Detect if we're in a compact/thumbnail mode (smaller padding)
  const isCompact = className.includes('!p-2')

  return (
    <div
      className={`flex flex-col items-center justify-center qt-bg-muted border-2 border-dashed border-muted-foreground rounded-lg ${isCompact ? 'p-1' : 'p-6'} ${className}`}
      style={style}
    >
      <Icon name="image" className={`qt-text-secondary ${isCompact ? 'w-6 h-6 mb-1' : 'w-12 h-12 mb-2'}`} />
      <p className={`text-foreground font-medium text-center ${isCompact ? 'text-[10px] mb-0.5' : 'text-sm mb-2'}`}>
        Image Deleted
      </p>
      {!isCompact && (
        <p className="qt-text-xs text-center mb-4 break-words max-w-full">{filename}</p>
      )}
      <button
        onClick={handleCleanup}
        className={`qt-bg-destructive hover:qt-bg-destructive/90 qt-text-on-destructive rounded transition-colors ${isCompact ? 'px-1.5 py-0.5 text-[9px]' : 'px-3 py-1 text-xs'}`}
      >
        Remove
      </button>
    </div>
  )
}
