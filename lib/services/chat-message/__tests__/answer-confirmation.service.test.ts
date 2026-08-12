/**
 * Unit tests for the answer-confirmation service.
 *
 * Covers the pure gate/input helpers and the verdict-handling branches of
 * runAnswerConfirmation with the cheap-LLM harness mocked.
 */

import {
  isAnswerConfirmationActive,
  hasCheckableInputs,
  gatherConfirmationInputs,
  findLatestCommonplaceWhisper,
  isUserDrivenTurn,
  CONFIRMATION_READ_TOOLS,
  buildRecentConversationContext,
  runAnswerConfirmation,
} from '../answer-confirmation.service';
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution';
import { resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm';
import type { ToolMessage } from '../types';
import type { MessageEvent, ConnectionProfile } from '@/lib/schemas/types';

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}));
jest.mock('@/lib/llm/cheap-llm', () => ({
  resolveUncensoredCheapLLMSelection: jest.fn((sel) => sel),
}));

const mockExecute = jest.mocked(executeCheapLLMTask);
const mockResolve = jest.mocked(resolveUncensoredCheapLLMSelection);

beforeEach(() => {
  jest.clearAllMocks();
  mockResolve.mockImplementation((sel: any) => sel);
});

function tool(toolName: string, content = 'result body'): ToolMessage {
  return { toolName, content, success: true }
}

const CHEAP_SELECTION = { provider: 'openai', modelName: 'gpt-cheap', isLocal: false } as any
const CHAR_PROFILE = {
  id: 'profile-1',
  provider: 'anthropic',
  modelName: 'claude-x',
  baseUrl: null,
} as unknown as ConnectionProfile

