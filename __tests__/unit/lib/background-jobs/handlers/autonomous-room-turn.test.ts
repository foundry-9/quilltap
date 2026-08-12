import {
  handleAutonomousRoomTurn,
  computeAutonomousContextCap,
  DEFAULT_AUTONOMOUS_TARGET_TURNS,
  MIN_AUTONOMOUS_CONTEXT_TOKENS,
} from '@/lib/background-jobs/handlers/autonomous-room-turn'
import type { ChatMetadataBase } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { handleSendMessage } from '@/lib/services/chat-message/orchestrator.service'
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  getActiveCharacterParticipants,
} from '@/lib/chat/turn-manager'
import { enqueueAutonomousRoomTurn } from '@/lib/background-jobs/queue-service'
import { checkAndGenerateSummaryIfNeeded } from '@/lib/chat/context-summary'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/services/chat-message/orchestrator.service', () => ({
  handleSendMessage: jest.fn(),
}))
jest.mock('@/lib/chat/turn-manager', () => ({
  selectNextSpeaker: jest.fn(),
  calculateTurnStateFromHistory: jest.fn(),
  getActiveCharacterParticipants: jest.fn(),
}))
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueAutonomousRoomTurn: jest.fn(),
}))
jest.mock('@/lib/chat/context-summary', () => ({
  checkAndGenerateSummaryIfNeeded: jest.fn(),
}))

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockHandleSendMessage = handleSendMessage as jest.MockedFunction<typeof handleSendMessage>
const mockSelectNextSpeaker = selectNextSpeaker as jest.MockedFunction<typeof selectNextSpeaker>
const mockCalculateTurnStateFromHistory = calculateTurnStateFromHistory as jest.MockedFunction<typeof calculateTurnStateFromHistory>
const mockGetActiveCharacterParticipants = getActiveCharacterParticipants as jest.MockedFunction<typeof getActiveCharacterParticipants>
const mockEnqueueAutonomousRoomTurn = enqueueAutonomousRoomTurn as jest.MockedFunction<typeof enqueueAutonomousRoomTurn>
const mockCheckAndGenerateSummaryIfNeeded = checkAndGenerateSummaryIfNeeded as jest.MockedFunction<typeof checkAndGenerateSummaryIfNeeded>

/**
 * Build a child-style repository proxy that simulates the readonly-DB +
 * buffered-writes semantics of the forked-job runner. Reads return the
 * "committed" snapshot; writes are recorded but do NOT update the snapshot
 * (mirroring how the AsyncLocalStorage buffer holds writes until flush at
 * end of job, with the readonly connection unable to see them).
 */
const createBufferedRepos = (initial: {
  chat: Record<string, unknown>
  jobId: string
  chatId: string
}) => {
  const committed = { ...initial.chat }
  const chatUpdates: Array<Record<string, unknown>> = []
  const messageAdds: Array<{ id?: string; createdAt?: string; participantId?: string | null; type?: string }> = []

  return {
    state: {
      get committed() { return committed },
      get chatUpdates() { return chatUpdates },
      get messageAdds() { return messageAdds },
    },
    repos: {
      chats: {
        findById: jest.fn(async () => ({ ...committed })),
        getMessages: jest.fn(async () => messageAdds),
        update: jest.fn(async (_id: string, patch: Record<string, unknown>) => {
          chatUpdates.push({ ...patch })
          // Buffered: do NOT update `committed`.
        }),
        addMessage: jest.fn(async (_id: string, message: Record<string, unknown>) => {
          messageAdds.push(message as never)
        }),
      },
      chatSettings: {
        findByUserId: jest.fn(async () => null),
      },
      llmLogs: {
        getTotalTokenUsageForRun: jest.fn(async () => ({ totalTokens: 0 })),
        getTotalTokenUsageForChatSince: jest.fn(async () => ({ totalTokens: 0 })),
        getTotalTokenUsageSince: jest.fn(async () => ({ totalTokens: 0 })),
      },
      characters: {
        findById: jest.fn(async (id: string) => ({ id, name: `Char-${id}` })),
      },
      backgroundJobs: {
        findPendingForChat: jest.fn(async () => []),
      },
    },
  }
}

const baseJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  userId: 'user-1',
  type: 'AUTONOMOUS_ROOM_TURN' as const,
  status: 'PROCESSING' as const,
  payload: { chatId: 'chat-1', runId: 'run-A' },
  priority: 0,
  attempts: 0,
  maxAttempts: 3,
  lastError: null,
  scheduledAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const baseChat = (overrides: Record<string, unknown> = {}) => ({
  id: 'chat-1',
  userId: 'user-1',
  chatType: 'autonomous',
  currentRunId: 'run-A',
  runState: 'running',
  runStartedAt: '2026-05-26T16:00:00.000Z',
  runTurnsConsumed: 5,
  runTokensConsumed: 1000,
  budgetMaxTurns: null,
  budgetMaxTokens: null,
  budgetMaxWallClockMs: null,
  scheduleCron: null,
  scheduleNextRunAt: null,
  participants: [
    { id: 'p1', characterId: 'char-1', type: 'CHARACTER', status: 'active', controlledBy: 'llm' },
    { id: 'p2', characterId: 'char-2', type: 'CHARACTER', status: 'active', controlledBy: 'llm' },
  ],
  spokenThisCycleParticipantIds: [],
  ...overrides,
})

/**
 * Minimal duck-typed ReadableStream that satisfies the handler's `drainStream`
 * loop (Jest's jsdom env doesn't expose the real Web Streams API).
 */
const drainableStream = () => ({
  getReader: () => ({
    read: async () => ({ done: true, value: undefined }),
    releaseLock: () => {},
  }),
})

beforeEach(() => {
  jest.clearAllMocks()
  mockHandleSendMessage.mockResolvedValue(drainableStream() as never)
  mockGetActiveCharacterParticipants.mockImplementation(((participants: Array<{ id: string }>) => participants) as never)
  mockCalculateTurnStateFromHistory.mockReturnValue({} as never)
  mockSelectNextSpeaker.mockReturnValue({ nextSpeakerId: 'p1', reason: 'next', cycleComplete: false } as never)
  mockEnqueueAutonomousRoomTurn.mockResolvedValue('job-next')
})

