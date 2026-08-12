/**
 * Chat-Creation Progress SSE — `GET /api/v1/chats/creation-progress?id=<progressId>`
 *
 * Side-channel for the blocking "Green Room" status dialog. The client opens
 * this stream just before it fires `POST /api/v1/chats`; the create handler
 * publishes progress to an in-memory bus keyed by the same `progressId`, and
 * this route relays each event to the dialog.
 *
 * The bus buffers events per id, so a subscriber that connects a beat late
 * replays the whole backlog (and, if creation already finished, the terminal
 * `done`/`error` — which closes the stream immediately).
 */

import type { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { badRequest } from '@/lib/api/responses';
import { sseStreamResponse } from '@/lib/services/chat-message/request-helpers';
import { safeEnqueue, safeClose } from '@/lib/services/chat-message/streaming.service';
import {
  subscribeCreationProgress,
  type CreationProgressEvent,
} from '@/lib/chat/creation-progress';

// Streaming response — never cache, always run dynamically.
export const dynamic = 'force-dynamic';

/** ~15s idle ping, mirroring the message stream's keep-alive cadence. */
const KEEP_ALIVE_MS = 15_000;

export const GET = createContextHandler(async (request: NextRequest): Promise<NextResponse> => {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return badRequest('Missing progress id');
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }
      };

      const send = (event: CreationProgressEvent) => {
        safeEnqueue(controller, encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        if (event.kind === 'done' || event.kind === 'error') {
          cleanup();
          safeClose(controller);
        }
      };

      const { replay, unsubscribe: unsub } = subscribeCreationProgress(id, send);
      unsubscribe = unsub;

      // Replay the backlog first. If it already carries a terminal event, the
      // stream closes here and we never bother arming the keep-alive.
      for (const event of replay) {
        send(event);
        if (event.kind === 'done' || event.kind === 'error') return;
      }

      keepAlive = setInterval(() => {
        safeEnqueue(controller, encoder.encode(`: keep-alive\n\n`));
      }, KEEP_ALIVE_MS);
      keepAlive.unref?.();

      // Client navigated away / closed the dialog → tear the subscription down.
      request.signal.addEventListener('abort', () => {
        cleanup();
        safeClose(controller);
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
    },
  });

  return sseStreamResponse(stream);
});
