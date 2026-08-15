/**
 * Processor host (parent-side)
 *
 * Owns the lifecycle of the forked job-runner child process. Public surface
 * matches the legacy `lib/background-jobs/processor.ts` exports so existing
 * callers (queue-service, embedding-reindex handler, sillytavern import)
 * keep working without modification.
 *
 * Responsibilities:
 *   - spawn / respawn the child
 *   - route IPC messages between the dispatcher (claim loop, write applier)
 *     and the child
 *   - re-emit child log records through the parent's main-thread logger
 *   - send graceful shutdown on SIGTERM / SIGINT and clean up on exit
 *
 * This module is HMR-safe: the live `ChildProcess` and the dispatcher state
 * are stashed on `globalThis`, mirroring the dev-only repository singleton
 * trick used elsewhere in the codebase. Without that, every file save in
 * `next dev` would spawn a new child while leaving the previous one
 * orphaned.
 */

import type { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as nodeModule from 'node:module';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import {
  ChildToParentMessage,
  ParentToChildMessage,
  isChildToParentMessage,
} from '../ipc-types';
import { startDispatcher, stopDispatcher, dispatcherWake, getDispatcherSnapshot, handleChildJobResult } from './job-dispatcher';
import { dispatchHostRpc } from './host-rpc-dispatcher';

const log = logger.child({ module: 'jobs:processor-host' });

// Load `child_process.fork` via createRequire so Turbopack's static analyzer
// can't see the call site. With a direct `import { fork }`, Turbopack treats
// `fork(entry, ...)` as a module-resolving call and tries to bundle the
// `entry` string as an import (failing with `Can't resolve './ROOT/...'`).
// Routing through createRequire keeps the lookup runtime-only.
const dynamicRequire = nodeModule.createRequire(/*turbopackIgnore: true*/ process.cwd() + '/');
const { fork } = dynamicRequire('child_process') as typeof import('child_process');

// ============================================================================
// HMR-safe global state
// ============================================================================

interface HostState {
  child: ChildProcess | null;
  spawning: boolean;
  shuttingDown: boolean;
  childCrashed: boolean;
  restartTimestamps: number[];
  signalHandlersInstalled: boolean;
  invalidationListeners: Set<(target: 'vectorStore' | 'mountPoint', key: string) => void>;
}

declare global {
  var __quilltapJobHost: HostState | undefined;
}

function getState(): HostState {
  if (!globalThis.__quilltapJobHost) {
    globalThis.__quilltapJobHost = {
      child: null,
      spawning: false,
      shuttingDown: false,
      childCrashed: false,
      restartTimestamps: [],
      signalHandlersInstalled: false,
      invalidationListeners: new Set(),
    };
  }
  return globalThis.__quilltapJobHost;
}

// ============================================================================
// Restart policy
// ============================================================================

const RESTART_BACKOFF_MS = 5_000;
const RESTART_WINDOW_MS = 60_000;
const RESTART_CAP = 5;

function recordRestart(): void {
  const state = getState();
  const now = Date.now();
  state.restartTimestamps = state.restartTimestamps.filter(t => now - t < RESTART_WINDOW_MS);
  state.restartTimestamps.push(now);
}

function shouldGiveUp(): boolean {
  const state = getState();
  return state.restartTimestamps.length >= RESTART_CAP;
}

// ============================================================================
// Spawning the child
// ============================================================================

function getChildEntryPath(): string {
  // Next.js webpack-bundles server modules, so `__dirname` here resolves
  // to a synthetic path like `/ROOT/...` instead of the real source
  // location. Resolve against `process.cwd()` instead — both `npm run dev`
  // (tsx server.ts) and `next start` run from the project root, so
  // `lib/background-jobs/child/child-entry.{js,ts}` is always there.
  //
  // Prefer the precompiled `.js` when present: the standalone tarball
  // build (`scripts/build-standalone-tarball.ts`) bundles the child entry
  // with esbuild so the forked process — which has no tsx loader and no
  // tsconfig-paths resolver — can `require` it directly. The `.ts`
  // fallback covers `npm run dev`, where tsx is on `process.execArgv`.
  const baseDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), 'lib', 'background-jobs', 'child');
  const compiled = path.join(baseDir, 'child-entry.js');
  const source = path.join(baseDir, 'child-entry.ts');
  const candidate = fs.existsSync(/*turbopackIgnore: true*/ compiled) ? compiled : source;
  if (!fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
    throw new Error(
      `Background-job child entry not found at ${baseDir} (looked for child-entry.js and child-entry.ts). ` +
      `Ensure the working directory is the Quilltap project root (process.cwd() = "${process.cwd()}").`
    );
  }
  return candidate;
}

