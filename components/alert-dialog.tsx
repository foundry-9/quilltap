'use client'

import { useEffect } from 'react'

interface AlertDialogProps {
  message: string
  onClose: () => void
}

export function AlertDialog({ message, onClose }: AlertDialogProps) {
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      // Optional: You could add a visual feedback here
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-500 dark:bg-gray-900 bg-opacity-75 dark:bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md w-full shadow-xl">
        <div className="mb-6">
          <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap break-words">
            {message}
          </p>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleCopy}
            className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
          >
            Copy
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
