/**
 * Query-parameter readers shared by v1 routes.
 *
 * @module api/query-params
 */

import type { NextRequest } from 'next/server';

/**
 * Read the `?includeArchived=true` opt-in.
 *
 * Archived scenarios and wardrobe items are hidden by default at every listing
 * endpoint; a caller that wants to see them says so explicitly. Reading the
 * param in one place keeps the accepted spelling from drifting between the
 * eleven routes that honour it — anything other than a literal `true` (or the
 * bare valueless `?includeArchived`) means "no".
 */
export function readIncludeArchived(req: NextRequest | Request): boolean {
  let raw: string | null;
  try {
    raw = new URL(req.url).searchParams.get('includeArchived');
  } catch {
    // No parseable URL (an odd runtime, a bare stub in a test): fall closed.
    // Hiding archived entries is always the safe answer to "were we asked?".
    return false;
  }
  return raw === 'true' || raw === '';
}
