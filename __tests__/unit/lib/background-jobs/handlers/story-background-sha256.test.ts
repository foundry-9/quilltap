/**
 * Regression test for the SHA-256 recorded by the story-background generation
 * handler.
 *
 * Same invariant as the character-avatar handler: the handler must hash the
 * *post-WebP-conversion* buffer (the bytes it actually persists), not the raw
 * provider bytes, and pass that exact digest to repos.files.create. The two
 * handlers carry an identical inline hashing line; this locks story-background's
 * copy independently so a change to one can't silently desync the other.
 *
 * The handler is driven with NO participant characters and NO recent messages so
 * the appearance-resolution and scene-derivation branches collapse to nulls,
 * and with dangerous-content scanning OFF, leaving the straight
 * craft → generate → convert → hash → save path into the Lantern Backgrounds
 * mount. Mock style matches the other handler suites: subject imports first,
 * bare jest.mock() factories, behaviour wired in beforeEach.
 */

import { createHash } from 'node:crypto'
import { handleStoryBackgroundGeneration } from '@/lib/background-jobs/handlers/story-background'
import { getRepositories } from '@/lib/repositories/factory'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { convertToWebP } from '@/lib/files/webp-conversion'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm'
import {
  craftStoryBackgroundPrompt,
  deriveSceneContext,
  extractVisibleConversation,
} from '@/lib/memory/cheap-llm-tasks'
import { writeLanternBackgroundToMountStore } from '@/lib/file-storage/lantern-store-bridge'

jest.mock('@/lib/logger', () => {
  const makeLogger = () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/llm/plugin-factory', () => ({ createImageProvider: jest.fn() }))
jest.mock('@/lib/files/webp-conversion', () => ({ convertToWebP: jest.fn() }))
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(),
}))
jest.mock('@/lib/services/dangerous-content/chat-override', () => ({
  shouldUseUncensoredRoute: jest.fn(),
}))
jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  resolveUncensoredCheapLLMSelection: jest.fn(),
  DEFAULT_CHEAP_LLM_CONFIG: {},
}))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  craftStoryBackgroundPrompt: jest.fn(),
  deriveSceneContext: jest.fn(),
  extractVisibleConversation: jest.fn(),
}))
jest.mock('@/lib/image-gen/appearance-resolution', () => ({
  resolveCharacterAppearances: jest.fn(),
  sanitizeAppearancesIfNeeded: jest.fn(),
  equippedWardrobeItemsForAppearance: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/wardrobe/resolve-equipped', () => ({
  resolveEquippedOutfitForCharacter: jest.fn(),
}))
jest.mock('@/lib/services/lantern-notifications/writer', () => ({
  postLanternImageNotification: jest.fn().mockResolvedValue(undefined),
}))

const USER = 'user-1'
const CHAT_ID = 'chat-1'

const RAW_PROVIDER_BYTES = Buffer.from('raw png bytes from provider')
const CONVERTED_WEBP_BYTES = Buffer.from('converted webp bytes — different from raw')

const filesCreate = jest.fn()

const mockGetRepositories = jest.mocked(getRepositories)
const mockCreateImageProvider = jest.mocked(createImageProvider)
const mockConvertToWebP = jest.mocked(convertToWebP)
const mockResolveDanger = jest.mocked(resolveDangerousContentSettings)
const mockShouldUseUncensoredRoute = jest.mocked(shouldUseUncensoredRoute)
const mockGetCheapLLM = jest.mocked(getCheapLLMProvider)
const mockCraftPrompt = jest.mocked(craftStoryBackgroundPrompt)
const mockExtractConversation = jest.mocked(extractVisibleConversation)
const mockDeriveScene = jest.mocked(deriveSceneContext)
const mockWriteLantern = jest.mocked(writeLanternBackgroundToMountStore)

