import '@testing-library/jest-dom'
import fetchMock from 'jest-fetch-mock'

fetchMock.enableMocks()

// Polyfill setImmediate for Node.js APIs used in archiver
global.setImmediate = global.setImmediate || ((fn: (...args: any[]) => void, ...args: any[]) => global.setTimeout(fn, 0, ...args))

const shouldSilenceConsole = process.env.ENABLE_TEST_LOGS !== 'true'

if (shouldSilenceConsole) {
  const consoleMethodsToSilence: Array<'log' | 'info' | 'debug' | 'warn' | 'trace' | 'error'> = [
    'log',
    'info',
    'debug',
    'warn',
    'trace',
    'error',
  ]
  const noop = (..._args: any[]) => {}
  const silencedSpies = consoleMethodsToSilence.map((method) => jest.spyOn(console, method).mockImplementation(noop))

  afterAll(() => {
    silencedSpies.forEach((spy) => spy.mockRestore())
  })
}

// Mock our session utilities to avoid running full plugin initialization in tests
const mockGetServerSession = jest.fn().mockResolvedValue(null)

jest.mock('@/lib/auth/session', () => ({
  getServerSession: mockGetServerSession,
}))

// Mock startup state to avoid waiting for server initialization in tests
jest.mock('@/lib/startup/startup-state', () => ({
  startupState: {
    isReady: jest.fn().mockReturnValue(true),
    waitForReady: jest.fn().mockResolvedValue(true),
    getPhase: jest.fn().mockReturnValue('complete'),
    isPepperResolved: jest.fn().mockReturnValue(true),
    getPepperState: jest.fn().mockReturnValue('resolved'),
    setPepperState: jest.fn(),
  },
}))

// Mock session provider for tests
jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(() => ({
    data: null,
    status: 'unauthenticated',
    update: jest.fn(),
  })),
  useSessionOptional: jest.fn(() => ({
    data: null,
    status: 'unauthenticated',
    update: jest.fn(),
  })),
  Providers: ({ children }: any) => children,
}))

// Mock environment variables for tests
// Note: NODE_ENV is read-only and set by Jest automatically
process.env.BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests-32-chars-long!!'
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-client-secret'
process.env.ENCRYPTION_MASTER_PEPPER = process.env.ENCRYPTION_MASTER_PEPPER || 'test-pepper-for-unit-tests-32-chars-long!'
process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'test-s3-access-key'
process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'test-s3-secret-key'

// Set up globals required for Next.js
// Note: We check if they're undefined to avoid conflicts with jsdom's implementation
if (!globalThis.Request) {
  globalThis.Request = class {
    constructor(input: string | Request, init?: RequestInit) {
      if (typeof input === 'string') {
        Object.defineProperty(this, 'url', { value: input })
      }
      if (init) {
        Object.defineProperty(this, 'init', { value: init })
      }
    }
  } as any
}

if (!globalThis.Response) {
  globalThis.Response = class {
    constructor(body?: any, init?: ResponseInit) {
      if (body !== undefined) Object.defineProperty(this, 'body', { value: body })
      if (init) Object.defineProperty(this, 'init', { value: init })
    }
  } as any
}

if (!globalThis.Headers) {
  globalThis.Headers = class {
    private map = new Map<string, string>()
    set(name: string, value: string) { this.map.set(name.toLowerCase(), value) }
    get(name: string) { return this.map.get(name.toLowerCase()) }
    has(name: string) { return this.map.has(name.toLowerCase()) }
    delete(name: string) { this.map.delete(name.toLowerCase()) }
    forEach(cb: Function) { this.map.forEach((v, k) => cb(v, k)) }
  } as any
}

// Mock OpenAI to avoid dangerously loading browser checks
jest.mock('openai', () => {
  const mockCreate = jest.fn(() =>
    Promise.resolve({
      choices: [{ message: { content: 'test' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  )

  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
      models: { list: jest.fn(() => Promise.resolve({ data: [] })) },
    })),
  }
})

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(() =>
          Promise.resolve({
            content: [{ type: 'text', text: 'test response' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          })
        ),
      },
    })),
  }
})

// Add TextEncoder and TextDecoder for Node.js tests
if (typeof TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}

