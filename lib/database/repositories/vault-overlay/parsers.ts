/**
 * Pure parsing/validation helpers for vault overlay files.
 *
 * Each parser turns raw file content (JSON or markdown-with-frontmatter) into
 * a validated domain value, falling back to null and logging a warning when
 * the content is missing/malformed so a single bad file never blows up a whole
 * overlay read. None of these reach the database; they operate on already-read
 * content (or pre-fetched `DocMountDocument`s).
 *
 * @module database/repositories/vault-overlay/parsers
 */

import crypto from 'node:crypto';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import type {
  Character,
  CharacterSystemPrompt,
  CharacterScenario,
} from '@/lib/schemas/types';
import {
  WardrobeItemTypeEnum,
  type WardrobeItem,
  type WardrobeItemType,
} from '@/lib/schemas/wardrobe.types';
import { detectComponentCycles } from '@/lib/wardrobe/expand-composites';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import type { DocMountDocumentWithLink as DocMountDocument } from '@/lib/database/repositories/doc-mount-documents.repository';

import {
  CharacterVaultPropertiesSchema,
  type CharacterVaultProperties,
  CharacterVaultMetadataSchema,
  type CharacterVaultMetadata,
  CharacterVaultPhysicalPromptsSchema,
  type CharacterVaultPhysicalPrompts,
  type CharacterVaultWardrobe,
  LegacyVaultWardrobeJsonSchema,
} from './schema';

/**
 * Returns true if this character has a linked vault and is therefore subject
 * to vault-managed-field routing. Post-cutover this is the only condition;
 * the per-character opt-in flag is gone.
 */
export function hasLinkedVault(character: Character): boolean {
  return !!character.characterDocumentMountPointId;
}

/**
 * Parse one JSON-backed vault file into a validated value, returning null (and
 * logging a warning) when the content is missing/malformed or fails schema
 * validation. The single shape shared by every JSON vault parser below; each
 * caller supplies only its schema, log messages, and log context.
 */
