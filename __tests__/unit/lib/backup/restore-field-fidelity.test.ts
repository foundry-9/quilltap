/**
 * Field-fidelity guard for backup restore.
 *
 * Backup/restore is schema-driven: `ensureCollection` derives a table's JSON /
 * array / boolean columns straight from its Zod schema, and restore re-inserts
 * entities by spreading whatever the archive held. That means a field added to
 * a Zod schema rides along for free — but it also means a stray destructure in
 * `restore()` can silently drop a column with nothing to catch it.
 *
 * These tests pin the data-model additions of the 4.8 and 4.9 cycles
 * end-to-end, and assert the id-preservation contract that keeps cross-entity
 * references (notably the Commonplace Book's `relatedMemoryIds` graph) intact.
 *
 * They also pin the two connection-profile columns whose SQLite DEFAULT is the
 * WRONG answer for an archive that predates them — a column absent from the
 * archive is absent from the INSERT, so the table default silently decides a
 * setting the user never chose. Riding along for free only works for a field
 * the archive actually carries.
 */

import { restore } from '@/lib/backup/restore/restore';
import { parseBackupZip } from '@/lib/backup/restore/archive';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { rawQuery } from '@/lib/database/manager';

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
const mockedRawQuery = rawQuery as jest.MockedFunction<typeof rawQuery>

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

/** Columns added to connection_profiles in 4.9. */
const NEW_CONNECTION_PROFILE_FIELDS = {
  multiCharacterPrefill: false,
  fallbackProfileId: 'profile-2',
  allowTierFallback: true,
}

/** The 4.9 `chats.equippedOutfit` slot bag, with the hair slot added this cycle. */
const NEW_EQUIPPED_OUTFIT = {
  'char-1': { top: ['item-1'], bottom: [], footwear: [], accessories: [], hair: ['item-hair'] },
}

/**
 * The 4.9/4.10 additions that ride *inside* an existing column rather than
 * arriving as one of their own — a widened enum domain and three JSON bags.
 *
 * These are the additions most likely to be lost quietly. A new column at
 * least announces itself with a migration; a new key inside a JSON column is
 * invisible to every schema check, and a widened enum only fails at the moment
 * some restored row happens to carry the new value.
 */

/** `chats.conciergeOverride` grew a fourth state in 4.9; the column did not change. */
const WIDENED_CONCIERGE_OVERRIDE = 'UNCENSORED'

/** `chat_settings.cheapLLMSettings` (a JSON column) grew `allowCheapFallback` in 4.10. */
const NEW_CHEAP_LLM_SETTINGS = {
  strategy: 'PROVIDER_CHEAPEST',
  fallbackToLocal: true,
  embeddingProvider: 'OPENAI',
  allowCheapFallback: true,
}

/** `image_profiles.parameters` (an open JSON bag) gained the reserved `loras` key in 4.9. */
const NEW_IMAGE_PROFILE_PARAMETERS = {
  size: '1024x1024',
  loras: [{ source: 'author/some-lora', scale: 0.8, triggerPhrase: 'in the style of', label: 'Some LoRA' }],
}

/** `instance_settings.memoryRecall` (a JSON value) gained `perTurnConversationSummaries` in 4.9. */
const NEW_MEMORY_RECALL_SETTING = JSON.stringify({
  scopePolicy: 'down-weight',
  expandRelated: false,
  perTurnConversationSummaries: true,
})

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
  // Re-derived after the transcript is replayed — `addMessage` stamps the
  // wall clock, which would date every restored chat to the restore itself.
  const getLastPlayedMessageAt = jest.fn().mockResolvedValue('2026-05-05T00:00:00.000Z')
  const chatsUpdate = jest.fn().mockResolvedValue({})
  const memoriesCreate = jest.fn().mockImplementation((data: Record<string, unknown>, opts?: { id?: string }) =>
    Promise.resolve({ ...data, id: opts?.id ?? 'generated-memory-id' })
  )
  const chatSettingsCreate = jest.fn().mockResolvedValue({})
  const connectionsCreate = jest.fn().mockImplementation((data: Record<string, unknown>, opts?: { id?: string }) =>
    Promise.resolve({ ...data, id: opts?.id ?? 'generated-profile-id' })
  )
  const imageProfilesCreate = jest.fn().mockImplementation((data: Record<string, unknown>, opts?: { id?: string }) =>
    Promise.resolve({ ...data, id: opts?.id ?? 'generated-image-profile-id' })
  )

  const userRepos = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'chats')
        return repoStub({ create: chatsCreate, addMessage, getLastPlayedMessageAt, update: chatsUpdate })
      if (prop === 'memories') return repoStub({ create: memoriesCreate })
      if (prop === 'connections') return repoStub({ create: connectionsCreate, findAll: jest.fn().mockResolvedValue([]) })
      if (prop === 'imageProfiles') return repoStub({ create: imageProfilesCreate })
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

  return {
    chatsCreate,
    addMessage,
    getLastPlayedMessageAt,
    chatsUpdate,
    memoriesCreate,
    chatSettingsCreate,
    connectionsCreate,
    imageProfilesCreate,
  }
}