describe('handleAutonomousRoomTurn — counter bookkeeping', () => {
  // Regression: the child-side repo proxy buffers writes; a read-modify-write
  // off `findById` after `update` always picks up the *previous* run's stale
  // counter, so the in-job increment-write lands after the reset-write at
  // flush time and clobbers it. The counter then accumulates across every
  // run forever. Verify the increment uses the local in-handler snapshot.

  it('resets the counter to 1 on the first turn of a new run (idle → running)', async () => {
    // Committed DB still shows the previous run's leftover counter (999),
    // because the manual-start path did NOT reset it — the reset happens
    // inside this handler at the idle → running transition.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'idle', runTurnsConsumed: 999, runTokensConsumed: 50000 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    // The first chats.update fires the idle → running reset (runTurnsConsumed:
    // 0). The final chats.update writes the post-turn counter. We assert on
    // the latter: it must be 1, not 1000 (the bug would yield 1000 because
    // post.runTurnsConsumed reads the still-stale 999 from the readonly DB).
    const updatesWithTurns = state.chatUpdates.filter(u => 'runTurnsConsumed' in u)
    expect(updatesWithTurns.length).toBeGreaterThanOrEqual(2)
    const resetUpdate = updatesWithTurns[0]
    const finalUpdate = updatesWithTurns[updatesWithTurns.length - 1]
    expect(resetUpdate.runTurnsConsumed).toBe(0)
    expect(finalUpdate.runTurnsConsumed).toBe(1)
  })

  it('clears the token counter to this run\'s own usage on the first turn of a new run', async () => {
    // Same buffered-read hazard as the turn counter, one field over: a fresh
    // manual/scheduled start leaves the previous run's 50000-token total in
    // the committed DB (the reset to 0 is buffered in the job child). This
    // run actually spent 3000 tokens. The post-turn write must record 3000,
    // not Math.max(3000, 50000) = 50000 — the bug floored against the stale
    // re-read `post.runTokensConsumed` and carried the old run's count over.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'idle', runTurnsConsumed: 999, runTokensConsumed: 50000 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    repos.llmLogs.getTotalTokenUsageForRun = jest.fn(async () => ({ totalTokens: 3000 })) as never
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const updatesWithTokens = state.chatUpdates.filter(u => 'runTokensConsumed' in u)
    const resetUpdate = updatesWithTokens[0]
    const finalUpdate = updatesWithTokens[updatesWithTokens.length - 1]
    expect(resetUpdate.runTokensConsumed).toBe(0)
    expect(finalUpdate.runTokensConsumed).toBe(3000)
  })

  it('keeps the accumulated token count when continuing a run (resume)', async () => {
    // A resumed run is already `running` (the service flipped it back without
    // touching the counters), so the idle → running reset never fires and
    // chat.runTokensConsumed holds the genuine pre-pause total (20000). The
    // run keeps accumulating: getTotalTokenUsageForRun re-sums every llm_logs
    // row tagged with the preserved runId (pre-pause + this turn) = 23000.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 5, runTokensConsumed: 20000 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    repos.llmLogs.getTotalTokenUsageForRun = jest.fn(async () => ({ totalTokens: 23000 })) as never
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const updatesWithTokens = state.chatUpdates.filter(u => 'runTokensConsumed' in u)
    // No reset write — only the single post-turn update.
    expect(updatesWithTokens).toHaveLength(1)
    expect(updatesWithTokens[0].runTokensConsumed).toBe(23000)
  })

  it('floors a transient zero token read against the run\'s preserved count (resume)', async () => {
    // The run's rows are buffered one turn behind, so a transient read can
    // return 0; Math.max against the local snapshot keeps the counter
    // monotonic. On a continuing run that floor is the preserved 20000 — the
    // count must never drop back to 0 mid-run.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 5, runTokensConsumed: 20000 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    // Default getTotalTokenUsageForRun returns { totalTokens: 0 }.
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const updatesWithTokens = state.chatUpdates.filter(u => 'runTokensConsumed' in u)
    expect(updatesWithTokens).toHaveLength(1)
    expect(updatesWithTokens[0].runTokensConsumed).toBe(20000)
  })

  it('increments off the local snapshot when continuing a run (already running)', async () => {
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 7 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const updatesWithTurns = state.chatUpdates.filter(u => 'runTurnsConsumed' in u)
    // No reset on a continuing run — only the single post-turn update.
    expect(updatesWithTurns).toHaveLength(1)
    expect(updatesWithTurns[0].runTurnsConsumed).toBe(8)
  })

  it('does NOT post the run-start banner when continuing an already-running run (resume)', async () => {
    // A resumed run is flipped to `running` by the service before the turn
    // job lands, so the handler must skip the idle → running start block —
    // no "autonomous-room-start" announcement, no counter reset.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 5, runTokensConsumed: 1000 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const startAnnouncements = state.messageAdds.filter(
      (m) => (m as { systemKind?: string }).systemKind === 'autonomous-room-start',
    )
    expect(startAnnouncements).toHaveLength(0)
    // No reset write either — counters only get the single post-turn update.
    const resetWrites = state.chatUpdates.filter(
      (u) => u.runTurnsConsumed === 0 && u.runTokensConsumed === 0,
    )
    expect(resetWrites).toHaveLength(0)
  })

  it('does not increment when handleSendMessage throws (turn failed)', async () => {
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 7 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)
    mockHandleSendMessage.mockRejectedValueOnce(new Error('boom'))

    await handleAutonomousRoomTurn(baseJob() as never)

    // No increment-write should land — only the error transition.
    const updatesWithTurns = state.chatUpdates.filter(
      u => 'runTurnsConsumed' in u && typeof u.runTurnsConsumed === 'number',
    )
    expect(updatesWithTurns).toHaveLength(0)
  })

  it('does NOT trip budgetExhausted on the first turn of a fresh run with a small turn cap', async () => {
    // Original user-reported symptom: a chat with budgetMaxTurns=10 and a
    // stale counter of 999 carried over from a prior run would trip
    // budgetExhausted immediately on the first turn — the buggy
    // read-modify-write off `post.runTurnsConsumed` ignored the buffered
    // reset and saw 999 + 1 = 1000 >= 10. With the fix, the local snapshot
    // (mutated to 0 on the idle → running transition) gives 0 + 1 = 1,
    // well under the cap, so the next turn is enqueued normally.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({
        runState: 'idle',
        runTurnsConsumed: 999,
        budgetMaxTurns: 10,
      }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const exhaustionTransitions = state.chatUpdates.filter(
      u => u.runState === 'budgetExhausted',
    )
    expect(exhaustionTransitions).toHaveLength(0)
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })

  it('does NOT trip budgetExhausted on the first turn of a fresh run with a small token cap', async () => {
    // Token-counter mirror of the turn-cap regression above. A room with
    // budgetMaxTokens=10000 and a stale 50000-token total carried over from a
    // prior run would trip budgetExhausted immediately on the first turn — the
    // buggy floor against `post.runTokensConsumed` saw 50000 >= 10000. With the
    // fix the local snapshot (reset to 0 on idle → running) gives this run's
    // own 3000, well under the cap, so the next turn is enqueued normally.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({
        runState: 'idle',
        runTokensConsumed: 50000,
        budgetMaxTokens: 10000,
      }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    repos.llmLogs.getTotalTokenUsageForRun = jest.fn(async () => ({ totalTokens: 3000 })) as never
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const exhaustionTransitions = state.chatUpdates.filter(
      u => u.runState === 'budgetExhausted',
    )
    expect(exhaustionTransitions).toHaveLength(0)
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })

  it('uses the freshly-computed counter for the post-turn budget check', async () => {
    // Counter reaches the cap exactly on this turn (running, 7 → 8 with
    // cap=8). The post-turn budget check must see the just-computed value
    // (8), not the stale re-read (7), and trip the run. The near-end warning
    // is pre-marked (bit 2) so the run ends immediately rather than taking a
    // grace turn — this test is about the counter, not the grace path.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 7, budgetMaxTurns: 8, runMilestonesAnnounced: 2 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const stateTransitions = state.chatUpdates.filter(u => u.runState === 'budgetExhausted')
    expect(stateTransitions).toHaveLength(1)
    expect(stateTransitions[0].runStateMessage).toBe('budget:turns')
    expect(mockEnqueueAutonomousRoomTurn).not.toHaveBeenCalled()
  })
})

