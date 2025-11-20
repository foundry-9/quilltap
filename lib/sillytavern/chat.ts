/**
 * SillyTavern Chat Import/Export
 */

export interface STMessage {
  name: string
  is_user: boolean
  is_name: boolean
  send_date: number | string
  mes: string
  swipes?: string[]
  swipe_id?: number
  swipe_info?: Array<{
    send_date: number | string
    gen_started: number
    gen_finished: number
    extra?: Record<string, any>
  }>
  extra?: Record<string, any>
}

export interface STChat {
  messages: STMessage[]
  chat_metadata?: {
    note_prompt?: string
    note_interval?: number
    note_depth?: number
    note_position?: number
    [key: string]: any
  }
  character_name?: string
  user_name?: string
  create_date?: number
}

/**
 * Helper function to parse send_date which can be either a timestamp or a string
 */
function parseSendDate(sendDate: number | string): Date {
  if (typeof sendDate === 'number') {
    return new Date(sendDate)
  }

  // Try parsing the string date with multiple formats
  let parsed = new Date(sendDate)

  // If standard parsing failed, try other formats
  if (Number.isNaN(parsed.getTime())) {
    // Try to parse format like "November 16, 2025 7:45am"
    // Replace ordinal indicators and normalize the string
    const normalized = sendDate
      .replace(/(\d+)(?:st|nd|rd|th)/, '$1')
      .replace(/(\d{1,2}):(\d{2})(am|pm)/i, (match, hours, mins, ampm) => {
        let h = Number.parseInt(hours)
        if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12
        if (ampm.toLowerCase() === 'am' && h === 12) h = 0
        return `${h.toString().padStart(2, '0')}:${mins}`
      })

    parsed = new Date(normalized)
  }

  // If still invalid, return current date as fallback
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

/**
 * Import SillyTavern chat to internal format
 */
export function importSTChat(
  stChat: STChat,
  characterId: string,
  userId: string
) {
  // If there are swipes, we need to create additional message records
  const allMessages: any[] = []

  stChat.messages.forEach((msg, index) => {
    const baseMessage = {
      role: msg.is_user ? 'USER' : 'ASSISTANT',
      swipeGroupId: msg.swipes && msg.swipes.length > 1 ? `swipe-${index}` : null,
      createdAt: parseSendDate(msg.send_date),
      rawResponse: msg.extra || null,
    }

    if (msg.swipes && msg.swipes.length > 1) {
      // Create a message for each swipe
      msg.swipes.forEach((swipe, swipeIdx) => {
        allMessages.push({
          ...baseMessage,
          content: swipe,
          swipeIndex: swipeIdx,
        })
      })
    } else {
      // Single message
      allMessages.push({
        ...baseMessage,
        content: msg.mes,
        swipeIndex: 0,
      })
    }
  })

  return {
    messages: allMessages,
    metadata: stChat.chat_metadata,
  }
}

/**
 * Export internal chat to SillyTavern format
 */
export function exportSTChat(
  chat: any,
  messages: any[],
  characterName: string,
  userName: string = 'User'
): STChat {
  // Group messages by swipeGroupId
  const messageGroups = new Map<string, any[]>()
  const nonSwipeMessages: any[] = []

  messages
    .filter((m) => m.role !== 'SYSTEM')
    .forEach((msg) => {
      if (msg.swipeGroupId) {
        if (!messageGroups.has(msg.swipeGroupId)) {
          messageGroups.set(msg.swipeGroupId, [])
        }
        messageGroups.get(msg.swipeGroupId)!.push(msg)
      } else {
        nonSwipeMessages.push(msg)
      }
    })

  // Convert to ST format
  const stMessages: STMessage[] = []

  // Process non-swipe messages and swipe groups in order
  let currentMessageIndex = 0

  messages
    .filter((m) => m.role !== 'SYSTEM')
    .forEach((msg) => {
      // Skip if this message is part of a swipe group we already processed
      if (msg.swipeGroupId) {
        const groupMessages = messageGroups.get(msg.swipeGroupId)!
        // Only process if this is the first message in the group we encounter
        if (groupMessages[0].id === msg.id) {
          // Sort by swipeIndex
          groupMessages.sort((a, b) => a.swipeIndex - b.swipeIndex)

          const swipes = groupMessages.map((m) => m.content)
          const currentSwipeIndex = groupMessages.findIndex(
            (m) => m.swipeIndex === msg.swipeIndex
          )

          stMessages.push({
            name: msg.role === 'USER' ? userName : characterName,
            is_user: msg.role === 'USER',
            is_name: true,
            send_date: msg.createdAt.getTime(),
            mes: groupMessages[currentSwipeIndex >= 0 ? currentSwipeIndex : 0]
              .content,
            swipes,
            swipe_id: currentSwipeIndex >= 0 ? currentSwipeIndex : 0,
            extra: msg.rawResponse || undefined,
          })
        }
      } else {
        // Regular message without swipes
        stMessages.push({
          name: msg.role === 'USER' ? userName : characterName,
          is_user: msg.role === 'USER',
          is_name: true,
          send_date: msg.createdAt.getTime(),
          mes: msg.content,
          extra: msg.rawResponse || undefined,
        })
      }
    })

  return {
    messages: stMessages,
    chat_metadata: chat.sillyTavernMetadata || {},
    character_name: characterName,
    user_name: userName,
    create_date: chat.createdAt.getTime(),
  }
}
