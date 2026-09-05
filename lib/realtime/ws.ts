/**
 * Realtime WebSocket Upgrade Handler
 *
 * Serves the multiplexed invalidation stream at
 * `/api/v1/system/realtime/stream`. Structurally a twin of the terminal
 * handler minus the PTY: authenticate, attach to the bus, answer pings,
 * detach on the way out.
 *
 * There is no subscription protocol. A single-user instance has a handful of
 * tabs and every event is a few dozen bytes, so the bus broadcasts to all of
 * them and each client ignores the topics it holds no live queries for —
 * invalidating an inactive query key is already a no-op in TanStack Query.
 *
 * @module lib/realtime/ws
 */

import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';

import { logger } from '@/lib/logger';
import { RealtimeClientMessageSchema } from '@/lib/schemas/realtime.types';
import { attachRealtimeSocket, realtimeListenerCount } from './bus';
import { authenticateUpgrade, WS_CLOSE_POLICY_VIOLATION } from './upgrade-auth';

const wsLogger = logger.child({ module: 'realtime-ws' });

/**
 * Handle a WebSocket upgrade for the realtime invalidation stream.
 */
export async function handleRealtimeUpgrade(
  ws: WebSocket,
  req: IncomingMessage,
): Promise<void> {
  const auth = await authenticateUpgrade(req);
  if (!auth.ok) {
    wsLogger.debug('[Realtime WS] Upgrade refused', { reason: auth.reason });
    ws.close(WS_CLOSE_POLICY_VIOLATION, 'Unauthorized');
    return;
  }

  const detach = attachRealtimeSocket(ws);
  wsLogger.info('[Realtime WS] Client connected', { listeners: realtimeListenerCount() });

  ws.on('message', (rawData: Buffer) => {
    try {
      const parsed = RealtimeClientMessageSchema.safeParse(JSON.parse(rawData.toString()));
      if (!parsed.success) return;
      if (parsed.data.type === 'ping') {
        try {
          ws.send(JSON.stringify({ type: 'pong' }));
        } catch {
          // Ignore send error — the close handler will clean up.
        }
      }
    } catch (err) {
      wsLogger.debug('[Realtime WS] Failed to parse client message', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ws.on('close', () => {
    detach();
    wsLogger.debug('[Realtime WS] Client disconnected', { listeners: realtimeListenerCount() });
  });

  ws.on('error', (err: Error) => {
    wsLogger.warn('[Realtime WS] Socket error', { error: err.message });
    detach();
  });
}
