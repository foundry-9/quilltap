'use client'

/**
 * FileDeleteConfirmation Component
 *
 * Modal dialog for confirming file deletion when the file has associations
 * with characters or messages. Displays a clear warning with details about
 * what will be affected by the deletion.
 */

import { BaseModal } from '@/components/ui/BaseModal'

interface FileAssociation {
  characters: { id: string; name: string; usage: string }[]
  messages: { chatId: string; chatName: string; messageId: string }[]
}

interface FileDeleteConfirmationProps {
  isOpen: boolean
  filename: string
  associations: FileAssociation
  onConfirm: () => void
  onCancel: () => void
  isDeleting: boolean
}

export default function FileDeleteConfirmation({
  isOpen,
  filename,
  associations,
  onConfirm,
  onCancel,
  isDeleting,
}: Readonly<FileDeleteConfirmationProps>) {
  const hasCharacters = associations.characters.length > 0
  const hasMessages = associations.messages.length > 0

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        onClick={onCancel}
        disabled={isDeleting}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={isDeleting}
        className="qt-button bg-destructive qt-text-on-destructive hover:qt-bg-destructive/90 disabled:opacity-50"
      >
        {isDeleting ? 'Deleting...' : 'Delete Anyway'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onCancel}
      title="This file is in use"
      footer={footer}
      closeOnClickOutside={!isDeleting}
      closeOnEscape={!isDeleting}
    >
      <div className="space-y-4">
        <p className="text-base font-semibold">
          &quot;{filename}&quot; is associated with characters and messages
        </p>

        {/* Characters section */}
        {hasCharacters && (
          <div>
            <p className="qt-text-small font-medium mb-2">Used by characters:</p>
            <ul className="space-y-1 ml-4">
              {associations.characters.map((char) => (
                <li key={char.id} className="qt-text-small">
                  <span className="font-medium">{char.name}</span>
                  {char.usage && <span className="qt-text-secondary"> — {char.usage}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Messages section */}
        {hasMessages && (
          <div>
            <p className="qt-text-small font-medium mb-2">Attached to messages in:</p>
            <ul className="space-y-1 ml-4">
              {associations.messages.map((msg) => (
                <li key={`${msg.chatId}-${msg.messageId}`} className="qt-text-small">
                  {msg.chatName}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Explanation text */}
        <p className="qt-text-small qt-text-secondary pt-2">
          Deleting will remove these associations. Messages will show a note indicating the
          attachment was deleted.
        </p>
      </div>
    </BaseModal>
  )
}