function primeArchive(data: Record<string, unknown>) {
  mockedParseBackupZip.mockResolvedValue({
    data: data as never,
    extractDir: '/tmp/qt-test-extract',
    rootFolder: '',
  })
}

describe('restore field fidelity — 4.9 data-model additions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function profileArchive(profile: Record<string, unknown>) {
    primeArchive(
      makeBackupData({
        connectionProfiles: [
          {
            id: 'profile-1',
            userId: 'old-user',
            name: 'A Profile',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            ...profile,
          },
        ],
      })
    )
  }

  it('carries every new connection_profiles column through restore', async () => {
    const { connectionsCreate } = buildRepoMocks()
    profileArchive({ provider: 'OPENAI', supportsImageUpload: true, ...NEW_CONNECTION_PROFILE_FIELDS })

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(connectionsCreate).toHaveBeenCalledTimes(1)
    expect(connectionsCreate.mock.calls[0][0]).toMatchObject(NEW_CONNECTION_PROFILE_FIELDS)
    expect(connectionsCreate.mock.calls[0][1]).toEqual({ id: 'profile-1' })
  })

  it('restores an archive older than multiCharacterPrefill as "never chosen", not as the table default', async () => {
    const { connectionsCreate } = buildRepoMocks()
    // A pre-4.9 archive has no multiCharacterPrefill key at all. Left absent,
    // the INSERT omits the column and SQLite's DEFAULT 1 turns the [Name]
    // prefill ON — which is precisely what Anthropic 4.6+ rejects outright,
    // and what add-profile-multi-character-prefill-field-v1 exists to avoid on
    // the upgrade path. An explicit null keeps it "never chosen" so
    // profileUsesNamePrefill() resolves the provider default.
    profileArchive({ provider: 'ANTHROPIC', supportsImageUpload: true })

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(connectionsCreate).toHaveBeenCalledTimes(1)
    expect(connectionsCreate.mock.calls[0][0]).toHaveProperty('multiCharacterPrefill', null)
  })

  it('restores an archive older than the fallback columns with no understudy named', async () => {
    const { connectionsCreate } = buildRepoMocks()
    // Unlike multiCharacterPrefill, the table DEFAULTs here (NULL / 0) *are*
    // the neutral answer — a pre-4.10 profile simply had no understudy. Pinned
    // explicitly so a later change to either DEFAULT can't quietly hand a
    // restored profile a fallback its owner never configured.
    profileArchive({ provider: 'OPENAI', supportsImageUpload: true })

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(connectionsCreate).toHaveBeenCalledTimes(1)
    expect(connectionsCreate.mock.calls[0][0]).toMatchObject({
      fallbackProfileId: null,
      allowTierFallback: false,
    })
  })

  it('refuses a self-referential understudy from a hand-edited archive', async () => {
    const { connectionsCreate } = buildRepoMocks()
    // fallbackProfileId is the first restore-path column holding a *reference*.
    // A profile that understudies itself is one attempt wearing two names, and
    // config validation refuses it on the way in; an archive is data, not a
    // contract, so it gets refused on the way back too.
    profileArchive({ provider: 'OPENAI', fallbackProfileId: 'profile-1' })

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(connectionsCreate).toHaveBeenCalledTimes(1)
    expect(connectionsCreate.mock.calls[0][0]).toHaveProperty('fallbackProfileId', null)
  })

  it('seeds supportsImageUpload from the provider map for an archive older than the flag', async () => {
    const { connectionsCreate } = buildRepoMocks()
    // Pre-4.3 archives predate the per-profile flag. `supportsImageUpload`
    // defaults to 0, so restoring one silently stripped image upload from
    // every profile that had it — while a .qtap import of the same data seeded
    // it from the historic provider map. The two paths now agree.
    profileArchive({ provider: 'ANTHROPIC' })

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(connectionsCreate.mock.calls[0][0]).toHaveProperty('supportsImageUpload', true)
  })

  it('leaves supportsImageUpload alone for a provider that never had the capability', async () => {
    const { connectionsCreate } = buildRepoMocks()
    profileArchive({ provider: 'OLLAMA' })

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(connectionsCreate.mock.calls[0][0]).toHaveProperty('supportsImageUpload', false)
  })

  it('carries the hair wardrobe slot in chats.equippedOutfit through restore', async () => {
    const { chatsCreate } = buildRepoMocks()
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
            equippedOutfit: NEW_EQUIPPED_OUTFIT,
            messages: [],
          },
        ],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(chatsCreate.mock.calls[0][0]).toMatchObject({ equippedOutfit: NEW_EQUIPPED_OUTFIT })
  })

  it("carries the widened conciergeOverride domain ('UNCENSORED') through restore", async () => {
    const { chatsCreate } = buildRepoMocks()
    primeArchive(
      makeBackupData({
        chats: [
          {
            id: 'chat-1',
            userId: 'old-user',
            title: 'A Spicy Conversation',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            participants: [],
            tags: [],
            conciergeOverride: WIDENED_CONCIERGE_OVERRIDE,
            messages: [],
          },
        ],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    // The fourth state is a *value*, not a column: a restore that narrowed it
    // back to 'OFF' or dropped it would silently re-arm the classifier on a
    // chat whose operator had already ruled on it.
    expect(chatsCreate.mock.calls[0][0]).toMatchObject({
      conciergeOverride: WIDENED_CONCIERGE_OVERRIDE,
    })
  })

  it('carries the cheap-LLM fallback opt-in inside cheapLLMSettings through restore', async () => {
    const { chatSettingsCreate } = buildRepoMocks()
    primeArchive(
      makeBackupData({
        chatSettings: [
          {
            id: 'settings-1',
            userId: 'old-user',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            cheapLLMSettings: NEW_CHEAP_LLM_SETTINGS,
          },
        ],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    // `allowCheapFallback` defaults to false, so losing it in transit reads as
    // the user having declined an automatic stand-in they actually opted into.
    expect(chatSettingsCreate.mock.calls[0][0]).toMatchObject({
      cheapLLMSettings: NEW_CHEAP_LLM_SETTINGS,
    })
  })

  it("carries an image profile's LoRA adapters through restore", async () => {
    const { imageProfilesCreate } = buildRepoMocks()
    primeArchive(
      makeBackupData({
        imageProfiles: [
          {
            id: 'image-profile-1',
            userId: 'old-user',
            name: 'An Image Profile',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            parameters: NEW_IMAGE_PROFILE_PARAMETERS,
          },
        ],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    // `parameters` is an open bag: nothing downstream validates its shape, so
    // nothing downstream would notice the reserved `loras` key going missing.
    expect(imageProfilesCreate).toHaveBeenCalledTimes(1)
    expect(imageProfilesCreate.mock.calls[0][0]).toMatchObject({
      parameters: NEW_IMAGE_PROFILE_PARAMETERS,
    })
    expect(imageProfilesCreate.mock.calls[0][1]).toEqual({ id: 'image-profile-1' })
  })

  it('carries the per-turn conversation-summaries recall knob through restore', async () => {
    buildRepoMocks()
    primeArchive(
      makeBackupData({
        instanceSettings: [{ key: 'memoryRecall', value: NEW_MEMORY_RECALL_SETTING }],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    // instance_settings is upserted by raw SQL rather than through a
    // repository, so the value travels as an opaque string — the guard is that
    // the row is written at all, and written verbatim.
    const upsert = mockedRawQuery.mock.calls.find(
      (call) => Array.isArray(call[1]) && (call[1] as unknown[])[0] === 'memoryRecall'
    )
    expect(upsert).toBeDefined()
    expect((upsert as unknown[])[1]).toEqual(['memoryRecall', NEW_MEMORY_RECALL_SETTING])
  })
})

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

  it('re-derives lastMessageAt after the transcript is replayed, so a restore does not date every chat to itself', async () => {
    // `addMessage` stamps `lastMessageAt` with the wall clock. Replaying a
    // transcript would therefore date every restored chat to the instant of the
    // restore — and that column is what every list sorts and displays by, so an
    // entire history would land in one flat heap at the top. Restore must put
    // the real activity date back, read from the transcript it just wrote.
    const { getLastPlayedMessageAt, chatsUpdate } = buildRepoMocks()
    primeArchive(
      makeBackupData({
        chats: [
          {
            id: 'chat-1',
            userId: 'user-1',
            title: 'A conversation from last spring',
            participants: [],
            tags: [],
            messages: [{ id: 'msg-1', type: 'message', role: 'assistant', content: 'hello' }],
          },
        ],
      })
    )

    await restore('/tmp/backup.zip', { mode: 'merge', targetUserId: 'user-1' })

    expect(getLastPlayedMessageAt).toHaveBeenCalledWith('chat-1')
    expect(chatsUpdate).toHaveBeenCalledWith('chat-1', { lastMessageAt: '2026-05-05T00:00:00.000Z' })
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
