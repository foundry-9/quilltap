/**
 * Restore must reconcile — and, for a compact archive, rebuild.
 *
 * `restore()` used to end after applying instance settings, with no reindex or
 * reconcile of any kind: a restored corpus was repaired only by the *next
 * boot's* sweep. Fine for restoring a backup onto the machine that made it;
 * wrong for `new-account` mode, and wrong for any instance whose default
 * embedding profile differs from the archive's — the vectors mean nothing
 * under a different standard and nothing noticed until a restart.
 *
 * A compact archive is the harder case: it carries no vectors at all, and the
 * reconcile deliberately ignores *absent* chunk rows (it repairs
 * non-conforming ones), so it alone would leave search quietly cold. That
 * archive gets an explicit full re-index, enqueued before the reconcile so the
 * reconcile's own dedup sees it rather than stacking a second job.
 */

import { restore } from '@/lib/backup/restore/restore'
import { parseBackupZip } from '@/lib/backup/restore/archive'
import { getUserRepositories } from '@/lib/repositories/user-scoped'
import { getRepositories } from '@/lib/repositories/factory'
import { reconcileEmbeddingDimensions } from '@/lib/startup/reconcile-embedding-dimensions'
import { enqueueEmbeddingReindexAll } from '@/lib/background-jobs/queue-service'
import { getDefaultEmbeddingProfile } from '@/lib/embedding/embedding-service'

jest.mock('@/lib/backup/restore/archive', () => ({
  parseBackupZip: jest.fn(),
  getFileFromExtractedBackup: jest.fn(),
  cleanupDir: jest.fn(),
}))

jest.mock('@/lib/backup/restore/delete-service', () => ({
  deleteUserData: jest.fn(),
}))

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { listUserFiles: jest.fn(), uploadFile: jest.fn() },
}))

jest.mock('@/lib/file-storage/user-uploads-bridge', () => ({
  writeUserUploadToMountStore: jest.fn(),
}))

jest.mock('@/lib/paths', () => ({
  getNpmPluginsDir: jest.fn(() => '/tmp/qt-test-plugins'),
  getThemesDir: jest.fn(() => '/tmp/qt-test-themes'),
}))

jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({
  isLLMLogsDegraded: jest.fn(() => true),
}))

jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  isMountIndexDegraded: jest.fn(() => true),
  getRawMountIndexDatabase: jest.fn(() => null),
}))

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
}))

jest.mock('@/lib/llm/connection-profile-names', () => ({
  normalizeProfileName: jest.fn((n: string) => n),
  makeUniqueProfileName: jest.fn((n: string) => n),
}))

jest.mock('@/lib/startup/reconcile-embedding-dimensions', () => ({
  reconcileEmbeddingDimensions: jest.fn(),
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueEmbeddingReindexAll: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  getDefaultEmbeddingProfile: jest.fn(),
}))

const mockedParseBackupZip = parseBackupZip as jest.MockedFunction<typeof parseBackupZip>
const mockedReconcile = reconcileEmbeddingDimensions as jest.MockedFunction<
  typeof reconcileEmbeddingDimensions
>

const EMPTY_COLLECTIONS = [
  'characters', 'tags', 'connectionProfiles', 'imageProfiles', 'embeddingProfiles',
  'files', 'promptTemplates', 'roleplayTemplates', 'providerModels', 'projects',
  'groups', 'llmLogs', 'pluginConfigs', 'folders', 'wardrobeItems',
  'characterPluginData', 'conversationAnnotations', 'chatDocuments',
  'instanceSettings', 'embeddingStatus', 'conversationChunks', 'tfidfVocabularies',
  'vectorIndexMetas', 'textReplacementRules', 'docMountPoints', 'docMountFiles',
  'docMountDocuments', 'docMountChunks', 'docMountFileLinks', 'docMountFolders',
  'docMountBlobs', 'projectDocMountLinks', 'groupDocMountLinks',
  'groupCharacterMembers', 'vectorEntries',
] as const

function makeBackupData(manifest: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    manifest,
    chats: [],
    memories: [],
    chatSettings: [],
  }
  for (const key of EMPTY_COLLECTIONS) base[key] = []
  return base
}

