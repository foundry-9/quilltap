'use client'

import { showConfirmation } from '@/lib/alert'
import { showErrorToast } from '@/lib/toast'

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
      const response = await fetch(`/api/images/${imageId}`, {
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
      className={`flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 border-2 border-dashed border-gray-400 dark:border-gray-600 rounded-lg ${isCompact ? 'p-1' : 'p-6'} ${className}`}
      style={style}
    >
      <svg className={`text-gray-400 dark:text-gray-500 ${isCompact ? 'w-6 h-6 mb-1' : 'w-12 h-12 mb-2'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
      <p className={`text-gray-600 dark:text-gray-400 font-medium text-center ${isCompact ? 'text-[10px] mb-0.5' : 'text-sm mb-2'}`}>
        Image Deleted
      </p>
      {!isCompact && (
        <p className="text-gray-500 dark:text-gray-500 text-xs text-center mb-4 break-words max-w-full">{filename}</p>
      )}
      <button
        onClick={handleCleanup}
        className={`bg-red-500 hover:bg-red-600 text-white rounded transition-colors ${isCompact ? 'px-1.5 py-0.5 text-[9px]' : 'px-3 py-1 text-xs'}`}
      >
        Remove
      </button>
    </div>
  )
}
