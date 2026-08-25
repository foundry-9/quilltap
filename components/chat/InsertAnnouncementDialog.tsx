'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { FloatingDialog } from '@/components/ui/FloatingDialog'
import { QuillAnimation } from '@/components/chat/QuillAnimation'

type StaffId =
  | 'lantern'
  | 'aurora'
  | 'librarian'
  | 'concierge'
  | 'prospero'
  | 'host'
  | 'commonplaceBook'
  | 'ariel'
  | 'suparna'
  | 'pascal'

const STAFF_OPTIONS: { id: StaffId; label: string }[] = [
  { id: 'host', label: 'The Host' },
  { id: 'librarian', label: 'The Librarian' },
  { id: 'lantern', label: 'The Lantern' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'concierge', label: 'The Concierge' },
  { id: 'prospero', label: 'Prospero' },
  { id: 'commonplaceBook', label: 'The Commonplace Book' },
  { id: 'ariel', label: 'Ariel' },
  { id: 'suparna', label: 'Suparṇā' },
  { id: 'pascal', label: 'Pascal the Croupier' },
]

interface CharacterSystemPromptInfo {
  id: string
  name: string
  isDefault: boolean
}

interface CharacterCard {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string | null
  controlledBy?: 'llm' | 'user'
  defaultConnectionProfileId?: string | null
  defaultSystemPromptId?: string | null
  systemPrompts?: CharacterSystemPromptInfo[]
}

interface ProfileCard {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
}

/** A current participant of the chat, offered as a whisper target. */
interface AudienceCandidate {
  /** CHAT PARTICIPANT id — this is what gets persisted as a whisper target. */
  participantId: string
  name: string
  controlledBy: 'llm' | 'user'
  avatarUrl?: string | null
  status?: 'active' | 'silent' | 'absent' | 'removed'
}

interface InsertAnnouncementDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  /** Character IDs already present in the chat (filtered out of the off-scene picker). */
  participantCharacterIds: string[]
  /** Current participants, offered as optional whisper targets. */
  audienceCandidates?: AudienceCandidate[]
  onPosted?: () => void
}

type Mode = 'staff' | 'character' | 'custom'
type Stage = 'compose' | 'generating' | 'review'

const AS_IS = 'as-is'

