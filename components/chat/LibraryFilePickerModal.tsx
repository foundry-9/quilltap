'use client'

/**
 * LibraryFilePickerModal Component
 *
 * Two-step modal for picking a file from anywhere the user has files —
 * General library, their own photo gallery, project files, or any of the
 * database-backed document stores in the system — and linking it to the
 * current chat.
 *
 * Step 1 ("scope"): pick a source.
 * Step 2 ("browse-project" | "browse-gallery" | "browse-mount"): browse the
 *   selected source. The Gallery view is a custom thumbnail grid backed by
 *   `/api/v1/photos`; everything else delegates to `FileBrowser`.
 */

import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import FileBrowser, { type FileInfo, type FileBrowserMountPoint } from '@/components/files/FileBrowser'

interface LibraryFilePickerModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  /**
   * Called when a legacy library file (not a Scriptorium document-store file)
   * has been linked to the chat. The parent typically pushes the result into
   * the composer's pending-attachments tray so the user's next message picks
   * it up.
   */
  onFileLinked: (file: {
    id: string
    filename: string
    filepath: string
    mimeType: string
    url: string
  }) => void
  /**
   * Called when a Scriptorium document-store file (including a gallery photo
   * or a generic mount-store file) has been pinned to the chat via a
   * Librarian announcement. There is no composer-tray hand-off — the
   * announcement is already in the transcript — so the parent should refetch
   * the chat to reveal it.
   */
  onMountFileAttached?: () => void
}

interface Project {
  id: string
  name: string
  icon?: string
  color?: string
}

interface MountPointSummary {
  id: string
  name: string
  mountType: 'filesystem' | 'obsidian' | 'database'
  storeType: 'documents' | 'character'
  enabled: boolean
}

interface MountPointsResponse {
  mountPoints: MountPointSummary[]
}

interface GalleryEntry {
  linkId: string
  mountPointId: string
  relativePath: string
  fileName: string
  blobUrl: string
  mimeType: string
  caption: string | null
  keptAt: string
  generationPromptExcerpt?: string
}

interface GalleryResponse {
  entries: GalleryEntry[]
  total: number
  hasMore: boolean
}

interface PhotoAlbumOption {
  mountPointId: string
  name: string
  kind: 'character' | 'project' | 'document-store' | 'general'
  characterId?: string
  participantId?: string
  isUserCharacter?: boolean
  isDefault?: boolean
}

interface PhotoAlbumsResponse {
  albums: PhotoAlbumOption[]
}

type Step = 'scope' | 'browse-project' | 'browse-gallery' | 'browse-mount'

