'use client'

/**
 * DocumentPickerModal - Source selection and file browser for Document Mode
 *
 * Two-step modal:
 * Step 1: Select source (new blank document, project library, mounted stores)
 * Step 2: Browse files within the selected scope
 *
 * Scriptorium Phase 3.5
 *
 * @module app/salon/[id]/components/DocumentPickerModal
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Icon } from '@/components/ui/icon'
import { BaseModal } from '@/components/ui/BaseModal'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import FileBrowser, { type FileInfo } from '@/components/files/FileBrowser'
import { formatBytes } from '@/lib/utils/format-bytes'
import { MAX_RECENT_DOCUMENTS } from '@/lib/chat-documents/constants'

interface DocumentPickerModalProps {
  isOpen: boolean
  onClose: () => void
  /**
   * The chat whose reach scopes the picker. `null` = the standalone (chat-less)
   * surface: stores and recents come from `/api/v1/documents`, every enabled
   * store is shown (there is no narrower reach to default to), and the
   * project-library shortcut is unavailable.
   */
  chatId: string | null
  projectId?: string | null
  projectName?: string | null
  onSelectDocument: (params: {
    filePath?: string
    title?: string
    scope?: 'project' | 'document_store' | 'general'
    mountPoint?: string
    /** For new blank docs (no filePath), the folder to create inside. */
    targetFolder?: string
  }) => void
}

interface MountPoint {
  id: string
  name: string
  type: string
}

/**
 * A document store reachable from this chat, as returned by
 * `?action=accessible-stores`. `name` is the canonical mount name (used to
 * open documents — `document_store` paths resolve by name); `label` is the
 * display text (a character's name for vaults).
 */
interface AccessibleStore {
  mountPointId: string
  name: string
  label: string
  kind: 'character' | 'document-store'
  mountType: 'filesystem' | 'obsidian' | 'database'
  storeType: 'documents' | 'character'
  characterId?: string
  /** True when reached via a group membership — bucketed into "Group Files". */
  isGroupStore?: boolean
}

/** The project's official document store, when provisioned (see server). */
interface ProjectLibraryTarget {
  mountPointId: string
  name: string
  mountType: 'filesystem' | 'obsidian' | 'database'
}

interface MountPointFile {
  id: string
  relativePath: string
  size?: number
  mimeType?: string
  updatedAt?: string
}

interface RecentDocument {
  id: string
  filePath: string
  scope: 'project' | 'document_store' | 'general'
  mountPoint?: string | null
  displayTitle?: string | null
  isActive?: boolean
  /** True when this recent doc was last opened in the current chat. */
  fromCurrentChat?: boolean
  updatedAt: string
}

