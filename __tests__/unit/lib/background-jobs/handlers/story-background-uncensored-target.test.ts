/**
 * The story-background handler decides whether the crafted prompt is bound for
 * a moderated image provider or a Concierge uncensored one, and passes that as
 * `uncensoredImageTarget`. Appearance sanitization already steps aside for a
 * dangerous chat with an uncensored image profile configured; before this the
 * prompt crafter did not, so an uncensored provider still received a scene with
 * a sheet draped over it.
 *
 * Also locks the moderation-reroute path: a prompt crafted for a moderated
 * provider that the provider then rejects is re-crafted candidly for the
 * reroute target rather than resent as-is.
 *
 * Scaffolding mirrors story-background-sha256.test.ts: subject import first,
 * bare jest.mock() factories, behaviour wired in beforeEach.
 */

import { handleStoryBackgroundGeneration } from '@/lib/background-jobs/handlers/story-background'
import { getRepositories } from '@/lib/repositories/factory'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { convertToWebP } from '@/lib/files/webp-conversion'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { isChatActiveDangerous } from '@/lib/services/dangerous-content/chat-override'
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
  isChatActiveDangerous: jest.fn(),
}))
jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  isImageModerationError: jest.fn(),
  resolveUncensoredImageProfileForReroute: jest.fn(),
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
const WEBP_BYTES = Buffer.from('converted webp bytes')

const CONCEALED_PROMPT = 'a shuttered bedroom, a sheet draped across her hips'
const CANDID_PROMPT = 'a shuttered bedroom, a woman lying nude in tousled sheets'

const mockGetRepositories = jest.mocked(getRepositories)
const mockCreateImageProvider = jest.mocked(createImageProvider)
const mockConvertToWebP = jest.mocked(convertToWebP)
const mockResolveDanger = jest.mocked(resolveDangerousContentSettings)
const mockIsDangerous = jest.mocked(isChatActiveDangerous)
const mockGetCheapLLM = jest.mocked(getCheapLLMProvider)
const mockResolveUncensoredCheap = jest.mocked(resolveUncensoredCheapLLMSelection)
const mockCraftPrompt = jest.mocked(craftStoryBackgroundPrompt)
const mockExtractConversation = jest.mocked(extractVisibleConversation)
const mockDeriveScene = jest.mocked(deriveSceneContext)
const mockIsModerationError = jest.mocked(isImageModerationError)
const mockResolveReroute = jest.mocked(resolveUncensoredImageProfileForReroute)
const mockWriteLantern = jest.mocked(writeLanternBackgroundToMountStore)

const SELECTION = {
  provider: 'openai', modelName: 'm', connectionProfileId: 'p1', isLocal: false,
} as never

function makeJob() {
  return {
    id: 'job-1',
    userId: USER,
    payload: {
      chatId: CHAT_ID,
      characterIds: [],
      imageProfileId: 'profile-1',
      sceneContext: 'the morning after',
      projectId: null,
    },
  } as never
}

/** The `uncensoredImageTarget` flag on the nth craft call. */
function craftTargetFlag(call = 0): boolean | undefined {
  const ctx = mockCraftPrompt.mock.calls[call][0] as { uncensoredImageTarget?: boolean }
  return ctx.uncensoredImageTarget
}

/** Wire the Concierge to a dangerous chat, with or without an uncensored image profile. */
function markDangerous(withUncensoredImageProfile: boolean) {
  mockIsDangerous.mockReturnValue(true)
  mockResolveDanger.mockReturnValue({
    settings: {
      mode: 'AUTO_ROUTE',
      scanImagePrompts: true,
      uncensoredImageProfileId: withUncensoredImageProfile ? 'uncensored-image-profile' : null,
    },
  } as never)
  // Dangerous chats swap the cheap LLM for the uncensored text profile.
  mockResolveUncensoredCheap.mockReturnValue(SELECTION)
}