function spawnChild(): ChildProcess {
  const state = getState();
  if (state.child && !state.child.killed) {
    return state.child;
  }
  state.spawning = true;

  const entry = getChildEntryPath();
  log.info('Spawning background-job child', { entry, pid: process.pid });

  const child = fork(entry, [], {
    env: {
      ...process.env,
      QUILLTAP_JOB_CHILD: '1',
    },
    // Inherit tsx's loader flags so the child can execute the .ts entry file.
    execArgv: process.execArgv,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    // Advanced serialization (V8 structured-clone) preserves typed arrays
    // (Float32Array embeddings), Buffers, and Maps over IPC. The default
    // 'json' serialization would mangle Float32Array into a plain object
    // which then fails Zod validation in the parent's write applier.
    serialization: 'advanced',
  });

  state.child = child;
  state.spawning = false;

  child.on('message', handleChildMessage);

  child.on('error', err => {
    log.error('Child process error', { error: getErrorMessage(err) });
  });

  child.on('exit', (code, signal) => {
    log.warn('Child process exited', { code, signal });
    const wasShuttingDown = state.shuttingDown;
    state.child = null;
    if (wasShuttingDown) return;

    if (code !== 0) {
      recordRestart();
      if (shouldGiveUp()) {
        state.childCrashed = true;
        log.error('Child crashed too often; giving up. Restart the server to retry.', {
          crashCount: state.restartTimestamps.length,
        });
        return;
      }
      setTimeout(() => {
        if (!state.shuttingDown && !state.child) {
          log.info('Respawning background-job child after crash backoff', {
            backoffMs: RESTART_BACKOFF_MS,
          });
          spawnChild();
          startDispatcher();
        }
      }, RESTART_BACKOFF_MS);
    }
  });

  installSignalHandlers();
  return child;
}

function handleChildMessage(raw: unknown): void {
  if (!isChildToParentMessage(raw)) {
    log.warn('Child sent malformed IPC message', { raw });
    return;
  }
  const msg = raw as ChildToParentMessage;
  switch (msg.type) {
    case 'job-result':
      handleChildJobResult(msg).catch(err => {
        log.error('Failed to apply child job result', {
          jobId: msg.jobId,
          error: getErrorMessage(err),
        });
      });
      break;
    case 'log':
      replayLogRecord(msg.record);
      break;
    case 'status':
      // Status is consumed by getProcessorStatus via dispatcher snapshot
      // for now; reserved for future per-handler accounting.
      break;
    case 'shutdown-ack':
      log.info('Child acknowledged shutdown');
      break;
    case 'host-rpc':
      dispatchHostRpc(msg)
        .then(response => sendToChild(response))
        .catch(err => {
          log.error('host-rpc dispatch threw before reply', {
            method: msg.method,
            requestId: msg.requestId,
            error: getErrorMessage(err),
          });
        });
      break;
  }
}

function replayLogRecord(record: { level: string; message: string; timestamp: string; context?: string; meta?: Record<string, unknown> }): void {
  // Re-emit the child's log line through the parent's logger so it lands in
  // the same combined.log / error.log without competing for the file handle.
  const meta = { ...(record.meta ?? {}), childLog: true, childContext: record.context };
  switch (record.level) {
    case 'error': log.error(record.message, meta); break;
    case 'warn':  log.warn(record.message, meta); break;
    case 'info':  log.info(record.message, meta); break;
    case 'trace': log.trace(record.message, meta); break;
    // 'debug' and anything unrecognised: re-emit at debug, never at info. The
    // child has already filtered against the shared LOG_LEVEL (it inherits the
    // parent's env), so promoting an unknown level here would only mislabel it
    // and let it slip past a level filter downstream.
    default:      log.debug(record.message, meta); break;
  }
}

