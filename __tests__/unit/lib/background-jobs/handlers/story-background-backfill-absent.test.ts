/**
 * Step 9b back-fill: absent participants must not be enumerated back into the frame.
 *
 * The scan exists so an image provider does not invent an appearance for a
 * character the crafter named but was never given. Its candidate pool is "every
 * workspace character who is not a payload participant" — and since the payload
 * now carries only *present* participants, an absent one lands squarely in that
 * pool. Without this exclusion the back-fill would hand the provider a portrait
 * of someone who had just been deliberately kept out of the scene.
 *
 * Scaffolding mirrors story-background-uncensored-target.test.ts: subject import
 * first, bare jest.mock() factories, behaviour wired in beforeEach.
 */

import { handleStoryBackgroundGeneration } from '@/lib/background-jobs/handlers/story-background'
import { getRepositories } from '@/lib/repositories/factory'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { convertToWebP } from '@/lib/files/webp-conversion'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import {
  craftStoryBackgroundPrompt,
  deriveSceneContext,
  extractVisibleConversation,
} from '@/lib/memory/cheap-llm-tasks'
import {
  isImageModerationError,
  resolveUncensoredImageProfileForReroute,
} from '@/lib/services/dangerous-content/provider-routing.service'
import { writeLanternBackgroundToMountStore } from '@/lib/file-storage/lantern-store-bridge'
import {
  resolveCharacterAppearances,
  sanitizeAppearancesIfNeeded,
} from '@/lib/image-gen/appearance-resolution'

jest.mock('@/lib/logger', () => {
  const makeLogger = () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/llm/plugin-factory', () => ({ createImageProvider: jest.fn() }))
jest.mock('@/lib/files/webp-conversion', () => ({ convertToWebP: jest.fn() }))
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(),
}))
jest.mock('@/lib/services/dangerous-content/chat-override', () => ({
  shouldUseUncensoredRoute: jest.fn(),
}))
jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  isImageModerationError: jest.fn(),
  resolveUncensoredImageProfileForReroute: jest.fn(),
}))
jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  resolveUncensoredCheapLLMSelection: jest.fn(),
  buildCheapLLMConfig: jest.fn(() => ({})),
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
const WEBP_BYTES = Buffer.from('converted webp bytes')

/** The crafter names all three, but was only handed the one present character. */
const CRAFTED_PROMPT =
  'A rainswept quay at dusk. Alice waits by the bollards while Bertram hangs back ' +
  'beneath the awning and Mrs Gregson watches from the customs house.'

const mockGetRepositories = jest.mocked(getRepositories)
const mockCreateImageProvider = jest.mocked(createImageProvider)
const mockConvertToWebP = jest.mocked(convertToWebP)
const mockResolveDanger = jest.mocked(resolveDangerousContentSettings)
const mockShouldUseUncensoredRoute = jest.mocked(shouldUseUncensoredRoute)
const mockGetCheapLLM = jest.mocked(getCheapLLMProvider)
const mockResolveUncensoredCheap = jest.mocked(resolveUncensoredCheapLLMSelection)
const mockCraftPrompt = jest.mocked(craftStoryBackgroundPrompt)
const mockExtractConversation = jest.mocked(extractVisibleConversation)
const mockDeriveScene = jest.mocked(deriveSceneContext)
const mockIsModerationError = jest.mocked(isImageModerationError)
const mockResolveReroute = jest.mocked(resolveUncensoredImageProfileForReroute)
const mockWriteLantern = jest.mocked(writeLanternBackgroundToMountStore)
const mockResolveAppearances = jest.mocked(resolveCharacterAppearances)
const mockSanitizeAppearances = jest.mocked(sanitizeAppearancesIfNeeded)

const SELECTION = {
  provider: 'openai', modelName: 'm', connectionProfileId: 'p1', isLocal: false,
} as never

const character = (id: string, name: string) => ({
  id,
  name,
  pronouns: null,
  physicalDescription: { mediumPrompt: `${name}, painted in oils` },
})

/** Alice is present, Bertram is absent from this chat, Mrs Gregson is unaffiliated. */
const ALICE = character('char-alice', 'Alice')
const BERTRAM = character('char-bertram', 'Bertram')
const GREGSON = character('char-gregson', 'Mrs Gregson')

function makeJob() {
  return {
    id: 'job-1',
    userId: USER,
    payload: {
      chatId: CHAT_ID,
      characterIds: [ALICE.id],
      imageProfileId: 'profile-1',
      sceneContext: 'the quay at dusk',
      projectId: null,
    },
  } as never
}