export default function LibraryFilePickerModal({
  isOpen,
  onClose,
  chatId,
  onFileLinked,
  onMountFileAttached,
}: Readonly<LibraryFilePickerModalProps>) {
  const [step, setStep] = useState<Step>('scope')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedScopeName, setSelectedScopeName] = useState<string>('General')
  const [selectedMount, setSelectedMount] = useState<FileBrowserMountPoint | null>(null)
  const [linking, setLinking] = useState(false)

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: ({ signal }) => apiFetch<{ projects: Project[] }>('/api/v1/projects', { signal }),
    enabled: isOpen,
  })
  const projects = projectsData?.projects || []

  const { data: mountsData, isLoading: mountsLoading } = useQuery({
    queryKey: queryKeys.mountPoints.list(),
    queryFn: ({ signal }) => apiFetch<MountPointsResponse>('/api/v1/mount-points', { signal }),
    enabled: isOpen,
  })
  // Show database-backed stores that aren't private character vaults — those
  // are managed via the character optimizer / Aurora tab and are conceptually
  // off-limits for the human composer.
  const docStores = (mountsData?.mountPoints || []).filter(
    mp => mp.enabled && mp.mountType === 'database' && mp.storeType !== 'character'
  )

  // "My Gallery" routes to the user's active persona vault for this chat —
  // the same `photos/` folder Aurora's character page shows. Falls back to
  // the global Quilltap Uploads gallery when no user persona is set.
  const { data: albumsData } = useQuery({
    queryKey: queryKeys.chats.photoAlbums(chatId),
    queryFn: ({ signal }) =>
      apiFetch<PhotoAlbumsResponse>(`/api/v1/chats/${chatId}?action=photo-albums`, { signal }),
    enabled: isOpen,
  })

  // "Group Files" — document stores belonging to groups the user-persona
  // character(s) in this chat are members of.
  const { data: groupStoresData, isLoading: groupStoresLoading } = useQuery({
    queryKey: queryKeys.chats.groupStores(chatId),
    queryFn: ({ signal }) =>
      apiFetch<{ stores: MountPointSummary[] }>(`/api/v1/chats/${chatId}?action=group-stores`, { signal }),
    enabled: isOpen,
  })
  const groupStores = groupStoresData?.stores || []
  const userPersonaAlbum =
    albumsData?.albums.find(a => a.kind === 'character' && a.isUserCharacter && a.isDefault) ??
    albumsData?.albums.find(a => a.kind === 'character' && a.isUserCharacter) ??
    null

  // Reset state when modal closes (modal-reset pattern)
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset fires only on open; parent renders unconditionally
      setStep('scope')
      setSelectedProjectId(null)
      setSelectedScopeName('General')
      setSelectedMount(null)
      setLinking(false)
    }
  }, [isOpen])

  const attachMountFile = useCallback(
    async (mountPointId: string, relativePath: string, displayName: string) => {
      const res = await fetch(
        `/api/v1/chats/${chatId}/files?action=attach-mount-file`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mountPointId, relativePath }),
        }
      )
      if (!res.ok) {
        let errorMessage = 'Failed to attach document'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          errorMessage = `HTTP ${res.status}: ${res.statusText}`
        }
        throw new Error(errorMessage)
      }
      showSuccessToast(`Attached "${displayName}" — the Librarian has noted it`)
      if (onMountFileAttached) {
        onMountFileAttached()
      }
      onClose()
    },
    [chatId, onClose, onMountFileAttached]
  )

  const handleProjectScopeSelect = useCallback(
    (projectId: string | null, name: string) => {
      setSelectedProjectId(projectId)
      setSelectedScopeName(name)
      setSelectedMount(null)
      setStep('browse-project')
    },
    []
  )

  const handleGalleryScopeSelect = useCallback(() => {
    setSelectedScopeName('My Gallery')
    setStep('browse-gallery')
  }, [])

  const handleMountScopeSelect = useCallback((mount: MountPointSummary) => {
    setSelectedMount({
      id: mount.id,
      mountType: mount.mountType,
      storeType: mount.storeType,
      name: mount.name,
    })
    setSelectedScopeName(mount.name)
    setStep('browse-mount')
  }, [])

  const handleFileClick = useCallback(
    async (file: FileInfo) => {
      if (linking) return

      // Scriptorium document-store files don't live in the legacy `files`
      // table, so the link endpoint can't take their id. Post a Librarian
      // attachment announcement instead — the synthetic message carries the
      // mount-file id as a message-level attachment, and the assistant-side
      // attachment walker surfaces it to the next character turn.
      const isMountFile = !!file.mountPointId && !!file.relativePath
      const filename = file.originalFilename || file.filename || 'file'

      try {
        setLinking(true)

        if (isMountFile) {
          await attachMountFile(file.mountPointId!, file.relativePath!, filename)
          return
        }

        const res = await fetch(
          `/api/v1/chats/${chatId}/files?action=link`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: file.id }),
          }
        )

        if (!res.ok) {
          let errorMessage = 'Failed to link file'
          try {
            const errorData = await res.json()
            errorMessage = errorData.error || errorMessage
          } catch {
            errorMessage = `HTTP ${res.status}: ${res.statusText}`
          }
          throw new Error(errorMessage)
        }

        const data = await res.json()
        const linkedFile = data.file

        showSuccessToast(`Linked "${filename}" to chat`)
        onFileLinked({
          id: linkedFile.id,
          filename: linkedFile.filename,
          filepath: linkedFile.filepath,
          mimeType: linkedFile.mimeType,
          url: linkedFile.url,
        })
        onClose()
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        console.error('[LibraryFilePickerModal] Failed to attach file', {
          chatId,
          fileId: file.id,
          mountPointId: file.mountPointId ?? null,
          relativePath: file.relativePath ?? null,
          isMountFile,
          error: errorMessage,
        })
        showErrorToast(errorMessage || 'Failed to attach file')
      } finally {
        setLinking(false)
      }
    },
    [chatId, linking, onFileLinked, onClose, attachMountFile]
  )

  const handleGalleryPick = useCallback(
    async (entry: GalleryEntry) => {
      if (linking) return
      const displayName = entry.caption || entry.fileName
      try {
        setLinking(true)
        await attachMountFile(entry.mountPointId, entry.relativePath, displayName)
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        console.error('[LibraryFilePickerModal] Failed to attach gallery photo', {
          chatId,
          linkId: entry.linkId,
          error: errorMessage,
        })
        showErrorToast(errorMessage || 'Failed to attach photo')
      } finally {
        setLinking(false)
      }
    },
    [chatId, linking, attachMountFile]
  )

  const handleBack = useCallback(() => {
    setStep('scope')
    setSelectedMount(null)
  }, [])

  const title =
    step === 'scope'
      ? 'Choose File Source'
      : `Browse Files — ${selectedScopeName}`

  const footer =
    step !== 'scope' ? (
      <div className="flex justify-between">
        <button
          onClick={handleBack}
          disabled={linking}
          className="qt-button qt-button-secondary"
        >
          Back
        </button>
        <button
          onClick={onClose}
          disabled={linking}
          className="qt-button qt-button-secondary"
        >
          Cancel
        </button>
      </div>
    ) : (
      <div className="flex justify-end">
        <button onClick={onClose} className="qt-button qt-button-secondary">
          Cancel
        </button>
      </div>
    )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={footer}
      maxWidth="4xl"
      closeOnClickOutside={!linking}
      closeOnEscape={!linking}
    >
      {step === 'scope' && (
        <ScopePicker
          projects={projects}
          docStores={docStores}
          groupStores={groupStores}
          projectsLoading={projectsLoading}
          mountsLoading={mountsLoading}
          groupStoresLoading={groupStoresLoading}
          userPersonaName={userPersonaAlbum?.name ?? null}
          onPickGeneral={() => handleProjectScopeSelect(null, 'General')}
          onPickGallery={handleGalleryScopeSelect}
          onPickProject={handleProjectScopeSelect}
          onPickMount={handleMountScopeSelect}
        />
      )}

      {step === 'browse-project' && (
        <div className="min-h-[50vh] relative">
          {linking && <LinkingOverlay />}
          <FileBrowser
            projectId={selectedProjectId}
            onFileClick={handleFileClick}
            showUpload={false}
          />
        </div>
      )}

      {step === 'browse-mount' && selectedMount && (
        <div className="min-h-[50vh] relative">
          {linking && <LinkingOverlay />}
          <FileBrowser
            projectId={null}
            mountPoint={selectedMount}
            onFileClick={handleFileClick}
            showUpload={false}
          />
        </div>
      )}

      {step === 'browse-gallery' && (
        <GalleryPanel
          userPersona={userPersonaAlbum}
          onPick={handleGalleryPick}
          linking={linking}
        />
      )}
    </BaseModal>
  )
}

