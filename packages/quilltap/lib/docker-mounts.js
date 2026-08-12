'use strict';

/**
 * Docker Bind Planning for Filesystem Document Stores
 *
 * A container sees only the host paths handed to it at creation time. Database
 * -backed stores live inside the data directory and ride along on the single
 * bind every Quilltap container already has; filesystem and Obsidian stores
 * point anywhere on the host and are, by default, simply absent inside the
 * container — the store lists happily from the cached mount index while every
 * read and write against the real bytes fails.
 *
 * This module turns "what stores does this instance have" into "what -v flags
 * does the container need". It is deliberately pure: the caller supplies the
 * store rows, the platform, and a path probe, so the planner can be tested
 * without a database, a filesystem, or Docker.
 *
 * ## Why the binds are path-identical
 *
 * Each store is bound at its own host path (`-v /host/vault:/host/vault`) so
 * the `basePath` recorded in the database resolves unchanged whether Quilltap
 * runs natively or in a container. The alternative — mounting under some
 * container-local prefix — would require a translation layer on every path in
 * and out of the database, and would make the same instance directory
 * unusable outside the container.
 *
 * Docker creates missing destination ancestors itself, as root and mode 0755,
 * during mount setup — so binding `/Users/you/Vault` into an image that has no
 * `/Users` works, and the unprivileged app user can still traverse in. Those
 * ancestors are *not* writable by the app user, which is a feature: a store
 * that was never bound stays structurally unwritable rather than quietly
 * accumulating a fabricated directory tree.
 *
 * @module docker-mounts
 */

const path = require('path');
const fs = require('fs');

/**
 * Prefixes Docker Desktop for macOS shares with the VM out of the box. A bind
 * whose source falls outside these is accepted by `docker run` but arrives in
 * the container as an empty directory, which is a uniquely confusing failure —
 * so it earns a warning rather than silence.
 */
const MACOS_DEFAULT_SHARED_PREFIXES = ['/Users', '/Volumes', '/private', '/tmp', '/var/folders'];

/** Store types whose bytes live on the host filesystem rather than in the database. */
const FILESYSTEM_MOUNT_TYPES = new Set(['filesystem', 'obsidian']);

/**
 * Normalise a base path for comparison: resolve `.`/`..`, collapse separators,
 * and drop any trailing separator so `/a/b` and `/a/b/` are one path.
 */
function normalisePath(basePath) {
  const resolved = path.posix.normalize(String(basePath).trim());
  if (resolved.length > 1 && resolved.endsWith('/')) {
    return resolved.slice(0, -1);
  }
  return resolved;
}

/** True when `candidate` sits inside `ancestor` (and is not `ancestor` itself). */
function isDescendantOf(candidate, ancestor) {
  return candidate.startsWith(ancestor.endsWith('/') ? ancestor : ancestor + '/');
}

/**
 * Plan the bind mounts an instance's filesystem-backed stores require.
 *
 * @param {Array<object>} rows - doc_mount_points rows (id, name, mountType, basePath, enabled)
 * @param {object} [options]
 * @param {string} [options.platform] - process.platform value; defaults to the current host
 * @param {(p: string) => boolean} [options.exists] - path probe, injectable for tests
 * @returns {{binds: Array<object>, skipped: Array<object>, warnings: Array<string>, unsupported: boolean}}
 */
function planStoreMounts(rows, options = {}) {
  const platform = options.platform || process.platform;
  const exists =
    options.exists ||
    ((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });

  const warnings = [];

  // Windows host paths (C:\Users\…) have no in-container equivalent, so the
  // path-identical scheme this module depends on cannot work there. Say so
  // plainly rather than emitting binds that would silently misbehave.
  if (platform === 'win32') {
    return {
      binds: [],
      skipped: [],
      warnings: [
        'Automatic store binds are not supported on Windows: container paths cannot mirror ' +
          'Windows host paths. Filesystem document stores must be bound manually.',
      ],
      unsupported: true,
    };
  }

  const candidates = rows.filter(
    (r) => FILESYSTEM_MOUNT_TYPES.has(r.mountType) && r.enabled && String(r.basePath || '').trim()
  );

  // Group stores by normalised path first — several stores commonly share one
  // vault root, and they need exactly one bind between them.
  const byPath = new Map();
  for (const row of candidates) {
    const normalised = normalisePath(row.basePath);
    if (!path.posix.isAbsolute(normalised)) {
      warnings.push(`Skipping store '${row.name}': base path '${row.basePath}' is not absolute.`);
      continue;
    }
    if (!byPath.has(normalised)) {
      byPath.set(normalised, []);
    }
    byPath.get(normalised).push(row.name);
  }

  const allPaths = [...byPath.keys()].sort();

  const binds = [];
  const skipped = [];

  for (const hostPath of allPaths) {
    const stores = byPath.get(hostPath);

    // A path nested inside another selected path is already covered by that
    // bind. Binding both is redundant, and Docker mounts them independently —
    // which would shadow the parent's view of the child directory.
    const ancestor = allPaths.find((other) => other !== hostPath && isDescendantOf(hostPath, other));
    if (ancestor) {
      continue;
    }

    if (!exists(hostPath)) {
      // Never create the source. Docker would happily materialise a missing
      // bind source as a root-owned empty directory, which presents an empty
      // store as a healthy one — the exact failure this feature exists to end.
      skipped.push({ hostPath, stores, reason: 'missing' });
      continue;
    }

    if (platform === 'darwin' && !MACOS_DEFAULT_SHARED_PREFIXES.some((p) => hostPath === p || isDescendantOf(hostPath, p))) {
      warnings.push(
        `'${hostPath}' is outside Docker Desktop's default shared paths. Add it under ` +
          'Settings → Resources → File sharing, or the store will appear empty in the container.'
      );
    }

    binds.push({ hostPath, containerPath: hostPath, stores });
  }

  if (platform === 'linux' && binds.length > 0) {
    warnings.push(
      'On Linux, bind mounts preserve host ownership. If the container user cannot write to ' +
        'these paths, start the container with --user "$(id -u):$(id -g)".'
    );
  }

  for (const entry of skipped) {
    warnings.push(
      `Skipping '${entry.hostPath}' (${entry.stores.join(', ')}): the path does not exist on this host.`
    );
  }

  return { binds, skipped, warnings, unsupported: false };
}

/** Render a plan as `docker run` arguments. */
function toDockerArgs(plan) {
  const args = [];
  for (const bind of plan.binds) {
    args.push('-v', `${bind.hostPath}:${bind.containerPath}`);
  }
  return args;
}

/**
 * Compare a plan against the binds a container was actually created with.
 * Returns the host paths a running container is missing, which is what tells
 * an operator that a restart is owed.
 */
function findMissingBinds(plan, existingSources) {
  const existing = new Set(existingSources.map(normalisePath));
  return plan.binds.filter((b) => !existing.has(b.hostPath));
}

module.exports = {
  planStoreMounts,
  toDockerArgs,
  findMissingBinds,
  normalisePath,
  FILESYSTEM_MOUNT_TYPES,
  MACOS_DEFAULT_SHARED_PREFIXES,
};
