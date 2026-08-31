/**
 * Unit tests for the Carina memory-extraction job handler.
 *
 * jest.setup.ts already globally mocks `@/lib/repositories/factory`
 * (getRepositories) and `@/lib/database/manager`. We configure the repo proxy
 * per-test via jest.mocked in beforeEach and assert on the synthetic transcript
 * handed to processTurnForMemory — the one-slice shape that yields SELF-only
 * memories for the answerer.
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import { handleCarinaMemoryExtraction } from '../carina-memory-extraction';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';

jest.mock('@/lib/memory/memory-processor', () => ({
  processTurnForMemory: jest.fn(),
}));

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(),
}));

jest.mock('@/lib/services/dangerous-content/chat-override', () => ({
  shouldUseUncensoredRoute: jest.fn(),
}));

jest.mock('@/lib/services/system-events.service', () => ({
  createMemoryExtractionEvent: jest.fn(),
}));

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn(),
}));

jest.mock('@/lib/instance-settings', () => ({
  getMemoryExtractionLimits: jest.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { processTurnForMemory } from '@/lib/memory/memory-processor';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override';
import { getMemoryExtractionLimits } from '@/lib/instance-settings';
import type { BackgroundJob } from '@/lib/schemas/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_PROFILE = { id: 'conn-1', provider: 'anthropic', modelName: 'claude-3-haiku' };
const MOCK_SETTINGS = { cheapLLMSettings: { strategy: 'auto' } };
const MOCK_CHAT = { id: 'chat-1', chatType: 'standard', createdAt: '2026-06-01T00:00:00.000Z' };
const MOCK_ANSWERER = { id: 'char-1', name: 'Aria', pronouns: { subject: 'she' } };

const MOCK_CARINA_MESSAGE = {
  type: 'message',
  id: 'carina-msg-1',
  role: 'ASSISTANT',
  content: 'Paris is the capital of France.',
  systemSender: 'carina',
  systemKind: 'carina-response',
  createdAt: '2026-06-07T00:00:00.000Z',
  carinaMeta: { answererId: 'char-1', question: 'What is the capital of France?' },
};

const JOB = {
  id: 'job-1',
  userId: 'user-1',
  type: 'CARINA_MEMORY_EXTRACTION',
  payload: {
    chatId: 'chat-1',
    carinaMessageId: 'carina-msg-1',
    answererId: 'char-1',
    connectionProfileId: 'conn-1',
  },
} as unknown as BackgroundJob;

function makeMockRepos(overrides: Record<string, unknown> = {}) {
  return {
    connections: {
      findById: jest.fn().mockResolvedValue(MOCK_PROFILE),
      findByUserId: jest.fn().mockResolvedValue([MOCK_PROFILE]),
    },
    chatSettings: {
      findByUserId: jest.fn().mockResolvedValue(MOCK_SETTINGS),
    },
    chats: {
      findById: jest.fn().mockResolvedValue(MOCK_CHAT),
      getMessages: jest.fn().mockResolvedValue([MOCK_CARINA_MESSAGE]),
      updateMessage: jest.fn().mockResolvedValue(undefined),
    },
    characters: {
      findById: jest.fn().mockResolvedValue(MOCK_ANSWERER),
    },
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getRepositories).mockReturnValue(makeMockRepos() as never);
  jest.mocked(resolveDangerousContentSettings).mockReturnValue({ settings: { mode: 'OFF' } } as never);
  jest.mocked(shouldUseUncensoredRoute).mockReturnValue(false);
  jest.mocked(getMemoryExtractionLimits).mockResolvedValue({ enabled: false } as never);
  jest.mocked(processTurnForMemory).mockResolvedValue({
    success: true,
    memoriesCreatedCount: 1,
    memoriesReinforcedCount: 0,
    createdMemoryIds: ['mem-1'],
    reinforcedMemoryIds: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    sourceMessageId: 'carina-msg-1',
    debugLogs: [],
  } as never);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleCarinaMemoryExtraction', () => {
  it('builds a one-slice SELF transcript from the question and answer', async () => {
    await handleCarinaMemoryExtraction(JOB);

    expect(processTurnForMemory).toHaveBeenCalledTimes(1);
    const ctx = jest.mocked(processTurnForMemory).mock.calls[0][0];

    // The question opens the (synthetic) turn; no user character → OTHER pass
    // self-skips, leaving SELF-only extraction for the answerer.
    expect(ctx.transcript.userMessage).toBe('What is the capital of France?');
    expect(ctx.transcript.userCharacterId).toBeUndefined();
    expect(ctx.transcript.characterSlices).toHaveLength(1);
    expect(ctx.transcript.characterSlices[0]).toMatchObject({
      characterId: 'char-1',
      characterName: 'Aria',
      text: 'Paris is the capital of France.',
      contributingMessageIds: ['carina-msg-1'],
    });
    expect(ctx.transcript.latestAssistantMessageId).toBe('carina-msg-1');
    expect(ctx.participantCharacters.get('char-1')).toBe(MOCK_ANSWERER);
  });

  it('anchors derived memories to the carina message timestamp', async () => {
    await handleCarinaMemoryExtraction(JOB);
    const ctx = jest.mocked(processTurnForMemory).mock.calls[0][0];
    expect(ctx.sourceMessageTimestamp).toBe('2026-06-07T00:00:00.000Z');
  });

  it('marks autonomous-room provenance when the chat is autonomous', async () => {
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({
        chats: {
          findById: jest.fn().mockResolvedValue({ ...MOCK_CHAT, chatType: 'autonomous' }),
          getMessages: jest.fn().mockResolvedValue([MOCK_CARINA_MESSAGE]),
          updateMessage: jest.fn().mockResolvedValue(undefined),
        },
      }) as never,
    );
    await handleCarinaMemoryExtraction(JOB);
    const ctx = jest.mocked(processTurnForMemory).mock.calls[0][0];
    expect(ctx.inAutonomousRoom).toBe(true);
  });

  it('skips when the carina message is missing', async () => {
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({
        chats: {
          findById: jest.fn().mockResolvedValue(MOCK_CHAT),
          getMessages: jest.fn().mockResolvedValue([]),
          updateMessage: jest.fn().mockResolvedValue(undefined),
        },
      }) as never,
    );
    await handleCarinaMemoryExtraction(JOB);
    expect(processTurnForMemory).not.toHaveBeenCalled();
  });

  it('skips when the answer text is empty', async () => {
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({
        chats: {
          findById: jest.fn().mockResolvedValue(MOCK_CHAT),
          getMessages: jest.fn().mockResolvedValue([{ ...MOCK_CARINA_MESSAGE, content: '   ' }]),
          updateMessage: jest.fn().mockResolvedValue(undefined),
        },
      }) as never,
    );
    await handleCarinaMemoryExtraction(JOB);
    expect(processTurnForMemory).not.toHaveBeenCalled();
  });

  it('skips when the answerer character is gone', async () => {
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({
        characters: { findById: jest.fn().mockResolvedValue(null) },
      }) as never,
    );
    await handleCarinaMemoryExtraction(JOB);
    expect(processTurnForMemory).not.toHaveBeenCalled();
  });

  it('still extracts when the question is absent (answer-only memory)', async () => {
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({
        chats: {
          findById: jest.fn().mockResolvedValue(MOCK_CHAT),
          getMessages: jest.fn().mockResolvedValue([
            { ...MOCK_CARINA_MESSAGE, carinaMeta: { answererId: 'char-1', question: '' } },
          ]),
          updateMessage: jest.fn().mockResolvedValue(undefined),
        },
      }) as never,
    );
    await handleCarinaMemoryExtraction(JOB);
    const ctx = jest.mocked(processTurnForMemory).mock.calls[0][0];
    expect(ctx.transcript.userMessage).toBeNull();
    expect(ctx.transcript.characterSlices).toHaveLength(1);
  });

  it('throws when the connection profile is missing (so the job retries)', async () => {
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({
        connections: {
          findById: jest.fn().mockResolvedValue(null),
          findByUserId: jest.fn().mockResolvedValue([]),
        },
      }) as never,
    );
    await expect(handleCarinaMemoryExtraction(JOB)).rejects.toThrow('Connection profile not found');
  });
});