export default function InsertAnnouncementDialog({
  isOpen,
  onClose,
  chatId,
  participantCharacterIds,
  audienceCandidates = [],
  onPosted,
}: InsertAnnouncementDialogProps) {
  const [mode, setMode] = useState<Mode>('staff')
  const [staffId, setStaffId] = useState<StaffId>('host')
  const [characterId, setCharacterId] = useState<string>('')
  const [customName, setCustomName] = useState('')
  const [content, setContent] = useState('')
  const [characters, setCharacters] = useState<CharacterCard[]>([])
  const [charsLoading, setCharsLoading] = useState(false)
  const [charSearch, setCharSearch] = useState('')
  const [profiles, setProfiles] = useState<ProfileCard[]>([])
  // Explicit user choices for the in-character rewrite. Null means "use the
  // computed default" — that way the default updates automatically when the
  // character or profile list changes, but a deliberate pick sticks.
  const [profileOverride, setProfileOverride] = useState<string | null>(null)
  const [systemPromptOverride, setSystemPromptOverride] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('compose')
  const [proposedMarkdown, setProposedMarkdown] = useState('')
  const [isPosting, setIsPosting] = useState(false)
  // Whisper audience. Empty = public, which is the default and the historical
  // behaviour: an announcement is a proclamation unless the operator says
  // otherwise.
  const [audience, setAudience] = useState<string[]>([])

  // Note: state resets naturally on each open because the parent conditionally
  // renders this component (`{insertAnnouncementOpen && <... />}`), so each
  // open is a fresh mount and useState() initializers fire again.

  const loadCharactersIfNeeded = useCallback(() => {
    if (characters.length > 0 || charsLoading) return
    setCharsLoading(true)
    fetch('/api/v1/characters')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        const all: CharacterCard[] = data.characters || []
        setCharacters(all)
      })
      .catch((err) => {
        showErrorToast(`Failed to load characters: ${err.message}`)
      })
      .finally(() => setCharsLoading(false))
  }, [characters.length, charsLoading])

  // Load connection profiles once per open. Cheap — the response is small
  // and the user has at most a couple dozen profiles.
  useEffect(() => {
    if (!isOpen) return
    fetch('/api/v1/connection-profiles')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        const all: ProfileCard[] = (data.profiles || []).map((p: Record<string, unknown>) => ({
          id: String(p.id),
          name: String(p.name ?? ''),
          provider: String(p.provider ?? ''),
          modelName: String(p.modelName ?? ''),
          isDefault: Boolean(p.isDefault),
        }))
        setProfiles(all)
      })
      .catch((err) => {
        showErrorToast(`Failed to load connection profiles: ${err.message}`)
      })
  }, [isOpen])

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === characterId) || null,
    [characters, characterId],
  )

  // Default profile selection, derived from the picked character and the
  // loaded profile list. User-controlled characters default to as-is; LLM
  // characters fall back through character default → system default → as-is.
  const defaultProfileId = useMemo<string>(() => {
    if (mode !== 'character' || !selectedCharacter) return AS_IS
    if (selectedCharacter.controlledBy === 'user') return AS_IS
    if (
      selectedCharacter.defaultConnectionProfileId
      && profiles.some((p) => p.id === selectedCharacter.defaultConnectionProfileId)
    ) {
      return selectedCharacter.defaultConnectionProfileId
    }
    return profiles.find((p) => p.isDefault)?.id ?? AS_IS
  }, [mode, selectedCharacter, profiles])

  // Default system prompt selection, in the same shape as the character's
  // own resolution: explicit defaultSystemPromptId → isDefault flag → first.
  const defaultSystemPromptId = useMemo<string | null>(() => {
    if (mode !== 'character' || !selectedCharacter) return null
    const prompts = selectedCharacter.systemPrompts || []
    if (
      selectedCharacter.defaultSystemPromptId
      && prompts.some((p) => p.id === selectedCharacter.defaultSystemPromptId)
    ) {
      return selectedCharacter.defaultSystemPromptId
    }
    return prompts.find((p) => p.isDefault)?.id ?? prompts[0]?.id ?? null
  }, [mode, selectedCharacter])

  const profileId = profileOverride ?? defaultProfileId
  const systemPromptId = systemPromptOverride ?? defaultSystemPromptId

  const handleSelectCharacter = (id: string) => {
    setCharacterId(id)
    // Drop any previous overrides and clear the preview so the newly-picked
    // character gets fresh defaults and a clean compose stage.
    setProfileOverride(null)
    setSystemPromptOverride(null)
    setStage('compose')
    setProposedMarkdown('')
  }

  // The audience reaches the in-character rewrite (a private aside is phrased
  // differently from a proclamation), so changing it invalidates any proposal
  // already on screen and drops back to compose.
  const toggleAudience = (participantId: string) => {
    setAudience((prev) =>
      prev.includes(participantId)
        ? prev.filter((id) => id !== participantId)
        : [...prev, participantId],
    )
    setStage('compose')
    setProposedMarkdown('')
  }

  const handleModeChange = (next: Mode) => {
    setMode(next)
    setStage('compose')
    setProposedMarkdown('')
    setProfileOverride(null)
    setSystemPromptOverride(null)
    if (next === 'character') {
      loadCharactersIfNeeded()
    }
  }

  const offSceneCharacters = useMemo(() => {
    const presentSet = new Set(participantCharacterIds)
    return characters
      .filter((c) => !presentSet.has(c.id))
      .filter((c) =>
        charSearch.trim().length === 0
          ? true
          : c.name.toLowerCase().includes(charSearch.trim().toLowerCase()),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [characters, participantCharacterIds, charSearch])

  const selectedAudienceNames = useMemo(
    () =>
      audience
        .map((id) => audienceCandidates.find((p) => p.participantId === id)?.name)
        .filter((name): name is string => Boolean(name)),
    [audience, audienceCandidates],
  )

  const willRewrite = mode === 'character' && profileId !== AS_IS

  const canSubmit = (() => {
    if (isPosting || stage === 'generating') return false
    if (mode === 'staff') return Boolean(staffId) && content.trim().length > 0
    if (mode === 'custom') return customName.trim().length > 0 && content.trim().length > 0
    if (mode === 'character') {
      if (!characterId) return false
      if (stage === 'compose') return content.trim().length > 0
      if (stage === 'review') return proposedMarkdown.trim().length > 0
    }
    return false
  })()

  const postAnnouncement = async (textToPost: string) => {
    const sender =
      mode === 'staff'
        ? { kind: 'staff' as const, staffId }
        : mode === 'character'
          ? { kind: 'character' as const, characterId }
          : { kind: 'custom' as const, displayName: customName.trim() }

    setIsPosting(true)
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=announcement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentMarkdown: textToPost.trim(),
          sender,
          targetParticipantIds: audience.length > 0 ? audience : null,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const message = err.message || err.error || `Failed (HTTP ${res.status})`
        showErrorToast(message)
        return
      }

      showSuccessToast(audience.length > 0 ? 'Whispered announcement posted' : 'Announcement posted')
      onPosted?.()
      onClose()
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to post announcement'
      showErrorToast(msg)
    } finally {
      setIsPosting(false)
    }
  }

  const runPreview = async () => {
    if (!characterId || profileId === AS_IS) return
    setStage('generating')
    setProposedMarkdown('')
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=announcement-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seedMarkdown: content.trim(),
          characterId,
          connectionProfileId: profileId,
          systemPromptId: systemPromptId || undefined,
          targetParticipantIds: audience.length > 0 ? audience : null,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const message = err.message || err.error || `Failed (HTTP ${res.status})`
        showErrorToast(message)
        setStage('compose')
        return
      }

      const data = await res.json()
      const proposed = String(data.proposedMarkdown || '').trim()
      if (!proposed) {
        showErrorToast('The LLM returned no content. Try again or use as-is.')
        setStage('compose')
        return
      }
      setProposedMarkdown(proposed)
      setStage('review')
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to generate in-character announcement'
      showErrorToast(msg)
      setStage('compose')
    }
  }

  const handlePrimary = () => {
    if (!canSubmit) return
    if (mode === 'character' && stage === 'review') {
      void postAnnouncement(proposedMarkdown)
      return
    }
    if (willRewrite && stage === 'compose') {
      void runPreview()
      return
    }
    void postAnnouncement(content)
  }

  const editSeed = () => {
    setStage('compose')
    setProposedMarkdown('')
  }

  const isWhisper = audience.length > 0
  const postLabel = isWhisper ? 'Post Whisper' : 'Post Announcement'

  const primaryLabel = (() => {
    if (stage === 'generating') return 'Generating…'
    if (isPosting) return 'Posting…'
    if (mode === 'character' && stage === 'review') return postLabel
    if (willRewrite && stage === 'compose') return 'Preview in character'
    return postLabel
  })()

  const showSystemPromptPicker =
    mode === 'character'
    && selectedCharacter
    && (selectedCharacter.systemPrompts?.length || 0) > 1
    && profileId !== AS_IS

  const dialogClose = isPosting || stage === 'generating' ? () => {} : onClose

  return (
    <FloatingDialog
      isOpen={isOpen}
      onClose={dialogClose}
      title="Insert Announcement"
      storageKey="quilltap:insert-announcement-geometry"
      initialGeometry={{ width: 640, height: 600 }}
      minWidth={420}
      minHeight={460}
    >
      <div className="flex flex-col h-full">
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Mode selector */}
          <div className="mb-4">
            <label className="block text-sm qt-text-primary mb-2">Sender</label>
            <div className="flex gap-2" role="tablist" aria-label="Announcement sender type">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'staff'}
                onClick={() => handleModeChange('staff')}
                className={`qt-button ${mode === 'staff' ? 'qt-button-primary' : 'qt-button-secondary'}`}
                disabled={isPosting || stage !== 'compose'}
              >
                Staff
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'character'}
                onClick={() => handleModeChange('character')}
                className={`qt-button ${mode === 'character' ? 'qt-button-primary' : 'qt-button-secondary'}`}
                disabled={isPosting || stage !== 'compose'}
              >
                Off-scene character
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'custom'}
                onClick={() => handleModeChange('custom')}
                className={`qt-button ${mode === 'custom' ? 'qt-button-primary' : 'qt-button-secondary'}`}
                disabled={isPosting || stage !== 'compose'}
              >
                Custom
              </button>
            </div>
          </div>

          {/* Sender picker */}
          <div className="mb-4">
            {mode === 'staff' && (
              <div>
                <label htmlFor="announce-staff" className="block text-sm qt-text-primary mb-2">
                  Staff member
                </label>
                <select
                  id="announce-staff"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value as StaffId)}
                  className="qt-input w-full"
                  disabled={isPosting}
                >
                  {STAFF_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {mode === 'character' && (
              <div>
                <label htmlFor="announce-character-search" className="block text-sm qt-text-primary mb-2">
                  Off-scene character
                </label>
                <input
                  id="announce-character-search"
                  type="text"
                  value={charSearch}
                  onChange={(e) => setCharSearch(e.target.value)}
                  placeholder="Search by name…"
                  className="qt-input w-full mb-2"
                  disabled={isPosting || charsLoading || stage !== 'compose'}
                />
                {charsLoading ? (
                  <div className="qt-text-secondary text-sm">Loading characters…</div>
                ) : offSceneCharacters.length === 0 ? (
                  <div className="qt-text-secondary text-sm">
                    No matching workspace characters are absent from this chat.
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto qt-border-primary border rounded mb-3">
                    {offSceneCharacters.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectCharacter(c.id)}
                        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 ${
                          characterId === c.id ? 'qt-bg-primary/20' : 'hover:qt-bg-primary/10'
                        }`}
                        disabled={isPosting || stage !== 'compose'}
                      >
                        {c.avatarUrl ? (
                          <img
                            src={c.avatarUrl}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full qt-bg-secondary flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{c.name}</div>
                          {c.title && (
                            <div className="text-xs qt-text-secondary truncate">{c.title}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {selectedCharacter && (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="announce-profile" className="block text-sm qt-text-primary mb-2">
                        How should they say it?
                      </label>
                      <select
                        id="announce-profile"
                        value={profileId}
                        onChange={(e) => setProfileOverride(e.target.value)}
                        className="qt-input w-full"
                        disabled={isPosting || stage !== 'compose'}
                      >
                        <option value={AS_IS}>Use as-is, do not process in-character</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.modelName}
                            {p.isDefault ? ' (default)' : ''}
                          </option>
                        ))}
                      </select>
                      {selectedCharacter.controlledBy === 'user' && profileId === AS_IS && (
                        <div className="qt-text-xs mt-1">
                          {selectedCharacter.name} is user-controlled — by default the announcement is posted verbatim.
                        </div>
                      )}
                    </div>

                    {showSystemPromptPicker && (
                      <div>
                        <label htmlFor="announce-prompt" className="block text-sm qt-text-primary mb-2">
                          System prompt
                        </label>
                        <select
                          id="announce-prompt"
                          value={systemPromptId || ''}
                          onChange={(e) => setSystemPromptOverride(e.target.value || null)}
                          className="qt-input w-full"
                          disabled={isPosting || stage !== 'compose'}
                        >
                          {(selectedCharacter.systemPrompts || []).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.isDefault ? ' (default)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {mode === 'custom' && (
              <div>
                <label htmlFor="announce-custom-name" className="block text-sm qt-text-primary mb-2">
                  Display name
                </label>
                <input
                  id="announce-custom-name"
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. The Narrator, A Distant Voice"
                  className="qt-input w-full"
                  disabled={isPosting}
                />
                <div className="qt-text-xs mt-1">
                  The bubble shows this name beside a placeholder avatar.
                </div>
              </div>
            )}
          </div>

          {/* Audience — public by default; naming anyone makes it a whisper. */}
          {audienceCandidates.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm qt-text-primary mb-2" id="announce-audience-label">
                Who hears it
              </label>
              <div
                role="group"
                aria-labelledby="announce-audience-label"
                className="qt-border-primary border rounded max-h-40 overflow-y-auto"
              >
                {audienceCandidates.map((p) => {
                  const checked = audience.includes(p.participantId)
                  return (
                    <label
                      key={p.participantId}
                      className={`w-full px-3 py-2 text-sm flex items-center gap-3 cursor-pointer ${
                        checked ? 'qt-bg-primary/20' : 'hover:qt-bg-primary/10'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAudience(p.participantId)}
                        disabled={isPosting || stage === 'generating'}
                        className="qt-checkbox flex-shrink-0"
                      />
                      {p.avatarUrl ? (
                        <img
                          src={p.avatarUrl}
                          alt=""
                          className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full qt-bg-secondary flex-shrink-0" />
                      )}
                      <span className="min-w-0 truncate">{p.name}</span>
                      {p.controlledBy === 'user' && (
                        <span className="qt-text-xs flex-shrink-0">(you)</span>
                      )}
                      {(p.status === 'silent' || p.status === 'absent') && (
                        <span className="qt-text-xs flex-shrink-0">({p.status})</span>
                      )}
                    </label>
                  )
                })}
              </div>
              <div className="qt-text-xs mt-1">
                {audience.length === 0 ? (
                  <>Everyone present hears this — it is posted as a public announcement.</>
                ) : (
                  <>
                    Whispered to {selectedAudienceNames.join(', ')}. No other character receives it in
                    their context.
                    {' '}
                    <button
                      type="button"
                      onClick={() => {
                        setAudience([])
                        setStage('compose')
                        setProposedMarkdown('')
                      }}
                      className="qt-action underline"
                      disabled={isPosting || stage === 'generating'}
                    >
                      Make it public
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Seed editor */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm qt-text-primary">
                {willRewrite
                  ? `What you want the character to ${isWhisper ? 'say privately' : 'announce'}`
                  : isWhisper
                    ? 'Whisper'
                    : 'Announcement'}
              </label>
              {willRewrite && stage === 'review' && (
                <button
                  type="button"
                  onClick={editSeed}
                  className="text-xs qt-action underline"
                  disabled={isPosting}
                >
                  Edit seed
                </button>
              )}
            </div>
            <MarkdownLexicalEditor
              value={content}
              onChange={setContent}
              disabled={isPosting || stage !== 'compose'}
              namespace="InsertAnnouncementDialog"
              ariaLabel="Announcement body"
            />
          </div>

          {/* Preview panel */}
          {willRewrite && stage !== 'compose' && (
            <div>
              <label className="block text-sm qt-text-primary mb-2">
                What {selectedCharacter?.name || 'the character'} will say
              </label>
              {stage === 'generating' ? (
                <div className="qt-border-primary border rounded p-6 flex flex-col items-center justify-center gap-3 min-h-32">
                  <QuillAnimation size="lg" />
                  <div className="qt-text-secondary text-sm">Generating in character…</div>
                </div>
              ) : (
                <MarkdownLexicalEditor
                  value={proposedMarkdown}
                  onChange={setProposedMarkdown}
                  disabled={isPosting}
                  namespace="InsertAnnouncementDialogPreview"
                  ariaLabel="Proposed announcement"
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t qt-border-default px-4 py-3 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="qt-button qt-button-secondary"
            disabled={isPosting || stage === 'generating'}
          >
            Cancel
          </button>
          {mode === 'character' && stage === 'review' && (
            <button
              type="button"
              onClick={runPreview}
              className="qt-button qt-button-secondary"
              disabled={isPosting || content.trim().length === 0}
            >
              Regenerate
            </button>
          )}
          <button
            onClick={handlePrimary}
            disabled={!canSubmit}
            className="qt-button qt-button-primary"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </FloatingDialog>
  )
}
