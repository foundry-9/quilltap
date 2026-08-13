/**
 * Message Navigation Utilities
 *
 * Handles navigation to specific messages in chat, including
 * scrolling and highlighting for memory provenance tracking.
 */

const SCROLL_TO_MESSAGE_KEY = 'scrollToMessageId'
const HIGHLIGHT_MESSAGE_KEY = 'highlightMessageId'

/**
 * Navigate to a specific message in a chat.
 * Stores the target message ID in sessionStorage for the chat page to pick up.
 *
 * @param chatId The chat ID to navigate to
 * @param messageId The message ID to scroll to and highlight
 */
export function navigateToMessage(chatId: string, messageId: string): void {
  // Store in sessionStorage for the chat page to pick up
  sessionStorage.setItem(SCROLL_TO_MESSAGE_KEY, messageId)
  sessionStorage.setItem(HIGHLIGHT_MESSAGE_KEY, messageId)

  // Navigate to chat. Full page load, not router.push: this is a plain module
  // with no router in scope, and the sessionStorage handoff above is read by
  // the chat page on mount — a client transition would change that timing
  // relative to the message DOM the scroll/highlight depends on.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/salon/${chatId}`
}

/**
 * Check for pending message navigation and return the message ID.
 * Clears the stored values after reading.
 *
 * @returns Object with scrollTo and highlight message IDs, or null if none
 */
export function getPendingMessageNavigation(): {
  scrollTo: string | null
  highlight: string | null
} {
  const scrollTo = sessionStorage.getItem(SCROLL_TO_MESSAGE_KEY)
  const highlight = sessionStorage.getItem(HIGHLIGHT_MESSAGE_KEY)

  // Clear after reading
  sessionStorage.removeItem(SCROLL_TO_MESSAGE_KEY)
  sessionStorage.removeItem(HIGHLIGHT_MESSAGE_KEY)

  return { scrollTo, highlight }
}

/**
 * Scroll to a specific message element and optionally highlight it.
 *
 * @param messageId The message ID to scroll to
 * @param options Options for scrolling behavior
 */
export function scrollToMessage(
  messageId: string,
  options: {
    behavior?: ScrollBehavior
    highlight?: boolean
    highlightDuration?: number
  } = {}
): boolean {
  const { behavior = 'smooth', highlight = true, highlightDuration = 3000 } = options

  // Find the message element by data attribute
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)

  if (!messageElement) {
    return false
  }

  // Scroll the element into view
  messageElement.scrollIntoView({ behavior, block: 'center' })

  // Add highlight effect if requested
  if (highlight) {
    messageElement.classList.add('qt-memory-source-highlight')

    // Remove highlight after duration
    setTimeout(() => {
      messageElement.classList.remove('qt-memory-source-highlight')
    }, highlightDuration)
  }

  return true
}