describe('handleAutonomousRoomTurn — pacing milestones', () => {
  const milestoneMessages = (
    adds: Array<{ systemKind?: string }>,
  ) => adds.filter((m) => m.systemKind === 'autonomous-room-halfway' || m.systemKind === 'autonomous-room-nearing-end')

  it('announces the halfway nudge once when the binding (turns) budget crosses 50%', async () => {
    // 10-turn cap, 4 turns done → this turn makes 5 (exactly 50%).
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 4, budgetMaxTurns: 10 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const halfway = state.messageAdds.filter((m) => (m as { systemKind?: string }).systemKind === 'autonomous-room-halfway')
    expect(halfway).toHaveLength(1)
    // Carries a persona-free body so opaque-anywhere rooms steer correctly.
    expect((halfway[0] as { opaqueContent?: string }).opaqueContent).toContain('halfway')
    expect((halfway[0] as { content?: string }).content).toContain('The Host')
    // The bitmask records bit 0 so it never re-fires this run.
    const maskWrites = state.chatUpdates.filter((u) => 'runMilestonesAnnounced' in u)
    expect(maskWrites[maskWrites.length - 1].runMilestonesAnnounced).toBe(1)
    // Run still continues.
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })

  it('announces the near-end nudge once when the binding (turns) budget crosses 90%', async () => {
    // 10-turn cap, 8 done → this turn makes 9 (90%).
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 8, budgetMaxTurns: 10 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const nearEnd = state.messageAdds.filter((m) => (m as { systemKind?: string }).systemKind === 'autonomous-room-nearing-end')
    expect(nearEnd).toHaveLength(1)
    expect((nearEnd[0] as { opaqueContent?: string }).opaqueContent).toContain('end soon')
    const maskWrites = state.chatUpdates.filter((u) => 'runMilestonesAnnounced' in u)
    expect(maskWrites[maskWrites.length - 1].runMilestonesAnnounced).toBe(3)
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })

  it('does not re-announce a milestone already recorded in the bitmask', async () => {
    // Halfway bit already set; this turn (5 → 6 of 10 = 60%) must stay quiet.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 5, budgetMaxTurns: 10, runMilestonesAnnounced: 1 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    expect(milestoneMessages(state.messageAdds as never)).toHaveLength(0)
    expect(state.chatUpdates.filter((u) => 'runMilestonesAnnounced' in u)).toHaveLength(0)
  })

  it('fires only the near-end nudge (and marks both bits) when a turn vaults straight past 50%', async () => {
    // Token budget: a single heavy turn jumps from 0% to 95% in one go.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({
        runState: 'running',
        runTurnsConsumed: 1,
        runTokensConsumed: 0,
        budgetMaxTurns: null,
        budgetMaxTokens: 1000,
      }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    repos.llmLogs.getTotalTokenUsageForRun = jest.fn(async () => ({ totalTokens: 950 })) as never
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const halfway = state.messageAdds.filter((m) => (m as { systemKind?: string }).systemKind === 'autonomous-room-halfway')
    const nearEnd = state.messageAdds.filter((m) => (m as { systemKind?: string }).systemKind === 'autonomous-room-nearing-end')
    expect(halfway).toHaveLength(0)
    expect(nearEnd).toHaveLength(1)
    // Phrased around the token budget.
    expect((nearEnd[0] as { opaqueContent?: string }).opaqueContent).toContain('allotted length')
    const maskWrites = state.chatUpdates.filter((u) => 'runMilestonesAnnounced' in u)
    expect(maskWrites[maskWrites.length - 1].runMilestonesAnnounced).toBe(3)
  })

  it('stays silent when no room budget is configured', async () => {
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 50, budgetMaxTurns: null, budgetMaxTokens: null, budgetMaxWallClockMs: null }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    expect(milestoneMessages(state.messageAdds as never)).toHaveLength(0)
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })

  it('resets the milestone bitmask to 0 on the first turn of a fresh run', async () => {
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'idle', runMilestonesAnnounced: 3, budgetMaxTurns: 100 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const resetWrites = state.chatUpdates.filter((u) => u.runMilestonesAnnounced === 0)
    expect(resetWrites.length).toBeGreaterThanOrEqual(1)
  })

  it('announces the halfway nudge for a wall-clock budget, phrased around time', async () => {
    // Continuing run, started ~31s ago with a 60s wall-clock cap → ~51% elapsed.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({
        runState: 'running',
        runStartedAt: new Date(Date.now() - 31_000).toISOString(),
        runPausedAccumMs: 0,
        budgetMaxTurns: null,
        budgetMaxTokens: null,
        budgetMaxWallClockMs: 60_000,
      }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const halfway = state.messageAdds.filter((m) => (m as { systemKind?: string }).systemKind === 'autonomous-room-halfway')
    expect(halfway).toHaveLength(1)
    expect((halfway[0] as { opaqueContent?: string }).opaqueContent).toContain('allotted time')
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })

  it('frames the near-end nudge as a pause (not an ending) when the daily user-token cap is binding', async () => {
    // No per-run cap; the cross-room daily cap is at 95%. The daily cap pauses
    // the room rather than ending it, so the nudge must tell the characters to
    // finish for now and reconvene later — not that the gathering closes.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', budgetMaxTurns: null, budgetMaxTokens: null, budgetMaxWallClockMs: null }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    repos.chatSettings.findByUserId = jest.fn(async () => ({ autonomousRoomSettings: { dailyTokenBudget: 10_000 } })) as never
    repos.llmLogs.getTotalTokenUsageSince = jest.fn(async () => ({ totalTokens: 9_500 })) as never
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    // Not exhausted (95% < 100%) — the run continues.
    expect(state.chatUpdates.filter((u) => u.runState === 'paused' || u.runState === 'budgetExhausted')).toHaveLength(0)
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)

    const nearEnd = state.messageAdds.filter((m) => (m as { systemKind?: string }).systemKind === 'autonomous-room-nearing-end')
    expect(nearEnd).toHaveLength(1)
    const opaque = (nearEnd[0] as { opaqueContent?: string }).opaqueContent ?? ''
    expect(opaque).toContain('pause')
    expect(opaque).toContain('resume')
    expect(opaque).toContain('allowance for the day')
    // Host body promises a reconvening rather than a close.
    expect((nearEnd[0] as { content?: string }).content).toContain('reconvene')
  })
})

