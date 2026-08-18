'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
// Using native img tag instead of next/image because /api/files/* routes
// are dynamic API endpoints that can't go through Next.js image optimization
import dynamic from 'next/dynamic'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { CharacterDeleteDialog } from '@/components/character-delete-dialog'
import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import { processTemplate } from '@/lib/templates/processor'
import { useGroups } from '@/app/aurora/hooks/useGroups'
import { GroupsGrid } from '@/app/aurora/components/GroupsGrid'
import { Icon } from '@/components/ui/icon'
import { useSubsystemBackgroundStyle } from '@/components/providers/theme-provider'
import { useOnTabActivated, useWorkspaceTabId } from '@/components/workspace/workspace-tab-context'

const AIImportWizard = dynamic(() => import('@/components/settings/ai-import/AIImportWizard'), {
  loading: () => <p className="qt-text-muted p-8 text-center">Loading wizard...</p>,
})

// Lazy so the list bundle doesn't pull in the character detail (chat modal,
// optimizer, editors) until a character is actually opened in place.
const CharacterDetailView = dynamic(
  () => import('./[id]/view/CharacterDetailView').then((m) => m.CharacterDetailView),
  { ssr: false, loading: () => <p className="qt-text-muted p-8 text-center">Loading character…</p> }
)

const GroupDetailView = dynamic(
  () => import('./groups/[id]/GroupDetailView').then((m) => m.GroupDetailView),
  { ssr: false, loading: () => <p className="qt-text-muted p-8 text-center">Loading group…</p> }
)

interface Character {
  id: string
  name: string
  title?: string | null
  description: string
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
  isFavorite: boolean
  controlledBy: 'llm' | 'user'
  canBeCarina?: boolean
  npc: boolean
  archivedAt?: string | null
  defaultPartnerName?: string | null
  createdAt: string
  tags?: string[]
  defaultConnectionProfileId?: string | null
  _count: {
    chats: number
  }
}

export interface AuroraViewProps {
  /** Deep-link target: open with this group's editor shown (workspace tab only). */
  initialGroupId?: string
}

