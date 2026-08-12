'use client'

import { useCallback, useState } from 'react'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { Message, MemoryCascadeAction, ChatSettings } from '../types'
import type { ComposerEditorHandle } from '@/components/chat/lexical/types'

/** Info returned when delete requires memory cascade confirmation */
export interface MemoryCascadeConfirmation {
  messageId: string
  memoryCount: number
  isSwipeGroup: boolean
}

export function useMessageActions(
  messages: Message[],
  setMessages: (value: Message[] | ((prev: Message[]) => Message[])) => void,
  setEditingMessageId: (id: string | null) => void,
  setEditContent: (content: string) => void,
  setViewSourceMessageIds: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void,
  editingMessageId: string | null,
  editContent: string,
  viewSourceMessageIds: Set<string>,
  setInput: (value: string) => void,
  setAttachedFiles: (value: any[] | ((prev: any[]) => any[])) => void,
  inputRef: React.RefObject<ComposerEditorHandle | null>,
  messagesEndRef: React.RefObject<HTMLDivElement>,
  chatSettings?: ChatSettings | null,
) {
  // State for memory cascade dialog
  const [memoryCascadeConfirmation, setMemoryCascadeConfirmation] = useState<MemoryCascadeConfirmation | null>(null)
  const startEdit = (message: Message) => {
    setEditingMessageId(message.id)
    setEditContent(message.content)
  }

  const cancelEdit = () => {
    setEditingMessageId(null)
    setEditContent('')
  }

  const saveEdit = async (messageId: string) => {
    try {
      const res = await fetch(`/api/v1/messages/${messageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      })

      if (!res.ok) throw new Error('Failed to update message')

      const updated = await res.json()
      // The endpoint returns { message: <event> }; fall back to what we sent.
      const newContent: string = updated?.message?.content ?? editContent
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: newContent } : m))
      setEditingMessageId(null)
      setEditContent('')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update message')
    }
  }

  /**
   * Complete the message deletion with a specific memory action
   */
  const completeDeleteWithMemoryAction = async (
    messageId: string,
    memoryAction: MemoryCascadeAction
  ) => {
    // Find the index of the message being deleted to determine scroll target
    const messageIndex = messages.findIndex(m => m.id === messageId)
    const nextMessage = messageIndex >= 0 && messageIndex < messages.length - 1
      ? messages[messageIndex + 1]
      : null

    try {
      const res = await fetch(
        `/api/v1/messages/${messageId}?memoryAction=${memoryAction}&skipConfirmation=true`,
        { method: 'DELETE' }
      )

      if (!res.ok) throw new Error('Failed to delete message')

      const result = await res.json()

      // Remove message from display (handle swipe groups too)
      const messageToDelete = messages.find(m => m.id === messageId)
      if (messageToDelete?.swipeGroupId) {
        setMessages(messages.filter(m => m.swipeGroupId !== messageToDelete.swipeGroupId))
      } else {
        setMessages(messages.filter(m => m.id !== messageId))
      }

      // Show success message if memories were deleted
      if (result.memoriesDeleted > 0) {
        showSuccessToast(`Deleted message and ${result.memoriesDeleted} ${result.memoriesDeleted === 1 ? 'memory' : 'memories'}`)
      }

      // Scroll to next message or bottom after deletion
      setTimeout(() => {
        if (nextMessage) {
          const nextMessageElement = document.getElementById(`message-${nextMessage.id}`)
          if (nextMessageElement) {
            nextMessageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        } else {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
      }, 100)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete message')
    }
  }

  /**
   * Handle memory cascade confirmation dialog result
   */
  const handleMemoryCascadeConfirm = async (
    action: MemoryCascadeAction,
    rememberChoice: boolean
  ) => {
    if (!memoryCascadeConfirmation) return

    // If user wants to remember, update settings
    if (rememberChoice) {
      try {
        await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            memoryCascadePreferences: {
              onMessageDelete: action,
              onSwipeRegenerate: chatSettings?.memoryCascadePreferences?.onSwipeRegenerate || 'DELETE_MEMORIES',
            },
          }),
        })
      } catch {
        // Don't fail if settings update fails
      }
    }

    // Complete the deletion with the chosen action
    await completeDeleteWithMemoryAction(memoryCascadeConfirmation.messageId, action)

    // Close the dialog
    setMemoryCascadeConfirmation(null)
  }

  /**
   * Cancel the memory cascade dialog
   */
  const cancelMemoryCascadeConfirmation = () => {
    setMemoryCascadeConfirmation(null)
  }

  const deleteMessage = async (messageId: string) => {
    // First confirm they want to delete
    if (!(await showConfirmation('Are you sure you want to delete this message?'))) return

    // Get the user's default cascade preference
    const defaultAction = chatSettings?.memoryCascadePreferences?.onMessageDelete || 'ASK_EVERY_TIME'

    // Find the index of the message being deleted to determine scroll target
    const messageIndex = messages.findIndex(m => m.id === messageId)
    const nextMessage = messageIndex >= 0 && messageIndex < messages.length - 1
      ? messages[messageIndex + 1]
      : null

    try {
      // If user has a saved preference (not ASK_EVERY_TIME), use it directly
      if (defaultAction !== 'ASK_EVERY_TIME') {
        await completeDeleteWithMemoryAction(messageId, defaultAction)
        return
      }

      // Otherwise, check if there are memories first
      const res = await fetch(`/api/v1/messages/${messageId}`, {
        method: 'DELETE',
      })

      const result = await res.json()

      // If confirmation is required (memories exist), show the dialog
      if (result.requiresConfirmation) {
        setMemoryCascadeConfirmation({
          messageId,
          memoryCount: result.memoryCount,
          isSwipeGroup: result.isSwipeGroup,
        })
        return
      }

      // No memories - just delete
      if (!res.ok) throw new Error('Failed to delete message')

      // Remove message from display
      const messageToDelete = messages.find(m => m.id === messageId)
      if (messageToDelete?.swipeGroupId) {
        setMessages(messages.filter(m => m.swipeGroupId !== messageToDelete.swipeGroupId))
      } else {
        setMessages(messages.filter(m => m.id !== messageId))
      }

      // Scroll to next message or bottom after deletion
      setTimeout(() => {
        if (nextMessage) {
          const nextMessageElement = document.getElementById(`message-${nextMessage.id}`)
          if (nextMessageElement) {
            nextMessageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        } else {
          // No next message, scroll to bottom
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
      }, 100)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete message')
    }
  }

  // Check if a user message can be resent. Resolves the message by id (not by
  // a positional index), since the rendered list is whisper-filtered and has
  // tool rows folded into assistant bubbles, so render indices diverge from
  // this full `messages` array.
  const canResendMessage = (messageId: string): boolean => {
    const messageIndex = messages.findIndex(m => m.id === messageId)
    const message = messages[messageIndex]
    if (!message || message.role !== 'USER') return false

    const messagesAfter = messages.slice(messageIndex + 1)
    if (messagesAfter.length === 0) return true

    for (const msg of messagesAfter) {
      if (msg.role === 'TOOL') continue
      if (msg.role === 'ASSISTANT' && msg.content && msg.content.trim().length > 0) {
        return false
      }
      if (msg.role === 'USER') {
        return false
      }
    }

    return true
  }

  // Strip [Attached: ...] from message content for display
  const getDisplayContent = (content: string) => {
    return content.replace(/\n?\[Attached: [^\]]+\]$/, '').trim()
  }

  // Resend a user message: delete blank responses after it, delete the message, then resend
  const resendMessage = async (message: Message) => {
    // Extract the original content (strip [Attached: ...] suffix)
    const originalContent = getDisplayContent(message.content)
    const originalAttachments = message.attachments || []

    // Find the index of this message
    const messageIndex = messages.findIndex(m => m.id === message.id)
    if (messageIndex === -1) return

    // Delete blank assistant messages after this one (from the server)
    const messagesAfter = messages.slice(messageIndex + 1)
    for (const msg of messagesAfter) {
      if (msg.role === 'ASSISTANT' && (!msg.content || msg.content.trim().length === 0)) {
        try {
          await fetch(`/api/v1/messages/${msg.id}`, { method: 'DELETE' })
        } catch {
          // Ignore errors deleting blank messages
        }
      }
    }

    // Delete the original user message from server
    try {
      const deleteRes = await fetch(`/api/v1/messages/${message.id}`, { method: 'DELETE' })
      if (!deleteRes.ok) {
        throw new Error('Failed to delete original message')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to resend message')
      return
    }

    // Remove the message and any blank messages after it from the UI
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === message.id)
      if (idx === -1) return prev
      return prev.slice(0, idx)
    })

    // Set up the input and attachments for resending
    setInput(originalContent)

    if (originalAttachments.length > 0) {
      setAttachedFiles(originalAttachments.map(a => ({
        id: a.id,
        filename: a.filename,
        filepath: a.filepath,
        mimeType: a.mimeType,
        size: 0,
        url: a.filepath.startsWith('/') ? a.filepath : `/${a.filepath}`,
      })))
    }

    // Focus the input
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
      }
    }, 100)

    showSuccessToast('Message restored to input. Press Enter to resend.')
  }

  const generateSwipe = async (messageId: string, fetchChat: () => Promise<void>) => {
    try {
      const res = await fetch(`/api/v1/messages/${messageId}?action=swipe`, {
        method: 'POST',
      })

      if (!res.ok) throw new Error('Failed to generate alternative response')

      await res.json()
      await fetchChat()
      notifyQueueChange()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to generate alternative response')
    }
  }

  const switchSwipe = (
    groupId: string,
    direction: 'prev' | 'next',
    swipeStates: Record<string, { current: number; total: number; messages: Message[] }>,
    setSwipeStates: (value: any) => void,
  ) => {
    const state = swipeStates[groupId]
    if (!state) return

    const newIndex = direction === 'next'
      ? Math.min(state.current + 1, state.total - 1)
      : Math.max(state.current - 1, 0)

    if (newIndex === state.current) return

    const newMessage = state.messages[newIndex]
    setMessages(messages.map(m =>
      m.swipeGroupId === groupId ? newMessage : m
    ))
    setSwipeStates({
      ...swipeStates,
      [groupId]: { ...state, current: newIndex }
    })
  }

  const copyMessageContent = (content: string) => {
    navigator.clipboard.writeText(content)
    showSuccessToast('Message copied to clipboard!')
  }

  const toggleSourceView = (messageId: string) => {
    setViewSourceMessageIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(messageId)) {
        newSet.delete(messageId)
      } else {
        newSet.add(messageId)
      }
      return newSet
    })
  }

  return {
    startEdit,
    cancelEdit,
    saveEdit,
    deleteMessage,
    canResendMessage,
    resendMessage,
    generateSwipe,
    switchSwipe,
    copyMessageContent,
    toggleSourceView,
    getDisplayContent,
    // Memory cascade dialog state and handlers
    memoryCascadeConfirmation,
    handleMemoryCascadeConfirm,
    cancelMemoryCascadeConfirmation,
  }
}