// ============================================================================
// Signal handlers (parent shutdown)
// ============================================================================

function installSignalHandlers(): void {
  const state = getState();
  if (state.signalHandlersInstalled) return;
  state.signalHandlersInstalled = true;

  const onExit = () => {
    state.shuttingDown = true;
    sendToChild({ type: 'shutdown' });
    stopDispatcher();
    if (state.child && !state.child.killed) {
      // Give the child a moment to drain in-flight jobs, then kill.
      setTimeout(() => {
        if (state.child && !state.child.killed) {
          state.child.kill('SIGTERM');
        }
      }, 5_000).unref();
    }
  };

  process.once('SIGTERM', onExit);
  process.once('SIGINT', onExit);
  process.once('beforeExit', onExit);
}

// ============================================================================
// Public API (mirrors legacy processor.ts exports)
// ============================================================================

export function ensureProcessorRunning(): void {
  // The processor host only has work to do in the parent. Code paths
  // inside the child (e.g. `initializePlugins` reaching into a service
  // that calls `ensureProcessorRunning`) must be no-ops — otherwise the
  // child tries to fork a grandchild, start its own dispatcher, and
  // claim jobs against its readonly DB.
  if (process.env.QUILLTAP_JOB_CHILD === '1') return;

  const state = getState();
  if (state.shuttingDown) return;
  // If the exit handler already gave up after RESTART_CAP failures, don't let
  // a fresh enqueue silently respawn. Without this, every enqueueJob() call
  // re-enters the crash loop because the give-up path only suppresses the
  // setTimeout respawn — not the lazy spawn from this entrypoint.
  if (state.childCrashed) return;
  if (!state.child) {
    spawnChild();
    startDispatcher();
  }
  dispatcherWake();
}

export function stopProcessor(): void {
  if (process.env.QUILLTAP_JOB_CHILD === '1') return;

  const state = getState();
  state.shuttingDown = true;
  sendToChild({ type: 'shutdown' });
  stopDispatcher();
  if (state.child && !state.child.killed) {
    state.child.kill('SIGTERM');
  }
  state.child = null;
  // Reset the shuttingDown flag so subsequent ensureProcessorRunning calls
  // can spawn fresh — operators may stop and restart.
  state.shuttingDown = false;
}

export function isProcessorRunning(): boolean {
  if (process.env.QUILLTAP_JOB_CHILD === '1') return false;
  const state = getState();
  return !!state.child && !state.child.killed;
}

export function getProcessorStatus(): {
  running: boolean;
  processing: boolean;
  inFlight: number;
  childCrashed: boolean;
} {
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    return { running: false, processing: false, inFlight: 0, childCrashed: false };
  }
  const state = getState();
  const snapshot = getDispatcherSnapshot();
  return {
    running: isProcessorRunning(),
    processing: snapshot.inFlight > 0,
    inFlight: snapshot.inFlight,
    childCrashed: state.childCrashed,
  };
}

export function wakeProcessor(): void {
  if (process.env.QUILLTAP_JOB_CHILD === '1') return;
  ensureProcessorRunning();
}

/**
 * Forward a cache invalidation to the child, if alive. Used by parent-side
 * code that mutates state the child caches (vector store, mount-chunk
 * cache).
 */
export function notifyChild(target: 'vectorStore' | 'mountPoint', key: string): void {
  sendToChild({ type: 'invalidate', target, key });
}

/**
 * Send a message to the child. Returns false if the child isn't alive.
 */
export function sendToChild(msg: ParentToChildMessage): boolean {
  const state = getState();
  if (!state.child || state.child.killed) return false;
  try {
    state.child.send(msg);
    return true;
  } catch (err) {
    log.warn('Failed to send IPC message to child', {
      type: msg.type,
      error: getErrorMessage(err),
    });
    return false;
  }
}
