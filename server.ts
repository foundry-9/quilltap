import { createServer, type IncomingMessage } from 'node:http';
import next from 'next';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Duplex } from 'node:stream';
import { logger } from './lib/logger';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

const moduleLogger = logger.child({ module: 'server' });

const wss = new WebSocketServer({ noServer: true });

async function main(): Promise<void> {
  // Create the HTTP server first so we can hand it to Next; this lets Next
  // attach its own upgrade listener (HMR, dev RSC) at prepare time rather
  // than lazily on the first request.
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      moduleLogger.error('Request handler error', { url: req.url }, err as Error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal server error');
      }
    });
  });

  const app = next({ dev, hostname, port, httpServer: server });
  const handle = app.getRequestHandler();

  await app.prepare();

  // Dispatch one upgrade to a lazily-loaded handler module.
  //
  // Lazy so config-only environments (build, lint) don't drag in node-pty and
  // friends. The `.js` extension is required for Node's ESM resolution at
  // runtime: esbuild keeps these imports external (--external:./lib/...), so we
  // get a native dynamic import that needs the explicit suffix even though the
  // source is .ts.
  const dispatchUpgrade = (
    label: string,
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    load: () => Promise<(ws: WebSocket, req: IncomingMessage) => Promise<void>>,
  ): void => {
    const url = req.url ?? '';
    load()
      .then((handle) => {
        wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          handle(ws, req).catch((err) => {
            moduleLogger.error(`${label} WS upgrade error`, { url }, err as Error);
            try {
              ws.close(1011, 'internal error');
            } catch {
              // ignore
            }
          });
        });
      })
      .catch((err) => {
        moduleLogger.error(`Failed to load ${label} WS handler`, { url }, err as Error);
        socket.destroy();
      });
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? '';
    // Terminal WebSocket: /api/v1/terminals/[id]/stream
    if (/^\/api\/v1\/terminals\/[^/]+\/stream(\?|$)/.test(url)) {
      dispatchUpgrade('Terminal', req, socket, head, () =>
        import('./lib/terminal/ws.js').then((m) => m.handleTerminalUpgrade),
      );
      return;
    }
    // Realtime invalidation WebSocket: /api/v1/system/realtime/stream
    if (/^\/api\/v1\/system\/realtime\/stream(\?|$)/.test(url)) {
      dispatchUpgrade('Realtime', req, socket, head, () =>
        import('./lib/realtime/ws.js').then((m) => m.handleRealtimeUpgrade),
      );
      return;
    }
    // Other upgrades (Next HMR, dev RSC, devtools) are handled by Next's own
    // upgrade listener, which it attaches to this same server on first request.
    // Returning without destroying lets that listener take over. Both branches
    // above are anchored regexes for exactly that reason — a loose match would
    // swallow Next's HMR socket.
  });

  server.listen(port, hostname, () => {
    moduleLogger.info('Quilltap server listening', { port, hostname, dev });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      moduleLogger.warn('Forced exit on second signal', { signal });
      process.exit(1);
    }
    shuttingDown = true;
    moduleLogger.info('Shutting down', { signal });

    for (const ws of wss.clients) {
      try { ws.close(1001, 'server shutting down'); } catch { /* ignore */ }
    }
    wss.close();

    server.close(() => {
      moduleLogger.info('HTTP server closed');
      process.exit(0);
    });

    setTimeout(() => {
      moduleLogger.warn('Shutdown timed out, forcing exit');
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  moduleLogger.error('Server failed to start', {}, err as Error);
  process.exit(1);
});
