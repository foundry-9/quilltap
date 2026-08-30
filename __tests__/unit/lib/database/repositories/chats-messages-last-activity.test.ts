/**
 * `lastMessageAt` is the timestamp every chat list, sort, and card reads. It
 * must move only when a *character* posts — the human user or an LLM. Staff
 * announcements (a story background finishing, a summary folded, a Concierge
 * notice) persist as `type: 'message'` rows too, and used to stamp a chat as
 * freshly active and float a months-dead conversation to the top of the list.
 *
 * These tests pin the write-side gate at its source.
 */

import { ChatMessagesOps } from '@/lib/database/repositories/chats-messages.ops'
import type { ChatOpsContext } from '@/lib/database/repositories/chats-ops-context'
import type { ChatEvent, ChatMetadata } from '@/lib/schemas/types'

const NOW = '2026-08-30T12:00:00.000Z'
const CHAT_ID = '00000000-0000-4000-8000-00000000c0a7'

let inserted: unknown[]
let updates: Array<Partial<ChatMetadata>>

function makeOps(): ChatMessagesOps {
  inserted = []
  updates = []

  const messagesCollection = {
    insertOne: jest.fn(async (doc: unknown) => {
      inserted.push(doc)
      return doc
    }),
    // getMessages() re-reads the transcript to recount; the inserted rows are
    // enough for that, and the ops layer Zod-validates whatever comes back.
    find: jest.fn(async () => inserted),
    findOne: jest.fn(async () => null),
    updateOne: jest.fn(async () => ({})),
    deleteOne: jest.fn(async () => 1),
    deleteMany: jest.fn(async () => 1),
  }

  const ctx: ChatOpsContext = {
    findById: jest.fn(async () => ({ id: CHAT_ID, participants: [] }) as unknown as ChatMetadata),
    update: jest.fn(async (_id: string, data: Partial<ChatMetadata>) => {
      updates.push(data)
      return null
    }),
    getCollection: jest.fn(async () => messagesCollection as never),
    getMessagesCollection: jest.fn(async () => messagesCollection as never),
    isSQLiteBackend: () => true,
    generateId: () => '00000000-0000-4000-8000-000000000abc',
    getCurrentTimestamp: () => NOW,
  }

  return new ChatMessagesOps(ctx)
}

function msg(overrides: Record<string, unknown> = {}): ChatEvent {
  return {
    type: 'message',
    id: '00000000-0000-4000-8000-000000000001',
    role: 'ASSISTANT',
    content: 'hello',
    createdAt: NOW,
    ...overrides,
  } as unknown as ChatEvent
}

/** The single metadata patch `addMessage`/`addMessages` wrote. */
function lastPatch(): Partial<ChatMetadata> {
  expect(updates).toHaveLength(1)
  return updates[0]
}

describe('addMessage — lastMessageAt gate', () => {
  it('bumps lastMessageAt when a character posts', async () => {
    const ops = makeOps()
    await ops.addMessage(CHAT_ID, msg())
    expect(lastPatch().lastMessageAt).toBe(NOW)
  })

  it('bumps lastMessageAt for a whisper — a character still spoke', async () => {
    const ops = makeOps()
    await ops.addMessage(CHAT_ID, msg({ targetParticipantIds: ['00000000-0000-4000-8000-000000000011'] }))
    expect(lastPatch().lastMessageAt).toBe(NOW)
  })

  it('does NOT bump lastMessageAt for a Lantern background announcement', async () => {
    const ops = makeOps()
    await ops.addMessage(CHAT_ID, msg({ systemSender: 'lantern', systemKind: 'story-background' }))
    const patch = lastPatch()
    expect(patch).not.toHaveProperty('lastMessageAt')
    // updatedAt still moves — the row genuinely changed; it is simply no
    // longer what the reader is shown.
    expect(patch.updatedAt).toBe(NOW)
  })

  it('does NOT bump lastMessageAt for an announcement bubble', async () => {
    const ops = makeOps()
    await ops.addMessage(CHAT_ID, msg({ role: 'USER', customAnnouncer: { kind: 'custom', displayName: 'The Narrator' } }))
    expect(lastPatch()).not.toHaveProperty('lastMessageAt')
  })

  it('does NOT bump lastMessageAt for a raw tool-result row', async () => {
    const ops = makeOps()
    await ops.addMessage(CHAT_ID, msg({ role: 'TOOL', content: '{"toolName":"doc_read"}' }))
    expect(lastPatch()).not.toHaveProperty('lastMessageAt')
  })
})

describe('addMessages — lastMessageAt gate', () => {
  it('bumps lastMessageAt when a batch carries any character-authored message', async () => {
    const ops = makeOps()
    await ops.addMessages(CHAT_ID, [
      msg({ id: '00000000-0000-4000-8000-000000000001', systemSender: 'host' }),
      msg({ id: '00000000-0000-4000-8000-000000000002', role: 'USER' }),
    ])
    expect(lastPatch().lastMessageAt).toBe(NOW)
  })

  it('does NOT bump lastMessageAt for a batch of Staff announcements alone', async () => {
    const ops = makeOps()
    await ops.addMessages(CHAT_ID, [
      msg({ id: '00000000-0000-4000-8000-000000000001', systemSender: 'host' }),
      msg({ id: '00000000-0000-4000-8000-000000000002', systemSender: 'commonplaceBook' }),
    ])
    const patch = lastPatch()
    expect(patch).not.toHaveProperty('lastMessageAt')
    expect(patch.updatedAt).toBe(NOW)
  })
})
