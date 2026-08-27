/**
 * Data Enrichment Utilities
 *
 * Provides centralized enrichment functions for API responses.
 * Consolidates patterns for adding related data (API keys, tags, etc.)
 * that were duplicated across multiple route handlers.
 */

import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { Tag } from '@/lib/schemas/types';
import { resolveCharacterAvatar } from '@/lib/photos/resolve-character-avatar';

/**
 * Enriched API key info for responses
 * Contains only safe fields (no actual key value)
 */
export interface EnrichedApiKey {
  id: string;
  label: string;
  provider: string;
  isActive: boolean;
}

/**
 * Enriched tag info for responses
 */
export interface EnrichedTag {
  tagId: string;
  tag: Tag;
}

/**
 * Enrich an entity with API key information
 *
 * Common pattern for profiles that reference an API key.
 * Returns only safe fields (no actual key value).
 *
 * @param apiKeyId - The API key ID from the entity
 * @param repos - Repository container for data access
 * @returns Enriched API key info or null
 *
 * @example
 * ```ts
 * const profile = await repos.embeddingProfiles.findById(id);
 * const apiKey = await enrichWithApiKey(profile.apiKeyId, repos);
 * return { ...profile, apiKey };
 * ```
 */
export async function enrichWithApiKey(
  apiKeyId: string | null | undefined,
  repos: RepositoryContainer
): Promise<EnrichedApiKey | null> {
  if (!apiKeyId) {
    return null;
  }

  const key = await repos.connections.findApiKeyById(apiKeyId);

  if (!key) {
    return null;
  }

  return {
    id: key.id,
    label: key.label,
    provider: key.provider,
    isActive: key.isActive,
  };
}

/**
 * Enrich an entity with tag details (batched)
 *
 * Common pattern for entities that have a tags array of IDs.
 * Resolves all tag IDs in a single batched query for efficiency.
 *
 * @param tagIds - Array of tag IDs from the entity
 * @param repos - Repository container for data access
 * @returns Array of enriched tags (filters out null/not found)
 *
 * @example
 * ```ts
 * const profile = await repos.embeddingProfiles.findById(id);
 * const tags = await enrichWithTags(profile.tags, repos);
 * return { ...profile, tags };
 * ```
 */
export async function enrichWithTags(
  tagIds: string[] | undefined,
  repos: RepositoryContainer
): Promise<EnrichedTag[]> {
  if (!tagIds || tagIds.length === 0) {
    return [];
  }

  // Use batched query instead of N+1 individual queries
  const tags = await repos.tags.findByIds(tagIds);

  // Map to enriched format, preserving order from input tagIds
  const tagMap = new Map(tags.map(tag => [tag.id, tag]));
  const enriched: EnrichedTag[] = [];

  for (const tagId of tagIds) {
    const tag = tagMap.get(tagId);
    if (tag) {
      enriched.push({ tagId, tag });
    }
  }

  return enriched;
}

/**
 * A tag as `components/tags/tag-editor.tsx` reads it — flat, not the
 * `{ tagId, tag }` envelope `EnrichedTag` uses for entity payloads.
 *
 * `TagBadge` styles from `getStyleForTag(tag.id)`, so `id` and `name` are the
 * load-bearing fields; `visualStyle` rides along for callers rendering a tag
 * outside the style provider.
 */
export interface EditorTag {
  id: string;
  name: string;
  visualStyle: Tag['visualStyle'];
}

/**
 * Resolve an entity's tag ids for a `?action=get-tags` response.
 *
 * TagEditor is entity-agnostic: it swaps a base path and expects every
 * `get-tags` route to answer with the same `{ tags: [...] }` body. That
 * contract had no owner, so each route open-coded its own loop and they were
 * free to drift — which is Bug 74's second layer. Any entity that grows a
 * `get-tags` action resolves its tags here.
 *
 * Built on {@link enrichWithTags} so the batching and the "preserve the
 * entity's own order" rule are stated once; this only unwraps the envelope.
 */
export async function resolveEditorTags(
  tagIds: string[] | null | undefined,
  repos: RepositoryContainer
): Promise<EditorTag[]> {
  const enriched = await enrichWithTags(tagIds ?? undefined, repos);
  return enriched.map(({ tag }) => ({
    id: tag.id,
    name: tag.name,
    visualStyle: tag.visualStyle,
  }));
}

/**
 * Enriched default image info for responses
 */
export interface EnrichedDefaultImage {
  id: string;
  filepath: string;
  url: null;
}

/**
 * Enrich an entity with default image information
 *
 * Common pattern for characters and projects that have a defaultImageId.
 * Looks up the file entry and returns an API-friendly path.
 *
 * @param imageId - The default image file ID
 * @param repos - Repository container for data access
 * @returns Enriched image info or null
 *
 * @example
 * ```ts
 * const character = await repos.characters.findById(id);
 * const defaultImage = await enrichWithDefaultImage(character.defaultImageId, repos);
 * return { ...character, defaultImage };
 * ```
 */
export async function enrichWithDefaultImage(
  imageId: string | null | undefined,
  repos: RepositoryContainer
): Promise<EnrichedDefaultImage | null> {
  if (!imageId) {
    return null;
  }

  // Post-Phase-3 the id is a doc_mount_file_links id. resolveCharacterAvatar
  // tries the link table first and falls back to the legacy files table,
  // so this stays correct for fresh imports / pre-migration data.
  const resolved = await resolveCharacterAvatar(imageId, repos);

  if (!resolved) {
    return null;
  }

  return {
    id: resolved.id,
    filepath: resolved.url,
    url: null,
  };
}

/**
 * Enrich a profile entity with both API key and tags
 *
 * Convenience wrapper for the common pattern of enriching profiles
 * with both API key info and tag details.
 *
 * @param profile - Profile entity with apiKeyId and tags
 * @param repos - Repository container for data access
 * @returns Object with enriched apiKey and tags
 *
 * @example
 * ```ts
 * const profile = await repos.embeddingProfiles.findById(id);
 * const enriched = await enrichProfile(profile, repos);
 * return { ...profile, ...enriched };
 * ```
 */
export async function enrichProfile<
  T extends { apiKeyId?: string | null; tags?: string[] }
>(
  profile: T,
  repos: RepositoryContainer
): Promise<{ apiKey: EnrichedApiKey | null; tags: EnrichedTag[] }> {
  const [apiKey, tags] = await Promise.all([
    enrichWithApiKey(profile.apiKeyId, repos),
    enrichWithTags(profile.tags, repos),
  ]);

  return { apiKey, tags };
}