// Mock cookies for NextRequest
if (!(globalThis as any).Cookies) {
  ;(globalThis as any).Cookies = class {
    get(_name: string) { return null }
    getAll() { return [] }
    has(_name: string) { return false }
    delete(_name: string) {}
    set(_name: string, _value: string) {}
    clear() {}
  }
}

// Mock next/server Response
jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server')
  
  class MockNextResponse {
    status: number
    statusText: string
    body: any
    headers: Headers

    constructor(body?: any, init?: ResponseInit & { statusText?: string }) {
      this.body = body
      this.status = init?.status || 200
      this.statusText = init?.statusText || ''
      this.headers = init?.headers ? new Headers(init.headers) : new Headers()
    }

    async json() {
      return this.body
    }

    static json = jest.fn((data: any, init?: ResponseInit) => {
      const response = new MockNextResponse(data, init)
      return response
    })
  }

  return {
    ...actual,
    NextResponse: MockNextResponse,
  }
})


// Mock encryption library (field-level encryption removed; only passphrase-based functions remain)
jest.mock('@/lib/encryption', () => ({
  maskApiKey: jest.fn(),
  encryptWithPassphrase: jest.fn(),
  decryptWithPassphrase: jest.fn(),
  deriveKeyFromPassphrase: jest.fn(),
  signWithPassphrase: jest.fn(),
  verifyWithPassphrase: jest.fn(),
}))

// Mock LLM plugin factory
jest.mock('@/lib/llm/plugin-factory', () => ({
  createLLMProvider: jest.fn(),
  createImageProvider: jest.fn(),
  getAllAvailableProviders: jest.fn(() => []),
  getAllAvailableImageProviders: jest.fn(() => []),
  isProviderFromPlugin: jest.fn(() => true),
}))

// Mock provider validation - default to valid
jest.mock('@/lib/plugins/provider-validation', () => ({
  validateProviderConfig: jest.fn().mockReturnValue({
    valid: true,
    errors: [],
  }),
}))

// Mock LLM module (re-exports from plugin-factory)
jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(),
  createImageProvider: jest.fn(),
  getAllAvailableProviders: jest.fn(() => []),
  getAllAvailableImageProviders: jest.fn(() => []),
  isProviderFromPlugin: jest.fn(() => true),
}))

// Mock file tag inheritance
jest.mock('@/lib/files/tag-inheritance', () => ({
  getInheritedTags: jest.fn().mockResolvedValue([]),
  mergeTags: jest.fn().mockImplementation((a: string[], b: string[]) => [...new Set([...a, ...b])]),
}))

// Mock Repositories
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
  getRepositoriesSafe: jest.fn(),
  getUserRepositories: jest.fn(),
  resetRepositories: jest.fn(),
  clearUserRepositoryCache: jest.fn(),
}))

// Mock the low-level database manager so test files that import code paths
// touching `rawQuery` (e.g. the memory-deletion chokepoint introduced in 4.5)
// don't spin up the real SQLite backend and trip on jsdom's setInterval
// returning a number instead of a Timeout. Tests that need a specific
// rawQuery response can override this with `jest.requireMock(...).rawQuery.mockResolvedValueOnce(...)`.
jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn().mockResolvedValue([]),
  registerBlobColumns: jest.fn().mockResolvedValue(undefined),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
  initializeDatabase: jest.fn(),
  isDatabaseInitialized: jest.fn().mockReturnValue(false),
  isDatabaseConnected: jest.fn().mockResolvedValue(false),
  closeDatabase: jest.fn().mockResolvedValue(undefined),
  suspendDatabase: jest.fn().mockResolvedValue(false),
  resumeDatabase: jest.fn().mockResolvedValue(null),
  getCollection: jest.fn(),
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  listCollections: jest.fn().mockResolvedValue([]),
  getBackendType: jest.fn().mockReturnValue(null),
  getBackendCapabilities: jest.fn().mockReturnValue(null),
  supportsCapability: jest.fn().mockReturnValue(false),
  healthCheck: jest.fn(),
  withTransaction: jest.fn(),
  _resetForTesting: jest.fn(),
  _setBackendForTesting: jest.fn(),
}))