/** A repo stand-in whose every accessed method is an auto-created jest.fn. */
function repoStub() {
  const cache = new Map<string, unknown>()
  return new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (!cache.has(prop)) cache.set(prop, jest.fn().mockResolvedValue([]))
      return cache.get(prop)
    },
  })
}

const CLEAN_RECONCILE = {
  targetDimensions: 1536,
  skippedReason: null,
  vectorEntriesDeleted: 0,
  vectorIndexMetaFixed: 0,
  staleChunkEmbeddingsCleared: 0,
  mismatched: { memories: 0, conversationChunks: 0, helpDocs: 0, mountChunks: 0 },
  reindexEnqueued: false,
}

function primeArchive(manifest: Record<string, unknown>) {
  mockedParseBackupZip.mockResolvedValue({
    data: makeBackupData(manifest) as never,
    extractDir: '/tmp/qt-test-extract',
    rootFolder: '',
  })
}

describe('restore — post-restore embedding repair', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getUserRepositories as jest.Mock).mockReturnValue(
      new Proxy({} as Record<string, unknown>, { get: () => repoStub() }) as never
    )
    ;(getRepositories as jest.Mock).mockReturnValue(
      new Proxy({} as Record<string, unknown>, { get: () => repoStub() }) as never
    )
    mockedReconcile.mockResolvedValue(CLEAN_RECONCILE as never)
    ;(getDefaultEmbeddingProfile as jest.Mock).mockResolvedValue({ id: 'profile-1' })
  })

  it('runs the reconcile exactly once and records the result in the summary', async () => {
    primeArchive({ backupFormat: 4 })

    const summary = await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(mockedReconcile).toHaveBeenCalledTimes(1)
    expect(summary.embeddingReconcile).toEqual({
      targetDimensions: 1536,
      skippedReason: null,
      vectorEntriesDeleted: 0,
      vectorIndexMetaFixed: 0,
      reindexEnqueued: false,
    })
    // A clean pass is silent — no warning noise for the ordinary case.
    expect(summary.warnings.some((w) => w.includes('Embedding reconcile'))).toBe(false)
  })

  it('warns when the reconcile could not run', async () => {
    primeArchive({ backupFormat: 4 })
    mockedReconcile.mockResolvedValue({
      ...CLEAN_RECONCILE,
      targetDimensions: null,
      skippedReason: 'no-profile',
    } as never)

    const summary = await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(summary.embeddingReconcile?.skippedReason).toBe('no-profile')
    expect(summary.warnings.some((w) => w.includes('no-profile'))).toBe(true)
  })

  it('warns when the reconcile had to queue a repair', async () => {
    primeArchive({ backupFormat: 4 })
    mockedReconcile.mockResolvedValue({ ...CLEAN_RECONCILE, reindexEnqueued: true } as never)

    const summary = await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(summary.warnings.some((w) => w.includes('re-indexing has been queued'))).toBe(true)
  })

  it('does not queue a full re-index for an ordinary archive', async () => {
    primeArchive({ backupFormat: 4 })

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(enqueueEmbeddingReindexAll).not.toHaveBeenCalled()
  })

  it('queues one full re-index for a compact archive, before the reconcile', async () => {
    primeArchive({ backupFormat: 4, compact: true })

    const summary = await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(enqueueEmbeddingReindexAll).toHaveBeenCalledTimes(1)
    expect(enqueueEmbeddingReindexAll).toHaveBeenCalledWith('user-1', {
      profileId: 'profile-1',
      scope: 'all',
    })
    // Ordering matters: the reconcile dedupes against pending reindex jobs, so
    // enqueueing first is what stops it stacking a second one.
    const enqueueOrder = (enqueueEmbeddingReindexAll as jest.Mock).mock.invocationCallOrder[0]
    const reconcileOrder = mockedReconcile.mock.invocationCallOrder[0]
    expect(enqueueOrder).toBeLessThan(reconcileOrder)

    expect(summary.warnings.some((w) => w.includes('compact backup'))).toBe(true)
  })

  it('says so plainly when a compact archive lands with no embedding profile', async () => {
    primeArchive({ backupFormat: 4, compact: true })
    ;(getDefaultEmbeddingProfile as jest.Mock).mockResolvedValue(null)

    const summary = await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(enqueueEmbeddingReindexAll).not.toHaveBeenCalled()
    expect(summary.warnings.some((w) => w.includes('no default embedding profile'))).toBe(true)
  })
})
