import {
  groupToolMessagesIntoAssistants,
  resolveToolRowAttributionMessage,
} from './group-tool-messages'
import type { Message } from './types'

let seq = 0
function msg(partial: Partial<Message> & { role: string }): Message {
  seq += 1
  return {
    id: `m${seq}`,
    content: '',
    createdAt: new Date(seq * 1000).toISOString(),
    ...partial,
  }
}

function toolContent(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ toolName: 'rng', success: true, result: '17', ...extra })
}

describe('groupToolMessagesIntoAssistants', () => {
  it('nests a character tool result under the preceding assistant message', () => {
    const user = msg({ role: 'USER', content: 'roll a d20' })
    const assistant = msg({ role: 'ASSISTANT', content: 'Here goes!', participantId: 'p1' })
    const tool = msg({ role: 'TOOL', content: toolContent(), participantId: 'p1' })

    const result = groupToolMessagesIntoAssistants([user, assistant, tool])

    // Flat list drops the standalone tool row
    expect(result.map(m => m.id)).toEqual([user.id, assistant.id])
    expect(result[1].attachedToolMessages).toHaveLength(1)
    expect(result[1].attachedToolMessages![0].id).toBe(tool.id)
  })

  it('nests multiple tool results under the same assistant in order', () => {
    const assistant = msg({ role: 'ASSISTANT', content: 'working', participantId: 'p1' })
    const t1 = msg({ role: 'TOOL', content: toolContent(), participantId: 'p1' })
    const t2 = msg({ role: 'TOOL', content: toolContent(), participantId: 'p1' })

    const result = groupToolMessagesIntoAssistants([assistant, t1, t2])

    expect(result).toHaveLength(1)
    expect(result[0].attachedToolMessages!.map(m => m.id)).toEqual([t1.id, t2.id])
  })

  it('keeps user-initiated (initiatedBy: user) tool runs standalone', () => {
    const assistant = msg({ role: 'ASSISTANT', content: 'hi', participantId: 'p1' })
    const userTool = msg({ role: 'TOOL', content: toolContent({ initiatedBy: 'user' }) })

    const result = groupToolMessagesIntoAssistants([assistant, userTool])

    expect(result.map(m => m.id)).toEqual([assistant.id, userTool.id])
    expect(result[0].attachedToolMessages).toBeUndefined()
  })

  it('keeps Prospero/system-authored tool runs standalone', () => {
    const assistant = msg({ role: 'ASSISTANT', content: 'hi', participantId: 'p1' })
    const sysTool = msg({ role: 'TOOL', content: toolContent(), systemSender: 'prospero' })

    const result = groupToolMessagesIntoAssistants([assistant, sysTool])

    expect(result.map(m => m.id)).toEqual([assistant.id, sysTool.id])
    expect(result[0].attachedToolMessages).toBeUndefined()
  })

  it('keeps a tool with no preceding assistant in the turn standalone', () => {
    // Composer-attached results are pushed before the user message
    const orphanTool = msg({ role: 'TOOL', content: toolContent({ initiatedBy: 'user' }) })
    const user = msg({ role: 'USER', content: 'go' })

    const result = groupToolMessagesIntoAssistants([orphanTool, user])

    expect(result.map(m => m.id)).toEqual([orphanTool.id, user.id])
  })

  it('does not attach a tool across a USER boundary to a prior turn assistant', () => {
    const a1 = msg({ role: 'ASSISTANT', content: 'turn 1', participantId: 'p1' })
    const user = msg({ role: 'USER', content: 'next' })
    const tool = msg({ role: 'TOOL', content: toolContent(), participantId: 'p1' })

    const result = groupToolMessagesIntoAssistants([a1, user, tool])

    // tool has no assistant in its own turn -> standalone
    expect(result.map(m => m.id)).toEqual([a1.id, user.id, tool.id])
    expect(result[0].attachedToolMessages).toBeUndefined()
  })

  it('attaches tools to the most recent assistant in multi-character runs', () => {
    const a1 = msg({ role: 'ASSISTANT', content: 'char A', participantId: 'pA' })
    const tA = msg({ role: 'TOOL', content: toolContent(), participantId: 'pA' })
    const a2 = msg({ role: 'ASSISTANT', content: 'char B', participantId: 'pB' })
    const tB = msg({ role: 'TOOL', content: toolContent(), participantId: 'pB' })

    const result = groupToolMessagesIntoAssistants([a1, tA, a2, tB])

    expect(result.map(m => m.id)).toEqual([a1.id, a2.id])
    expect(result[0].attachedToolMessages!.map(m => m.id)).toEqual([tA.id])
    expect(result[1].attachedToolMessages!.map(m => m.id)).toEqual([tB.id])
  })

  it('does not host tools on a Staff-authored (systemSender) assistant announcement', () => {
    const announce = msg({ role: 'ASSISTANT', content: 'image ready', systemSender: 'lantern' })
    const tool = msg({ role: 'TOOL', content: toolContent() })

    const result = groupToolMessagesIntoAssistants([announce, tool])

    // No valid host -> tool stays standalone, announcement untouched
    expect(result.map(m => m.id)).toEqual([announce.id, tool.id])
  })

  it('passes untouched assistant rows through by reference and never mutates the source', () => {
    const plainAssistant = msg({ role: 'ASSISTANT', content: 'no tools', participantId: 'p1' })
    const hostAssistant = msg({ role: 'ASSISTANT', content: 'has tool', participantId: 'p2' })
    const tool = msg({ role: 'TOOL', content: toolContent(), participantId: 'p2' })
    const input = [plainAssistant, hostAssistant, tool]

    const result = groupToolMessagesIntoAssistants(input)

    // Untouched row keeps identity (memo stability)
    expect(result[0]).toBe(plainAssistant)
    // Host is a clone, not the original; original is never mutated
    expect(result[1]).not.toBe(hostAssistant)
    expect(hostAssistant.attachedToolMessages).toBeUndefined()
    expect(result[1].attachedToolMessages![0]).toBe(tool)
  })

  it('treats a tool with unparseable content as character-initiated', () => {
    const assistant = msg({ role: 'ASSISTANT', content: 'hi', participantId: 'p1' })
    const tool = msg({ role: 'TOOL', content: 'not json', participantId: 'p1' })

    const result = groupToolMessagesIntoAssistants([assistant, tool])

    expect(result).toHaveLength(1)
    expect(result[0].attachedToolMessages![0].id).toBe(tool.id)
  })
})

