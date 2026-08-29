import {
  shouldChainNext,
  persistTurnParticipantId,
  executeTurnChain,
  DEFAULT_CHAIN_CONFIG,
} from '@/lib/services/chat-message/turn-orchestrator.service';
import * as turnManager from '@/lib/chat/turn-manager';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock('@/lib/chat/turn-manager', () => ({
  calculateTurnStateFromHistory: jest.fn().mockReturnValue({
    lastSpeakerId: null,
    turnsSinceUser: 0,
    participantTurnCounts: new Map(),
  }),
  selectNextSpeaker: jest.fn().mockReturnValue({ nextSpeakerId: null, reason: 'no_speakers' }),
  getActiveCharacterParticipants: jest.fn().mockReturnValue([]),
  isAllLLMChat: jest.fn().mockReturnValue(false),
  shouldPauseForAllLLM: jest.fn().mockReturnValue(false),
  isUserDrivenSeat: (p: { id?: string; controlledBy?: string } | null | undefined, ids?: readonly string[] | null) =>
    p?.controlledBy === 'user' || (Array.isArray(ids) && !!p?.id && ids.includes(p.id)),
}));

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  encodeTurnStartEvent: jest.fn((_encoder: TextEncoder, data: unknown) => data),
  encodeTurnCompleteEvent: jest.fn((_encoder: TextEncoder, data: unknown) => data),
  encodeChainCompleteEvent: jest.fn((_encoder: TextEncoder, data: unknown) => data),
  safeEnqueue: jest.fn((controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => {
    controller.enqueue(chunk);
  }),
}));

const llmParticipant = {
  id: 'llm-1',
  characterId: 'char-llm-1',
  controlledBy: 'llm',
  type: 'CHARACTER',
  isActive: true,
};

const userParticipant = {
  id: 'user-p-1',
  characterId: 'char-user-1',
  controlledBy: 'user',
  type: 'CHARACTER',
  isActive: true,
};

