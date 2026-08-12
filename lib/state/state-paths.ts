/**
 * Pure path helpers for the persistent state system.
 *
 * `parsePath`/`getAtPath`/`setAtPath`/`deleteAtPath` navigate and mutate the
 * plain JSON objects that back chat / project / group / general state. They
 * carry no I/O, no repository access, and no logging, so they can be shared by
 * the state tool handler, the cascade resolver, and Pascal's `$state`
 * resolution without dragging any of those subsystems in.
 *
 * Extracted verbatim from `lib/tools/handlers/state-handler.ts` (which now
 * re-exports them for backwards compatibility). One deliberate difference: the
 * root-set guard throws a plain `Error` here rather than the handler's typed
 * `StateError`, so this module stays dependency-free. The handler catches and
 * re-wraps it.
 *
 * Known limitation (pre-existing, documented alongside Pascal's `$state`): the
 * `\w+` segment pattern means keys containing spaces or dots are unreachable
 * via a path string.
 *
 * @module state/state-paths
 */

/**
 * Parse a path string into an array of keys.
 * Supports dot notation and array indexing: "player.inventory[0].name".
 */
export function parsePath(path: string | undefined): (string | number)[] {
  if (!path || path.trim() === '') {
    return [];
  }

  const result: (string | number)[] = [];
  // Match either:
  // - A word (property name): \w+
  // - Or an array index: \[(\d+)\]
  const regex = /(\w+)|\[(\d+)\]/g;
  let match;

  while ((match = regex.exec(path)) !== null) {
    if (match[1] !== undefined) {
      // Property name
      result.push(match[1]);
    } else if (match[2] !== undefined) {
      // Array index
      result.push(parseInt(match[2], 10));
    }
  }

  return result;
}

/**
 * Get a value at a path in an object.
 * Returns undefined if path doesn't exist.
 */
export function getAtPath(obj: Record<string, unknown>, path: (string | number)[]): unknown {
  if (path.length === 0) {
    return obj;
  }

  let current: unknown = obj;

  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key];
  }

  return current;
}

/**
 * Set a value at a path in an object.
 * Creates intermediate objects/arrays as needed.
 * Returns the modified object (mutates in place).
 *
 * Setting the root (empty path) requires an object value; a non-object throws
 * a plain `Error` — callers that need a typed error wrap it.
 */
export function setAtPath(
  obj: Record<string, unknown>,
  path: (string | number)[],
  value: unknown
): Record<string, unknown> {
  if (path.length === 0) {
    // Setting root - value must be an object
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    throw new Error('Cannot set root state to non-object value');
  }

  let current: Record<string | number, unknown> = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const nextKey = path[i + 1];

    if (current[key] === undefined || current[key] === null) {
      // Create intermediate structure based on next key type
      current[key] = typeof nextKey === 'number' ? [] : {};
    } else if (typeof current[key] !== 'object') {
      // Overwrite primitive with structure
      current[key] = typeof nextKey === 'number' ? [] : {};
    }

    current = current[key] as Record<string | number, unknown>;
  }

  const lastKey = path[path.length - 1];
  current[lastKey] = value;

  return obj;
}

/**
 * Delete a value at a path in an object.
 * Returns true if something was deleted, false otherwise.
 */
export function deleteAtPath(
  obj: Record<string, unknown>,
  path: (string | number)[]
): boolean {
  if (path.length === 0) {
    // Cannot delete root
    return false;
  }

  let current: Record<string | number, unknown> = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (current[key] === undefined || current[key] === null) {
      return false;
    }
    if (typeof current[key] !== 'object') {
      return false;
    }
    current = current[key] as Record<string | number, unknown>;
  }

  const lastKey = path[path.length - 1];
  if (!(lastKey in current)) {
    return false;
  }

  if (Array.isArray(current) && typeof lastKey === 'number') {
    current.splice(lastKey, 1);
  } else {
    delete current[lastKey];
  }

  return true;
}