// Mock file storage manager - used by cascade-delete and other modules
jest.mock('@/lib/file-storage/manager', () => {
  return {
    safeFilename: jest.fn().mockImplementation((filename: string) => {
      return filename.replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/_{2,}/g, '_').replace(/^[_.]+/, '').replace(/[_.]+$/, '') || 'unnamed';
    }),
    fileStorageManager: {
      initialize: jest.fn().mockResolvedValue(undefined),
      isInitialized: jest.fn().mockReturnValue(true),
      uploadFile: jest.fn().mockResolvedValue({ storageKey: 'mock-storage-key' }),
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('mock file content')),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      getFileUrl: jest.fn().mockResolvedValue('http://localhost:3000/api/v1/files/proxy/mock-key'),
      fileExists: jest.fn().mockResolvedValue(true),
      storageKeyExists: jest.fn().mockResolvedValue(false),
      getBasePath: jest.fn().mockReturnValue('/tmp/quilltap-test/files'),
      buildStorageKey: jest.fn().mockImplementation((params: { filename: string; projectId?: string | null; folderPath?: string }) => {
        const { filename, projectId, folderPath } = params;
        const projectPath = projectId || '_general';
        const folder = folderPath ? folderPath.replace(/^\/+|\/+$/g, '') : '';
        if (folder) {
          return `${projectPath}/${folder}/${filename}`;
        }
        return `${projectPath}/${filename}`;
      }),
      buildFolderStoragePath: jest.fn().mockImplementation((params: { projectId: string | null; folderPath: string }) => {
        const { projectId, folderPath } = params;
        const projectPath = projectId || '_general';
        const folder = folderPath.replace(/^\/+|\/+$/g, '');
        if (folder) {
          return `${projectPath}/${folder}`;
        }
        return projectPath;
      }),
      buildLegacyStorageKey: jest.fn().mockImplementation((params: { userId: string; fileId: string; filename: string; projectId?: string | null; folderPath?: string }) => {
        const { userId, fileId, filename, projectId, folderPath } = params;
        const projectPath = projectId || '_general';
        const folder = folderPath ? folderPath.replace(/^\/+|\/+$/g, '') : '';
        if (folder) {
          return `users/${userId}/${projectPath}/${folder}/${fileId}_${filename}`;
        }
        return `users/${userId}/${projectPath}/${fileId}_${filename}`;
      }),
      uploadRaw: jest.fn().mockResolvedValue(undefined),
      deleteRaw: jest.fn().mockResolvedValue(undefined),
      createFolder: jest.fn().mockResolvedValue(undefined),
      deleteFolder: jest.fn().mockResolvedValue(undefined),
    },
    FileStorageManager: jest.fn(),
  }
})

// Mock the document-store bridges so route/handler tests that exercise the
// post-fallback writers (character avatars, Lantern backgrounds, project files)
// don't need to spin up real mounts. Tests can override per-suite as needed.
jest.mock('@/lib/file-storage/lantern-store-bridge', () => ({
  getLanternBackgroundsStore: jest.fn().mockResolvedValue({ mountPointId: 'mock-lantern-mount' }),
  writeLanternBackgroundToMountStore: jest.fn().mockResolvedValue({
    storageKey: 'mount-blob:mock-lantern-mount:mock-blob-id',
    mountPointId: 'mock-lantern-mount',
    blobId: 'mock-blob-id',
    relativePath: 'tool/mock.webp',
    storedMimeType: 'image/webp',
    sizeBytes: 1024,
    sha256: 'mock-sha256',
  }),
}))

jest.mock('@/lib/file-storage/character-vault-bridge', () => ({
  getCharacterVaultStore: jest.fn().mockResolvedValue({ mountPointId: 'mock-vault-mount', mountPointName: 'Mock Vault' }),
  writeCharacterAvatarToVault: jest.fn().mockResolvedValue({
    storageKey: 'mount-blob:mock-vault-mount:mock-blob-id',
    mountPointId: 'mock-vault-mount',
    blobId: 'mock-blob-id',
    linkId: 'mock-link-id',
    relativePath: 'images/avatar.webp',
    storedMimeType: 'image/webp',
    sizeBytes: 1024,
    sha256: 'mock-sha256',
  }),
}))

