/**
 * Shared path + file-type helpers for mount-point file operations.
 *
 * These were duplicated verbatim across `file-ops.ts`, `database-store.ts`,
 * and the blob upload route. Centralised here so the canonical write pipeline
 * (`store-file.ts`) and the cross-mount operations (`file-ops.ts`) share one
 * implementation. `normaliseRelativePath` is the single source of truth for
 * the "strip slashes, reject traversal" rule applied before any mount write.
 *
 * @module mount-index/path-utils
 */

import path from 'path';
import { FileOpError } from './file-op-error';

/**
 * Native-text extensions that belong in `doc_mount_documents` (chunkable text)
 * rather than the binary blob mirror.
 */
export type NativeTextType = 'markdown' | 'txt' | 'json' | 'jsonl';

/**
 * Normalise a caller-supplied relative path: collapse `./` and redundant
 * separators, strip leading/trailing slashes, and reject `..` traversal.
 * Throws `FileOpError('INVALID_PATH')` on an empty or traversing path.
 */
export function normaliseRelativePath(input: string): string {
  const normalised = path
    .normalize(input)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!normalised || normalised === '.') {
    throw new FileOpError(`Invalid relative path: ${input}`, 'INVALID_PATH');
  }
  if (normalised.split('/').includes('..')) {
    throw new FileOpError(`Path traversal not allowed: ${input}`, 'INVALID_PATH');
  }
  return normalised;
}

/**
 * Map a path's extension to a native-text file type, or null when the file is
 * binary (or otherwise not a chunkable text format). Mirrors
 * `detectDatabaseFileType` in `database-store.ts` — keep them aligned.
 */
export function detectNativeText(relativePath: string): NativeTextType | null {
  const ext = path.extname(relativePath).toLowerCase();
  switch (ext) {
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.txt':
      return 'txt';
    case '.json':
      return 'json';
    case '.jsonl':
    case '.ndjson':
      return 'jsonl';
    default:
      return null;
  }
}

/**
 * Best-effort MIME type from a path extension. Used when a write has no
 * caller-supplied MIME (e.g. cross-storage byte copies and CLI writes).
 */
export function mimeForExtension(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  switch (ext) {
    case '.md':
    case '.markdown':
      return 'text/markdown; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.jsonl':
    case '.ndjson':
      return 'application/jsonl; charset=utf-8';
    case '.webp':
      return 'image/webp';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Clean, parameter-free MIME type for a native-text document, suitable for a
 * `FileAttachment` handed to the LLM. Unlike {@link mimeForExtension} this drops
 * the `; charset=utf-8` suffix, because the provider text whitelist and
 * `lib/chat/file-attachment-fallback#isTextFile` compare exact strings. Returns
 * null for paths that aren't a native-text type.
 */
export function nativeTextAttachmentMime(relativePath: string): string | null {
  switch (detectNativeText(relativePath)) {
    case 'markdown':
      return 'text/markdown';
    case 'txt':
      return 'text/plain';
    case 'json':
    case 'jsonl':
      return 'application/json';
    default:
      return null;
  }
}
