'use client'

import { useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'

interface AlertDialogProps {
  message: string
  onClose: (buttonLabel?: string) => void
  buttons?: string[]
  showCopy?: boolean
}

export function AlertDialog({ message, onClose, buttons, showCopy = true }: AlertDialogProps) {
  // Close on Escape key and prevent body scroll
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
      clientLogger.error('Failed to copy to clipboard:', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  // Default to single close button if no buttons provided
  const dialogButtons = buttons && buttons.length > 0 ? buttons : ['Close']

  const getButtonStyle = (index: number, total: number) => {
    // Last button is primary (blue), others are secondary (gray)
    const isLast = index === total - 1
    return isLast
      ? 'px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800 transition-colors'
      : 'px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors'
  }

  return (
    <>
      <button
        className="fixed inset-0 bg-black bg-opacity-10 pointer-events-auto z-[100] cursor-default border-none p-0"
        onClick={() => onClose()}
        aria-label="Close dialog"
        type="button"
      />
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[101] pointer-events-auto">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md w-full shadow-xl">
        <div className="mb-6">
          <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap break-words">
            {message}
          </p>
        </div>
        <div className="flex gap-3 justify-end">
          {showCopy && (
            <button
              onClick={handleCopy}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
            >
              Copy
            </button>
          )}
          {dialogButtons.map((buttonLabel, index) => (
            <button
              key={buttonLabel}
              onClick={() => onClose(buttonLabel)}
              className={getButtonStyle(index, dialogButtons.length)}
            >
              {buttonLabel}
            </button>
          ))}
        </div>
        </div>
      </div>
    </>
  )
}
