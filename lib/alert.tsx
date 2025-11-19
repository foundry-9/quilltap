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
    // Create a container for the dialog
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const handleClose = (buttonLabel?: string) => {
      // Unmount and remove the dialog
      root.unmount()
      document.body.removeChild(container)
      resolve(buttonLabel)
    }

    // Render the dialog
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