export function AuroraView({ initialGroupId }: AuroraViewProps = {}) {
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [aiImportDialogOpen, setAIImportDialogOpen] = useState(false)
  const [resetBuiltinsDialogOpen, setResetBuiltinsDialogOpen] = useState(false)
  const [resetBuiltinsInProgress, setResetBuiltinsInProgress] = useState(false)
  const [deleteDialogCharacter, setDeleteDialogCharacter] = useState<Character | null>(null)
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const { getProfileProvider } = useConnectionProfiles()
  const { style } = useAvatarDisplay()
  const { shouldHideByIds } = useQuickHide()
  const router = useRouter()
  const { groups, fetchGroups, deleteGroup, createGroup } = useGroups()
  const bgStyle = useSubsystemBackgroundStyle('aurora')
  // In a workspace tab, drilling into a character renders in place (keep-alive)
  // instead of navigating to /aurora/[id]/view. (Group detail still routes.)
  const inTab = useWorkspaceTabId() != null
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [openChatForSelected, setOpenChatForSelected] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialGroupId ?? null)

  // Fetch groups on mount
  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  // Navigating back to this tab refreshes the groups list (the characters
  // list is TanStack-backed and refreshed by the tab-activation invalidator).
  useOnTabActivated(() => {
    void fetchGroups()
  })

  // A deep-link re-open refreshes the tab payload; follow it into the group.
  // Adjusting state during render is React's sanctioned derive-from-prop-change
  // pattern (re-renders immediately, nothing committed in between).
  const [prevInitialGroupId, setPrevInitialGroupId] = useState(initialGroupId)
  if (initialGroupId !== prevInitialGroupId) {
    setPrevInitialGroupId(initialGroupId)
    if (initialGroupId) setSelectedGroupId(initialGroupId)
  }

  const queryClient = useQueryClient()
  // "Show archived" opts into the tombstones the API hides by default; the two
  // filter states cache under distinct keys so they never cross-contaminate.
  const [showArchived, setShowArchived] = useState(false)
  const { data, isLoading: loading, error: loadError } = useQuery({
    queryKey: queryKeys.characters.list(showArchived ? { archived: 'include' } : undefined),
    queryFn: ({ signal }) =>
      apiFetch<{ characters: Character[] }>(
        showArchived ? '/api/v1/characters?archived=include' : '/api/v1/characters',
        { signal }
      ),
  })
  // Shim preserving SWR's `mutate` signature so the handlers below stay
  // unchanged: with an updater it writes optimistically (revalidating unless
  // `{ revalidate: false }`), with no args it revalidates.
  const mutateCharacters = useCallback(
    async (
      updater?: (prev: { characters: Character[] } | undefined) => { characters: Character[] } | undefined,
      opts?: { revalidate?: boolean }
    ): Promise<void> => {
      const activeKey = queryKeys.characters.list(showArchived ? { archived: 'include' } : undefined)
      if (updater) {
        queryClient.setQueryData<{ characters: Character[] }>(activeKey, updater)
        if (opts?.revalidate !== false) {
          // Prefix invalidation so the other archived-filter variant refreshes too.
          await queryClient.invalidateQueries({ queryKey: queryKeys.characters.all })
        }
        return
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.characters.all })
    },
    [queryClient, showArchived]
  )
  const characters = useMemo(() => data?.characters ?? [], [data])
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'An error occurred') : null

  const visibleCharacters = useMemo(
    () => characters
      .filter(character => !shouldHideByIds(character.tags || []))
      .sort((a, b) => {
        // 0. Archived characters at the very end of the shelf
        const aArchived = Boolean(a.archivedAt)
        const bArchived = Boolean(b.archivedAt)
        if (aArchived !== bArchived) {
          return aArchived ? 1 : -1
        }
        // 1. NPCs last
        if (a.npc !== b.npc) {
          return a.npc ? 1 : -1
        }
        // 2. Favorites first
        if (a.isFavorite !== b.isFavorite) {
          return a.isFavorite ? -1 : 1
        }
        // 3. Then by chat count (descending)
        if (a._count.chats !== b._count.chats) {
          return b._count.chats - a._count.chats
        }
        // 4. Then alphabetically by name (case-insensitive)
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      }),
    [characters, shouldHideByIds]
  )

  const getAvatarSrc = (character: Character): string | null => {
    if (character.defaultImage) {
      // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
      const filepath = character.defaultImage.filepath
      return character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    }
    return character.avatarUrl || null
  }

  const openDeleteDialog = (character: Character) => {
    setDeleteDialogCharacter(character)
  }

  const handleDeleteConfirm = async (options: { cascadeChats: boolean; cascadeImages: boolean }) => {
    if (!deleteDialogCharacter) return

    const id = deleteDialogCharacter.id
    const params = new URLSearchParams()
    if (options.cascadeChats) params.set('cascadeChats', 'true')
    if (options.cascadeImages) params.set('cascadeImages', 'true')

    try {
      const url = `/api/v1/characters/${id}${params.toString() ? `?${params.toString()}` : ''}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete character')

      const result = await res.json()
      await mutateCharacters()
      setDeleteDialogCharacter(null)

      // Show success message with details
      const deletedItems: string[] = ['Character deleted']
      if (result.deletedChats > 0) {
        deletedItems.push(`${result.deletedChats} chat${result.deletedChats === 1 ? '' : 's'} deleted`)
      }
      if (result.deletedImages > 0) {
        deletedItems.push(`${result.deletedImages} image${result.deletedImages === 1 ? '' : 's'} deleted`)
      }
      if (result.deletedMemories > 0) {
        deletedItems.push(`${result.deletedMemories} memor${result.deletedMemories === 1 ? 'y' : 'ies'} deleted`)
      }
      showSuccessToast(deletedItems.join('. '))

    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete character')
    }
  }

  const toggleFavorite = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    try {
      const res = await fetch(`/api/v1/characters/${id}?action=favorite`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to toggle favorite')
      const data = await res.json()
      await mutateCharacters(
        (prev) => prev && { characters: prev.characters.map((c) => (c.id === id ? { ...c, isFavorite: data.character.isFavorite } : c)) },
        { revalidate: false }
      )
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle favorite')
    }
  }

  const toggleControlledBy = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    try {
      const res = await fetch(`/api/v1/characters/${id}?action=toggle-controlled-by`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to toggle controlled-by')
      const data = await res.json()
      await mutateCharacters(
        (prev) => prev && { characters: prev.characters.map((c) => (c.id === id ? { ...c, controlledBy: data.character.controlledBy } : c)) },
        { revalidate: false }
      )
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle controlled-by')
    }
  }

  const toggleCarina = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    try {
      const res = await fetch(`/api/v1/characters/${id}?action=toggle-carina`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to toggle Carina eligibility')
      const data = await res.json()
      await mutateCharacters(
        (prev) => prev && { characters: prev.characters.map((c) => (c.id === id ? { ...c, canBeCarina: data.character.canBeCarina } : c)) },
        { revalidate: false }
      )
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle Carina eligibility')
    }
  }

  const handleCardClick = (e: React.MouseEvent, characterId: string) => {
    // Don't navigate if clicking on a button, link, or interactive element
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('a')) {
      return
    }
    if (inTab) {
      setOpenChatForSelected(false)
      setSelectedCharacterId(characterId)
    } else {
      router.push(`/aurora/${characterId}/view`)
    }
  }

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return

    try {
      setCreatingGroup(true)
      const newGroup = await createGroup(newGroupName, newGroupDescription || null)
      if (newGroup) {
        setCreateGroupDialogOpen(false)
        setNewGroupName('')
        setNewGroupDescription('')
        // Open the new group — in place if we're a workspace tab, else navigate.
        if (inTab) setSelectedGroupId(newGroup.id)
        else router.push(`/aurora/groups/${newGroup.id}`)
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to create group')
    } finally {
      setCreatingGroup(false)
    }
  }

  const handleDeleteGroup = useCallback((groupId: string) => {
    deleteGroup(groupId)
  }, [deleteGroup])

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    try {
      const res = await fetch('/api/v1/characters?action=import', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('Failed to import character')

      await res.json()
      await mutateCharacters()
      setImportDialogOpen(false)
      showSuccessToast('Character imported successfully!')
    } catch (err) {
      showErrorToast('Failed to import character. Make sure it\'s a valid SillyTavern PNG or JSON file.')
      console.error('Failed to import character', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleResetBuiltins = async () => {
    setResetBuiltinsInProgress(true)

    try {
      const res = await fetch('/api/v1/characters?action=reset-builtins', {
        method: 'POST',
      })

      if (!res.ok) {
        throw new Error('Failed to reset built-in characters')
      }

      await res.json()
      await mutateCharacters()
      setResetBuiltinsDialogOpen(false)
      showSuccessToast('Built-in characters reset successfully.')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to reset built-in characters')
      console.error('Failed to reset built-in characters', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setResetBuiltinsInProgress(false)
    }
  }

  // Workspace tab, drilled into a character or group: render its detail in place
  // (the detail views manage their own loading, so this precedes the list gate).
  if (inTab && selectedCharacterId) {
    return (
      <CharacterDetailView
        characterId={selectedCharacterId}
        onBack={() => {
          setSelectedCharacterId(null)
          setOpenChatForSelected(false)
        }}
        openChatOnMount={openChatForSelected}
      />
    )
  }

  if (inTab && selectedGroupId) {
    return (
      <GroupDetailView
        groupId={selectedGroupId}
        onBack={() => {
          setSelectedGroupId(null)
          // Reflect any name/color/member edits in the list (a route visit would
          // have refetched on remount).
          void fetchGroups()
        }}
      />
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading characters...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg qt-text-destructive">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="character-page qt-page-container text-foreground" style={bgStyle}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b qt-border-default/60 pb-6">
        <h1 className="qt-page-title">Characters</h1>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`qt-button character-toolbar__button inline-flex items-center gap-1.5 rounded-lg border qt-border-default px-4 py-2 text-sm qt-shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${showArchived ? 'qt-bg-primary/20 qt-text-primary' : 'qt-bg-muted/70 qt-text-primary hover:qt-bg-muted'}`}
            title={showArchived ? 'Tuck the archived characters back out of sight' : 'Show characters resting in the archive'}
          >
            <Icon name="folder" className="w-4 h-4" />
            {showArchived ? 'Hide Archived' : 'Show Archived'}
          </button>
          <button
            onClick={() => setResetBuiltinsDialogOpen(true)}
            className="qt-button character-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Reset built-in characters to first-run defaults"
          >
            Reset Built-in Characters
          </button>
          <button
            onClick={() => setImportDialogOpen(true)}
            className="qt-button character-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Import from SillyTavern
          </button>
          <button
            onClick={() => setAIImportDialogOpen(true)}
            className="qt-button character-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="AI generation of character from any text source"
          >
            Summon From Lore
          </button>
          <button
            onClick={() => setCreateGroupDialogOpen(true)}
            className="qt-button character-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Create a new group"
          >
            Create Group
          </button>
          <Link
            href="/aurora/new"
            className="qt-button character-toolbar__button character-toolbar__button--primary inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-md transition hover:qt-bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Create Character
          </Link>
        </div>
      </div>

      {/* Groups Section — rendered unconditionally so GroupsGrid can show its
          empty state ("No groups yet") for first-time users. */}
      <div className="mt-8">
        <h2 className="qt-heading-2 mb-6 text-foreground">Groups</h2>
        <GroupsGrid
          groups={groups}
          onCreateClick={() => setCreateGroupDialogOpen(true)}
          onDeleteClick={handleDeleteGroup}
          onOpenGroup={inTab ? setSelectedGroupId : undefined}
        />
      </div>

      {/* Characters Section */}
      {visibleCharacters.length === 0 ? (
        <div className="character-empty-state mt-12 rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-12 text-center qt-shadow-sm">
          <p className="mb-4 text-lg qt-text-secondary">No characters yet</p>
          <Link
            href="/aurora/new"
            className="qt-text-primary hover:text-primary/80"
          >
            Create your first character
          </Link>
        </div>
      ) : (
        <div className="character-card-grid mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visibleCharacters.map((character) => (
            <div
              key={character.id}
              className="qt-entity-card character-card cursor-pointer hover:qt-border-primary/50 transition-colors"
              onClick={(e) => handleCardClick(e, character.id)}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center flex-grow gap-4">
                  {getAvatarSrc(character) ? (
                     
                    <img
                      src={getAvatarSrc(character)!}
                      alt={character.name}
                      width={48}
                      height={48}
                      className={getAvatarClasses(style, 'md').imageClass}
                    />
                  ) : (
                    <div className={getAvatarClasses(style, 'md').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                      <span className={getAvatarClasses(style, 'md').fallbackClass}>
                        {character.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex-grow">
                    <h2 className="qt-heading-3 text-foreground flex items-center gap-2">
                      {character.name}
                      {character.archivedAt && (
                        <span
                          className="qt-badge inline-flex items-center rounded-full border qt-border-default qt-bg-muted px-2 py-0.5 text-xs font-medium qt-text-secondary"
                          title={`Resting in the archive since ${new Date(character.archivedAt).toLocaleDateString()}`}
                        >
                          Archived
                        </span>
                      )}
                    </h2>
                    {character.title && (
                      <p className="qt-text-small">{character.title}</p>
                    )}
                    <p className="qt-text-small">
                      {character._count.chats} chat{character._count.chats !== 1 ? 's' : ''}
                    </p>
                    {character.defaultConnectionProfileId && (() => {
                      const profileInfo = getProfileProvider(character.defaultConnectionProfileId!)
                      return profileInfo ? (
                        <ProviderModelBadge provider={profileInfo.provider} modelName={profileInfo.modelName} size="sm" />
                      ) : null
                    })()}
                  </div>
                </div>
                {!character.archivedAt && (
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={(e) => toggleFavorite(e, character.id)}
                      className="text-2xl qt-text-favorite transition-transform hover:scale-110"
                      title={character.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      {character.isFavorite ? '⭐' : '☆'}
                    </button>
                    <button
                      onClick={(e) => toggleCarina(e, character.id)}
                      className={`transition hover:scale-110 ${character.canBeCarina ? 'qt-text-favorite' : 'qt-text-secondary'}`}
                      title={character.canBeCarina ? 'Disable Carina answers (@-queries)' : 'Enable Carina answers (@-queries)'}
                    >
                      <Icon name="monitor" className="w-6 h-6" />
                    </button>
                    <button
                      onClick={(e) => toggleControlledBy(e, character.id)}
                      className={`transition hover:scale-110 ${character.controlledBy === 'user' ? 'qt-text-favorite' : 'qt-text-secondary'}`}
                      title={character.controlledBy === 'user' ? 'Switch to LLM control' : 'Switch to user control'}
                    >
                      <Icon name="user" className="w-6 h-6" />
                    </button>
                  </div>
                )}
              </div>

              <p className="line-clamp-3 qt-text-small">
                {processTemplate(character.description || '', {
                  char: character.name,
                  user: character.controlledBy === 'user'
                    ? character.name
                    : (character.defaultPartnerName || 'User')
                })}
              </p>

              <div className="qt-entity-card-actions character-card-actions">
                {character.archivedAt ? (
                  <span
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border qt-border-default qt-bg-muted/50 px-4 py-2 text-sm qt-text-secondary"
                    title="An archived character neither chats nor exports; open their page to rehydrate them."
                  >
                    Resting in the archive
                  </span>
                ) : (
                  <>
                    <Link
                      href={`/aurora/${character.id}/view?action=chat`}
                      onClick={inTab ? (e) => {
                        e.preventDefault()
                        setOpenChatForSelected(true)
                        setSelectedCharacterId(character.id)
                      } : undefined}
                      className="character-card__action character-card__action--chat inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold qt-text-success-foreground qt-shadow-sm transition hover:qt-bg-success/90"
                      title="Start a chat with this character"
                    >
                      <Icon name="chat" className="w-5 h-5" />
                      Chat
                    </Link>
                    <a
                      href={`/api/v1/characters/${character.id}?action=export&format=json`}
                      className="character-card__action inline-flex items-center justify-center gap-2 rounded-lg border qt-border-default qt-bg-muted/80 px-3 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted"
                      title="Export character data"
                    >
                      <Icon name="download" className="w-5 h-5" />
                    </a>
                  </>
                )}
                <button
                  onClick={() => openDeleteDialog(character)}
                  className="character-card__action qt-button-destructive qt-shadow-sm"
                  title="Delete this character"
                >
                  <Icon name="trash" className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import Dialog */}
      {importDialogOpen && (
        <div className="character-import-dialog fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border qt-border-default qt-bg-card p-6 shadow-2xl">
            <h3 className="mb-4 qt-dialog-title text-foreground">
              Import from SillyTavern
            </h3>
            <form onSubmit={handleImport}>
              <div className="mb-4">
                <label className="mb-2 block text-sm qt-text-primary">
                  Select SillyTavern character file (PNG or JSON)
                </label>
                <input
                  type="file"
                  name="file"
                  accept=".png,.json"
                  required
                  className="block w-full qt-text-small file:mr-4 file:rounded-md file:border-0 file:qt-bg-primary/20 file:px-4 file:py-2 file:font-semibold file:text-primary hover:file:qt-bg-primary/30"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setImportDialogOpen(false)}
                  className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm qt-text-primary qt-shadow-sm hover:qt-bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:qt-bg-primary/90"
                >
                  Import
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Built-ins Dialog */}
      {resetBuiltinsDialogOpen && (
        <div className="character-import-dialog fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border qt-border-default qt-bg-card p-6 shadow-2xl">
            <h3 className="mb-3 qt-dialog-title text-foreground">
              Reset Built-in Characters
            </h3>
            <p className="mb-5 qt-text-small">
              This will delete existing Lorian and Riya records if present, then re-import their first-run versions.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setResetBuiltinsDialogOpen(false)}
                disabled={resetBuiltinsInProgress}
                className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm qt-text-primary qt-shadow-sm hover:qt-bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetBuiltins}
                disabled={resetBuiltinsInProgress}
                className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:qt-bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resetBuiltinsInProgress ? 'Resetting...' : 'Reset Built-ins'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Import Dialog */}
      {aiImportDialogOpen && (
        <div className="character-import-dialog fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border qt-border-default qt-bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="qt-dialog-title text-foreground">
                Summon From Lore
              </h3>
              <button
                onClick={() => setAIImportDialogOpen(false)}
                className="inline-flex items-center justify-center rounded-lg border qt-border-default qt-bg-card px-3 py-1.5 text-sm qt-text-primary qt-shadow-sm hover:qt-bg-muted"
              >
                Close
              </button>
            </div>
            <AIImportWizard
              onClose={() => setAIImportDialogOpen(false)}
              onImportSuccess={() => {
                mutateCharacters()
              }}
            />
          </div>
        </div>
      )}

      {/* Delete Character Dialog */}
      {deleteDialogCharacter && (
        <CharacterDeleteDialog
          characterId={deleteDialogCharacter.id}
          characterName={deleteDialogCharacter.name}
          onClose={() => setDeleteDialogCharacter(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}

      {/* Create Group Dialog */}
      {createGroupDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border qt-border-default qt-bg-card p-6 shadow-2xl">
            <h3 className="mb-4 qt-dialog-title text-foreground">
              Create Group
            </h3>
            <form onSubmit={handleCreateGroup}>
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Group Name *
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g., Adventuring Party"
                  className="w-full px-4 py-2 rounded-lg border qt-border-default bg-transparent text-foreground text-sm"
                  autoFocus
                  required
                />
              </div>
              <div className="mb-6">
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Description (optional)
                </label>
                <textarea
                  value={newGroupDescription}
                  onChange={(e) => setNewGroupDescription(e.target.value)}
                  placeholder="Optional description of this group"
                  rows={3}
                  className="w-full px-4 py-2 rounded-lg border qt-border-default bg-transparent text-foreground text-sm resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setCreateGroupDialogOpen(false)
                    setNewGroupName('')
                    setNewGroupDescription('')
                  }}
                  disabled={creatingGroup}
                  className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm qt-text-primary qt-shadow-sm hover:qt-bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingGroup || !newGroupName.trim()}
                  className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:qt-bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creatingGroup ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