function ScopePicker({
  projects,
  docStores,
  groupStores,
  projectsLoading,
  mountsLoading,
  groupStoresLoading,
  userPersonaName,
  onPickGeneral,
  onPickGallery,
  onPickProject,
  onPickMount,
}: {
  projects: Project[]
  docStores: MountPointSummary[]
  groupStores: MountPointSummary[]
  projectsLoading: boolean
  mountsLoading: boolean
  groupStoresLoading: boolean
  userPersonaName: string | null
  onPickGeneral: () => void
  onPickGallery: () => void
  onPickProject: (id: string, name: string) => void
  onPickMount: (mount: MountPointSummary) => void
}) {
  const galleryTitle = userPersonaName ? `${userPersonaName}'s Photos` : 'My Gallery'
  const gallerySubtitle = userPersonaName
    ? `Photos saved to ${userPersonaName}'s vault`
    : "Photos you've saved from chats"
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <ScopeCard icon="📁" title="General" subtitle="Files not assigned to any project" onClick={onPickGeneral} />
        <ScopeCard icon="🖼️" title={galleryTitle} subtitle={gallerySubtitle} onClick={onPickGallery} />
      </section>

      {groupStores.length > 0 && (
        <section className="space-y-2">
          <h3 className="qt-text-label">Group Files</h3>
          {groupStores.map((store) => (
            <ScopeCard
              key={store.id}
              icon="👥"
              title={store.name}
              subtitle="Shared with your group"
              onClick={() => onPickMount(store)}
            />
          ))}
        </section>
      )}

      {groupStoresLoading && (
        <p className="qt-text-secondary py-2 text-center text-sm">Loading groups…</p>
      )}

      {projects.length > 0 && (
        <section className="space-y-2">
          <h3 className="qt-text-label">Projects</h3>
          {projects.map((project) => (
            <ScopeCard
              key={project.id}
              icon={project.icon || '📂'}
              title={project.name}
              onClick={() => onPickProject(project.id, project.name)}
            />
          ))}
        </section>
      )}

      {projectsLoading && (
        <p className="qt-text-secondary py-2 text-center text-sm">Loading projects…</p>
      )}

      {docStores.length > 0 && (
        <section className="space-y-2">
          <h3 className="qt-text-label">Document Stores</h3>
          {docStores.map((mount) => (
            <ScopeCard
              key={mount.id}
              icon="📚"
              title={mount.name}
              subtitle="Database-backed store"
              onClick={() => onPickMount(mount)}
            />
          ))}
        </section>
      )}

      {mountsLoading && (
        <p className="qt-text-secondary py-2 text-center text-sm">Loading document stores…</p>
      )}
    </div>
  )
}

function ScopeCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: string
  title: string
  subtitle?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="qt-card w-full text-left p-4 hover:bg-accent/50 transition-colors cursor-pointer flex items-center gap-3"
    >
      <span className="text-xl">{icon}</span>
      <div>
        <div className="font-medium text-foreground">{title}</div>
        {subtitle && <div className="qt-text-muted text-sm">{subtitle}</div>}
      </div>
    </button>
  )
}

function GalleryPanel({
  userPersona,
  onPick,
  linking,
}: {
  userPersona: PhotoAlbumOption | null
  onPick: (entry: GalleryEntry) => void
  linking: boolean
}) {
  // Same `photos/` folder Aurora's character page reads when a user persona is
  // set; falls back to the global Quilltap Uploads gallery otherwise. The URL is
  // built inside the queryFn from `userPersona`, which the key already encodes.
  const { data, isLoading, error } = useQuery({
    queryKey: userPersona?.characterId
      ? queryKeys.characters.photos(userPersona.characterId)
      : queryKeys.photos.list({ limit: 200 }),
    queryFn: ({ signal }) =>
      apiFetch<GalleryResponse>(
        userPersona?.characterId
          ? `/api/v1/characters/${userPersona.characterId}/photos?limit=200`
          : '/api/v1/photos?limit=200',
        { signal }
      ),
  })
  const entries = data?.entries ?? []

  if (isLoading) {
    return <p className="qt-text-secondary py-8 text-center">Loading your gallery…</p>
  }
  if (error) {
    return <p className="qt-text-destructive py-8 text-center">Couldn&rsquo;t load gallery: {String(error)}</p>
  }
  if (entries.length === 0) {
    return (
      <p className="qt-text-muted py-8 text-center text-sm">
        {userPersona
          ? `${userPersona.name}'s photo gallery is empty. Use Save Image on any chat message and pick ${userPersona.name} as the album to add photos here.`
          : 'Your gallery is empty. Save an image from any chat via "Save to my gallery" and it’ll appear here.'}
      </p>
    )
  }

  return (
    <div className="relative min-h-[50vh]">
      {linking && <LinkingOverlay />}
      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {entries.map((entry) => (
          <li key={entry.linkId}>
            <button
              type="button"
              onClick={() => onPick(entry)}
              disabled={linking}
              className="qt-card w-full text-left p-2 hover:bg-accent/50 transition-colors cursor-pointer disabled:opacity-50"
              title={entry.caption || entry.fileName}
            >
              <img
                src={entry.blobUrl}
                alt={entry.caption || entry.fileName}
                loading="lazy"
                className="w-full h-32 object-cover rounded"
              />
              <p className="qt-text-xs qt-text-muted mt-2 truncate">
                {entry.caption || entry.generationPromptExcerpt || entry.fileName}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LinkingOverlay() {
  return (
    <div className="absolute inset-0 bg-background/50 z-10 flex items-center justify-center">
      <p className="qt-text-secondary">Attaching…</p>
    </div>
  )
}