function imageProviderMock() {
  return mockCreateImageProvider.mock.results[
    mockCreateImageProvider.mock.results.length - 1
  ].value as { generateImage: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()

  mockGetRepositories.mockReturnValue({
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: CHAT_ID, projectId: null, title: 'The Morning After',
        sceneState: null, messageCount: 0, contextSummary: null,
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
  mockIsDangerous.mockReturnValue(false)
  mockGetCheapLLM.mockReturnValue(SELECTION)
  mockResolveUncensoredCheap.mockReturnValue(SELECTION)
  mockExtractConversation.mockReturnValue([])
  mockDeriveScene.mockResolvedValue(null as never)
  mockCraftPrompt.mockResolvedValue({ success: true, result: CONCEALED_PROMPT } as never)
  mockIsModerationError.mockReturnValue(false)
  mockResolveReroute.mockResolvedValue(null as never)

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

describe('story-background handler — uncensoredImageTarget', () => {
  it('conceals for an ordinary chat', async () => {
    await handleStoryBackgroundGeneration(makeJob())

    expect(mockCraftPrompt).toHaveBeenCalledTimes(1)
    expect(craftTargetFlag()).toBe(false)
  })

  it('conceals for a dangerous chat with NO uncensored image profile configured', async () => {
    markDangerous(false)

    await handleStoryBackgroundGeneration(makeJob())

    expect(craftTargetFlag()).toBe(false)
  })

  it('crafts candidly for a dangerous chat with an uncensored image profile configured', async () => {
    markDangerous(true)

    await handleStoryBackgroundGeneration(makeJob())

    expect(craftTargetFlag()).toBe(true)
  })
})

describe('story-background handler — moderation reroute', () => {
  /** First provider instance rejects for moderation; the reroute target accepts. */
  function rejectThenReroute() {
    mockIsModerationError.mockReturnValue(true)
    mockResolveReroute.mockResolvedValue({
      profile: {
        id: 'uncensored-image-profile', provider: 'openai',
        modelName: 'uncensored-model', parameters: {},
      },
      apiKey: 'sk-uncensored',
    } as never)

    let call = 0
    mockCreateImageProvider.mockImplementation(() => {
      call += 1
      return (call === 1
        ? { generateImage: jest.fn().mockRejectedValue(new Error('content moderation')) }
        : {
            generateImage: jest.fn().mockResolvedValue({
              images: [{ b64Json: Buffer.from('png').toString('base64'), mimeType: 'image/png', revisedPrompt: null }],
            }),
          }) as never
    })
  }

  it('re-crafts the prompt candidly before resending to the uncensored provider', async () => {
    rejectThenReroute()
    mockCraftPrompt
      .mockResolvedValueOnce({ success: true, result: CONCEALED_PROMPT } as never)
      .mockResolvedValueOnce({ success: true, result: CANDID_PROMPT } as never)

    await handleStoryBackgroundGeneration(makeJob())

    expect(mockCraftPrompt).toHaveBeenCalledTimes(2)
    expect(craftTargetFlag(0)).toBe(false)
    expect(craftTargetFlag(1)).toBe(true)

    const sent = imageProviderMock().generateImage.mock.calls[0][0] as { prompt: string }
    expect(sent.prompt).toContain(CANDID_PROMPT)
    expect(sent.prompt).not.toContain('sheet draped')
  })

  it('falls back to the already-crafted prompt when the candid re-craft fails', async () => {
    rejectThenReroute()
    mockCraftPrompt
      .mockResolvedValueOnce({ success: true, result: CONCEALED_PROMPT } as never)
      .mockRejectedValueOnce(new Error('cheap LLM unavailable'))

    await handleStoryBackgroundGeneration(makeJob())

    // The reroute still happens — a failed re-craft must not lose the image.
    const sent = imageProviderMock().generateImage.mock.calls[0][0] as { prompt: string }
    expect(sent.prompt).toContain(CONCEALED_PROMPT)
  })

  it('does not re-craft when the prompt was already crafted candidly', async () => {
    markDangerous(true)
    rejectThenReroute()

    await handleStoryBackgroundGeneration(makeJob())

    expect(mockCraftPrompt).toHaveBeenCalledTimes(1)
    expect(craftTargetFlag(0)).toBe(true)
  })
})