export default function DocumentPickerModal({
  isOpen,
  onClose,
  chatId,
  projectId,
  projectName,
  onSelectDocument,
}: Readonly<DocumentPickerModalProps>) {
  const [step, setStep] = useState<'source' | 'browse'>('source')
  const [selectedScope, setSelectedScope] = useState<'project' | 'document_store' | 'general'>('project')
  const [selectedMountPoint, setSelectedMountPoint] = useState<MountPoint | null>(null)
  const [accessibleStores, setAccessibleStores] = useState<AccessibleStore[]>([])
  // The project's official document store, when one is provisioned. When set,
  // the "Project library" button browses/opens this mount (so browse and open
  // agree); when null it falls back to the legacy `project` filesystem scope.
  const [projectLibrary, setProjectLibrary] = useState<ProjectLibraryTarget | null>(null)
  const [mountPointFiles, setMountPointFiles] = useState<MountPointFile[]>([])
  // Folder rows from the server (populated for database-backed mounts) so
  // empty folders show up too. Filesystem mounts don't currently track
  // folder rows, so this stays empty for them.
  const [mountPointFolders, setMountPointFolders] = useState<string[]>([])
  const [mountPointFilesLoading, setMountPointFilesLoading] = useState(false)
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>([])
  const [loading, setLoading] = useState(false)
  // "Look everywhere" widens the store accordions beyond this chat's reach to
  // every enabled store (character vaults of all characters, all doc stores).
  const [lookEverywhere, setLookEverywhere] = useState(false)
  // Current folder path for mount point tree navigation (empty string = root)
  const [currentFolder, setCurrentFolder] = useState('')
  // Folders created during this session — surfaced in the listing even if
  // they're empty and so wouldn't be derived from the indexed file paths.
  const [createdFolders, setCreatedFolders] = useState<Set<string>>(new Set())
  // Inline "new folder" form state
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderError, setNewFolderError] = useState<string | null>(null)

  const fetchAccessibleStores = async (all: boolean) => {
    try {
      setLoading(true)
      const res = await fetch(chatId
        ? `/api/v1/chats/${chatId}?action=accessible-stores${all ? '&all=true' : ''}`
        : '/api/v1/documents?action=accessible-stores')
      if (res.ok) {
        const data = await res.json()
        setAccessibleStores(data.stores || [])
        setProjectLibrary(data.projectLibrary ?? null)
      }
    } catch (error) {
      console.error('[DocumentPickerModal] Failed to fetch accessible stores', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchRecentDocuments = async () => {
    try {
      const url = chatId
        ? `/api/v1/chats/${chatId}?action=recent-documents`
        : '/api/v1/documents?action=recent-documents'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        setRecentDocuments(data.documents || [])
      }
    } catch (error) {
      console.error('[DocumentPickerModal] Failed to fetch recent documents', error)
    }
  }

  // Recent documents — fetched when the modal opens.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch when modal opens; parent renders unconditionally
      fetchRecentDocuments()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch function is stable
  }, [isOpen])

  // Accessible stores — refetched when the modal opens or the "look everywhere"
  // scope toggles.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch; parent renders unconditionally
      fetchAccessibleStores(lookEverywhere)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch function is stable
  }, [isOpen, lookEverywhere])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset on close; parent renders unconditionally
      setStep('source')
      setSelectedScope('project')
      setSelectedMountPoint(null)
      setMountPointFiles([])
      setMountPointFolders([])
      setCurrentFolder('')
      setCreatedFolders(new Set())
      setShowNewFolderInput(false)
      setNewFolderName('')
      setNewFolderError(null)
      setCreatingFolder(false)
      setLookEverywhere(false)
      setProjectLibrary(null)
    }
  }, [isOpen])

  const fetchMountPointFiles = async (mp: MountPoint) => {
    try {
      setMountPointFilesLoading(true)
      const res = await fetch(`/api/v1/mount-points/${mp.id}/files`)
      if (res.ok) {
        const data = await res.json()
        setMountPointFiles(data.files || [])
        setMountPointFolders(Array.isArray(data.folders) ? data.folders : [])
        setCurrentFolder('')
      }
    } catch (error) {
      console.error('[DocumentPickerModal] Failed to fetch mount point files', error)
    } finally {
      setMountPointFilesLoading(false)
    }
  }

  const handleNewBlank = useCallback(() => {
    onSelectDocument({})
    onClose()
  }, [onSelectDocument, onClose])

  const handleReopenDocument = useCallback((doc: RecentDocument) => {
    onSelectDocument({
      filePath: doc.filePath,
      scope: doc.scope,
      mountPoint: doc.mountPoint || undefined,
    })
    onClose()
  }, [onSelectDocument, onClose])

  const handleSelectScope = useCallback((scope: 'project' | 'document_store' | 'general', mp?: MountPoint) => {
    setSelectedScope(scope)
    setSelectedMountPoint(mp || null)
    setStep('browse')

    // Fetch files for document stores
    if (scope === 'document_store' && mp) {
      fetchMountPointFiles(mp)
    }
  }, [])

  const handleFileSelect = useCallback((file: FileInfo) => {
    onSelectDocument({
      filePath: file.filepath || file.filename,
      scope: selectedScope,
      mountPoint: selectedMountPoint?.name || undefined,
    })
    onClose()
  }, [onSelectDocument, selectedScope, selectedMountPoint, onClose])

  const handleMountPointFileSelect = useCallback((file: MountPointFile) => {
    onSelectDocument({
      filePath: file.relativePath,
      scope: 'document_store',
      mountPoint: selectedMountPoint?.name || undefined,
    })
    onClose()
  }, [onSelectDocument, selectedMountPoint, onClose])

  // Create a brand-new "Untitled Document.md" inside the currently-browsed
  // folder of the selected mount point. The server picks the actual filename
  // (with collision numbering); we just hand it the scope and target folder.
  const handleNewBlankInFolder = useCallback(() => {
    if (!selectedMountPoint) return
    onSelectDocument({
      scope: 'document_store',
      mountPoint: selectedMountPoint.name,
      targetFolder: currentFolder || undefined,
    })
    onClose()
  }, [onSelectDocument, selectedMountPoint, currentFolder, onClose])

  const handleBack = useCallback(() => {
    setStep('source')
    setMountPointFiles([])
  }, [])

  // Compute folders and files at the current folder level for mount point tree view
  const mountPointEntries = useMemo(() => {
    const prefix = currentFolder ? currentFolder + '/' : ''
    const folderSet = new Set<string>()
    const filesAtLevel: MountPointFile[] = []

    for (const file of mountPointFiles) {
      if (!file.relativePath.startsWith(prefix)) continue

      const remainder = file.relativePath.substring(prefix.length)
      const slashIndex = remainder.indexOf('/')

      if (slashIndex === -1) {
        // File at this level
        filesAtLevel.push(file)
      } else {
        // Subfolder
        folderSet.add(remainder.substring(0, slashIndex))
      }
    }

    // Merge server-known folder rows (database-backed mounts) so empty
    // folders are visible even though no file path implies them.
    for (const fullPath of mountPointFolders) {
      const lastSlash = fullPath.lastIndexOf('/')
      const parent = lastSlash === -1 ? '' : fullPath.substring(0, lastSlash)
      const name = lastSlash === -1 ? fullPath : fullPath.substring(lastSlash + 1)
      if (parent === currentFolder && name) {
        folderSet.add(name)
      }
    }

    // Merge folders created in this session that aren't yet reflected in
    // the fetched lists (e.g. created on a filesystem mount).
    for (const fullPath of createdFolders) {
      const lastSlash = fullPath.lastIndexOf('/')
      const parent = lastSlash === -1 ? '' : fullPath.substring(0, lastSlash)
      const name = lastSlash === -1 ? fullPath : fullPath.substring(lastSlash + 1)
      if (parent === currentFolder && name) {
        folderSet.add(name)
      }
    }

    const folders = Array.from(folderSet).sort((a, b) => a.localeCompare(b))
    filesAtLevel.sort((a, b) => {
      const nameA = a.relativePath.split('/').pop() || ''
      const nameB = b.relativePath.split('/').pop() || ''
      return nameA.localeCompare(nameB)
    })

    return { folders, files: filesAtLevel }
  }, [mountPointFiles, mountPointFolders, currentFolder, createdFolders])

  const handleNavigateFolder = useCallback((folderName: string) => {
    setCurrentFolder(prev => prev ? `${prev}/${folderName}` : folderName)
    setShowNewFolderInput(false)
    setNewFolderName('')
    setNewFolderError(null)
  }, [])

  const handleNavigateUp = useCallback(() => {
    setCurrentFolder(prev => {
      const lastSlash = prev.lastIndexOf('/')
      return lastSlash === -1 ? '' : prev.substring(0, lastSlash)
    })
    setShowNewFolderInput(false)
    setNewFolderName('')
    setNewFolderError(null)
  }, [])

  const handleStartNewFolder = useCallback(() => {
    setNewFolderName('')
    setNewFolderError(null)
    setShowNewFolderInput(true)
  }, [])

  const handleCancelNewFolder = useCallback(() => {
    setShowNewFolderInput(false)
    setNewFolderName('')
    setNewFolderError(null)
  }, [])

  const handleSubmitNewFolder = useCallback(async () => {
    if (!selectedMountPoint) return
    const name = newFolderName.trim()
    if (!name) {
      setNewFolderError('Enter a folder name.')
      return
    }
    if (/[\/\\<>:"|?*\x00-\x1f]/.test(name) || name === '.' || name === '..') {
      setNewFolderError('That name has characters folders cannot contain.')
      return
    }
    const fullPath = currentFolder ? `${currentFolder}/${name}` : name
    if (createdFolders.has(fullPath)) {
      setNewFolderError('A folder by that name already exists here.')
      return
    }
    // Avoid colliding with a folder we already see in the listing
    if (mountPointEntries.folders.includes(name)) {
      setNewFolderError('A folder by that name already exists here.')
      return
    }
    try {
      setCreatingFolder(true)
      setNewFolderError(null)
      const res = await fetch(`/api/v1/mount-points/${selectedMountPoint.id}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fullPath }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const message = typeof data?.error === 'string' ? data.error : 'Could not create folder.'
        setNewFolderError(message)
        return
      }
      setCreatedFolders(prev => {
        const next = new Set(prev)
        next.add(fullPath)
        return next
      })
      setShowNewFolderInput(false)
      setNewFolderName('')
    } catch (error) {
      console.error('[DocumentPickerModal] Failed to create folder', error)
      setNewFolderError('Could not create folder.')
    } finally {
      setCreatingFolder(false)
    }
  }, [selectedMountPoint, newFolderName, currentFolder, createdFolders, mountPointEntries.folders])

  // Breadcrumb segments for current folder path
  const folderBreadcrumbs = useMemo(() => {
    if (!currentFolder) return []
    return currentFolder.split('/')
  }, [currentFolder])

  // On the standalone (chat-less) surface everything is already "everywhere":
  // the toggle disappears and the accordion descriptions read accordingly.
  const everywhere = chatId === null || lookEverywhere

  // Bucket the chat-accessible stores for the right-column accordions. Group
  // stores get their own bucket and are held out of the generic Database-/
  // Filesystem-backed buckets so each store appears exactly once.
  const storeBuckets = useMemo(() => ({
    characterVaults: accessibleStores.filter(s => s.storeType === 'character'),
    groupStores: accessibleStores.filter(s => s.isGroupStore),
    databaseStores: accessibleStores.filter(s => s.storeType === 'documents' && s.mountType === 'database' && !s.isGroupStore),
    filesystemStores: accessibleStores.filter(s => s.storeType === 'documents' && s.mountType !== 'database' && !s.isGroupStore),
  }), [accessibleStores])

  // Clicking a store row drills into its file browser (Step 2). We pass the
  // canonical mount name so document opens resolve correctly.
  const renderStoreRow = useCallback((store: AccessibleStore) => (
    <button
      key={store.mountPointId}
      onClick={() => handleSelectScope('document_store', { id: store.mountPointId, name: store.name, type: store.mountType })}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:qt-bg-hover transition-colors text-left"
    >
      <Icon name="file" className="w-4 h-4 flex-shrink-0 qt-text-secondary" />
      <div className="flex-1 min-w-0">
        <div className="text-sm qt-text-primary font-medium truncate" title={store.label}>{store.label}</div>
      </div>
      <Icon name="chevron-right" className="w-3 h-3 flex-shrink-0 qt-text-muted" />
    </button>
  ), [handleSelectScope])

  const renderEmptyBucket = () => (
    <div className="px-3 py-2 text-sm qt-text-muted">None available here.</div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={step === 'source' ? 'Open Document' : 'Select File'}
      maxWidth={step === 'source' ? '4xl' : 'lg'}
    >
      {step === 'source' ? (
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-start">
          {/* Left column: defaults + recent files */}
          <div className="space-y-3 md:w-72 md:flex-shrink-0">
            {/* New blank document */}
            <button
              onClick={handleNewBlank}
              className="w-full flex items-center gap-3 p-4 rounded-lg border border-dashed qt-border hover:qt-bg-hover transition-colors text-left"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted">
                <Icon name="plus" className="w-5 h-5 qt-text-secondary" />
              </div>
              <div>
                <div className="font-medium qt-text-primary">New blank document</div>
                <div className="text-sm qt-text-secondary">Create an empty Markdown document</div>
              </div>
            </button>

            {/* Project library (if chat has a project). When the project has an
                official document store, browse/open that mount directly so the
                two agree; otherwise fall back to the legacy `project` scope. */}
            {projectId && (
              <button
                onClick={() => projectLibrary
                  ? handleSelectScope('document_store', { id: projectLibrary.mountPointId, name: projectLibrary.name, type: projectLibrary.mountType })
                  : handleSelectScope('project')}
                className="w-full flex items-center gap-3 p-4 rounded-lg border qt-border hover:qt-bg-hover transition-colors text-left"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted">
                  <Icon name="folder" className="w-5 h-5 qt-text-secondary" />
                </div>
                <div>
                  <div className="font-medium qt-text-primary">Project library</div>
                  <div className="text-sm qt-text-secondary">{projectName || 'Current project'} files</div>
                </div>
              </button>
            )}

            {/* General library */}
            <button
              onClick={() => handleSelectScope('general')}
              className="w-full flex items-center gap-3 p-4 rounded-lg border qt-border hover:qt-bg-hover transition-colors text-left"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted">
                <Icon name="scriptorium" className="w-5 h-5 qt-text-secondary" />
              </div>
              <div>
                <div className="font-medium qt-text-primary">General library</div>
                <div className="text-sm qt-text-secondary">All non-project files</div>
              </div>
            </button>

            {/* Recent documents — quick reopen (this chat first, then others) */}
            <CollapsibleCard
              key={`recent-${recentDocuments.length > 0}`}
              title="Recent"
              description="Documents you've lately had open"
              defaultOpen={recentDocuments.length > 0}
              icon={<Icon name="clock" className="w-5 h-5" />}
            >
              <div className="space-y-1">
                {recentDocuments.length === 0 && (
                  <div className="px-3 py-2 text-sm qt-text-muted">No recent documents yet.</div>
                )}
                {recentDocuments.slice(0, MAX_RECENT_DOCUMENTS).map((doc) => {
                  const scopeLabel = doc.scope === 'document_store' && doc.mountPoint
                    ? doc.mountPoint
                    : doc.scope === 'project'
                    ? 'Project'
                    : 'General'
                  const actionLabel = doc.isActive ? 'Continue editing' : 'Reopen'
                  return (
                    <button
                      key={doc.id}
                      onClick={() => handleReopenDocument(doc)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border qt-border hover:qt-bg-hover transition-colors text-left"
                    >
                      {doc.isActive
                        ? <Icon name="file" className="w-5 h-5 flex-shrink-0 qt-text-secondary" />
                        : <Icon name="clock" className="w-5 h-5 flex-shrink-0 qt-text-secondary" />
                      }
                      <div className="flex-1 min-w-0">
                        <div className="font-medium qt-text-primary truncate">
                          {doc.displayTitle || doc.filePath}
                        </div>
                        <div className="text-xs qt-text-secondary">{actionLabel} &middot; {scopeLabel}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </CollapsibleCard>
          </div>

          {/* Right column: document stores, grouped by kind */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Look-everywhere toggle — widens the accordions beyond this chat.
                Absent on the standalone surface, which is always everywhere. */}
            {chatId !== null && (
              <label className="flex items-start gap-3 px-1 pb-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lookEverywhere}
                  onChange={(e) => setLookEverywhere(e.target.checked)}
                  className="qt-checkbox mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium qt-text-primary">Look everywhere</span>
                  <span className="block text-xs qt-text-secondary">Show every store, not just the ones reachable from this chat</span>
                </span>
              </label>
            )}

            <CollapsibleCard
              key={`vaults-${everywhere}-${storeBuckets.characterVaults.length > 0}`}
              title="Character Vaults"
              description={everywhere ? 'Every character vault' : 'Vaults of characters in this chat'}
              defaultOpen={storeBuckets.characterVaults.length > 0}
              icon={<Icon name="characters" className="w-5 h-5" />}
            >
              <div className="space-y-0.5">
                {storeBuckets.characterVaults.length > 0
                  ? storeBuckets.characterVaults.map(renderStoreRow)
                  : renderEmptyBucket()}
              </div>
            </CollapsibleCard>

            {storeBuckets.groupStores.length > 0 && (
              <CollapsibleCard
                key={`group-${everywhere}-${storeBuckets.groupStores.length > 0}`}
                title="Group Files"
                description="Stores shared with characters' groups"
                defaultOpen={storeBuckets.groupStores.length > 0}
                icon={<Icon name="users" className="w-5 h-5" />}
              >
                <div className="space-y-0.5">
                  {storeBuckets.groupStores.map(renderStoreRow)}
                </div>
              </CollapsibleCard>
            )}

            <CollapsibleCard
              key={`db-${everywhere}-${storeBuckets.databaseStores.length > 0}`}
              title="Database-backed document stores"
              description={everywhere ? 'Every store kept inside Quilltap' : 'Project stores kept inside Quilltap'}
              defaultOpen={storeBuckets.databaseStores.length > 0}
              icon={<Icon name="database" className="w-5 h-5" />}
            >
              <div className="space-y-0.5">
                {storeBuckets.databaseStores.length > 0
                  ? storeBuckets.databaseStores.map(renderStoreRow)
                  : renderEmptyBucket()}
              </div>
            </CollapsibleCard>

            <CollapsibleCard
              key={`fs-${everywhere}-${storeBuckets.filesystemStores.length > 0}`}
              title="Filesystem-backed document stores"
              description={everywhere ? 'Every store backed by folders on disk' : 'Project stores backed by folders on disk'}
              defaultOpen={storeBuckets.filesystemStores.length > 0}
              icon={<Icon name="folder" className="w-5 h-5" />}
            >
              <div className="space-y-0.5">
                {storeBuckets.filesystemStores.length > 0
                  ? storeBuckets.filesystemStores.map(renderStoreRow)
                  : renderEmptyBucket()}
              </div>
            </CollapsibleCard>

            {loading && (
              <div className="text-center py-2 qt-text-muted text-sm">Loading stores…</div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col" style={{ height: '60vh' }}>
          {/* Back button and scope label */}
          <div className="flex items-center gap-2 px-4 py-2 border-b qt-border">
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-sm qt-text-secondary hover:qt-text-primary transition-colors"
            >
              <Icon name="arrow-left" className="w-4 h-4" />
              Back
            </button>
            <span className="text-sm qt-text-muted">
              {selectedScope === 'project' ? projectName || 'Project' :
               selectedScope === 'general' ? 'General Library' :
               selectedMountPoint?.name || 'Document Store'}
            </span>
          </div>

          {/* File browser — different component per scope */}
          <div className="flex-1 overflow-y-auto">
            {selectedScope === 'document_store' ? (
              /* Mount point folder tree */
              <div className="p-2">
                {mountPointFilesLoading ? (
                  <div className="text-center py-8 qt-text-muted text-sm">Loading files...</div>
                ) : (
                  <div className="space-y-0.5">
                    {/* Breadcrumb path */}
                    {currentFolder && (
                      <div className="flex items-center gap-1 px-3 py-1.5 mb-1 text-xs qt-text-muted">
                        <button
                          onClick={() => setCurrentFolder('')}
                          className="hover:qt-text-primary transition-colors"
                        >
                          {selectedMountPoint?.name || 'Root'}
                        </button>
                        {folderBreadcrumbs.map((segment, idx) => (
                          <span key={idx} className="flex items-center gap-1">
                            <span>/</span>
                            <button
                              onClick={() => setCurrentFolder(folderBreadcrumbs.slice(0, idx + 1).join('/'))}
                              className={idx === folderBreadcrumbs.length - 1 ? 'qt-text-primary font-medium' : 'hover:qt-text-primary transition-colors'}
                            >
                              {segment}
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Up navigation */}
                    {currentFolder && (
                      <button
                        onClick={handleNavigateUp}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:qt-bg-hover transition-colors text-left"
                      >
                        <Icon name="arrow-left" className="w-4 h-4 flex-shrink-0 qt-text-secondary" />
                        <span className="text-sm qt-text-secondary">..</span>
                      </button>
                    )}

                    {/* New document here — creates "Untitled Document.md" in
                        the currently-browsed folder. The server handles
                        collision-safe naming so the user can pick the spot
                        and rename later. */}
                    <button
                      onClick={handleNewBlankInFolder}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:qt-bg-hover transition-colors text-left"
                    >
                      <Icon name="file-plus" className="w-4 h-4 flex-shrink-0 qt-text-secondary" />
                      <span className="text-sm qt-text-secondary">New document here</span>
                    </button>

                    {/* New folder control */}
                    {showNewFolderInput ? (
                      <div className="flex flex-col gap-1 px-3 py-2 rounded-md qt-bg-hover">
                        <div className="flex items-center gap-2">
                          <Icon name="folder-plus" className="w-4 h-4 flex-shrink-0 qt-text-secondary" />
                          <input
                            type="text"
                            autoFocus
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void handleSubmitNewFolder()
                              } else if (e.key === 'Escape') {
                                e.preventDefault()
                                handleCancelNewFolder()
                              }
                            }}
                            placeholder="New folder name"
                            disabled={creatingFolder}
                            className="flex-1 min-w-0 text-sm qt-input px-2 py-1 rounded"
                          />
                          <button
                            onClick={() => void handleSubmitNewFolder()}
                            disabled={creatingFolder || newFolderName.trim().length === 0}
                            className="text-sm qt-button-primary px-2 py-1 rounded disabled:opacity-50"
                          >
                            {creatingFolder ? 'Creating…' : 'Create'}
                          </button>
                          <button
                            onClick={handleCancelNewFolder}
                            disabled={creatingFolder}
                            className="text-sm qt-text-secondary hover:qt-text-primary px-2 py-1"
                          >
                            Cancel
                          </button>
                        </div>
                        {newFolderError && (
                          <div className="text-xs qt-text-destructive pl-6">{newFolderError}</div>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={handleStartNewFolder}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:qt-bg-hover transition-colors text-left"
                      >
                        <Icon name="folder-plus" className="w-4 h-4 flex-shrink-0 qt-text-secondary" />
                        <span className="text-sm qt-text-secondary">New folder</span>
                      </button>
                    )}

                    {/* Folders */}
                    {mountPointEntries.folders.map((folder) => (
                      <button
                        key={`folder-${folder}`}
                        onClick={() => handleNavigateFolder(folder)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:qt-bg-hover transition-colors text-left"
                      >
                        <Icon name="folder" className="w-4 h-4 flex-shrink-0 qt-text-secondary" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm qt-text-primary font-medium truncate">{folder}</div>
                        </div>
                        <Icon name="chevron-right" className="w-3 h-3 flex-shrink-0 qt-text-muted" />
                      </button>
                    ))}

                    {/* Files */}
                    {mountPointEntries.files.map((file) => {
                      const fileName = file.relativePath.split('/').pop() || file.relativePath
                      return (
                        <button
                          key={file.id}
                          onClick={() => handleMountPointFileSelect(file)}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:qt-bg-hover transition-colors text-left"
                        >
                          <Icon name="file" className="w-4 h-4 flex-shrink-0 qt-text-secondary" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm qt-text-primary truncate" title={file.relativePath}>
                              {fileName}
                            </div>
                          </div>
                          {file.size != null && (
                            <span className="text-xs qt-text-muted flex-shrink-0">
                              {file.size != null ? formatBytes(file.size) : ''}
                            </span>
                          )}
                        </button>
                      )
                    })}

                    {/* Empty folder */}
                    {mountPointEntries.folders.length === 0 && mountPointEntries.files.length === 0 && (
                      <div className="text-center py-4 qt-text-muted text-sm">This folder is empty.</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Project or general library — use FileBrowser */
              <FileBrowser
                projectId={selectedScope === 'project' ? (projectId || null) : null}
                onFileClick={handleFileSelect}
                showUpload={false}
              />
            )}
          </div>
        </div>
      )}
    </BaseModal>
  )
}
