'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { FloatingDialog } from '@/components/ui/FloatingDialog'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { formatDate } from '@/lib/format-time'

export interface ComposeMailParticipant {
  /** The workspace character id (used as from/to in the action). */
  id: string
  name: string
  controlledBy: 'llm' | 'user'
  avatarUrl?: string | null
}

interface ComposeMailDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  /** Active CHARACTER participants in this chat (character id + name + controlledBy + avatar). */
  participants: ComposeMailParticipant[]
  /** Refetch the chat after a letter is delivered (so Suparṇā's delivery shows). */
  onPosted: () => void
}

interface MailboxLetter {
  path: string
  from: string
  sentAt: string
}

/** A workspace character, as returned by `/api/v1/characters`. */
interface WorkspaceCharacter {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string | null
  controlledBy?: 'llm' | 'user'
}

/** Sentinel select value for the default "No quoted reply." option. */
const NO_REPLY = ''

/**
 * Compose Mail composer modal (The Post Office). Lets the operator post a letter
 * AS one of their player-characters (`controlledBy: 'user'`) to another character
 * in the scene, optionally quoting a letter from the sender's own mailbox. On
 * send it POSTs to the `send-mail` chat action, which delivers through the same
 * Post Office service the `send_mail` tool uses, then refetches the chat so
 * Suparṇā's delivery whisper is reflected.
 *
 * Near-clone of {@link InsertAnnouncementDialog}: a `FloatingDialog` with three
 * selects (From / To / In-reply-to) plus a `MarkdownLexicalEditor` body.
 *
 * From is restricted to player-characters the operator controls in THIS chat
 * (you can only sign as someone you're playing). To is the full workspace
 * character list (minus the From) — the backend `send_mail` allows any
 * character → any character, so a letter can be addressed to someone who isn't
 * in the scene.
 */