/** The prompt actually handed to the image provider. */
function generatedPrompt(): string {
  const provider = mockCreateImageProvider.mock.results[
    mockCreateImageProvider.mock.results.length - 1
  ].value as { generateImage: jest.Mock }
  return provider.generateImage.mock.calls[0][0].prompt as string
}

beforeEach(() => {
  jest.clearAllMocks()

  mockGetRepositories.mockReturnValue({
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: CHAT_ID, projectId: null, title: 'The Quay at Dusk',
        sceneState: null, messageCount: 0, contextSummary: null,
        participants: [
          { id: 'p-1', type: 'CHARACTER', characterId: ALICE.id, status: 'active' },
          { id: 'p-2', type: 'CHARACTER', characterId: BERTRAM.id, status: 'absent' },
        ],
      }),
      getMessages: jest.fn().mockResolvedValue([]),
      getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    },
    characters: {
      findById: jest.fn().mockResolvedValue(ALICE),
      findByUserId: jest.fn().mockResolvedValue([ALICE, BERTRAM, GREGSON]),
    },
    imageProfiles: {
      findById: jest.fn().mockResolvedValue({
        id: 'profile-1', apiKeyId: 'key-1', modelName: 'image-model',
        provider: 'openai', name: 'Default Image Profile', parameters: {},
      }),
    },
    connections: {
      findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'sk-test' }),
      findByUserId: jest.fn().mockResolvedValue([
        { id: 'p1', isDefault: true, provider: 'openai', modelName: 'm' },
      ]),
    },
    chatSettings: { findByUserId: jest.fn().mockResolvedValue(null) },
    files: { create: jest.fn().mockResolvedValue({ id: 'file-1' }) },
  } as never)

  mockResolveDanger.mockReturnValue({ settings: { mode: 'OFF', scanImagePrompts: false } } as never)
  mockShouldUseUncensoredRoute.mockReturnValue(false)
  mockGetCheapLLM.mockReturnValue(SELECTION)
  mockResolveUncensoredCheap.mockReturnValue(SELECTION)
  mockExtractConversation.mockReturnValue([])
  mockDeriveScene.mockResolvedValue(null as never)
  mockCraftPrompt.mockResolvedValue({ success: true, result: CRAFTED_PROMPT } as never)
  mockIsModerationError.mockReturnValue(false)
  mockResolveReroute.mockResolvedValue(null as never)

  // Only the present participant is resolved — the payload carries just Alice.
  const appearances = [{
    characterId: ALICE.id,
    characterName: ALICE.name,
    physicalDescription: 'a woman in a rain-darkened coat',
    clothingDescription: null,
  }]
  mockResolveAppearances.mockResolvedValue(appearances as never)
  mockSanitizeAppearances.mockResolvedValue(appearances as never)

  mockCreateImageProvider.mockImplementation(() => ({
    generateImage: jest.fn().mockResolvedValue({
      images: [{ b64Json: Buffer.from('png').toString('base64'), mimeType: 'image/png', revisedPrompt: null }],
    }),
  }) as never)

  mockConvertToWebP.mockResolvedValue({
    buffer: WEBP_BYTES, mimeType: 'image/webp',
    filename: 'story_background.webp', wasConverted: true,
  } as never)

  mockWriteLantern.mockResolvedValue({
    storageKey: 'mount-blob:mock-lantern:blob-1', mountPointId: 'mock-lantern',
    blobId: 'blob-1', relativePath: 'generated/story.webp',
    storedMimeType: 'image/webp', sizeBytes: WEBP_BYTES.length, sha256: 'unused',
  } as never)
})

describe('story-background back-fill — absent participants', () => {
  it('does not enumerate a character who is an absent participant of this chat', async () => {
    await handleStoryBackgroundGeneration(makeJob())

    expect(generatedPrompt()).not.toMatch(/Bertram:/)
  })

  it('still enumerates a named character unaffiliated with the chat', async () => {
    await handleStoryBackgroundGeneration(makeJob())

    expect(generatedPrompt()).toMatch(/Mrs Gregson: /)
  })

  it('leaves the present participant to the crafter, without a portrait sidecard', async () => {
    await handleStoryBackgroundGeneration(makeJob())

    expect(generatedPrompt()).not.toMatch(/Alice:/)
  })
})
