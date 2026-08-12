/**
 * File-storage error types.
 *
 * The storage layer wraps most failures in a generic Error carrying a message,
 * which is fine for genuine faults but loses the one distinction callers need
 * to make: is the object *absent*, or did the read *fail*? An absent object is
 * a "gone" condition — the row outlived its bytes — and an HTTP caller should
 * answer 404 so the client renders its fallback, not 500 so it treats a
 * permanent condition as a retryable server fault.
 */

/**
 * The `files` row exists but its content does not: a mount-blob whose blob (or
 * whose whole mount point) has been deleted, or a filesystem key with nothing
 * at that path. Distinct from a read that failed for any other reason —
 * permissions, corruption, a backend that is down — all of which stay generic
 * and keep producing a 500.
 */
export class FileContentMissingError extends Error {
  readonly storageKey: string;

  constructor(storageKey: string, detail?: string) {
    super(detail ?? `No stored content for storageKey: ${storageKey}`);
    this.name = 'FileContentMissingError';
    this.storageKey = storageKey;
  }
}