export default function ComposeMailDialog({
  isOpen,
  onClose,
  chatId,
  participants,
  onPosted,
}: ComposeMailDialogProps) {
  const queryClient = useQueryClient()

  // From = player-characters the operator controls in this chat.
  const senders = useMemo(
    () => participants.filter((p) => p.controlledBy === 'user'),
    [participants],
  )

  const [fromCharacterId, setFromCharacterId] = useState<string>(() => senders[0]?.id ?? '')
  const [toCharacterId, setToCharacterId] = useState<string>('')
  const [inReplyToPath, setInReplyToPath] = useState<string>(NO_REPLY)
  const [body, setBody] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // To = ANY character in the workspace (not just this chat's participants),
  // minus the chosen From. self-mail is allowed server-side but a confusing
  // default in the UI, so the From is excluded.
  const charactersQuery = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) =>
      apiFetch<{ characters: WorkspaceCharacter[] }>('/api/v1/characters', { signal }),
    enabled: isOpen,
  })
  const recipients = useMemo(() => {
    const all = charactersQuery.data?.characters ?? []
    return all
      .filter((c) => c.id !== fromCharacterId)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [charactersQuery.data, fromCharacterId])

  // The effective recipient is derived, not stored-and-synced: an explicit pick
  // wins while it's still a valid recipient, otherwise it falls back to the
  // first one. This defaults the dropdown once the list loads and silently
  // re-picks when the chosen From becomes the current recipient — without a
  // setState-in-effect.
  const effectiveToCharacterId = useMemo(() => {
    if (toCharacterId && recipients.some((r) => r.id === toCharacterId)) return toCharacterId
    return recipients[0]?.id ?? ''
  }, [toCharacterId, recipients])

  const hasSender = senders.length > 0
  const hasRecipient = recipients.length > 0
  const recipientsLoading = charactersQuery.isLoading

  // The From character's own mailbox — the "In reply to" options. Refetches
  // automatically whenever From changes (the query key carries the character id).
  const mailboxQuery = useQuery({
    queryKey: queryKeys.mailbox.byCharacter(chatId, fromCharacterId),
    queryFn: ({ signal }) =>
      apiFetch<{ letters: MailboxLetter[] }>(
        `/api/v1/chats/${chatId}?action=mailbox&characterId=${encodeURIComponent(fromCharacterId)}`,
        { signal },
      ),
    enabled: isOpen && Boolean(fromCharacterId),
  })
  const letters = mailboxQuery.data?.letters ?? []

  const sendMutation = useMutation({
    mutationFn: (vars: {
      fromCharacterId: string
      toCharacterId: string
      bodyMarkdown: string
      inReplyToPath: string | null
    }) =>
      apiFetch(`/api/v1/chats/${chatId}?action=send-mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      showSuccessToast('Suparṇā has the letter and is already aloft.')
      // The salon page refetches the chat via onPosted; invalidate the cached
      // chat detail too so any TanStack reader picks up the delivery.
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.detail(chatId) })
      onPosted()
      onClose()
    },
    onError: (err) => {
      const message = extractErrorMessage(err)
      setErrorMessage(message)
      showErrorToast(message)
    },
  })

  const isSending = sendMutation.isPending

  const handleFromChange = (id: string) => {
    setFromCharacterId(id)
    // A different sender means a different mailbox — drop any quoted reply.
    // (The To selection is re-validated by the effect above if it collides.)
    setInReplyToPath(NO_REPLY)
  }

  const canSend =
    !isSending
    && hasSender
    && hasRecipient
    && Boolean(fromCharacterId)
    && Boolean(effectiveToCharacterId)
    && body.trim().length > 0

  const handleSend = () => {
    if (!canSend) return
    setErrorMessage(null)
    sendMutation.mutate({
      fromCharacterId,
      toCharacterId: effectiveToCharacterId,
      bodyMarkdown: body.trim(),
      inReplyToPath: inReplyToPath === NO_REPLY ? null : inReplyToPath,
    })
  }

  const dialogClose = isSending ? () => {} : onClose

  return (
    <FloatingDialog
      isOpen={isOpen}
      onClose={dialogClose}
      title="Compose Mail"
      storageKey="quilltap:compose-mail-geometry"
      initialGeometry={{ width: 640, height: 600 }}
      minWidth={420}
      minHeight={460}
    >
      <div className="flex flex-col h-full">
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* From */}
          <div className="mb-4">
            <label htmlFor="mail-from" className="block text-sm qt-text-primary mb-2">
              Signed by
            </label>
            {!hasSender ? (
              <div className="qt-text-secondary text-sm">
                You aren&rsquo;t playing anyone in this scene, so there&rsquo;s no one to sign the letter.
              </div>
            ) : senders.length === 1 ? (
              <select
                id="mail-from"
                value={fromCharacterId}
                disabled
                className="qt-input w-full"
                aria-label="Signed by"
              >
                <option value={senders[0].id}>{senders[0].name}</option>
              </select>
            ) : (
              <select
                id="mail-from"
                value={fromCharacterId}
                onChange={(e) => handleFromChange(e.target.value)}
                className="qt-input w-full"
                disabled={isSending}
              >
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* To */}
          <div className="mb-4">
            <label htmlFor="mail-to" className="block text-sm qt-text-primary mb-2">
              Addressed to
            </label>
            {recipientsLoading ? (
              <div className="qt-text-secondary text-sm">Fetching the address book&hellip;</div>
            ) : !hasRecipient ? (
              <div className="qt-text-secondary text-sm">
                There&rsquo;s no one else to address a letter to.
              </div>
            ) : (
              <select
                id="mail-to"
                value={effectiveToCharacterId}
                onChange={(e) => setToCharacterId(e.target.value)}
                className="qt-input w-full"
                disabled={isSending}
              >
                {recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.title ? ` — ${r.title}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* In reply to */}
          <div className="mb-4">
            <label htmlFor="mail-reply" className="block text-sm qt-text-primary mb-2">
              In reply to
            </label>
            <select
              id="mail-reply"
              value={inReplyToPath}
              onChange={(e) => setInReplyToPath(e.target.value)}
              className="qt-input w-full"
              disabled={isSending || !hasSender || mailboxQuery.isLoading}
            >
              <option value={NO_REPLY}>No quoted reply.</option>
              {letters.map((l) => (
                <option key={l.path} value={l.path}>
                  From {l.from} · {formatDate(l.sentAt, { includeYear: false })}
                </option>
              ))}
            </select>
            {mailboxQuery.isLoading && (
              <div className="qt-text-xs mt-1">Rummaging through the postbox&hellip;</div>
            )}
          </div>

          {/* Letter body */}
          <div className="mb-2">
            <label className="block text-sm qt-text-primary mb-2">The letter</label>
            <MarkdownLexicalEditor
              value={body}
              onChange={setBody}
              disabled={isSending}
              namespace="ComposeMailDialog"
              ariaLabel="The body of your letter"
            />
          </div>

          {errorMessage && <ErrorAlert message={errorMessage} className="mt-2" />}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t qt-border-default px-4 py-3 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="qt-button qt-button-secondary"
            disabled={isSending}
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="qt-button qt-button-primary"
          >
            {isSending ? 'Posting…' : 'Send'}
          </button>
        </div>
      </div>
    </FloatingDialog>
  )
}

/** {@link apiErrorMessage} with this dialog's own fallback. */
function extractErrorMessage(err: unknown): string {
  return apiErrorMessage(err, 'The letter could not be posted.')
}
