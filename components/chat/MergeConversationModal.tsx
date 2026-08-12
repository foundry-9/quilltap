'use client'

/**
 * MergeConversationModal
 *
 * The Organize sidebar's "Merge In…" flow — the inverse of "Continue
 * Elsewhere." Two steps:
 *
 *   1. Pick a recent conversation (its company + latest-message time shown).
 *   2. Choose each incoming character's starting outfit (reusing the same
 *      OutfitSelector the new-chat/continuation flows use, defaulting to "Same
 *      as last conversation"), then merge.
 *
 * Characters already present in the current chat are excluded — the same
 * filter the server re-applies authoritatively. On confirm it POSTs
 * `?action=merge-conversation` to the *current* chat; the server adds the
 * newcomers, applies their outfits, posts a Host recap here and a back-link in
 * the source chat.
 */

import { useMemo, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { formatRelativeDate } from '@/lib/format-time'
import { Icon } from '@/components/ui/icon'
import { OutfitSelector } from '@/components/wardrobe'
import type { OutfitSelection, PreviousOutfitSummary } from '@/components/wardrobe'

interface MergeChatParticipant {
  id: string
  type: 'CHARACTER'
  status: string
  removedAt?: string | null
  character: { id: string; name: string } | null
}

interface MergeChatRow {
  id: string
  title: string
  updatedAt: string
  lastMessageAt: string | null
  participants: MergeChatParticipant[]
  chatType?: 'salon' | 'help' | 'autonomous' | 'brahma'
}

interface OutfitSummaryResponse {
  summary: PreviousOutfitSummary
}

interface MergeConversationModalProps {
  isOpen: boolean
  onClose: () => void
  /** The chat being merged INTO (the current conversation). */
  targetChatId: string
  /** Character IDs already present in the current chat (any status). */
  existingCharacterIds: string[]
  /** Refresh the current chat after a successful merge. */
  onMerged: () => void | Promise<void>
}

function presentCharacters(chat: MergeChatRow): { id: string; name: string }[] {
  const seen = new Set<string>()
  const out: { id: string; name: string }[] = []
  for (const p of chat.participants) {
    if (p.type !== 'CHARACTER' || !p.character) continue
    if (p.status === 'removed') continue
    if (seen.has(p.character.id)) continue
    seen.add(p.character.id)
    out.push({ id: p.character.id, name: p.character.name })
  }
  return out
}

export function MergeConversationModal({
  isOpen,
  onClose,
  targetChatId,
  existingCharacterIds,
  onMerged,
}: MergeConversationModalProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'pick' | 'configure'>('pick')
  const [selectedSource, setSelectedSource] = useState<MergeChatRow | null>(null)
  const [outfitSelections, setOutfitSelections] = useState<OutfitSelection[]>([])
  // Which incoming characters the operator wants to bring across. Seeded to all
  // eligible when a source is picked; toggled per-character in the confirm step.
  const [includedCharacterIds, setIncludedCharacterIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [isMerging, setIsMerging] = useState(false)

  // The parent mounts this component only while open (see SalonView), so state
  // initializes fresh on each open — no reset effect needed.

  const { data: chatsData, isLoading: chatsLoading } = useQuery({
    queryKey: queryKeys.chats.list({ includeAutonomous: false }),
    queryFn: ({ signal }) => apiFetch<{ chats: MergeChatRow[] }>('/api/v1/chats', { signal }),
    enabled: isOpen,
  })

  const { data: outfitData, isLoading: outfitLoading } = useQuery({
    queryKey: [...queryKeys.chats.detail(selectedSource?.id ?? 'none'), 'outfit-summary'],
    queryFn: ({ signal }) =>
      apiFetch<OutfitSummaryResponse>(
        `/api/v1/chats/${selectedSource!.id}?action=outfit-summary`,
        { signal },
      ),
    enabled: isOpen && step === 'configure' && !!selectedSource,
  })

  // Recent conversations the operator can merge in: not this chat, not an
  // autonomous room, and (already) sorted newest-first by the list endpoint.
  const candidateChats = useMemo(() => {
    const rows = chatsData?.chats ?? []
    const filtered = rows.filter(
      (c) => c.id !== targetChatId && c.chatType !== 'autonomous',
    )
    if (!search.trim()) return filtered
    const needle = search.trim().toLowerCase()
    return filtered.filter((c) => {
      if (c.title.toLowerCase().includes(needle)) return true
      return presentCharacters(c).some((ch) => ch.name.toLowerCase().includes(needle))
    })
  }, [chatsData, targetChatId, search])

  // Incoming characters = source's present characters not already in this chat.
  const incomingCharacters = useMemo(() => {
    if (!selectedSource) return []
    const here = new Set(existingCharacterIds)
    return presentCharacters(selectedSource).filter((c) => !here.has(c.id))
  }, [selectedSource, existingCharacterIds])

  // The subset the operator has chosen to actually bring across (the gate).
  const mergeCharacters = useMemo(
    () => incomingCharacters.filter((c) => includedCharacterIds.has(c.id)),
    [incomingCharacters, includedCharacterIds],
  )

  const handleClose = useCallback(() => {
    if (isMerging) return
    onClose()
  }, [isMerging, onClose])

  const handlePick = useCallback(
    (chat: MergeChatRow) => {
      const here = new Set(existingCharacterIds)
      const eligible = presentCharacters(chat).filter((c) => !here.has(c.id))
      setSelectedSource(chat)
      setOutfitSelections([])
      // Default to bringing everyone eligible; the operator unchecks to exclude.
      setIncludedCharacterIds(new Set(eligible.map((c) => c.id)))
      setStep('configure')
    },
    [existingCharacterIds],
  )

  const toggleIncluded = useCallback((characterId: string) => {
    setIncludedCharacterIds((prev) => {
      const next = new Set(prev)
      if (next.has(characterId)) next.delete(characterId)
      else next.add(characterId)
      return next
    })
  }, [])

  const handleMerge = useCallback(async () => {
    if (!selectedSource || mergeCharacters.length === 0) return
    const includedIds = new Set(mergeCharacters.map((c) => c.id))
    setIsMerging(true)
    try {
      const res = await fetch(`/api/v1/chats/${targetChatId}?action=merge-conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChatId: selectedSource.id,
          characterIds: mergeCharacters.map((c) => c.id),
          // Only send outfit choices for characters actually coming across.
          outfitSelections: outfitSelections.filter((s) => includedIds.has(s.characterId)),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to merge conversation')
      }
      const data = await res.json().catch(() => ({}))
      const count = data?.merge?.mergedCharacterIds?.length ?? mergeCharacters.length
      showSuccessToast(
        count === 1
          ? `Merged 1 character from “${selectedSource.title}”`
          : `Merged ${count} characters from “${selectedSource.title}”`,
      )
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all })
      await onMerged()
      onClose()
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to merge conversation')
    } finally {
      setIsMerging(false)
    }
  }, [selectedSource, mergeCharacters, targetChatId, outfitSelections, queryClient, onMerged, onClose])

  if (!isOpen) return null

  return (
    <div
      className="qt-dialog-overlay p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div className="qt-dialog max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="qt-dialog-header flex items-center justify-between">
          <h2 className="qt-dialog-title">
            {step === 'pick' ? 'Merge a Conversation In' : `Merge “${selectedSource?.title ?? ''}”`}
          </h2>
          <button onClick={handleClose} className="qt-button qt-button-ghost p-2" disabled={isMerging}>
            <Icon name="close" className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="qt-dialog-body flex-1 overflow-y-auto">
          {step === 'pick' ? (
            <div className="space-y-3">
              <p className="text-sm qt-text-secondary">
                Choose a conversation to fold into this one. Its characters and a recap of where
                it left off will be brought in at the latest point here.
              </p>

              <input
                type="text"
                placeholder="Search conversations…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="qt-input"
              />

              {chatsLoading ? (
                <div className="py-12 text-center qt-text-secondary">Gathering conversations…</div>
              ) : candidateChats.length === 0 ? (
                <div className="py-12 text-center qt-text-secondary">
                  {search ? 'No matching conversations.' : 'No other conversations to merge in.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {candidateChats.map((chat) => {
                    const company = presentCharacters(chat)
                    const when = chat.lastMessageAt ?? chat.updatedAt
                    return (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => handlePick(chat)}
                        className="w-full rounded-lg border qt-border-default p-3 text-left transition hover:qt-border-primary/50 hover:qt-bg-muted/50"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-semibold qt-text-primary truncate">
                            {chat.title || 'Untitled conversation'}
                          </span>
                          <span className="text-xs qt-text-secondary shrink-0">
                            {formatRelativeDate(when)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs qt-text-secondary truncate">
                          {company.length > 0
                            ? company.map((c) => c.name).join(', ')
                            : 'No characters'}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {incomingCharacters.length === 0 ? (
                <div className="py-8 text-center qt-text-secondary">
                  Everyone from that conversation is already here — nothing to merge.
                </div>
              ) : (
                <>
                  <p className="text-sm qt-text-secondary">
                    Choose who joins this conversation as LLM-driven participants. A recap
                    of “{selectedSource?.title}” will be added at the latest point.
                  </p>

                  {/* Who joins? — the gate. Default all in; uncheck to exclude. */}
                  <div>
                    <label className="mb-2 block text-sm qt-text-primary">Who joins</label>
                    <div className="space-y-1.5">
                      {incomingCharacters.map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition cursor-pointer hover:qt-bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={includedCharacterIds.has(c.id)}
                            onChange={() => toggleIncluded(c.id)}
                            disabled={isMerging}
                            className="accent-[var(--primary)]"
                          />
                          <span className="qt-text-primary">{c.name}</span>
                        </label>
                      ))}
                    </div>
                    {mergeCharacters.length === 0 && (
                      <p className="mt-2 text-xs qt-text-warning italic">
                        Select at least one character to merge in.
                      </p>
                    )}
                  </div>

                  {mergeCharacters.length > 0 &&
                    (outfitLoading ? (
                      <div className="py-4 text-center qt-text-secondary">Reading their wardrobes…</div>
                    ) : (
                      <OutfitSelector
                        characters={mergeCharacters.map((c) => ({ id: c.id, name: c.name }))}
                        onSelectionsChange={setOutfitSelections}
                        disabled={isMerging}
                        sourceChatId={selectedSource?.id ?? null}
                        previousOutfitSummary={outfitData?.summary ?? null}
                        chatId={targetChatId}
                      />
                    ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="qt-dialog-footer flex items-center justify-between">
          {step === 'configure' ? (
            <button
              type="button"
              onClick={() => setStep('pick')}
              className="qt-button qt-button-ghost"
              disabled={isMerging}
            >
              ← Back
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleClose} className="qt-button qt-button-ghost" disabled={isMerging}>
              Cancel
            </button>
            {step === 'configure' && (
              <button
                type="button"
                onClick={handleMerge}
                className="qt-button qt-button-primary"
                disabled={isMerging || mergeCharacters.length === 0}
              >
                {isMerging
                  ? 'Merging…'
                  : mergeCharacters.length > 1
                    ? `Merge In (${mergeCharacters.length})`
                    : 'Merge In'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