describe('handleAutonomousRoomTurn — wall-clock anchor on a fresh run', () => {
  it('does NOT falsely exhaust a wall-clock budget on the first turn of a 2nd run', async () => {
    // Regression: the committed DB still shows the *previous* run's
    // runStartedAt (the manual-start service does not reset it; the handler's
    // idle → running reset is buffered). The post-turn budget check must use
    // the local snapshot's fresh start, not the stale re-read — otherwise a
    // wall-clock-budgeted room ends after a single turn on every repeat run.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({
        runState: 'idle',
        // A start far in the past — a previous run that ended long ago.
        runStartedAt: '2020-01-01T00:00:00.000Z',
        runPausedAccumMs: 0,
        budgetMaxTurns: null,
        budgetMaxTokens: null,
        budgetMaxWallClockMs: 60_000,
      }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const wallClockExhaustion = state.chatUpdates.filter(
      (u) => u.runState === 'budgetExhausted' && u.runStateMessage === 'budget:wall_clock',
    )
    expect(wallClockExhaustion).toHaveLength(0)
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })
})

describe('handleAutonomousRoomTurn — context-summary fold', () => {
  it('runs the fold awaited+untagged from the handler when a cheap-LLM is configured', async () => {
    const { repos } = createBufferedRepos({ chat: baseChat(), jobId: 'job-1', chatId: 'chat-1' })
    // A cheap-LLM is configured → the fold should run.
    repos.chatSettings.findByUserId = jest.fn(async () => ({ cheapLLMSettings: { provider: 'anthropic' } })) as never
    // The responding participant (p1) has no profile of its own → falls back to the default.
    ;(repos as Record<string, unknown>).connections = {
      findByUserId: jest.fn(async () => ([
        { id: 'cp-default', provider: 'anthropic', modelName: 'claude', isDefault: true },
      ])),
    }
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    expect(mockCheckAndGenerateSummaryIfNeeded).toHaveBeenCalledTimes(1)
    const args = mockCheckAndGenerateSummaryIfNeeded.mock.calls[0]
    // Signature: (chatId, provider, modelName, userId, connectionProfile, cheapLLMSettings, availableProfiles, options)
    expect(args[4]).toMatchObject({ id: 'cp-default' }) // resolved fold profile
    expect(args[7]).toEqual({ awaitFold: true })        // awaited so the forked-child write survives
    // The fold runs after the turn but before the next turn is enqueued.
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })

  it('skips the fold when no cheap-LLM is configured', async () => {
    const { repos } = createBufferedRepos({ chat: baseChat(), jobId: 'job-1', chatId: 'chat-1' })
    // Default chatSettings.findByUserId returns null → no cheapLLMSettings → no fold.
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    expect(mockCheckAndGenerateSummaryIfNeeded).not.toHaveBeenCalled()
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })
})