function parseJsonVaultFile<T>(
  raw: string,
  schema: z.ZodType<T>,
  opts: {
    parseErrorMessage: string;
    validationErrorMessage: string;
    logContext: Record<string, unknown>;
  },
): T | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    logger.warn(opts.parseErrorMessage, {
      ...opts.logContext,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    logger.warn(opts.validationErrorMessage, {
      ...opts.logContext,
      issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }

  return parsed.data;
}

export function parseVaultProperties(
  raw: string,
  characterId: string,
): CharacterVaultProperties | null {
  return parseJsonVaultFile(raw, CharacterVaultPropertiesSchema, {
    parseErrorMessage: 'Invalid JSON in vault properties.json; falling back to DB values',
    validationErrorMessage: 'Vault properties.json failed schema validation; falling back to DB values',
    logContext: { characterId },
  });
}

/**
 * Parse `metadata.json` — the character's freeform fact sheet.
 *
 * Returns null for anything that isn't a JSON object (invalid JSON, a
 * top-level array, a bare scalar), and the caller hydrates `{}` instead.
 * Deliberately unlike `properties.json`: metadata is not a keystone, so a file
 * the user fat-fingered costs them their metadata for that read and nothing
 * else. Hollowing the character over it would be wildly out of proportion to a
 * missing brace.
 */
export function parseVaultMetadata(
  raw: string,
  characterId: string,
  mountPointId?: string,
): CharacterVaultMetadata | null {
  return parseJsonVaultFile(raw, CharacterVaultMetadataSchema, {
    parseErrorMessage: 'Invalid JSON in vault metadata.json; hydrating empty metadata',
    validationErrorMessage: 'Vault metadata.json is not a JSON object; hydrating empty metadata',
    logContext: { characterId, mountPointId },
  });
}

export function parseVaultPhysicalPrompts(
  raw: string,
  characterId: string,
): CharacterVaultPhysicalPrompts | null {
  return parseJsonVaultFile(raw, CharacterVaultPhysicalPromptsSchema, {
    parseErrorMessage: 'Invalid JSON in vault physical-prompts.json; falling back to DB values',
    validationErrorMessage: 'Vault physical-prompts.json failed schema validation; falling back to DB values',
    logContext: { characterId },
  });
}

/**
 * Parse the legacy `wardrobe.json` payload — kept for migration so vaults that
 * shipped on the old format aren't lost when they're first read or refreshed
 * onto the folder layout. Returns just `{ items }`; the legacy `presets` array
 * is ignored here (the database-side migration folds presets into composite
 * wardrobe items, so honoring them on read would double-write), and the
 * legacy `outfit` placeholder is dropped on the floor (it was never consumed
 * by anything).
 */
export function parseLegacyWardrobeJson(
  raw: string,
  characterId: string,
): CharacterVaultWardrobe | null {
  const parsed = parseJsonVaultFile(raw, LegacyVaultWardrobeJsonSchema, {
    parseErrorMessage: 'Invalid JSON in legacy vault wardrobe.json; falling back to DB values',
    validationErrorMessage: 'Legacy vault wardrobe.json failed schema validation; falling back to DB values',
    logContext: { characterId },
  });
  return parsed ? { items: parsed.items } : null;
}

/**
 * Convert markdown file content into an overlay value. Empty strings become
 * null so that clearing a file collapses to the "unset" state that nullable
 * schema fields expect.
 */
export function markdownToNullable(content: string): string | null {
  return content === '' ? null : content;
}

/**
 * Build a stable, RFC 4122 v8-style UUID from a SHA-256 digest of the source
 * string. v8 is the "custom" version reserved for implementation-specific
 * content; we use it so the `z.uuid()` schema accepts the string without us
 * having to implement true v5 (which requires SHA-1). The exact version byte
 * is not load-bearing — we just need a stable string that parses as a UUID
 * and will always round-trip to itself for the same input.
 */
export function stableUuidFromString(source: string): string {
  const hash = crypto.createHash('sha256').update(source).digest();
  const bytes = Buffer.alloc(16);
  hash.copy(bytes, 0, 0, 16);
  // Set version to 8 (custom) in byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  // Set variant to RFC 4122 in byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Parse a prompt-variant file. The YAML frontmatter carries the display name
 * and isDefault flag; the body (after the closing ---) becomes the prompt
 * content. Files without frontmatter or without a `name` field are skipped.
 */
export function parsePromptFile(
  doc: DocMountDocument,
  characterId: string,
): CharacterSystemPrompt | null {
  const parsed = parseFrontmatter(doc.content);
  if (!parsed.data) {
    logger.warn('Prompts/*.md file has no parseable frontmatter; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  const name = parsed.data.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    logger.warn('Prompts/*.md file missing `name` in frontmatter; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  const isDefault = parsed.data.isDefault === true;
  const body = doc.content.slice(parsed.bodyStartOffset).trimStart();
  if (body.length === 0) {
    logger.warn('Prompts/*.md body is empty; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  return {
    id: stableUuidFromString(`prompt:${doc.mountPointId}:${doc.relativePath}`),
    name: name.trim().slice(0, 100),
    content: body,
    isDefault,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Parse a `Wardrobe/<title>.md` file. Frontmatter carries the structured
 * fields (id, title, types, appropriateness, default flag, archive flag,
 * componentItems, timestamps); the body is the freeform description.
 * Hand-edited files may omit `id` and timestamps — both are filled in on the
 * next sync.
 *
 * Returns null when the file can't yield a valid `WardrobeItem` (no usable
 * title, no valid types, etc.) so the read overlay keeps falling back to the
 * DB value for that single file rather than blowing up the whole list.
 *
 * `componentItemIds` is initially populated with the raw refs from the file
 * (slug or UUID strings, in author-given order). The caller is responsible
 * for resolving these to canonical UUIDs against the freshly-built itemBySlug
 * / itemById maps once every item in the folder has been parsed; see
 * `resolveAndCheckComponentItems` below.
 */
export function parseWardrobeItemFile(
  doc: DocMountDocument,
  characterId: string,
): WardrobeItem | null {
  const parsed = parseFrontmatter(doc.content);

  let title: string | null = null;
  if (parsed.data) {
    const t = parsed.data.title;
    if (typeof t === 'string' && t.trim().length > 0) {
      title = t.trim();
    }
  }
  const afterFrontmatter = doc.content.slice(parsed.bodyStartOffset);
  const lines = afterFrontmatter.split('\n');
  let titleLineIndex = -1;
  if (title === null) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^#\s+(.+)$/);
      if (match) {
        titleLineIndex = i;
        title = match[1].trim();
        break;
      }
    }
  }
  if (title === null) {
    title = doc.fileName.replace(/\.md$/i, '').trim();
  }
  if (title.length === 0) {
    logger.warn('Wardrobe/*.md file has no usable title; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }

  const types = parseWardrobeTypesField(parsed.data?.types);
  if (types === null) {
    logger.warn('Wardrobe/*.md frontmatter has no valid `types` list; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
      raw: parsed.data?.types,
    });
    return null;
  }

  const id =
    typeof parsed.data?.id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.data.id as string)
      ? (parsed.data.id as string)
      : stableUuidFromString(`wardrobe-item:${doc.mountPointId}:${doc.relativePath}`);

  const appropriateness =
    typeof parsed.data?.appropriateness === 'string' && parsed.data.appropriateness.length > 0
      ? (parsed.data.appropriateness as string)
      : null;

  const imagePrompt =
    typeof parsed.data?.imagePrompt === 'string' && parsed.data.imagePrompt.length > 0
      ? (parsed.data.imagePrompt as string)
      : null;

  const isDefault =
    parsed.data?.default === true || parsed.data?.isDefault === true;

  const replace = parsed.data?.replace === true;

  let archivedAt: string | null = null;
  const archivedAtRaw = parsed.data?.archivedAt;
  if (typeof archivedAtRaw === 'string' && archivedAtRaw.length > 0) {
    archivedAt = archivedAtRaw;
  } else if (parsed.data?.archived === true) {
    archivedAt = doc.updatedAt;
  }

  const migratedFromClothingRecordId =
    typeof parsed.data?.migratedFromClothingRecordId === 'string'
      ? (parsed.data.migratedFromClothingRecordId as string)
      : null;

  // Raw componentItems refs (slug or UUID strings). We deliberately store
  // these as-written into componentItemIds; `resolveAndCheckComponentItems`
  // rewrites them to canonical UUIDs in a second pass once the slug/id maps
  // exist. Treating them as UUIDs here would force per-item resolution and
  // re-thread the parser through the lookup maps.
  const componentItemIdsRaw = parseComponentItemsField(parsed.data?.componentItems);

  const createdAt =
    typeof parsed.data?.createdAt === 'string'
      ? (parsed.data.createdAt as string)
      : doc.createdAt;
  const updatedAt =
    typeof parsed.data?.updatedAt === 'string'
      ? (parsed.data.updatedAt as string)
      : doc.updatedAt;

  const bodyText = (titleLineIndex >= 0
    ? lines.slice(titleLineIndex + 1).join('\n')
    : afterFrontmatter
  ).trim();
  const description = bodyText.length > 0 ? bodyText : null;

  return {
    id,
    characterId,
    title: title.slice(0, 200),
    description,
    imagePrompt,
    types,
    appropriateness,
    isDefault,
    replace,
    componentItemIds: componentItemIdsRaw,
    migratedFromClothingRecordId,
    archivedAt,
    createdAt,
    updatedAt,
  };
}

/**
 * Parse the `componentItems:` frontmatter array. Accepts a list of strings
 * (slug or UUID); anything else is dropped with a warning-level no-op (the
 * caller logs once at file scope rather than on every entry). Empty/missing
 * arrays return `[]` so leaf items get the canonical empty value.
 */
export function parseComponentItemsField(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

export function parseWardrobeTypesField(raw: unknown): WardrobeItemType[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const allowed = new Set(WardrobeItemTypeEnum.options);
  const out: WardrobeItemType[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') return null;
    if (!allowed.has(v as WardrobeItemType)) return null;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v as WardrobeItemType);
  }
  return out.length > 0 ? out : null;
}

/**
 * Resolve the raw `componentItems:` strings that `parseWardrobeItemFile`
 * stashed on each item into canonical UUIDs, then run a cycle check across
 * the resolved list. Items whose composites would form a cycle have their
 * `componentItemIds` cleared (read-tolerant — the item itself stays so the
 * user doesn't lose a hand-edit, but the bad reference is dropped). Unknown
 * refs (no slug or UUID match) are logged and dropped from that item's list.
 *
 * Mutates `items` in place because the array is freshly built by the caller
 * and not yet exposed elsewhere.
 */
export function resolveAndCheckComponentItems(
  items: WardrobeItem[],
  itemBySlug: ReadonlyMap<string, WardrobeItem>,
  itemById: ReadonlyMap<string, WardrobeItem>,
  characterId: string,
  mountPointId: string,
): void {
  // First pass — slug/UUID → canonical UUID, dropping unknown refs.
  for (const item of items) {
    if (item.componentItemIds.length === 0) continue;
    const resolved: string[] = [];
    for (const ref of item.componentItemIds) {
      const bySlug = itemBySlug.get(ref);
      if (bySlug) {
        resolved.push(bySlug.id);
        continue;
      }
      const byId = itemById.get(ref);
      if (byId) {
        resolved.push(byId.id);
        continue;
      }
      logger.warn('Wardrobe item references unknown component; dropping ref', {
        characterId,
        mountPointId,
        itemId: item.id,
        title: item.title,
        ref,
      });
    }
    item.componentItemIds = resolved;
  }

  // Second pass — cycle check using the now-resolved IDs. A cycle in the
  // declared graph wipes that item's components rather than the item itself,
  // so the user doesn't lose anything irrecoverable to a vault edit slip.
  for (const item of items) {
    if (item.componentItemIds.length === 0) continue;
    const cycles = detectComponentCycles(item.id, item.componentItemIds, itemById);
    if (cycles.length > 0) {
      logger.warn('Wardrobe item declares a component cycle in vault; dropping its components', {
        characterId,
        mountPointId,
        itemId: item.id,
        title: item.title,
        cycles,
      });
      item.componentItemIds = [];
    }
  }
}

/**
 * Parse a scenario file. Frontmatter — when present — supplies `name` (title)
 * and `description`; the body after the closing `---` becomes the scenario
 * content. When no frontmatter is present, falls back to the legacy heading
 * convention: the first `# heading` is the title and everything after it is
 * the body. Files with neither fall back to the filename-without-extension as
 * the title so malformed files are still visible rather than silently dropped.
 *
 * Project Scenarios in `lib/mount-index/project-scenarios.ts` use the same
 * shape (frontmatter-first, heading-fallback) for symmetry between vault and
 * project scenario authoring.
 */
export function parseScenarioFile(
  doc: DocMountDocument,
  characterId: string,
): CharacterScenario | null {
  const content = doc.content;
  const parsed = parseFrontmatter(content);

  // Title resolution — frontmatter `name` wins, then first `# heading`,
  // then filename-without-extension.
  let title: string | null = null;
  let frontmatterDescription: string | undefined;

  if (parsed.data) {
    const name = parsed.data.name;
    if (typeof name === 'string' && name.trim().length > 0) {
      title = name.trim();
    }
    const description = parsed.data.description;
    if (typeof description === 'string' && description.trim().length > 0) {
      frontmatterDescription = description.trim().slice(0, 500);
    }
  }

  // Body excludes the frontmatter block (parsed.bodyStartOffset is 0 when
  // no frontmatter was present, so this is safe in either case).
  const afterFrontmatter = content.slice(parsed.bodyStartOffset);
  const lines = afterFrontmatter.split('\n');
  let titleLineIndex = -1;

  if (title === null) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^#\s+(.+)$/);
      if (match) {
        titleLineIndex = i;
        title = match[1].trim();
        break;
      }
    }
  }

  if (title === null) {
    const fileName = doc.fileName.replace(/\.md$/i, '');
    title = fileName.trim().slice(0, 200);
    if (title.length === 0) {
      logger.warn('Scenarios/*.md file has no title; skipping', {
        characterId,
        mountPointId: doc.mountPointId,
        relativePath: doc.relativePath,
      });
      return null;
    }
  }

  // Body: when a `# heading` was used as the title, drop that line; otherwise
  // use everything after the frontmatter block.
  let body: string;
  if (titleLineIndex >= 0) {
    body = lines.slice(titleLineIndex + 1).join('\n').trim();
  } else {
    body = afterFrontmatter.trim();
  }
  if (body.length === 0) {
    logger.warn('Scenarios/*.md body is empty; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  return {
    id: stableUuidFromString(`scenario:${doc.mountPointId}:${doc.relativePath}`),
    title: title.slice(0, 200),
    content: body,
    ...(frontmatterDescription !== undefined && { description: frontmatterDescription }),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