// ---------------------------------------------------------------------------
// isAnswerConfirmationActive — the ON/OFF/inherit truth table
// ---------------------------------------------------------------------------
describe('isAnswerConfirmationActive', () => {
  it('chat override wins over everything', () => {
    expect(isAnswerConfirmationActive('ON', 'OFF', false)).toBe(true)
    expect(isAnswerConfirmationActive('OFF', 'ON', true)).toBe(false)
  })

  it('project override applies when chat inherits', () => {
    expect(isAnswerConfirmationActive(null, 'ON', false)).toBe(true)
    expect(isAnswerConfirmationActive(undefined, 'OFF', true)).toBe(false)
  })

  it('falls back to the global default when both inherit', () => {
    expect(isAnswerConfirmationActive(null, null, true)).toBe(true)
    expect(isAnswerConfirmationActive(null, undefined, false)).toBe(false)
    expect(isAnswerConfirmationActive(undefined, undefined, undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Input gathering
// ---------------------------------------------------------------------------
describe('hasCheckableInputs', () => {
  it('true when a whisper exists', () => {
    expect(hasCheckableInputs('some memory', [])).toBe(true)
  })
  it('true when an in-scope read tool ran', () => {
    expect(hasCheckableInputs(null, [tool('search')])).toBe(true)
    expect(hasCheckableInputs('', [tool('doc_read_file')])).toBe(true)
  })
  it('false with no whisper and only out-of-scope tools', () => {
    expect(hasCheckableInputs(null, [tool('wardrobe_wear'), tool('doc_list_files')])).toBe(false)
    expect(hasCheckableInputs('   ', [])).toBe(false)
  })
})

describe('CONFIRMATION_READ_TOOLS', () => {
  it('includes the content reads and excludes listings/binary reads', () => {
    expect(CONFIRMATION_READ_TOOLS.has('search')).toBe(true)
    expect(CONFIRMATION_READ_TOOLS.has('read_conversation')).toBe(true)
    expect(CONFIRMATION_READ_TOOLS.has('doc_read_file')).toBe(true)
    expect(CONFIRMATION_READ_TOOLS.has('doc_grep')).toBe(true)
    expect(CONFIRMATION_READ_TOOLS.has('doc_list_files')).toBe(false)
    expect(CONFIRMATION_READ_TOOLS.has('doc_read_blob')).toBe(false)
  })
})

describe('gatherConfirmationInputs', () => {
  it('returns null when nothing is checkable', () => {
    expect(gatherConfirmationInputs(null, [tool('wardrobe_wear')])).toBeNull()
  })
  it('includes only in-scope tool results and the whisper', () => {
    const ref = gatherConfirmationInputs('recalled thing', [
      tool('search', 'search hit'),
      tool('doc_list_files', 'listing'),
      tool('doc_read_file', 'doc body'),
    ])
    expect(ref).toContain('recalled thing')
    expect(ref).toContain('search hit')
    expect(ref).toContain('doc body')
    expect(ref).not.toContain('listing')
  })
})

describe('findLatestCommonplaceWhisper', () => {
  const msg = (over: Partial<MessageEvent>): MessageEvent => ({
    type: 'message', id: 'x', role: 'ASSISTANT', content: '', createdAt: '', ...over,
  } as MessageEvent)

  it('returns the most-recent whisper targeted to the participant', () => {
    const messages = [
      msg({ id: 'a', systemSender: 'commonplaceBook', targetParticipantIds: ['p1'], content: 'old' }),
      msg({ id: 'b', systemSender: 'commonplaceBook', targetParticipantIds: ['p1'], content: 'new' }),
      msg({ id: 'c', systemSender: 'commonplaceBook', targetParticipantIds: ['p2'], content: 'other' }),
    ]
    expect(findLatestCommonplaceWhisper(messages, 'p1')).toBe('new')
  })

  it('returns null when no matching whisper', () => {
    const messages = [msg({ content: 'plain' })]
    expect(findLatestCommonplaceWhisper(messages, 'p1')).toBeNull()
  })
})

describe('isUserDrivenTurn', () => {
  it('detects impersonation via impersonatingParticipantIds', () => {
    const chat = { participants: [], impersonatingParticipantIds: ['p1'] } as any
    expect(isUserDrivenTurn(chat, 'p1')).toBe(true)
  })
  it('detects a user-controlled participant', () => {
    const chat = { participants: [{ id: 'p1', controlledBy: 'user' }], impersonatingParticipantIds: [] } as any
    expect(isUserDrivenTurn(chat, 'p1')).toBe(true)
  })
  it('false for an ordinary LLM participant', () => {
    const chat = { participants: [{ id: 'p1', controlledBy: 'llm' }] } as any
    expect(isUserDrivenTurn(chat, 'p1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildRecentConversationContext — the anchor that keeps a rewrite in-scene
// ---------------------------------------------------------------------------
describe('buildRecentConversationContext', () => {
  const participants = [
    { id: 'p-user', type: 'CHARACTER', characterId: 'c-user', controlledBy: 'user' },
    { id: 'p-ada', type: 'CHARACTER', characterId: 'c-ada' },
  ] as any
  const participantCharacters = new Map<string, any>([
    ['c-user', { id: 'c-user', name: 'Bertie' }],
    ['c-ada', { id: 'c-ada', name: 'Ada' }],
  ])
  function msg(over: Partial<MessageEvent>): MessageEvent {
    return { type: 'message', role: 'USER', content: 'hi', ...over } as MessageEvent
  }

  it('renders Name: text for resolved participants', () => {
    const out = buildRecentConversationContext(
      [
        msg({ role: 'USER', participantId: 'p-user', content: 'How tall is the tower?' }),
        msg({ role: 'ASSISTANT', participantId: 'p-ada', content: 'Let me check.' }),
      ],
      participants,
      participantCharacters,
    )
    expect(out).toBe('Bertie: How tall is the tower?\n\nAda: Let me check.')
  })

  it('drops Staff/system-sender whispers, tool bubbles, and silent messages', () => {
    const out = buildRecentConversationContext(
      [
        msg({ role: 'USER', participantId: 'p-user', content: 'real line' }),
        msg({ role: 'ASSISTANT', systemSender: 'commonplaceBook', content: 'a recalled memory' }),
        msg({ role: 'ASSISTANT', systemSender: 'prospero', content: 'ran a tool' }),
        msg({ role: 'ASSISTANT', participantId: 'p-ada', isSilentMessage: true, content: 'silent' }),
      ],
      participants,
      participantCharacters,
    )
    expect(out).toBe('Bertie: real line')
  })

  it('null when there is no real dialogue', () => {
    expect(buildRecentConversationContext([], participants, participantCharacters)).toBeNull()
    const onlyWhispers = buildRecentConversationContext(
      [msg({ role: 'ASSISTANT', systemSender: 'host', content: 'scene note' })],
      participants,
      participantCharacters,
    )
    expect(onlyWhispers).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// runAnswerConfirmation — verdict handling
// ---------------------------------------------------------------------------
describe('runAnswerConfirmation', () => {
  function baseOpts(over: Partial<Parameters<typeof runAnswerConfirmation>[0]> = {}) {
    return {
      reply: 'The tower is 300m tall.',
      reference: 'The tower is 324m tall.',
      userId: 'u1',
      chatId: 'c1',
      messageId: 'm1',
      characterId: 'char1',
      cheapLLMSelection: CHEAP_SELECTION,
      connectionProfile: CHAR_PROFILE,
      isDangerousChat: false,
      uncensoredFallback: undefined,
      ...over,
    }
  }

  it('null when no cheap-LLM selection', async () => {
    const out = await runAnswerConfirmation(baseOpts({ cheapLLMSelection: null }))
    expect(out).toEqual({ confirmed: null, revised: false, notes: null, revisedContent: null })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('consistent → confirmed true, no notes', async () => {
    mockExecute.mockResolvedValueOnce({ success: true, result: { consistent: true, discrepancies: '' } } as any)
    const out = await runAnswerConfirmation(baseOpts())
    expect(out).toEqual({ confirmed: true, revised: false, notes: null, revisedContent: null })
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('check errored → confirmed null', async () => {
    mockExecute.mockResolvedValueOnce({ success: false, error: 'boom' } as any)
    const out = await runAnswerConfirmation(baseOpts())
    expect(out.confirmed).toBeNull()
    expect(out.revised).toBe(false)
  })

  it('inconsistent + stood by → confirmed false with notes', async () => {
    mockExecute
      .mockResolvedValueOnce({ success: true, result: { consistent: false, discrepancies: 'height wrong' } } as any)
      .mockResolvedValueOnce({ success: true, result: { revise: false } } as any)
    const out = await runAnswerConfirmation(baseOpts())
    expect(out.confirmed).toBe(false)
    expect(out.revised).toBe(false)
    expect(out.notes).toBe('height wrong')
  })

  it('inconsistent + revise → confirmed true, revised, replacement text', async () => {
    const onAffirming = jest.fn()
    mockExecute
      .mockResolvedValueOnce({ success: true, result: { consistent: false, discrepancies: 'height wrong' } } as any)
      .mockResolvedValueOnce({ success: true, result: { revise: true, reply: 'The tower is 324m tall.' } } as any)
    const out = await runAnswerConfirmation(baseOpts({ onAffirming }))
    expect(out).toEqual({ confirmed: true, revised: true, notes: 'height wrong', revisedContent: 'The tower is 324m tall.' })
    expect(onAffirming).toHaveBeenCalledTimes(1)
  })

  it('re-affirmation prompt carries the conversation scene + character name, and frames reference as background', async () => {
    mockExecute
      .mockResolvedValueOnce({ success: true, result: { consistent: false, discrepancies: 'height wrong' } } as any)
      .mockResolvedValueOnce({ success: true, result: { revise: false } } as any)
    await runAnswerConfirmation(baseOpts({
      characterName: 'Ada',
      conversationContext: 'Bertie: How tall is the tower?',
    }))
    // Second harness call is the re-affirmation pass.
    const reaffMessages = (mockExecute.mock.calls[1][1] as any[])
    const system = reaffMessages[0].content as string
    const user = reaffMessages[1].content as string
    expect(system).toContain('You are Ada.')
    expect(user).toContain('The conversation so far')
    expect(user).toContain('Bertie: How tall is the tower?')
    // The reference is explicitly labelled background knowledge, not the scene.
    expect(user).toContain('NOT the conversation')
  })

  it('revise requested but empty reply → confirmed null (no gamble)', async () => {
    mockExecute
      .mockResolvedValueOnce({ success: true, result: { consistent: false, discrepancies: 'x' } } as any)
      .mockResolvedValueOnce({ success: true, result: { revise: true, reply: '   ' } } as any)
    const out = await runAnswerConfirmation(baseOpts())
    expect(out.confirmed).toBeNull()
    expect(out.revised).toBe(false)
  })

  it('re-affirmation errored → confirmed null, keeps notes', async () => {
    mockExecute
      .mockResolvedValueOnce({ success: true, result: { consistent: false, discrepancies: 'x' } } as any)
      .mockResolvedValueOnce({ success: false, error: 'boom' } as any)
    const out = await runAnswerConfirmation(baseOpts())
    expect(out.confirmed).toBeNull()
    expect(out.notes).toBe('x')
  })
})