describe('turn-orchestrator.service', () => {
  const createMockRepos = () => ({
    chats: {
      findById: jest.fn(),
      getMessages: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
    characters: {
      findById: jest.fn().mockResolvedValue({ id: 'char-llm-1', name: 'TestChar' }),
    },
  });

  const createMockChat = (overrides: Record<string, unknown> = {}) => ({
    id: 'chat-1',
    isPaused: false,
    lastTurnParticipantId: null,
    turnQueue: '[]',
    participants: [llmParticipant],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (turnManager.selectNextSpeaker as jest.Mock).mockReturnValue({ nextSpeakerId: null, reason: 'no_speakers' });
    (turnManager.getActiveCharacterParticipants as jest.Mock).mockReturnValue([]);
    (turnManager.isAllLLMChat as jest.Mock).mockReturnValue(false);
  });

  describe('DEFAULT_CHAIN_CONFIG', () => {
    it('should have maxChainDepth of 20', () => {
      expect(DEFAULT_CHAIN_CONFIG.maxChainDepth).toBe(20);
    });

    it('should have maxChainTimeMs of 300000', () => {
      expect(DEFAULT_CHAIN_CONFIG.maxChainTimeMs).toBe(300000);
    });
  });

  describe('shouldChainNext', () => {
    it('returns chain: false when chat not found', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(null);

      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p', 0, Date.now());
      expect(result.chain).toBe(false);
      expect(result.reason).toBe('error');
    });

    it('returns chain: false when chat is paused', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(createMockChat({ isPaused: true }));

      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p', 0, Date.now());
      expect(result.chain).toBe(false);
      expect(result.reason).toBe('paused');
    });

    it('returns chain: false when maxChainDepth exceeded', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(createMockChat());

      const config = { ...DEFAULT_CHAIN_CONFIG, maxChainDepth: 5 };
      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p', 5, Date.now(), config);
      expect(result.chain).toBe(false);
      expect(result.reason).toBe('max_depth');
    });

    it('returns chain: false when maxChainTimeMs exceeded', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(createMockChat());

      const startTime = Date.now() - 400000;
      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p', 0, startTime);
      expect(result.chain).toBe(false);
      expect(result.reason).toBe('max_time');
    });

    it('returns chain: true when turn queue has LLM participant', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(createMockChat({
        turnQueue: JSON.stringify(['llm-1']),
        participants: [llmParticipant, userParticipant],
      }));

      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p-1', 0, Date.now());
      expect(result.chain).toBe(true);
      expect(result.participantId).toBe('llm-1');
      expect(result.characterName).toBe('TestChar');
    });

    it('returns chain: false when turn queue has user participant', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(createMockChat({
        turnQueue: JSON.stringify(['user-p-1']),
        participants: [llmParticipant, userParticipant],
      }));

      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p-1', 0, Date.now());
      expect(result.chain).toBe(false);
      expect(result.reason).toBe('user_turn');
    });

    it('uses selectNextSpeaker when queue is empty', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(createMockChat({
        participants: [llmParticipant],
      }));
      (turnManager.getActiveCharacterParticipants as jest.Mock).mockReturnValue([llmParticipant]);
      (turnManager.selectNextSpeaker as jest.Mock).mockReturnValue({ nextSpeakerId: 'llm-1', reason: 'round_robin' });

      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p', 0, Date.now());
      expect(turnManager.selectNextSpeaker).toHaveBeenCalled();
      expect(result.chain).toBe(true);
      expect(result.participantId).toBe('llm-1');
    });

    it('returns chain: false when selectNextSpeaker returns user', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(createMockChat({
        participants: [llmParticipant, userParticipant],
      }));
      (turnManager.getActiveCharacterParticipants as jest.Mock).mockReturnValue([llmParticipant]);
      (turnManager.selectNextSpeaker as jest.Mock).mockReturnValue({ nextSpeakerId: 'user-p-1', reason: 'round_robin' });

      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p-1', 0, Date.now());
      expect(result.chain).toBe(false);
      expect(result.reason).toBe('user_turn');
    });

    it('returns chain: false when no next speaker', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(createMockChat());
      (turnManager.selectNextSpeaker as jest.Mock).mockReturnValue({ nextSpeakerId: null, reason: 'no_speakers' });

      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p', 0, Date.now());
      expect(result.chain).toBe(false);
      expect(result.reason).toBe('no_next_speaker');
    });

    it('uses DEFAULT_CHAIN_CONFIG when no config provided', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(createMockChat());

      // chainDepth under default max (20), time under default max (300s)
      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p', 5, Date.now());
      // Should not fail on depth/time, will proceed to speaker selection
      expect(result.reason).not.toBe('max_depth');
      expect(result.reason).not.toBe('max_time');
    });

    it('chain decision includes characterName from character lookup', async () => {
      const repos = createMockRepos();
      repos.chats.findById.mockResolvedValue(createMockChat({
        turnQueue: JSON.stringify(['llm-1']),
      }));
      repos.characters.findById.mockResolvedValue({ id: 'char-llm-1', name: 'Alice' });

      const result = await shouldChainNext(repos as any, 'chat-1', 'user-p', 0, Date.now());
      expect(result.chain).toBe(true);
      expect(result.characterName).toBe('Alice');
      expect(result.reason).toBe('continue');
    });
  });

  describe('executeTurnChain', () => {
    const encoder = new TextEncoder();

    const initialResult = {
      isMultiCharacter: true,
      hasContent: true,
      messageId: 'msg-1',
      userParticipantId: 'user-p-1',
      isPaused: false,
    };

    it('processes chained turns and emits completion events', async () => {
      const repos = createMockRepos();
      const controller = { enqueue: jest.fn() } as any;
      const decideNextTurn = jest
        .fn()
        .mockResolvedValueOnce({ chain: true, participantId: 'llm-1', characterName: 'Alice', reason: 'continue' })
        .mockResolvedValueOnce({ chain: false, participantId: null, reason: 'cycle_complete' });
      const persistTurnParticipant = jest.fn().mockResolvedValue(undefined);
      const processChainedMessage = jest.fn().mockResolvedValue({
        ...initialResult,
        messageId: 'msg-2',
      });

      await executeTurnChain({
        repos: repos as any,
        chatId: 'chat-1',
        userId: 'user-1',
        initialResult,
        initialContinueMode: false,
        controller,
        encoder,
        processChainedMessage,
        decideNextTurn,
        persistTurnParticipant,
      });

      expect(processChainedMessage).toHaveBeenCalledWith({
        continueMode: true,
        respondingParticipantId: 'llm-1',
      });
      expect(persistTurnParticipant).toHaveBeenCalledWith(repos, 'chat-1', null);
      expect(controller.enqueue).toHaveBeenCalledWith(expect.objectContaining({
        participantId: 'llm-1',
        chainDepth: 1,
      }));
    });

    it('continues the chain when a chained turn is skipped (nothing to add)', async () => {
      const repos = createMockRepos();
      const controller = { enqueue: jest.fn() } as any;
      const decideNextTurn = jest
        .fn()
        .mockResolvedValueOnce({ chain: true, participantId: 'llm-1', characterName: 'Alice', reason: 'continue' })
        .mockResolvedValueOnce({ chain: true, participantId: 'llm-2', characterName: 'Bob', reason: 'continue' })
        .mockResolvedValueOnce({ chain: false, participantId: null, reason: 'cycle_complete' });
      const persistTurnParticipant = jest.fn().mockResolvedValue(undefined);
      // First chained turn is a skip; second has content. The skip must NOT stop
      // the chain — decideNextTurn should be consulted a second time.
      const processChainedMessage = jest
        .fn()
        .mockResolvedValueOnce({ ...initialResult, hasContent: false, skipped: true, skippedParticipantId: 'llm-1', messageId: null })
        .mockResolvedValueOnce({ ...initialResult, messageId: 'msg-2' });

      await executeTurnChain({
        repos: repos as any,
        chatId: 'chat-1',
        userId: 'user-1',
        initialResult,
        initialContinueMode: false,
        controller,
        encoder,
        processChainedMessage,
        decideNextTurn,
        persistTurnParticipant,
      });

      expect(processChainedMessage).toHaveBeenCalledTimes(2);
      // The turnComplete event for the skipped turn carries skipped:true.
      expect(controller.enqueue).toHaveBeenCalledWith(expect.objectContaining({
        participantId: 'llm-1',
        skipped: true,
      }));
    });

    it('continues the chain when the INITIAL turn is skipped', async () => {
      const repos = createMockRepos();
      const controller = { enqueue: jest.fn() } as any;
      const decideNextTurn = jest
        .fn()
        .mockResolvedValueOnce({ chain: true, participantId: 'llm-1', characterName: 'Alice', reason: 'continue' })
        .mockResolvedValueOnce({ chain: false, participantId: null, reason: 'cycle_complete' });
      const persistTurnParticipant = jest.fn().mockResolvedValue(undefined);
      const processChainedMessage = jest.fn().mockResolvedValue({ ...initialResult, messageId: 'msg-2' });

      // Initial turn skipped (no content) but skipped:true — the entry gate must
      // NOT short-circuit; the chain proceeds to the next speaker.
      await executeTurnChain({
        repos: repos as any,
        chatId: 'chat-1',
        userId: 'user-1',
        initialResult: { ...initialResult, hasContent: false, skipped: true, skippedParticipantId: 'llm-0', messageId: null },
        initialContinueMode: false,
        controller,
        encoder,
        processChainedMessage,
        decideNextTurn,
        persistTurnParticipant,
      });

      expect(processChainedMessage).toHaveBeenCalledTimes(1);
    });

    it('stops the chain on a genuinely empty turn (no content, no skip)', async () => {
      const repos = createMockRepos();
      const controller = { enqueue: jest.fn() } as any;
      const decideNextTurn = jest
        .fn()
        .mockResolvedValueOnce({ chain: true, participantId: 'llm-1', characterName: 'Alice', reason: 'continue' })
        .mockResolvedValueOnce({ chain: true, participantId: 'llm-2', characterName: 'Bob', reason: 'continue' });
      const persistTurnParticipant = jest.fn().mockResolvedValue(undefined);
      const processChainedMessage = jest.fn().mockResolvedValue({
        ...initialResult,
        hasContent: false,
        messageId: null,
      });

      await executeTurnChain({
        repos: repos as any,
        chatId: 'chat-1',
        userId: 'user-1',
        initialResult,
        initialContinueMode: false,
        controller,
        encoder,
        processChainedMessage,
        decideNextTurn,
        persistTurnParticipant,
      });

      // Empty (not skipped) stops after the first chained turn.
      expect(processChainedMessage).toHaveBeenCalledTimes(1);
    });

    it('stops immediately when chaining should not continue', async () => {
      const repos = createMockRepos();
      const controller = { enqueue: jest.fn() } as any;
      const decideNextTurn = jest.fn().mockResolvedValue({
        chain: false,
        participantId: null,
        reason: 'user_turn',
      });
      const persistTurnParticipant = jest.fn().mockResolvedValue(undefined);
      const processChainedMessage = jest.fn();

      await executeTurnChain({
        repos: repos as any,
        chatId: 'chat-1',
        userId: 'user-1',
        initialResult,
        initialContinueMode: false,
        controller,
        encoder,
        processChainedMessage,
        decideNextTurn,
        persistTurnParticipant,
      });

      expect(processChainedMessage).not.toHaveBeenCalled();
      expect(persistTurnParticipant).toHaveBeenCalledWith(repos, 'chat-1', null);
      expect(controller.enqueue).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'user_turn',
        nextSpeakerId: null,
      }));
    });

    it('skips the chain loop entirely when singleTurn is set', async () => {
      // singleTurn is the autonomous-room flag: each handler invocation is one
      // character turn, the caller enqueues the next. Verify that no chained
      // turn fires, no chainComplete event is emitted (callers handle their
      // own lifecycle), and no turn-participant persistence happens.
      const repos = createMockRepos();
      const controller = { enqueue: jest.fn() } as any;
      const decideNextTurn = jest.fn();
      const persistTurnParticipant = jest.fn().mockResolvedValue(undefined);
      const processChainedMessage = jest.fn();

      await executeTurnChain({
        repos: repos as any,
        chatId: 'chat-1',
        userId: 'user-1',
        initialResult,
        initialContinueMode: false,
        controller,
        encoder,
        processChainedMessage,
        decideNextTurn,
        persistTurnParticipant,
        singleTurn: true,
      });

      expect(decideNextTurn).not.toHaveBeenCalled();
      expect(processChainedMessage).not.toHaveBeenCalled();
      expect(persistTurnParticipant).not.toHaveBeenCalled();
      expect(controller.enqueue).not.toHaveBeenCalled();
    });

    it('pauses the chat and stops when a chained turn throws', async () => {
      const repos = createMockRepos();
      const controller = { enqueue: jest.fn() } as any;
      const decideNextTurn = jest.fn().mockResolvedValue({
        chain: true,
        participantId: 'llm-1',
        characterName: 'Alice',
        reason: 'continue',
      });
      const persistTurnParticipant = jest.fn().mockResolvedValue(undefined);
      const processChainedMessage = jest.fn().mockRejectedValue(new Error('boom'));

      await executeTurnChain({
        repos: repos as any,
        chatId: 'chat-1',
        userId: 'user-1',
        initialResult,
        initialContinueMode: false,
        controller,
        encoder,
        processChainedMessage,
        decideNextTurn,
        persistTurnParticipant,
      });

      expect(repos.chats.update).toHaveBeenCalledWith('chat-1', { isPaused: true });
      expect(persistTurnParticipant).toHaveBeenCalledWith(repos, 'chat-1', null);
      expect(controller.enqueue).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'error',
        nextSpeakerId: null,
      }));
    });
  });

  describe('persistTurnParticipantId', () => {
    it('calls repos.chats.update with lastTurnParticipantId', async () => {
      const repos = createMockRepos();
      await persistTurnParticipantId(repos as any, 'chat-1', 'participant-1');
      expect(repos.chats.update).toHaveBeenCalledWith('chat-1', { lastTurnParticipantId: 'participant-1' });
    });

    it('handles null participantId', async () => {
      const repos = createMockRepos();
      await persistTurnParticipantId(repos as any, 'chat-1', null);
      expect(repos.chats.update).toHaveBeenCalledWith('chat-1', { lastTurnParticipantId: null });
    });

    it('does not throw when update fails', async () => {
      const repos = createMockRepos();
      repos.chats.update.mockRejectedValue(new Error('DB error'));
      await expect(persistTurnParticipantId(repos as any, 'chat-1', 'p-1')).resolves.not.toThrow();
    });
  });
});
