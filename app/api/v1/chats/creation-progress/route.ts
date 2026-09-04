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
 * `done`/`error` — which closes the stream immediately). The relay itself is
 * the shared {@link operationProgressSseResponse}.
 */

import type { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { badRequest } from '@/lib/api/responses';
import { operationProgressSseResponse } from '@/lib/progress/operation-progress-sse';
import type { CreationProgressEvent } from '@/lib/chat/creation-progress';

// Streaming response — never cache, always run dynamically.
export const dynamic = 'force-dynamic';

export const GET = createContextHandler(async (request: NextRequest): Promise<NextResponse> => {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return badRequest('Missing progress id');
  }

  return operationProgressSseResponse<CreationProgressEvent>(id, request);
});