describe('resolveToolRowAttributionMessage', () => {
  it('heads a user-initiated tool card with the operator, not the last speaker', () => {
    // The pending TOOL row is persisted before the user's own message, so the
    // nearest preceding assistant is an unrelated character (Bug 29).
    const other = msg({ role: 'ASSISTANT', content: 'char B just spoke', participantId: 'pB' })
    const userTool = msg({ role: 'TOOL', content: toolContent({ initiatedBy: 'user' }) })
    const messages = [other, userTool]

    const resolved = resolveToolRowAttributionMessage(userTool, 1, messages)

    // Resolved as a USER row (operator's face) — it does NOT borrow pB.
    expect(resolved.role).toBe('USER')
    expect(resolved.participantId).toBeNull()
  })

  it('still borrows the calling character for a character-initiated tool row', () => {
    const caller = msg({ role: 'ASSISTANT', content: 'I roll', participantId: 'pA' })
    const charTool = msg({ role: 'TOOL', content: toolContent() })
    const messages = [caller, charTool]

    const resolved = resolveToolRowAttributionMessage(charTool, 1, messages)

    expect(resolved.role).toBe('TOOL')
    expect(resolved.participantId).toBe('pA')
  })

  it('does not borrow across a USER boundary for a character-initiated row', () => {
    const caller = msg({ role: 'ASSISTANT', content: 'turn 1', participantId: 'pA' })
    const user = msg({ role: 'USER', content: 'next' })
    const charTool = msg({ role: 'TOOL', content: toolContent() })
    const messages = [caller, user, charTool]

    const resolved = resolveToolRowAttributionMessage(charTool, 2, messages)

    // Walk stops at the USER boundary before reaching pA — row heads itself.
    expect(resolved.participantId).toBeUndefined()
  })

  it('heads a TOOL row that already knows its author with itself', () => {
    const sysTool = msg({ role: 'TOOL', content: toolContent(), systemSender: 'prospero' })
    expect(resolveToolRowAttributionMessage(sysTool, 0, [sysTool])).toBe(sysTool)

    const ownedTool = msg({ role: 'TOOL', content: toolContent(), participantId: 'pC' })
    expect(resolveToolRowAttributionMessage(ownedTool, 0, [ownedTool])).toBe(ownedTool)
  })
})
