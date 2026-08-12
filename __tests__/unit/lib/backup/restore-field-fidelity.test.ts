/**
 * Field-fidelity guard for backup restore.
 *
 * Backup/restore is schema-driven: `ensureCollection` derives a table's JSON /
 * array / boolean columns straight from its Zod schema, and restore re-inserts
 * entities by spreading whatever the archive held. That means a field added to
 * a Zod schema rides along for free — but it also means a stray destructure in
 * `restore()` can silently drop a column with nothing to catch it.
 *
 * These tests pin the data-model additions of the 4.8 cycle end-to-end, and
 * assert the id-preservation contract that keeps cross-entity references
 * (notably the Commonplace Book's `relatedMemoryIds` graph) intact.
 */

import { restore } from '@/lib/backup/restore/restore';
import { parseBackupZip } from '@/lib/backup/restore/archive';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';

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

const mockedParseBackupZip = parseBackupZip as jest.MockedFunction<typeof parseBackupZip>
const mockedGetUserRepositories = getUserRepositories as jest.MockedFunction<typeof getUserRepositories>
const mockedGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

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

function makeBackupData(overrides: Record<string, unknown>) {
  const base: Record<string, unknown> = { manifest: { backupFormat: 3 }, chats: [], memories: [], chatSettings: [] }
  for (const key of EMPTY_COLLECTIONS) base[key] = []
  return { ...base, ...overrides }
}

/** Every column added to chats/chat_messages/chat_settings/memories in 4.8. */
const NEW_CHAT_FIELDS = {
  answerConfirmationOverride: 'ON',
  commonplaceRecallHistory: { turns: [['mem-1']] },
  timelineMode: 'narrative',
  turnSkippingEnabled: true,
}

const NEW_MESSAGE_FIELDS = {
  confirmed: true,
  confirmationChecked: true,
  confirmationRevised: false,
  confirmationNotes: 'checked against the ledger',
  confirmationOriginalContent: 'the original phrasing',
  pascalMeta: { toolName: 'dice', outcome: 'success', roll: 17 },
}

const NEW_MEMORY_FIELDS = {
  occurredAt: '2026-07-21T10:00:00.000Z',
  narrativeTime: 'the second evening',
  entities: ['Lorian', 'the conservatory'],
  kind: 'episodic',
}

const NEW_CHAT_SETTINGS_FIELDS = {
  customTools: false,
  answerConfirmationSettings: { enabled: true, model: 'some-model' },
}

/**
 * A repo stand-in whose every accessed method is an auto-created jest.fn.
 * `restore()` touches a long tail of repositories we don't care about here;
 * this keeps the test focused on the four that carry the new columns.
 */
function repoStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>()
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (!cache.has(prop)) cache.set(prop, jest.fn().mockResolvedValue([]))
      return cache.get(prop)
    },
  })
}

function buildRepoMocks() {
  const chatsCreate = jest.fn().mockImplementation((data: Record<string, unknown>, opts?: { id?: string }) =>
    Promise.resolve({ ...data, id: opts?.id ?? 'generated-chat-id' })
  )
  const addMessage = jest.fn().mockResolvedValue(undefined)
  const memoriesCreate = jest.fn().mockImplementation((data: Record<string, unknown>, opts?: { id?: string }) =>
    Promise.resolve({ ...data, id: opts?.id ?? 'generated-memory-id' })
  )
  const chatSettingsCreate = jest.fn().mockResolvedValue({})

  const userRepos = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'chats') return repoStub({ create: chatsCreate, addMessage })
      if (prop === 'memories') return repoStub({ create: memoriesCreate })
      return repoStub()
    },
  })

  const globalRepos = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'chatSettings') return repoStub({ create: chatSettingsCreate })
      return repoStub()
    },
  })

  mockedGetUserRepositories.mockReturnValue(userRepos as never)
  mockedGetRepositories.mockReturnValue(globalRepos as never)

  return { chatsCreate, addMessage, memoriesCreate, chatSettingsCreate }
}

function primeArchive(data: Record<string, unknown>) {
  mockedParseBackupZip.mockResolvedValue({
    data: data as never,
    extractDir: '/tmp/qt-test-extract',
    rootFolder: '',
  })
}

describe('restore field fidelity — 4.8 data-model additions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('carries every new chats and chat_messages column through restore', async () => {
    const { chatsCreate, addMessage } = buildRepoMocks()
    primeArchive(
      makeBackupData({
        chats: [
          {
            id: 'chat-1',
            userId: 'old-user',
            title: 'A Conversation',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            participants: [],
            tags: [],
            ...NEW_CHAT_FIELDS,
            messages: [
              { id: 'msg-1', type: 'message', role: 'assistant', content: 'hello', ...NEW_MESSAGE_FIELDS },
            ],
          },
        ],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(chatsCreate).toHaveBeenCalledTimes(1)
    expect(chatsCreate.mock.calls[0][0]).toMatchObject(NEW_CHAT_FIELDS)
    // The chat id must survive so messages/memories keep pointing at it.
    expect(chatsCreate.mock.calls[0][1]).toEqual({ id: 'chat-1' })

    expect(addMessage).toHaveBeenCalledTimes(1)
    expect(addMessage.mock.calls[0][1]).toMatchObject(NEW_MESSAGE_FIELDS)
  })

  it('carries every new memories column through restore', async () => {
    const { memoriesCreate } = buildRepoMocks()
    primeArchive(
      makeBackupData({
        memories: [
          {
            id: 'mem-1',
            characterId: 'char-1',
            content: 'They met in the conservatory.',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            tags: [],
            keywords: [],
            relatedMemoryIds: [],
            ...NEW_MEMORY_FIELDS,
          },
        ],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(memoriesCreate).toHaveBeenCalledTimes(1)
    expect(memoriesCreate.mock.calls[0][0]).toMatchObject(NEW_MEMORY_FIELDS)
  })

  it('carries every new chat_settings column through restore', async () => {
    const { chatSettingsCreate } = buildRepoMocks()
    primeArchive(
      makeBackupData({
        chatSettings: [
          {
            id: 'settings-1',
            userId: 'old-user',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            ...NEW_CHAT_SETTINGS_FIELDS,
          },
        ],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(chatSettingsCreate).toHaveBeenCalledTimes(1)
    expect(chatSettingsCreate.mock.calls[0][0]).toMatchObject(NEW_CHAT_SETTINGS_FIELDS)
  })

  it('preserves memory ids so relatedMemoryIds edges still resolve after restore', async () => {
    const { memoriesCreate } = buildRepoMocks()
    primeArchive(
      makeBackupData({
        memories: [
          {
            id: 'mem-1',
            characterId: 'char-1',
            content: 'First.',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            tags: [],
            keywords: [],
            relatedMemoryIds: ['mem-2'],
          },
          {
            id: 'mem-2',
            characterId: 'char-1',
            content: 'Second.',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            tags: [],
            keywords: [],
            relatedMemoryIds: ['mem-1'],
          },
        ],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(memoriesCreate).toHaveBeenCalledTimes(2)
    // Each memory must be re-inserted under its backed-up id; otherwise the
    // relatedMemoryIds above dangle and the memory graph is lost on restore.
    expect(memoriesCreate.mock.calls[0][1]).toEqual({ id: 'mem-1' })
    expect(memoriesCreate.mock.calls[1][1]).toEqual({ id: 'mem-2' })
  })
})
