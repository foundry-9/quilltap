/**
 * Operation-progress SSE relay
 *
 * The HTTP face of the {@link module:lib/progress/operation-progress} bus: one
 * `text/event-stream` response that replays a channel's backlog, relays every
 * later event, pings the client while the operation is still running, and
 * tears the subscription down on a terminal `done`/`error`, on client abort, or
 * on stream cancel. The Green Room (`/api/v1/chats/creation-progress`) and The
 * Almanack's report card (`?action=capabilities-report-progress`) are the same
 * relay over different event vocabularies, so the mechanics live here once.
 *
 * @module lib/progress/operation-progress-sse
 */

import type { NextRequest, NextResponse } from 'next/server';
import { sseStreamResponse } from '@/lib/services/chat-message/request-helpers';
import { safeEnqueue, safeClose } from '@/lib/services/chat-message/streaming.service';
import { subscribeOperationProgress, type BaseProgressEvent } from './operation-progress';

/** ~15s idle ping, mirroring the message stream's keep-alive cadence. */
export const PROGRESS_KEEP_ALIVE_MS = 15_000;

function isTerminal(event: BaseProgressEvent): boolean {
  return event.kind === 'done' || event.kind === 'error';
}

/**
 * Stream a progress channel to the client as SSE `data:` frames.
 *
 * The backlog is replayed first; if it already carries a terminal event the
 * stream closes at once and the keep-alive is never armed. Otherwise live
 * events are relayed until the terminal one arrives, the client aborts, or the
 * consumer cancels the stream — each of which unsubscribes and stops the ping.
 */
export function operationProgressSseResponse<E extends BaseProgressEvent>(
  id: string,
  req: NextRequest,
): NextResponse {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

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

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: E) => {
        safeEnqueue(controller, encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        if (isTerminal(event)) {
          cleanup();
          safeClose(controller);
        }
      };

      const { replay, unsubscribe: unsub } = subscribeOperationProgress<E>(id, send);
      unsubscribe = unsub;

      // Replay the backlog first. If it already carries a terminal event the
      // stream closes here and the keep-alive is never armed.
      for (const event of replay) {
        send(event);
        if (isTerminal(event)) return;
      }

      keepAlive = setInterval(() => {
        safeEnqueue(controller, encoder.encode(`: keep-alive\n\n`));
      }, PROGRESS_KEEP_ALIVE_MS);
      keepAlive.unref?.();

      // Client navigated away / closed the dialog → tear the subscription down.
      req.signal.addEventListener('abort', () => {
        cleanup();
        safeClose(controller);
      });
    },
    cancel() {
      cleanup();
    },
  });

  return sseStreamResponse(stream);
}
