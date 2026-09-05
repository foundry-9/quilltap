/**
 * Story-background enqueue: only characters actually in the scene.
 *
 * The prompt crafter is instructed to place every enumerated character as a
 * figure in the frame, so an absent or soft-removed participant reaching the
 * payload gets painted back into a room they walked out of. Both enqueue sites
 * must filter on `isParticipantPresent`.
 */
import { queueStoryBackgroundIfEnabled } from '@/lib/background-jobs/handlers/title-update'
import { handleRegenerateBackground } from '@/app/api/v1/chats/[id]/actions/story-background'
import { enqueueStoryBackgroundGeneration } from '@/lib/background-jobs/queue-service'
import type { ChatMetadata, ChatSettings } from '@/lib/schemas/types'
import type { RequestContext } from '@/lib/api/middleware'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn(() => ({})) }))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  considerTitleUpdate: jest.fn(),
  considerHelpChatTitleUpdate: jest.fn(),
  extractVisibleConversation: jest.fn(() => []),
  throwIfLostToTimeout: jest.fn(),
}))
jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  resolveUncensoredCheapLLMSelection: jest.fn(),
}))
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(() => ({
    settings: { mode: 'OFF', threshold: 0.7 }, source: 'default',
  })),
}))
jest.mock('@/lib/services/dangerous-content/chat-override', () => ({
  shouldUseUncensoredRoute: () => false,
}))
jest.mock('@/lib/services/system-events.service', () => ({
  createTitleGenerationEvent: jest.fn(),
}))
jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn(async () => ({ cost: 0 })),
}))
jest.mock('@/lib/image-gen/profile-resolution', () => ({
  resolveImageProfileForChat: jest.fn(async () => 'image-profile-1'),
}))
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueStoryBackgroundGeneration: jest.fn(async () => ({ jobId: 'job-1', isNew: true })),
}))

const mockEnqueue = enqueueStoryBackgroundGeneration as jest.MockedFunction<
  typeof enqueueStoryBackgroundGeneration
>

/** One participant per status, so a missing filter shows up as extra IDs. */
const participants = [
  { id: 'p-1', type: 'CHARACTER', characterId: 'char-active', status: 'active', isActive: true },
  { id: 'p-2', type: 'CHARACTER', characterId: 'char-silent', status: 'silent', isActive: true },
  { id: 'p-3', type: 'CHARACTER', characterId: 'char-absent', status: 'absent', isActive: false },
  { id: 'p-4', type: 'CHARACTER', characterId: 'char-removed', status: 'removed', isActive: false },
]

const chat = {
  id: 'chat-1',
  userId: 'user-1',
  chatType: 'salon',
  title: 'A Quiet Evening',
  projectId: null,
  participants,
} as unknown as ChatMetadata

const chatSettings = {
  storyBackgroundsSettings: { enabled: true },
} as unknown as ChatSettings

const ctx = {
  user: { id: 'user-1' },
  repos: { chatSettings: { findByUserId: jest.fn(async () => chatSettings) } },
} as unknown as RequestContext

describe('story-background enqueue participant filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEnqueue.mockResolvedValue({ jobId: 'job-1', isNew: true })
  })

  it('auto-trigger enqueues only present (active/silent) characters', async () => {
    await queueStoryBackgroundIfEnabled('user-1', chat, chatSettings, 'A Quiet Evening')

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue.mock.calls[0][1].characterIds).toEqual(['char-active', 'char-silent'])
  })

  it('manual regeneration enqueues only present (active/silent) characters', async () => {
    await handleRegenerateBackground('chat-1', chat, ctx)

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue.mock.calls[0][1].characterIds).toEqual(['char-active', 'char-silent'])
  })

  it('does not enqueue at all when every participant has left the scene', async () => {
    const emptyScene = {
      ...chat,
      participants: participants.filter(p => p.status === 'absent' || p.status === 'removed'),
    } as unknown as ChatMetadata

    await queueStoryBackgroundIfEnabled('user-1', emptyScene, chatSettings, 'A Quiet Evening')

    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