jest.mock('@/lib/file-storage/user-uploads-bridge', () => ({
  getUserUploadsStore: jest.fn().mockResolvedValue({ mountPointId: 'mock-uploads-mount' }),
  writeUserUploadToMountStore: jest.fn().mockResolvedValue({
    storageKey: 'mount-blob:mock-uploads-mount:mock-blob-id',
    mountPointId: 'mock-uploads-mount',
    blobId: 'mock-blob-id',
    relativePath: 'uploads/mock-file',
    storedMimeType: 'application/octet-stream',
    sizeBytes: 1024,
    sha256: 'mock-sha256',
  }),
}))

// Mock LLM logging service — same SWC hoisting reason as below. Tests that need
// to assert against logLLMCall do so via `jest.mocked(logLLMCall)`.
jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn().mockResolvedValue(null),
  isLoggingEnabled: jest.fn().mockResolvedValue({ enabled: true, verboseMode: false, retentionDays: 30 }),
  getLogsForMessage: jest.fn().mockResolvedValue([]),
  getLogsForChat: jest.fn().mockResolvedValue([]),
  getLogsForCharacter: jest.fn().mockResolvedValue([]),
  messageHasLogs: jest.fn().mockResolvedValue(false),
  getLogsForUser: jest.fn().mockResolvedValue([]),
  getRecentLogs: jest.fn().mockResolvedValue([]),
  countLogsForUser: jest.fn().mockResolvedValue(0),
  getTotalTokenUsage: jest.fn().mockResolvedValue({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  getLogsByType: jest.fn().mockResolvedValue([]),
  cleanupOldLogs: jest.fn().mockResolvedValue(0),
  deleteAllLogsForUser: jest.fn().mockResolvedValue(0),
  getStandaloneLogs: jest.fn().mockResolvedValue([]),
}))

// Mock embedding service — required here because SWC's import hoisting prevents
// test-level jest.mock from taking effect before ES imports resolve.
// Tests that need the REAL embedding service (e.g. embedding-service.test.ts)
// should use jest.unmock('@/lib/embedding/embedding-service') at the top.
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn().mockResolvedValue({
    embedding: new Float32Array([0.1, 0.2, 0.3]),
    model: 'test-model',
    dimensions: 3,
    provider: 'TEST',
  }),
  extractSearchTerms: jest.fn((query: string) => {
    const words = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2)
    return { terms: words, phrases: [] }
  }),
  textSimilarity: jest.fn().mockReturnValue(0.5),
  cosineSimilarity: jest.fn((a: ArrayLike<number>, b: ArrayLike<number>) => {
    let sum = 0
    for (let i = 0; i < a.length && i < b.length; i++) {
      sum += a[i] * b[i]
    }
    return sum
  }),
  normalizeVector: jest.fn((v: Float32Array) => v),
  isEmbeddingAvailable: jest.fn().mockResolvedValue(false),
  EmbeddingError: class EmbeddingError extends Error {
    constructor(message: string, public code: string = 'EMBEDDING_ERROR') {
      super(message)
      this.name = 'EmbeddingError'
    }
  },
  generateEmbedding: jest.fn(),
  getDefaultEmbeddingProfile: jest.fn().mockResolvedValue(null),
  getEmbeddingProfile: jest.fn().mockResolvedValue(null),
  getUserEmbeddingProfiles: jest.fn().mockResolvedValue([]),
}))

// Mock vector store for embedding operations
jest.mock('@/lib/embedding/vector-store', () => ({
  getVectorStoreManager: jest.fn().mockReturnValue({
    deleteStore: jest.fn().mockResolvedValue(undefined),
    getStore: jest.fn().mockResolvedValue(null),
  }),
  getCharacterVectorStore: jest.fn().mockResolvedValue({
    getAllEntries: jest.fn().mockReturnValue([]),
    search: jest.fn().mockReturnValue([]),
    addVector: jest.fn(),
    updateVector: jest.fn(),
    removeVector: jest.fn(),
    hasVector: jest.fn().mockReturnValue(false),
    save: jest.fn(),
  }),
  CharacterVectorStore: jest.fn().mockImplementation(() => ({
    addMemory: jest.fn().mockResolvedValue(undefined),
    searchSimilar: jest.fn().mockResolvedValue([]),
    deleteMemory: jest.fn().mockResolvedValue(undefined),
  })),
}))

global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({}),
  }),
) as jest.Mock
