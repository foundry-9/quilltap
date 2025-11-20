import { createRoot } from 'react-dom/client'
import { AlertDialog } from '@/components/alert-dialog'

/**
 * Shows a styled alert dialog with the given message.
 * This is a replacement for the native browser alert() function.
 *
 * @param message - The message to display in the dialog
 * @param buttons - Optional array of button labels. If not provided, defaults to ['Close']
 * @returns A promise that resolves with the clicked button label when the dialog is closed
 */
export function showAlert(message: string, buttons?: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    // Create separate containers for overlay and dialog
    const overlayContainer = document.createElement('div')
    overlayContainer.setAttribute('role', 'alert-dialog-overlay')
    overlayContainer.style.position = 'fixed'
    overlayContainer.style.inset = '0'
    overlayContainer.style.zIndex = '40'
    overlayContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.3)'
    overlayContainer.style.pointerEvents = 'auto'

    const dialogContainer = document.createElement('div')
    dialogContainer.setAttribute('role', 'alert-dialog-content')
    dialogContainer.style.position = 'fixed'
    dialogContainer.style.top = '50%'
    dialogContainer.style.left = '50%'
    dialogContainer.style.transform = 'translate(-50%, -50%)'
    dialogContainer.style.zIndex = '50'
    dialogContainer.style.pointerEvents = 'auto'

    document.body.appendChild(overlayContainer)
    document.body.appendChild(dialogContainer)

    const overlayRoot = createRoot(overlayContainer)
    const dialogRoot = createRoot(dialogContainer)

    const handleClose = (buttonLabel?: string) => {
      // Unmount and remove both
      overlayRoot.unmount()
      dialogRoot.unmount()
      if (overlayContainer.parentNode) {
        overlayContainer.parentNode.removeChild(overlayContainer)
      }
      if (dialogContainer.parentNode) {
        dialogContainer.parentNode.removeChild(dialogContainer)
      }
      resolve(buttonLabel)
    }

    // Render the overlay
    overlayRoot.render(
      <div onClick={() => handleClose()} />
    )

    // Render the dialog
    dialogRoot.render(
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md shadow-xl">
        <div className="mb-6">
          <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap break-words">
            {message}
          </p>
        </div>
        <div className="flex gap-3 justify-end">
          {(!buttons || buttons.length === 0) && (
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message)
                } catch (err) {
                  console.error('Failed to copy to clipboard:', err)
                }
              }}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
            >
              Copy
            </button>
          )}
          {(buttons || ['Close']).map((buttonLabel, index) => {
            const isLast = index === (buttons || ['Close']).length - 1
            const buttonClass = isLast
              ? 'px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800 transition-colors'
              : 'px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors'
            return (
              <button
                key={buttonLabel}
                onClick={() => handleClose(buttonLabel)}
                className={buttonClass}
              >
                {buttonLabel}
              </button>
            )
          })}
        </div>
      </div>
    )
  })
}

/**
 * Shows a confirmation dialog with the given message.
 * This is a convenience function for yes/no confirmations.
 *
 * @param message - The message to display in the dialog
 * @returns A promise that resolves to true if confirmed, false if cancelled
 */
export function showConfirmation(message: string): Promise<boolean> {
  return showAlert(message, ['Cancel', 'Confirm']).then((result) => result === 'Confirm')
}