function makeJob() {
  return {
    id: 'job-1',
    userId: USER,
    payload: {
      chatId: CHAT_ID,
      characterIds: [], // no participants → appearance/enumeration branches collapse
      imageProfileId: 'profile-1',
      sceneContext: 'a misty harbor at dawn',
      projectId: null, // → routes into the Lantern Backgrounds mount
    },
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()

  filesCreate.mockResolvedValue({ id: 'file-1' })

  mockGetRepositories.mockReturnValue({
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: CHAT_ID,
        projectId: null,
        title: 'The Harbor',
        sceneState: null,
        messageCount: 0,
        contextSummary: null,
      }),
      getMessages: jest.fn().mockResolvedValue([]),
      getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    },
    characters: {
      findById: jest.fn().mockResolvedValue(null),
      findByUserId: jest.fn().mockResolvedValue([]),
    },
    imageProfiles: {
      findById: jest.fn().mockResolvedValue({
        id: 'profile-1',
        apiKeyId: 'key-1',
        modelName: 'image-model',
        provider: 'openai',
        name: 'Default Image Profile',
        parameters: {},
      }),
    },
    connections: {
      findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'sk-test' }),
      findByUserId: jest.fn().mockResolvedValue([
        { id: 'p1', isDefault: true, provider: 'openai', modelName: 'm' },
      ]),
    },
    chatSettings: {
      findByUserId: jest.fn().mockResolvedValue(null),
    },
    files: {
      create: filesCreate,
    },
  } as any)

  mockResolveDanger.mockReturnValue({ settings: { mode: 'OFF', scanImagePrompts: false } } as any)
  mockShouldUseUncensoredRoute.mockReturnValue(false)
  mockGetCheapLLM.mockReturnValue({
    provider: 'openai', modelName: 'm', connectionProfileId: 'p1', isLocal: false,
  } as any)
  mockExtractConversation.mockReturnValue([])
  mockDeriveScene.mockResolvedValue(null as any)
  mockCraftPrompt.mockResolvedValue({ success: true, result: 'a luminous misty harbor at dawn' } as any)

  mockCreateImageProvider.mockReturnValue({
    generateImage: jest.fn().mockResolvedValue({
      images: [
        { b64Json: RAW_PROVIDER_BYTES.toString('base64'), mimeType: 'image/png', revisedPrompt: null },
      ],
    }),
  } as any)

  mockConvertToWebP.mockResolvedValue({
    buffer: CONVERTED_WEBP_BYTES,
    mimeType: 'image/webp',
    filename: 'story_background.webp',
    wasConverted: true,
  } as any)

  mockWriteLantern.mockResolvedValue({
    storageKey: 'mount-blob:mock-lantern:blob-1',
    mountPointId: 'mock-lantern',
    blobId: 'blob-1',
    relativePath: 'generated/story.webp',
    storedMimeType: 'image/webp',
    sizeBytes: CONVERTED_WEBP_BYTES.length,
    sha256: 'unused-bridge-sha',
  } as any)
})

describe('story-background handler — sha256 of stored bytes', () => {
  it('records the sha256 of the converted (stored) buffer, not the raw provider bytes', async () => {
    await handleStoryBackgroundGeneration(makeJob())

    expect(filesCreate).toHaveBeenCalledTimes(1)
    const arg = filesCreate.mock.calls[0][0] as { sha256: string; source: string; category: string }

    const expectedConverted = createHash('sha256').update(new Uint8Array(CONVERTED_WEBP_BYTES)).digest('hex')
    const rawHash = createHash('sha256').update(new Uint8Array(RAW_PROVIDER_BYTES)).digest('hex')

    expect(arg.sha256).toBe(expectedConverted)
    expect(arg.sha256).not.toBe(rawHash)
    expect(arg.source).toBe('GENERATED')
    expect(arg.category).toBe('IMAGE')
  })

  it('hands the converted bytes (matching the recorded hash) to the Lantern mount writer', async () => {
    await handleStoryBackgroundGeneration(makeJob())

    expect(mockWriteLantern).toHaveBeenCalledTimes(1)
    const arg = mockWriteLantern.mock.calls[0][0] as { content: Buffer }
    expect(Buffer.compare(arg.content, CONVERTED_WEBP_BYTES)).toBe(0)
  })
})

describe('story-background handler — orientation + measured dimensions', () => {
  it('stores the measured dimensions from the converted buffer, not a hard-coded landscape size', async () => {
    mockConvertToWebP.mockResolvedValue({
      buffer: CONVERTED_WEBP_BYTES,
      mimeType: 'image/webp',
      filename: 'story_background.webp',
      wasConverted: true,
      width: 1280,
      height: 720,
    } as any)

    await handleStoryBackgroundGeneration(makeJob())

    const arg = filesCreate.mock.calls[0][0] as { width: number | null; height: number | null }
    expect(arg.width).toBe(1280)
    expect(arg.height).toBe(720)
    // The old hard-coded 1792x1024 must be gone.
    expect(arg.width).not.toBe(1792)
  })

  it('requests landscape orientation (no hard-coded size) and appends the landscape hint when the provider is unknown to the registry', async () => {
    await handleStoryBackgroundGeneration(makeJob())

    const providerInstance = mockCreateImageProvider.mock.results[0].value as { generateImage: jest.Mock }
    const genArg = providerInstance.generateImage.mock.calls[0][0] as { prompt: string; size?: string }

    // No registry plugin in the unit env → host fallback (prompt hint, no size).
    expect(genArg.size).toBeUndefined()
    expect(genArg.prompt).toMatch(/landscape/i)
  })
})
