/**
 * Format a timestamp as a human-readable string.
 * For messages from today, shows "X hours ago" or "X minutes ago"
 * For older messages, shows the date
 */
export function formatMessageTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()

  // Get the start of today
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  // Check if message is from today
  if (messageDate.getTime() === today.getTime()) {
    const diffMs = now.getTime() - date.getTime()
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

    if (diffMinutes < 1) {
      return 'just now'
    }
    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`
    }
  }

  // For older messages, show date
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}
