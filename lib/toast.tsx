import { createRoot } from 'react-dom/client'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastOptions {
  duration?: number
  type?: ToastType
}

interface Toast {
  id: string
  message: string
  type: ToastType
  duration: number
}

let toastContainer: HTMLDivElement | null = null
let toastRoot: ReturnType<typeof createRoot> | null = null
let toasts: Toast[] = []

function ensureContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div')
    toastContainer.setAttribute('role', 'toast-container')
    toastContainer.style.position = 'fixed'
    toastContainer.style.bottom = '20px'
    toastContainer.style.right = '20px'
    toastContainer.style.zIndex = '50'
    toastContainer.style.pointerEvents = 'none'
    toastContainer.style.display = 'flex'
    toastContainer.style.flexDirection = 'column'
    toastContainer.style.gap = '10px'
    toastContainer.style.maxWidth = '400px'
    document.body.appendChild(toastContainer)
    toastRoot = createRoot(toastContainer)
  }
}

function getToastStyles(type: ToastType) {
  switch (type) {
    case 'success':
      return {
        bg: 'bg-green-500 dark:bg-green-600',
        border: 'border-green-600 dark:border-green-700',
      }
    case 'error':
      return {
        bg: 'bg-red-500 dark:bg-red-600',
        border: 'border-red-600 dark:border-red-700',
      }
    case 'warning':
      return {
        bg: 'bg-yellow-500 dark:bg-yellow-600',
        border: 'border-yellow-600 dark:border-yellow-700',
      }
    case 'info':
    default:
      return {
        bg: 'bg-blue-500 dark:bg-blue-600',
        border: 'border-blue-600 dark:border-blue-700',
      }
  }
}

function renderToasts() {
  if (!toastRoot) return

  toastRoot.render(
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {toasts.map((toast) => {
        const styles = getToastStyles(toast.type)
        return (
          <div
            key={toast.id}
            className={`${styles.bg} border ${styles.border} text-white px-4 py-3 rounded-lg shadow-lg pointer-events-auto animate-in fade-in slide-in-from-bottom-3 duration-300`}
            style={{
              animation: 'slideInUp 0.3s ease-out',
            }}
          >
            {toast.message}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Shows a toast notification with the given message.
 * Toast notifications are temporary, non-blocking messages that appear in the bottom-right corner.
 *
 * @param message - The message to display
 * @param options - Configuration options (duration in ms, type of toast)
 */
export function showToast(message: string, options: ToastOptions = {}): string {
  ensureContainer()

  const {
    duration = 3000,
    type = 'info',
  } = options

  const id = `toast-${Date.now()}-${Math.random()}`

  const toast: Toast = {
    id,
    message,
    type,
    duration,
  }

  toasts.push(toast)
  renderToasts()

  // Auto-remove after duration
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id)
    renderToasts()
  }, duration)

  return id
}

/**
 * Convenience function for success toasts
 */
export function showSuccessToast(message: string, duration?: number): string {
  return showToast(message, { type: 'success', duration })
}

/**
 * Convenience function for error toasts
 */
export function showErrorToast(message: string, duration?: number): string {
  return showToast(message, { type: 'error', duration })
}

/**
 * Convenience function for warning toasts
 */
export function showWarningToast(message: string, duration?: number): string {
  return showToast(message, { type: 'warning', duration })
}

/**
 * Removes a specific toast by ID
 */
export function removeToast(id: string) {
  toasts = toasts.filter(t => t.id !== id)
  renderToasts()
}

/**
 * Clears all toasts
 */
export function clearToasts() {
  toasts = []
  renderToasts()
}
