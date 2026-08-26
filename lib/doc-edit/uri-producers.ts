/**
 * Server-side `qtap://` URI producers.
 *
 * These build human-/model-facing URIs from resolved documents. They touch the
 * database (to detect the self-vault and to count name collisions) but are kept
 * deliberately free of the heavier doc-edit modules (`reindex-file` →
 * `converters`, the path resolver's filesystem deps): they import only the pure
 * codec, the repositories factory, and TYPE-only references to the resolver.
 * That keeps any consumer (search, self-inventory, the doc-edit handlers) from
 * dragging native conversion deps into its module graph.
 *
 * @module doc-edit/uri-producers
 */

import { getRepositories } from '@/lib/repositories/factory';
import { formatSelfUri, formatScopedUri, formatDocStoreUri, docStoreAuthority } from './qtap-uri';
// Type-only — erased at compile time, so no runtime dependency on path-resolver.
import type { ResolvedPath } from './path-resolver';

/**
 * The acting character's own vault mount-point id, or null. A self-contained
 * copy of the resolver's `resolveSelfVaultMountPointId` so this module needs no
 * runtime import of path-resolver (which pulls in fs/native deps).
 */
async function selfVaultMountPointId(characterId: string | undefined): Promise<string | null> {
  if (!characterId) return null;
  try {
    const acting = await getRepositories().characters.findByIdRaw(characterId);
    return acting?.characterDocumentMountPointId ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a `qtap://` URI for a single document-store document given its mount id
 * and name (the form blob handlers and search hold instead of a `ResolvedPath`).
 * Prefers `qtap://self/…` for the acting character's own vault, else the store
 * name (UUID when the name is ambiguous). The URI is an additive convenience,
 * so any failure degrades to '' rather than throwing.
 */
export async function docStoreUriFor(args: {
  mountPointId: string;
  mountPointName: string;
  relativePath: string;
  characterId?: string;
  heading?: string;
  level?: number;
}): Promise<string> {
  try {
    if (args.characterId && args.mountPointId) {
      const selfId = await selfVaultMountPointId(args.characterId);
      if (selfId && args.mountPointId === selfId) {
        return formatSelfUri(args.relativePath, { heading: args.heading, level: args.level });
      }
    }
    let nameIsAmbiguous = !args.mountPointName;
    if (args.mountPointName) {
      try {
        nameIsAmbiguous = (await getRepositories().docMountPoints.countByName(args.mountPointName)) > 1;
      } catch {
        nameIsAmbiguous = false;
      }
    }
    return formatDocStoreUri({
      mountPointName: args.mountPointName,
      mountPointId: args.mountPointId,
      path: args.relativePath,
      nameIsAmbiguous,
      heading: args.heading,
      level: args.level,
    });
  } catch {
    return '';
  }
}

/**
 * Build a human-/model-facing `qtap://` URI for a single resolved document,
 * choosing the most stable readable form: the acting character's own vault →
 * `qtap://self/…`; project/general scope → the scoped authority; any other
 * document store → its name (or UUID when ambiguous). For multi-row tools that
 * emit many URIs at once, prefer `buildDocStoreUriResolver`.
 */
export async function uriForResolvedPath(
  resolved: ResolvedPath,
  context: { characterId?: string },
  opts?: { heading?: string; level?: number }
): Promise<string> {
  try {
    if (resolved.scope === 'project' || resolved.scope === 'general') {
      return formatScopedUri(resolved.scope, resolved.relativePath, opts);
    }
    return await docStoreUriFor({
      mountPointId: resolved.mountPointId ?? '',
      mountPointName: resolved.mountPointName ?? '',
      relativePath: resolved.relativePath,
      characterId: context.characterId,
      heading: opts?.heading,
      level: opts?.level,
    });
  } catch {
    return '';
  }
}

/**
 * Pre-compute the self-vault id and the set of ambiguous (duplicated) store
 * names ONCE, then hand back synchronous helpers for building many `qtap://`
 * URIs — for `doc_list_files`, `doc_grep`, `doc_list_blobs`, and search, which
 * emit a URI per row and must not fire a repo lookup per row. Each closure is
 * fully defensive: a URI is additive and must never throw out of a handler.
 */
export async function buildDocStoreUriResolver(characterId?: string): Promise<{
  uriForMount(mountPointName: string, mountPointId: string, relativePath: string): string;
  uriForScope(scope: 'project' | 'general', relativePath: string): string;
}> {
  let selfVaultId: string | null = null;
  try {
    selfVaultId = await selfVaultMountPointId(characterId);
  } catch {
    // No acting character, or a degraded read — no self-vault shorthand.
  }
  const ambiguous = await collectAmbiguousStoreNames();
  return {
    uriForMount(name, id, relativePath) {
      try {
        if (selfVaultId && id === selfVaultId) return formatSelfUri(relativePath);
        return formatDocStoreUri({
          mountPointName: name,
          mountPointId: id,
          path: relativePath,
          nameIsAmbiguous: !name || ambiguous.has(name.trim().toLowerCase()),
        });
      } catch {
        return '';
      }
    },
    uriForScope(scope, relativePath) {
      try {
        return formatScopedUri(scope, relativePath);
      } catch {
        return '';
      }
    },
  };
}

/**
 * The lower-cased names shared by more than one enabled store. A name in this
 * set can't address a store on its own, so producers fall back to the UUID.
 * Degrades to an empty set on a broken mount index — the readable name form is
 * still the better guess than nothing.
 */
async function collectAmbiguousStoreNames(): Promise<Set<string>> {
  const ambiguous = new Set<string>();
  try {
    const enabled = await getRepositories().docMountPoints.findEnabled();
    const counts = new Map<string, number>();
    for (const mp of enabled) {
      const key = mp.name.trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) if (count > 1) ambiguous.add(key);
  } catch {
    // Degraded mount index — leave the ambiguity set empty.
  }
  return ambiguous;
}

/**
 * The bare-reference sibling of {@link buildDocStoreUriResolver}: hands back a
 * synchronous `refForMount` that yields the store **name**, or its **UUID**
 * when the name is ambiguous or reserved. Used where the consumer wants an
 * addressable store reference rather than a full `qtap://` URI — the global
 * search bar's document results, whose click targets and deep links carry
 * `mountPoint=<ref>`.
 *
 * There is no self-vault shorthand here: `self` only means anything inside a
 * character's own prompt, and these references are handed to operator surfaces.
 */
export async function buildDocStoreRefResolver(): Promise<{
  refForMount(mountPointName: string, mountPointId: string): string;
}> {
  const ambiguous = await collectAmbiguousStoreNames();
  return {
    refForMount(mountPointName, mountPointId) {
      try {
        return docStoreAuthority({
          mountPointName,
          mountPointId,
          nameIsAmbiguous: !mountPointName || ambiguous.has(mountPointName.trim().toLowerCase()),
        });
      } catch {
        return mountPointId;
      }
    },
  };
}
