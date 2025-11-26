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
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'alert-dialog-overlay')
    document.body.appendChild(overlay)
    const overlayRoot = createRoot(overlay)

    const container = document.createElement('div')
    container.setAttribute('role', 'alert-dialog-content')
    document.body.appendChild(container)
    
    const root = createRoot(container)

    const handleClose = (buttonLabel?: string) => {
      root.unmount()
      overlayRoot.unmount()
      if (container.parentNode) {
        container.parentNode.removeChild(container)
      }
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay)
      }
      resolve(buttonLabel)
    }

    overlayRoot.render(
      <button
        type="button"
        className="fixed inset-0 bg-black opacity-50 z-[100] cursor-default border-none p-0"
        onClick={() => handleClose()}
        aria-label="Close dialog"
      />
    )

    root.render(
      <AlertDialog
        message={message}
        onClose={handleClose}
        buttons={buttons}
        showCopy={!buttons || buttons.length === 0}
      />
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
