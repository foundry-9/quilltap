import { createRoot } from 'react-dom/client'
import { AlertDialog } from '@/components/alert-dialog'

/**
 * Shows a styled alert dialog with the given message.
 * This is a replacement for the native browser alert() function.
 *
 * @param message - The message to display in the dialog
 * @returns A promise that resolves when the dialog is closed
 */
export function showAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    // Create a container for the dialog
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const handleClose = () => {
      // Unmount and remove the dialog
      root.unmount()
      document.body.removeChild(container)
      resolve()
    }

    // Render the dialog
    root.render(<AlertDialog message={message} onClose={handleClose} />)
  })
}
