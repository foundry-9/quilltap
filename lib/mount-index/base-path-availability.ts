/**
 * Base Path Availability
 *
 * A single answer to the question every filesystem-backed store keeps asking:
 * "is my basePath actually there, and if not, whose fault is it?"
 *
 * Three callers need that answer and used to guess at it independently:
 *
 *   - store creation, which warns the operator that scanning will fail;
 *   - folder creation, which must refuse to `mkdir -p` into thin air;
 *   - the scanner, which reports an unreachable mount as an error state.
 *
 * The Docker case deserves its own sentence rather than a generic "not
 * accessible". A container only sees the host paths that were handed to it as
 * bind mounts, so a store whose basePath was perfectly valid on the host is
 * simply absent inside the container — and the remedy (recreate the container
 * with the store bound in) is nothing the operator would infer from ENOENT.
 *
 * @module mount-index/base-path-availability
 */

import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { isDockerEnvironment } from '@/lib/paths';

const logger = createServiceLogger('MountIndex:BasePath');

/** Why a base path could not be used. */
export type BasePathUnavailableReason =
  | 'missing'        // ENOENT — nothing at that path
  | 'denied'         // EACCES/EPERM — present but unreadable
  | 'not-a-directory'; // a file (or similar) is sitting where a directory should be

export type BasePathAvailability =
  | { available: true }
  | {
      available: false;
      reason: BasePathUnavailableReason;
      /** True when this process is inside a container, making an unbound host path the likely cause. */
      containerized: boolean;
      /** Operator-facing explanation, safe to surface in the UI. */
      message: string;
    };

/**
 * Error thrown by filesystem mutations that were asked to act on a base path
 * that isn't there. Carries the diagnosis so routes can map it to a sensible
 * status code and message instead of a bare 500.
 */
export class BasePathUnavailableError extends Error {
  readonly basePath: string;
  readonly reason: BasePathUnavailableReason;
  readonly containerized: boolean;

  constructor(basePath: string, detail: Extract<BasePathAvailability, { available: false }>) {
    super(detail.message);
    this.name = 'BasePathUnavailableError';
    this.basePath = basePath;
    this.reason = detail.reason;
    this.containerized = detail.containerized;
  }
}

/**
 * True when this process can only see host paths that were explicitly passed
 * through — i.e. a container.
 */
function isContainerized(): boolean {
  return isDockerEnvironment();
}

function explain(
  basePath: string,
  reason: BasePathUnavailableReason,
  containerized: boolean
): string {
  if (reason === 'denied') {
    return `The path '${basePath}' exists but cannot be read. Check its permissions${
      containerized ? ', and note that the container runs as a non-root user' : ''
    }.`;
  }

  if (reason === 'not-a-directory') {
    return `The path '${basePath}' is not a directory.`;
  }

  // reason === 'missing'
  if (containerized) {
    return (
      `The path '${basePath}' is not visible from inside the container. ` +
      'Filesystem document stores must be passed through as bind mounts, which can ' +
      'only be done when the container is created. Re-run the start script with ' +
      '`--recreate` to rebuild the container with this store included.'
    );
  }

  return `The path '${basePath}' does not exist.`;
}

/**
 * Inspect a mount point's base path and report whether it can be used.
 *
 * Never throws: an unreadable path is a diagnosis, not an exception.
 */
export async function checkBasePathAvailability(basePath: string): Promise<BasePathAvailability> {
  const containerized = isContainerized();

  try {
    const stat = await fs.stat(basePath);
    if (!stat.isDirectory()) {
      const detail = {
        available: false as const,
        reason: 'not-a-directory' as const,
        containerized,
        message: explain(basePath, 'not-a-directory', containerized),
      };
      logger.debug('Base path is not a directory', { basePath, containerized });
      return detail;
    }

    logger.debug('Base path is available', { basePath, containerized });
    return { available: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const reason: BasePathUnavailableReason =
      code === 'EACCES' || code === 'EPERM' ? 'denied' : 'missing';

    logger.debug('Base path unavailable', { basePath, code, reason, containerized });

    return {
      available: false,
      reason,
      containerized,
      message: explain(basePath, reason, containerized),
    };
  }
}

/**
 * Assert that a base path is usable, throwing {@link BasePathUnavailableError}
 * if it is not. Use before any filesystem mutation rooted at a mount point.
 */
export async function assertBasePathAvailable(basePath: string): Promise<void> {
  const availability = await checkBasePathAvailability(basePath);
  if (availability.available) return;

  logger.warn('Refusing filesystem operation — base path unavailable', {
    basePath,
    reason: availability.reason,
    containerized: availability.containerized,
  });

  throw new BasePathUnavailableError(basePath, availability);
}
