/**
 * Send-message request helpers
 *
 * Single source of truth for translating a validated request body into the
 * `SendMessageOptions` passed to `handleSendMessage`, and for wrapping the
 * resulting stream in an SSE response. Both POST entry points
 * (`/api/v1/messages?chatId=` and `/api/v1/chats/[id]/messages`) delegate here
 * so the forwarded field set can't drift between them.
 */

import { NextResponse } from 'next/server'
import type { z } from 'zod'
import type { SendMessageOptions } from './types'
import { sendMessageSchema, continueMessageSchema } from './orchestrator.service'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const

/** Per-request extras that don't come from the JSON body. */
export interface SendMessageRequestExtras {
  /** Scrubbed browser User-Agent from the originating request, if available. */
  browserUserAgent?: string
}

/**
 * Build `SendMessageOptions` for a normal send from a validated send-message body.
 * Forwarding logic lives here so both routes stay in lockstep.
 */
export function buildSendMessageOptions(
  parsed: z.infer<typeof sendMessageSchema>,
  extras: SendMessageRequestExtras = {}
): SendMessageOptions {
  return {
    content: parsed.content,
    fileIds: parsed.fileIds,
    pendingToolResults: parsed.pendingToolResults,
    targetParticipantIds: parsed.targetParticipantIds,
    speakingAsParticipantId: parsed.speakingAsParticipantId,
    continueMode: false,
    browserUserAgent: extras.browserUserAgent,
  }
}

/**
 * Build `SendMessageOptions` for continue mode (nudge) from a validated body.
 */
export function buildContinueMessageOptions(
  parsed: z.infer<typeof continueMessageSchema>,
  extras: SendMessageRequestExtras = {}
): SendMessageOptions {
  return {
    continueMode: true,
    respondingParticipantId: parsed.respondingParticipantId,
    speakingAsParticipantId: parsed.speakingAsParticipantId,
    nudge: parsed.nudge,
    browserUserAgent: extras.browserUserAgent,
  }
}

/** Wrap a chat-message stream in the standard SSE response. */
export function sseStreamResponse(stream: ReadableStream<Uint8Array>): NextResponse {
  return new NextResponse(stream, { headers: { ...SSE_HEADERS } })
}
