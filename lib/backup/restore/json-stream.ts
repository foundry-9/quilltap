/**
 * Disk-backed JSON readers for the extracted backup tree. The streaming array
 * reader parses one element at a time so a multi-hundred-MB array (e.g. full
 * llm-logs history) never has to materialize as a single string and blow past
 * V8's ~512 MB string cap.
 *
 * @module backup/restore/json-stream
 */

import fs from 'fs';
import path from 'path';

/**
 * Reads and parses a JSON file from the extracted backup directory.
 * Returns the parsed data or throws if the file is required but missing.
 *
 * Use only for small documents (e.g. the manifest); use readJsonArrayFile for
 * potentially large arrays so we never load the whole file into a single string.
 */
export async function readJsonFile<T>(basePath: string, relativePath: string): Promise<T> {
  const filePath = path.join(basePath, relativePath);
  const content = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
}

/**
 * Streams a JSON-array file from disk, parsing one element at a time.
 *
 * Why: `fs.readFile(..., 'utf8')` and `JSON.parse` both materialize the entire
 * payload as a single string, and V8 caps strings at ~512 MB. With full-history
 * llm_logs the encoded array can exceed that limit, so a naive read throws
 * `ERR_STRING_TOO_LONG` or `RangeError: Invalid string length`.
 *
 * The scanner is JSON-aware (tracks string/escape state and brace/bracket depth)
 * and assumes top-level elements are objects or arrays — which matches every array
 * we write in `backup-service.ts`. It does not support top-level scalar elements.
 *
 * The resulting array still lives in memory; only the wire-format string is
 * avoided. Per-element memory is bounded by individual row size (a few MB at most
 * for our largest llm_logs entries).
 */
export async function readJsonArrayFile<T>(basePath: string, relativePath: string): Promise<T[]> {
  const filePath = path.join(basePath, relativePath);
  const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });

  const result: T[] = [];
  let started = false;
  let finished = false;
  let inElement = false;
  let elementBuf = '';
  let depth = 0;
  let inString = false;
  let escape = false;

  const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

  for await (const chunk of stream as AsyncIterable<string>) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];

      if (!started) {
        if (c === '[') {
          started = true;
        } else if (!isWs(c)) {
          throw new Error(`readJsonArrayFile: expected '[' at start of ${relativePath}, got ${JSON.stringify(c)}`);
        }
        continue;
      }

      if (finished) {
        if (!isWs(c)) {
          throw new Error(`readJsonArrayFile: unexpected character after array end in ${relativePath}: ${JSON.stringify(c)}`);
        }
        continue;
      }

      if (inElement) {
        elementBuf += c;

        if (escape) {
          escape = false;
          continue;
        }
        if (inString) {
          if (c === '\\') escape = true;
          else if (c === '"') inString = false;
          continue;
        }
        if (c === '"') {
          inString = true;
          continue;
        }
        if (c === '{' || c === '[') {
          depth++;
          continue;
        }
        if (c === '}' || c === ']') {
          depth--;
          if (depth === 0) {
            result.push(JSON.parse(elementBuf) as T);
            elementBuf = '';
            inElement = false;
          }
        }
        continue;
      }

      // Between elements: look for next element start or array close.
      if (c === ']') {
        finished = true;
        continue;
      }
      if (c === ',' || isWs(c)) continue;

      if (c !== '{' && c !== '[') {
        throw new Error(
          `readJsonArrayFile: only object/array elements supported at top level (${relativePath}), got ${JSON.stringify(c)}`
        );
      }
      inElement = true;
      elementBuf = c;
      depth = 1;
    }
  }

  if (!started) {
    throw new Error(`readJsonArrayFile: empty file or no array in ${relativePath}`);
  }
  if (!finished) {
    throw new Error(`readJsonArrayFile: unexpected end of input in ${relativePath}`);
  }

  return result;
}

/**
 * Streaming variant of {@link readJsonArrayFile} that returns the fallback if
 * the file is missing or unreadable; surfaces parse errors otherwise.
 */
export async function readJsonArrayFileOptional<T>(
  basePath: string,
  relativePath: string,
  fallback: T[]
): Promise<T[]> {
  const filePath = path.join(basePath, relativePath);
  try {
    await fs.promises.access(filePath);
  } catch {
    return fallback;
  }
  return readJsonArrayFile<T>(basePath, relativePath);
}
