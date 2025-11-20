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
  let rootCallCount: number

  beforeEach(() => {
    rootCallCount = 0
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
    ;(createRoot as jest.Mock).mockImplementation(() => {
      rootCallCount++
      return mockRoot
    })

    // Clear any previous containers
    document.body.innerHTML = ''

    // Clear mocks
    mockAlertDialog.mockClear()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  // Helper function to extract buttons from dialog render call
  const getButtons = (): any[] => {
    const calls = (mockRoot.render as jest.Mock).mock.calls
    // Find the dialog render call (second call, first is overlay)
    if (calls.length >= 2) {
      const dialogCall = calls[1]
      if (dialogCall && dialogCall[0] && dialogCall[0].props && dialogCall[0].props.children) {
        // Extract button elements from the rendered content
        return dialogCall[0].props.children.slice(-1)[0]?.props?.children || []
      }
    }
    return []
  }

  describe('showAlert', () => {
    it('should create containers and append them to document body', () => {
      showAlert('Test message')

      // Now we create 2 containers (overlay + dialog)
      expect(document.body.children.length).toBe(2)
      expect(document.body.children[0]).toBeInstanceOf(HTMLDivElement)
      expect(document.body.children[1]).toBeInstanceOf(HTMLDivElement)
    })

    it('should create roots and render overlay and dialog', () => {
      const message = 'Test alert message'
      showAlert(message)

      // Now we create 2 roots (overlay + dialog)
      expect(createRoot).toHaveBeenCalledTimes(2)
      expect(mockRoot.render).toHaveBeenCalledTimes(2)
    })

    it('should create and append two containers', () => {
      showAlert('Test message')

      // Verify structure
      expect(document.body.children.length).toBe(2)
      expect((document.body.children[0] as HTMLElement).getAttribute('role')).toBe('alert-dialog-overlay')
      expect((document.body.children[1] as HTMLElement).getAttribute('role')).toBe('alert-dialog-content')
    })

    it('should handle empty messages', () => {
      showAlert('')

      expect(mockRoot.render).toHaveBeenCalledTimes(2)
      expect(document.body.children.length).toBe(2)
    })

    it('should handle long messages', () => {
      const longMessage = 'A'.repeat(1000)
      showAlert(longMessage)

      expect(mockRoot.render).toHaveBeenCalledTimes(2)
      expect(document.body.children.length).toBe(2)
    })

    it('should handle special characters in messages', () => {
      const specialMessage = '<script>alert("xss")</script>\n\t"quotes"'
      showAlert(specialMessage)

      expect(mockRoot.render).toHaveBeenCalledTimes(2)
      expect(document.body.children.length).toBe(2)
    })
  })
})
