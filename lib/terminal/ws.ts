/**
 * Terminal WebSocket Upgrade Handler
 *
 * Handles WebSocket upgrades for terminal sessions at /api/v1/terminals/<id>/stream.
 * Authenticates requests, subscribes clients to session streams, and routes incoming
 * messages (input, resize, ping) to the PTY manager.
 *
 * Node-pty is imported at module load (not lazy) — the lazy import is handled at the
 * server.ts upgrade dispatch level.
 *
 * @module terminal/ws
 */

import { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { logger } from '@/lib/logger';
import { authenticateUpgrade, WS_CLOSE_POLICY_VIOLATION } from '@/lib/realtime/upgrade-auth';
import { ptyManager } from './pty-manager';
import type { WsClientMsg } from './types';

const wsLogger = logger.child({ module: 'terminal-ws' });

/**
 * Parse session ID from WebSocket upgrade URL
 * Expected format: /api/v1/terminals/<id>/stream
 */
function extractSessionId(url: string): string | null {
  const match = url.match(/^\/api\/v1\/terminals\/([^/]+)\/stream/);
  return match ? match[1] : null;
}

/**
 * Handle WebSocket upgrade for terminal stream
 *
 * Validates the PTY session exists, authenticates the upgrade through the
 * shared helper, subscribes to the stream, and wires message/close/error
 * handlers.
 */
export async function handleTerminalUpgrade(
  ws: WebSocket,
  req: IncomingMessage,
): Promise<void> {
  const sessionId = extractSessionId(req.url || '');

  if (!sessionId) {
    wsLogger.warn('[Terminal WS] Invalid URL format', { url: req.url });
    ws.close(1008, 'Invalid URL');
    return;
  }

  wsLogger.info('[Terminal WS] Upgrade received', { sessionId });

  // Validate session exists in PTY manager
  const ptySession = ptyManager.get(sessionId);
  if (!ptySession) {
    wsLogger.warn('[Terminal WS] Session not found', { sessionId });
    try {
      ws.send(JSON.stringify({ type: 'exit', code: -1, signal: 'session_not_found' }));
    } catch {
      // Ignore send error
    }
    ws.close(1000, 'Session not found');
    return;
  }

  // Authenticate through the shared upgrade helper — live session, not locked,
  // same origin. This replaced a "some session-ish cookie exists" fallback that
  // proved nothing: Quilltap sets no session cookie, so it accepted anything.
  const auth = await authenticateUpgrade(req);
  if (!auth.ok) {
    wsLogger.debug('[Terminal WS] Unauthorized upgrade', { sessionId, reason: auth.reason });
    ws.close(WS_CLOSE_POLICY_VIOLATION, 'Unauthorized');
    return;
  }

  // Subscribe WebSocket to PTY session
  const subscribed = ptyManager.subscribe(sessionId, ws);
  if (!subscribed) {
    wsLogger.debug('[Terminal WS] Failed to subscribe (session may have exited)', { sessionId });
    ws.close(1000, 'Failed to subscribe');
    return;
  }

  wsLogger.info('[Terminal WS] Client connected', { sessionId });

  // Wire message handler
  ws.on('message', (rawData: Buffer) => {
    try {
      const msg = JSON.parse(rawData.toString()) as WsClientMsg;

      if (msg.type === 'input') {
        wsLogger.debug('[Terminal WS] input', {
          sessionId,
          dataLen: msg.data.length,
        });
        const ok = ptyManager.write(sessionId, msg.data);
        if (!ok) {
          wsLogger.warn('[Terminal WS] input dropped — PTY rejected write', {
            sessionId,
            dataLen: msg.data.length,
          });
        }
      } else if (msg.type === 'resize') {
        ptyManager.resize(sessionId, msg.cols, msg.rows);
      } else if (msg.type === 'ping') {
        try {
          ws.send(JSON.stringify({ type: 'pong' }));
        } catch {
          // Ignore send error
        }
      }
    } catch (err) {
      wsLogger.debug('[Terminal WS] Failed to parse/dispatch message', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Wire close handler
  ws.on('close', () => {
    ptyManager.unsubscribe(sessionId, ws);
    wsLogger.debug('[Terminal WS] Client disconnected', { sessionId });
  });

  // Wire error handler
  ws.on('error', (err: Error) => {
    wsLogger.warn('[Terminal WS] Socket error', {
      sessionId,
      error: err.message,
    });
    ptyManager.unsubscribe(sessionId, ws);
  });
}
