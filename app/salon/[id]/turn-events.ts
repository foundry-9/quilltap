/**
 * Message → ChatEvent projection for the turn manager.
 *
 * The Salon's client `Message` rows are not the schema's `MessageEvent`s, but
 * `calculateTurnStateFromHistory` and `computeSkipEligibility` only ever read
 * from them, so one projection serves both. The Staff fields ride along so
 * turn-pass records (systemSender='host', systemKind='turn-pass') are
 * recognised by the turn-state reader and the skip guard alike.
 *
 * @module app/salon/[id]/turn-events
 */

import type { ChatEvent } from '@/lib/schemas/types'
import type { Message } from './types'

/**
 * Project the live message list onto the event shape the turn manager reads.
 *
 * The cast is deliberate: the client Message carries nullable `hostEvent`
 * fields the schema `MessageEvent` narrows, and the readers only read.
 */
export function toTurnEvents(messages: Message[]): ChatEvent[] {
  return messages.map(m => ({
    type: 'message' as const,
    id: m.id,
    role: m.role as 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL',
    content: m.content,
    participantId: m.participantId,
    createdAt: m.createdAt,
    attachments: m.attachments?.map(a => a.id) ?? [],
    targetParticipantIds: m.targetParticipantIds ?? null,
    systemSender: m.systemSender ?? null,
    systemKind: m.systemKind ?? null,
    hostEvent: m.hostEvent ?? null,
    isSilentMessage: m.isSilentMessage,
  })) as unknown as ChatEvent[]
}
