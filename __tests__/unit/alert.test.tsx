/**
 * Unit tests for alert dialog utility
 */

import { showAlert } from '@/lib/alert'
import { createRoot } from 'react-dom/client'

// Mock react-dom/client
jest.mock('react-dom/client', () => ({
  createRoot: jest.fn(),
}))

// Create a mock for AlertDialog that we can inspect
const mockAlertDialog = jest.fn()

// Mock the AlertDialog component
jest.mock('@/components/alert-dialog', () => ({
  AlertDialog: (props: any) => {
    mockAlertDialog(props)
    return null
  },
}))

describe('Alert Dialog Utility', () => {
  let mockRoot: any
  let mockContainer: HTMLElement

  beforeEach(() => {
    // Create mock root with immediate rendering
    mockRoot = {
      render: jest.fn((element) => {
        // Extract props from the React element and call the mock
        if (element && element.props) {
          mockAlertDialog(element.props)
        }
      }),
      unmount: jest.fn(),
    }

    // Mock createRoot to return our mock root
    ;(createRoot as jest.Mock).mockReturnValue(mockRoot)

    // Clear any previous containers
    document.body.innerHTML = ''

    // Clear mocks
    mockAlertDialog.mockClear()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  // Helper function to get onClose from the last render call
  const getOnClose = (): (() => void) | undefined => {
    if (mockAlertDialog.mock.calls.length > 0) {
      const lastCall = mockAlertDialog.mock.calls[mockAlertDialog.mock.calls.length - 1]
      return lastCall[0]?.onClose
    }
    return undefined
  }

  describe('showAlert', () => {
    it('should create a container and append it to document body', async () => {
      const alertPromise = showAlert('Test message')

      expect(document.body.children.length).toBe(1)
      expect(document.body.children[0]).toBeInstanceOf(HTMLDivElement)

      // Trigger close to resolve the promise
      const onClose = getOnClose()
      expect(onClose).toBeDefined()
      if (onClose) {
        onClose()
      }

      await alertPromise
    })

    it('should create a root and render AlertDialog', async () => {
      const message = 'Test alert message'
      const alertPromise = showAlert(message)

      expect(createRoot).toHaveBeenCalledTimes(1)
      expect(mockRoot.render).toHaveBeenCalledTimes(1)

      // Trigger close
      const onClose = getOnClose()
      if (onClose) {
        onClose()
      }

      await alertPromise
    })

    it('should return a promise that resolves when dialog is closed', async () => {
      const alertPromise = showAlert('Test message')

      // Promise should not be resolved yet
      let resolved = false
      alertPromise.then(() => {
        resolved = true
      })

      // Wait a tick
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(resolved).toBe(false)

      // Trigger close
      const onClose = getOnClose()
      if (onClose) {
        onClose()
      }

      // Now it should resolve
      await alertPromise
      expect(resolved).toBe(true)
    })

    it('should unmount root and remove container when closed', async () => {
      const alertPromise = showAlert('Test message')

      const containersBefore = document.body.children.length
      expect(containersBefore).toBe(1)

      // Trigger close
      const onClose = getOnClose()
      if (onClose) {
        onClose()
      }

      await alertPromise

      expect(mockRoot.unmount).toHaveBeenCalledTimes(1)
      expect(document.body.children.length).toBe(0)
    })

    it('should handle multiple alerts sequentially', async () => {
      // Show first alert
      const alert1 = showAlert('Message 1')
      expect(document.body.children.length).toBe(1)

      // Close first alert
      const onClose1 = getOnClose()
      if (onClose1) onClose1()
      await alert1

      expect(document.body.children.length).toBe(0)

      // Show second alert
      const alert2 = showAlert('Message 2')
      expect(document.body.children.length).toBe(1)

      // Close second alert
      const onClose2 = getOnClose()
      if (onClose2) onClose2()
      await alert2

      expect(document.body.children.length).toBe(0)
      expect(mockRoot.unmount).toHaveBeenCalledTimes(2)
    })

    it('should pass the correct message to AlertDialog', async () => {
      const message = 'Important alert message'
      const alertPromise = showAlert(message)

      // Check that render was called with an element
      expect(mockRoot.render).toHaveBeenCalled()
      expect(mockAlertDialog).toHaveBeenCalledWith(
        expect.objectContaining({ message })
      )

      // Trigger close
      const onClose = getOnClose()
      if (onClose) {
        onClose()
      }

      await alertPromise
    })

    it('should handle empty messages', async () => {
      const alertPromise = showAlert('')

      expect(mockRoot.render).toHaveBeenCalledTimes(1)

      // Trigger close
      const onClose = getOnClose()
      if (onClose) {
        onClose()
      }

      await alertPromise
      expect(mockRoot.unmount).toHaveBeenCalledTimes(1)
    })

    it('should handle long messages', async () => {
      const longMessage = 'A'.repeat(1000)
      const alertPromise = showAlert(longMessage)

      expect(mockRoot.render).toHaveBeenCalledTimes(1)

      // Trigger close
      const onClose = getOnClose()
      if (onClose) {
        onClose()
      }

      await alertPromise
      expect(mockRoot.unmount).toHaveBeenCalledTimes(1)
    })

    it('should handle special characters in messages', async () => {
      const specialMessage = '<script>alert("xss")</script>\n\t"quotes"'
      const alertPromise = showAlert(specialMessage)

      expect(mockRoot.render).toHaveBeenCalledTimes(1)

      // Trigger close
      const onClose = getOnClose()
      if (onClose) {
        onClose()
      }

      await alertPromise
    })
  })
})
