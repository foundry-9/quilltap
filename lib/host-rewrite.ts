/**
 * Host URL Rewriting for Container Environments
 *
 * When Quilltap runs inside Docker — or inside a virtual machine the user has
 * built and manages themselves — `localhost` and `127.0.0.1` resolve to the
 * container/VM's own loopback, not the host machine where services like Ollama
 * or LM Studio are running.
 *
 * This module provides a single function that transparently rewrites
 * localhost URLs to point at the host, so users can configure
 * `http://localhost:11434` and have it Just Work in every environment.
 *
 * Gateway resolution order:
 * 1. `QUILLTAP_HOST_IP` env var (explicit override) → rewrite to that IP.
 *    This is also the only supported route for a self-managed VM, where
 *    Quilltap has no reliable way to detect the host gateway on its own.
 * 2. In Docker: rewrite `localhost` → `host.docker.internal`
 *    (Docker Desktop DNS or --add-host on Linux handles the forwarding)
 * 3. Give up gracefully — return URL unchanged
 *
 * @module lib/host-rewrite
 */

import { logger } from '@/lib/logger';
import { isDockerEnvironment } from '@/lib/paths';

// ============================================================================
// Types
// ============================================================================

/** Hostnames that refer to the local loopback */
const LOCALHOST_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '::1',
]);

// ============================================================================
// Cached Gateway Host
// ============================================================================

let cachedGatewayHost: string | null | undefined; // undefined = not yet resolved

const rewriteLogger = logger.child({ module: 'host-rewrite' });

/**
 * Check if running in an environment that needs URL rewriting.
 *
 * Docker is detected automatically. A hand-rolled VM cannot be, so setting
 * `QUILLTAP_HOST_IP` is what opts one in — it both enables rewriting and
 * supplies the gateway address.
 */
export function isVMEnvironment(): boolean {
  return isDockerEnvironment() || !!process.env.QUILLTAP_HOST_IP;
}

/**
 * Resolve the host gateway address (IP or hostname).
 *
 * Tries multiple strategies in order; caches the result so file reads
 * only happen once per process lifetime.
 */
function resolveHostGateway(): string | null {
  // Return cached result if already resolved
  if (cachedGatewayHost !== undefined) {
    return cachedGatewayHost;
  }

  // Strategy 1: Explicit env var override
  const envIP = process.env.QUILLTAP_HOST_IP;
  if (envIP) {
    rewriteLogger.info('Host gateway from QUILLTAP_HOST_IP', { host: envIP });
    cachedGatewayHost = envIP;
    return cachedGatewayHost;
  }

  // Strategy 2: Docker — use host.docker.internal directly as a hostname
  // Docker Desktop (macOS/Windows) provides built-in DNS resolution for
  // host.docker.internal via its DNS server (127.0.0.11).  Linux Docker
  // needs --add-host=host.docker.internal:host-gateway (handled by the
  // start scripts).  Either way, host.docker.internal correctly forwards
  // to services bound to the host's loopback (127.0.0.1).
  //
  // The bridge gateway IP (e.g. 172.17.0.1) is deliberately not used as a
  // fallback: it is only the Docker bridge interface, and services listening
  // on the host's localhost are NOT reachable through it.
  if (isDockerEnvironment()) {
    rewriteLogger.info('Docker environment detected — using host.docker.internal as gateway hostname');
    cachedGatewayHost = 'host.docker.internal';
    return cachedGatewayHost;
  }

  rewriteLogger.warn('Could not resolve host gateway — localhost URLs will not be rewritten');
  cachedGatewayHost = null;
  return cachedGatewayHost;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Rewrite a localhost URL to point at the host gateway.
 *
 * No-ops when:
 * - Not running in a container (and QUILLTAP_HOST_IP is unset)
 * - The URL doesn't point to localhost or 127.0.0.1
 * - Gateway resolution fails
 *
 * @param url The URL to potentially rewrite
 * @returns The original URL or a rewritten version with the gateway host
 */
export function rewriteLocalhostUrl(url: string): string {
  // No-op on bare metal
  if (!isVMEnvironment()) {
    return url;
  }

  // Parse the URL to check the hostname
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a valid URL — return unchanged
    return url;
  }

  // Check if hostname is a localhost variant
  if (!LOCALHOST_HOSTS.has(parsed.hostname)) {
    return url;
  }

  // Resolve the gateway host
  const gatewayHost = resolveHostGateway();
  if (!gatewayHost) {
    return url;
  }

  // Rewrite the hostname
  parsed.hostname = gatewayHost;
  const rewritten = parsed.toString();

  rewriteLogger.debug('Rewrote localhost URL', {
    original: url,
    rewritten,
    gatewayHost,
  });

  return rewritten;
}
