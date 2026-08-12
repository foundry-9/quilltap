'use client'

import { useState, useCallback } from 'react'

interface WhisperDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Character name of the target */
  targetName: string
  /** Participant ID of the target */
  targetParticipantId: string
  /** Chat ID to send the whisper in */
  chatId: string
  /** The user-controlled participant the human is "Speaking As" (null = default) */
  speakingAsParticipantId?: string | null
  /** Callback when dialog is closed */
  onClose: () => void
  /** Callback when whisper is sent successfully */
  onSent: () => void
}

export function WhisperDialog({
  isOpen,
  targetName,
  targetParticipantId,
  chatId,
  speakingAsParticipantId,
  onClose,
  onSent,
}: WhisperDialogProps) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = useCallback(async () => {
    if (!message.trim() || sending) return

    setSending(true)
    try {
      const response = await fetch(`/api/v1/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: message.trim(),
          targetParticipantIds: [targetParticipantId],
          speakingAsParticipantId: speakingAsParticipantId ?? undefined,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to send whisper')
      }

      // Close dialog immediately so user isn't waiting
      setMessage('')
      onClose()

      // Consume the SSE stream so the server-side response completes,
      // then notify parent to refresh the chat and resume turn order
      const reader = response.body?.getReader()
      if (reader) {
        try {
          while (true) {
            const { done } = await reader.read()
            if (done) break
          }
        } catch {
          // Stream may be aborted, that's OK
        }
      }
      onSent()
    } catch (error) {
      console.error('Failed to send whisper:', error)
    } finally {
      setSending(false)
    }
  }, [message, sending, chatId, targetParticipantId, speakingAsParticipantId, onSent, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }, [handleSend, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 qt-bg-overlay-caption"
        onClick={onClose}
      />
      {/* Dialog */}
      <div className="qt-dialog relative z-10 w-full max-w-md mx-4">
        <div className="qt-dialog-header">
          <h3 className="qt-dialog-title">Whisper to {targetName}</h3>
        </div>
        <div className="qt-dialog-body">
          <p className="text-sm qt-text-muted mb-3">
            This message will only be visible to you and {targetName}.
          </p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Write a private message to ${targetName}...`}
            className="qt-input w-full min-h-[100px] resize-y"
            autoFocus
            disabled={sending}
          />
        </div>
        <div className="qt-dialog-footer">
          <button
            onClick={onClose}
            className="qt-button qt-button-secondary"
            disabled={sending}
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            className="qt-button qt-button-primary"
            disabled={!message.trim() || sending}
          >
            {sending ? 'Sending...' : 'Whisper'}
          </button>
        </div>
      </div>
    </div>
  )
}
