/**
 * Shared character resolution by name or id.
 *
 * Extracted from Carina's inline name-matching so other server-side features
 * (e.g. the Post Office's `send_mail`) resolve a character the same way without
 * duplicating the loop. This layer carries NO reachability/capability gate —
 * callers that need one (Carina's `canBeCarina` / "asker opens the line") apply
 * it on top of the name matches.
 *
 * @module services/character-resolver
 */

import { getRepositories } from '@/lib/repositories/factory';
import type { Character } from '@/lib/schemas/character.types';

/**
 * Every character whose name matches `name` case-insensitively, oldest first
 * (by `createdAt`). Empty array for a blank query or no match.
 *
 * Archived characters never match by name: they can't answer Carina queries or
 * receive mail, and skipping them here lets a live character sharing the name
 * (archive → recreate is a legitimate path to that) win the resolution.
 */
export async function findCharactersByName(userId: string, name: string): Promise<Character[]> {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return [];
  const repos = getRepositories();
  const candidates = await repos.characters.findByUserId(userId);
  return candidates
    .filter((c) => !c.archivedAt && c.name.trim().toLowerCase() === wanted)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/**
 * Resolve a single character from a token that may be an id OR a name. An exact
 * id match wins; otherwise the case-insensitive name match (oldest wins).
 * Returns null when nothing matches. Scoped to the user's characters, so a raw
 * id from elsewhere can't reach a character that isn't theirs.
 *
 * Name matches skip archived characters (a live namesake wins); an exact id
 * match still returns an archived character so the caller can refuse with the
 * named "archived; rehydrate" message instead of a generic not-found.
 */
export async function resolveCharacterByNameOrId(
  userId: string,
  token: string,
): Promise<Character | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const repos = getRepositories();
  const candidates = await repos.characters.findByUserId(userId);

  const byId = candidates.find((c) => c.id === trimmed);
  if (byId) return byId;

  const wanted = trimmed.toLowerCase();
  const nameMatches = candidates
    .filter((c) => !c.archivedAt && c.name.trim().toLowerCase() === wanted)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  return nameMatches[0] ?? null;
}