describe('handleAutonomousRoomTurn — grace turn on budget exhaustion', () => {
  const graceMessages = (adds: Array<{ systemKind?: string }>) =>
    adds.filter((m) => m.systemKind === 'autonomous-room-grace')

  it('grants one grace turn (no end) when the budget is reached without a near-end warning', async () => {
    // 8-turn cap, 7 done → this turn makes 8 (exhausts). 7/8 = 87.5% → 8/8 =
    // 100%: the [90%,100%) band was vaulted, so near-end never fired (mask 0).
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 7, budgetMaxTurns: 8, runMilestonesAnnounced: 0 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    // The Host invites a final word...
    const grace = graceMessages(state.messageAdds as never)
    expect(grace).toHaveLength(1)
    expect((grace[0] as { content?: string }).content).toContain('The Host')
    expect((grace[0] as { opaqueContent?: string }).opaqueContent).toContain('one final turn')
    // ...the grace bit is recorded...
    const maskWrites = state.chatUpdates.filter((u) => 'runMilestonesAnnounced' in u)
    expect(maskWrites[maskWrites.length - 1].runMilestonesAnnounced).toBe(4) // MILESTONE_GRACE
    // ...the run does NOT end yet...
    expect(state.chatUpdates.filter((u) => u.runState === 'budgetExhausted')).toHaveLength(0)
    // ...and one more turn is enqueued.
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })

  it('runs the granted grace turn over budget, then ends the run', async () => {
    // Grace already granted (bit 4 set) and the counter is at the cap, so the
    // pre-turn check is over budget. The grace turn must still run, then end.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 8, budgetMaxTurns: 8, runMilestonesAnnounced: 4 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    // The grace turn actually ran (pre-turn budget check let it through).
    expect(mockHandleSendMessage).toHaveBeenCalledTimes(1)
    // No second grace announcement.
    expect(graceMessages(state.messageAdds as never)).toHaveLength(0)
    // The run ends after the grace turn.
    const ends = state.chatUpdates.filter((u) => u.runState === 'budgetExhausted')
    expect(ends).toHaveLength(1)
    expect(state.messageAdds.filter((m) => (m as { systemKind?: string }).systemKind === 'autonomous-room-end')).toHaveLength(1)
    expect(mockEnqueueAutonomousRoomTurn).not.toHaveBeenCalled()
  })

  it('ends directly (no grace turn) when the near-end warning already fired', async () => {
    // Near-end bit (2) already set; reaching the cap ends the run at once.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 7, budgetMaxTurns: 8, runMilestonesAnnounced: 2 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    expect(graceMessages(state.messageAdds as never)).toHaveLength(0)
    expect(state.chatUpdates.filter((u) => u.runState === 'budgetExhausted')).toHaveLength(1)
    expect(mockEnqueueAutonomousRoomTurn).not.toHaveBeenCalled()
  })
})

