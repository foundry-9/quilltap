/**
 * Shared WebSocket upgrade authentication
 *
 * A raw `upgrade` request never reaches Next's route pipeline, so none of the
 * usual middleware has looked at it by the time a handler gets a socket. Both
 * WebSocket handlers — the terminal PTY stream and the realtime invalidation
 * stream — gate on this one helper rather than each inventing its own check.
 *
 * What it actually checks, and why:
 *
 *  - **A live session.** `getServerSession()` is the real source of truth in
 *    single-user mode; it resolves the instance's one user out of the
 *    database. The terminal handler previously fell back to "some session-ish
 *    cookie exists," which proved nothing at all — Quilltap sets no session
 *    cookie, so the fallback accepted any request carrying any cookie. That
 *    fallback is gone.
 *  - **Not locked.** A locked instance is waiting on a passphrase and its
 *    databases are shut; API routes answer 423. A socket must not be the one
 *    door left ajar.
 *  - **Same origin.** Browsers do not apply CORS to WebSocket upgrades, so a
 *    page on any other origin can open a socket against a localhost server and
 *    read whatever it streams. An `Origin` whose host disagrees with `Host` is
 *    refused. A *missing* origin is allowed: that is a non-browser client
 *    (`wscat`, the integration tests, the Electron shell's own probes), which
 *    is not the threat this check exists for.
 *
 * @module lib/realtime/upgrade-auth
 */

import type { IncomingMessage } from 'http';

import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { startupState } from '@/lib/startup/startup-state';

const log = logger.child({ module: 'ws-upgrade-auth' });

/** WebSocket close code for a policy refusal. */
export const WS_CLOSE_POLICY_VIOLATION = 1008;

export type UpgradeAuthResult =
  | { ok: true; userId: string }
  | { ok: false; reason: string };

/**
 * Reject an upgrade whose `Origin` names a different host than the request's
 * `Host`. Returns null when the request is acceptable.
 */
function checkOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  // No Origin at all, or the opaque `null` origin: not a browser page acting
  // on behalf of another site, so the hijacking threat doesn't apply.
  if (!origin || origin === 'null') return null;

  const host = req.headers.host;
  if (!host) return 'request has an Origin but no Host';

  try {
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      return `cross-origin upgrade (origin ${originHost} vs host ${host})`;
    }
  } catch {
    return `unparseable Origin header (${origin})`;
  }
  return null;
}

/**
 * Authenticate a WebSocket upgrade request.
 *
 * Never throws — a failure to read the session is a refusal, not an exception
 * for the caller to interpret.
 *
 * @example
 * const auth = await authenticateUpgrade(req);
 * if (!auth.ok) {
 *   ws.close(WS_CLOSE_POLICY_VIOLATION, 'Unauthorized');
 *   return;
 * }
 */
export async function authenticateUpgrade(req: IncomingMessage): Promise<UpgradeAuthResult> {
  const originProblem = checkOrigin(req);
  if (originProblem) {
    log.warn('Rejecting WebSocket upgrade', { url: req.url, reason: originProblem });
    return { ok: false, reason: originProblem };
  }

  if (startupState.isLockedMode()) {
    log.debug('Rejecting WebSocket upgrade — instance is locked', { url: req.url });
    return { ok: false, reason: 'instance is locked' };
  }

  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      log.warn('Rejecting WebSocket upgrade — no session', { url: req.url });
      return { ok: false, reason: 'no session' };
    }
    log.debug('WebSocket upgrade authenticated', { url: req.url, userId: session.user.id });
    return { ok: true, userId: session.user.id };
  } catch (err) {
    log.warn('Rejecting WebSocket upgrade — session lookup failed', {
      url: req.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: 'session lookup failed' };
  }
}