describe('computeAutonomousContextCap — per-turn budget slice', () => {
  const chat = (overrides: Record<string, unknown> = {}) =>
    baseChat(overrides) as unknown as ChatMetadataBase

  it('returns undefined when the room has no token budget (unchanged behavior)', () => {
    expect(computeAutonomousContextCap(chat({ budgetMaxTokens: null }))).toBeUndefined()
  })

  it('slices the full budget across the default turns target at run start', () => {
    // Fresh run: runTokensConsumed reset to 0, no explicit turn budget.
    const cap = computeAutonomousContextCap(
      chat({ budgetMaxTokens: 250_000, runTokensConsumed: 0, budgetMaxTurns: null }),
    )
    expect(cap).toBe(Math.floor(250_000 / DEFAULT_AUTONOMOUS_TARGET_TURNS))
  })

  it('slices the remaining budget (not the original) as the run progresses', () => {
    const cap = computeAutonomousContextCap(
      chat({ budgetMaxTokens: 250_000, runTokensConsumed: 100_000, budgetMaxTurns: null }),
    )
    // remaining 150k / 6 = 25k
    expect(cap).toBe(Math.floor(150_000 / DEFAULT_AUTONOMOUS_TARGET_TURNS))
  })

  it('cooperates with budgetMaxTurns: divides remaining by turns left, not the default', () => {
    const cap = computeAutonomousContextCap(
      chat({ budgetMaxTokens: 240_000, runTokensConsumed: 0, budgetMaxTurns: 8, runTurnsConsumed: 2 }),
    )
    // turnsLeft = 8 - 2 = 6 → 240k / 6 = 40k (not 240k / DEFAULT)
    expect(cap).toBe(40_000)
  })

  it('floors at MIN_AUTONOMOUS_CONTEXT_TOKENS so a nearly-spent run still ships a usable turn', () => {
    const cap = computeAutonomousContextCap(
      chat({ budgetMaxTokens: 250_000, runTokensConsumed: 249_000, budgetMaxTurns: null }),
    )
    // remaining 1k / 6 = 166 → clamped up to the floor
    expect(cap).toBe(MIN_AUTONOMOUS_CONTEXT_TOKENS)
  })

  it('never goes negative when the counter has overshot the budget', () => {
    const cap = computeAutonomousContextCap(
      chat({ budgetMaxTokens: 250_000, runTokensConsumed: 650_000, budgetMaxTurns: null }),
    )
    expect(cap).toBe(MIN_AUTONOMOUS_CONTEXT_TOKENS)
  })

  it('clamps turnsLeft to at least 1 once the turn budget is spent', () => {
    const cap = computeAutonomousContextCap(
      chat({ budgetMaxTokens: 90_000, runTokensConsumed: 0, budgetMaxTurns: 5, runTurnsConsumed: 9 }),
    )
    // turnsLeft = max(1, 5 - 9) = 1 → whole remaining 90k
    expect(cap).toBe(90_000)
  })
})

describe('handleAutonomousRoomTurn — autonomous context cap wiring', () => {
  it('passes the computed per-turn cap into handleSendMessage', async () => {
    const { repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', budgetMaxTokens: 240_000, runTokensConsumed: 0, budgetMaxTurns: null }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    expect(mockHandleSendMessage).toHaveBeenCalledWith(
      expect.anything(),
      'chat-1',
      'user-1',
      expect.objectContaining({
        autonomousContextCap: Math.floor(240_000 / DEFAULT_AUTONOMOUS_TARGET_TURNS),
      }),
    )
  })

  it('leaves the cap undefined for a room without a token budget', async () => {
    const { repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', budgetMaxTokens: null }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const opts = mockHandleSendMessage.mock.calls[0][3]
    expect(opts.autonomousContextCap).toBeUndefined()
  })
})
