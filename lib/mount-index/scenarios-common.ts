/**
 * Scenarios — shared file-IO primitives.
 *
 * Two scopes wrap these helpers:
 *   - `project-scenarios.ts` — per-project `Scenarios/` folder inside each
 *     project's official document store.
 *   - `general-scenarios.ts` — instance-wide `Scenarios/` folder inside the
 *     "Quilltap General" singleton mount.
 *
 * Both scopes follow the same on-disk shape: plain markdown files at
 * `<folder>/<filename>.md` with optional YAML frontmatter:
 *
 *   ---
 *   name: Optional Display Name        # overrides filename (without .md) as the title
 *   description: Optional subtitle      # one-line summary shown in the new-chat dropdown
 *   isDefault: true                     # marks this as the scope's default (one wins)
 *   archived: true                      # hidden from every list unless "Show archived"
 *   ---
 *   <body — delivered to the LLM as `chat.scenarioText`>
 *
 * Default-conflict semantics: if multiple files set `isDefault: true`, the
 * alphabetically-first filename wins. Losers are reported as `isDefault: false`
 * in the API response; the file frontmatter on disk is NOT auto-rewritten (the
 * surfaced warning lets the user fix it).
 *
 * Archived semantics: `archived: true` hides a scenario from every list and
 * picker unless the caller opts in with `includeArchived`. Absence of the key
 * means active — an archived file is written with `archived: true`, an active
 * one omits the key entirely. Archived scenarios never win default resolution,
 * even when they are being listed. `resolveScenarioBody()` deliberately ignores
 * the flag so a chat whose scenario was archived mid-life keeps resolving.
 *
 * @module mount-index/scenarios-common
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  readDatabaseDocument,
  writeDatabaseDocument,
} from '@/lib/mount-index/database-store';
import {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatterInContent,
} from '@/lib/doc-edit/markdown-parser';
import type { DocMountDocumentWithLink as DocMountDocument } from '@/lib/database/repositories/doc-mount-documents.repository';

export interface ParsedScenario {
  /** Relative path inside the mount point, e.g. `Scenarios/welcome.md`. */
  path: string;
  /** Filename inside the folder, without the `.md` extension. */
  filename: string;
  /** Display title — frontmatter `name` if present, else filename. */
  name: string;
  /** Optional one-line description from frontmatter. */
  description?: string;
  /** True when this scenario is the effective default after conflict resolution. */
  isDefault: boolean;
  /** True when the file's frontmatter set `isDefault: true`, regardless of conflict resolution. */
  rawIsDefault: boolean;
  /** True when the file's frontmatter set `archived: true`. Absence means active. */
  archived: boolean;
  /** Scenario body — content after frontmatter, trimmed. */
  body: string;
  lastModified: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListScenariosResult {
  scenarios: ParsedScenario[];
  warnings: string[];
}

/**
 * Coerce a frontmatter `archived` value. Truthy only for a real `true` or the
 * string `"true"` — mirrors how `isDefault` is read. Absence means active.
 */
function isArchivedFrontmatter(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  return data.archived === true || data.archived === 'true';
}

/**
 * Read the `archived` flag straight off raw file content. PUT handlers use this
 * to preserve the flag when the request body doesn't mention `archived` — the
 * serializer rewrites the whole file, so an unmentioned flag would otherwise be
 * silently dropped and the scenario would un-archive itself on the next edit.
 */
export function isScenarioContentArchived(content: string): boolean {
  return isArchivedFrontmatter(parseFrontmatter(content).data);
}

/**
 * Parse a single Scenarios/*.md file. Returns null if the file has no usable
 * body (empty bodies are skipped). `rawIsDefault` reflects the file's own
 * frontmatter; `isDefault` is set by the caller after conflict resolution.
 */
export function parseScenarioDoc(doc: DocMountDocument): ParsedScenario | null {
  const content = doc.content;
  const parsed = parseFrontmatter(content);

  let frontmatterName: string | undefined;
  let frontmatterDescription: string | undefined;
  let rawIsDefault = false;
  if (parsed.data) {
    if (typeof parsed.data.name === 'string' && parsed.data.name.trim().length > 0) {
      frontmatterName = parsed.data.name.trim();
    }
    if (typeof parsed.data.description === 'string' && parsed.data.description.trim().length > 0) {
      frontmatterDescription = parsed.data.description.trim().slice(0, 500);
    }
    rawIsDefault = parsed.data.isDefault === true;
  }
  const archived = isArchivedFrontmatter(parsed.data);

  const body = content.slice(parsed.bodyStartOffset).trim();

  if (body.length === 0) {
    logger.warn('Scenario file body is empty; skipping', {
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }

  const fileNameNoExt = doc.fileName.replace(/\.md$/i, '');

  return {
    path: doc.relativePath,
    filename: fileNameNoExt,
    name: (frontmatterName ?? fileNameNoExt).slice(0, 200),
    ...(frontmatterDescription !== undefined && { description: frontmatterDescription }),
    isDefault: rawIsDefault,
    rawIsDefault,
    archived,
    body,
    lastModified: doc.lastModified,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * List all `<folderName>/*.md` files in the given mount point, parsed and
 * sorted alphabetically. If multiple files have `isDefault: true`, the
 * alphabetically-first wins; the others are demoted in the result and a
 * warning naming the offenders is returned.
 *
 * Files at nested paths under the folder are excluded (top-level only).
 * Files with empty bodies are dropped with a logged warning.
 *
 * Archived scenarios are excluded unless `options.includeArchived` is true.
 * Either way they are barred from winning default resolution — an archived
 * file cannot be the scope's default.
 */
export async function listScenariosInFolder(
  mountPointId: string,
  folderName: string,
  options: { includeArchived?: boolean } = {},
): Promise<ListScenariosResult> {
  const repos = getRepositories();

  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    folderName,
    '.md',
  );

  docs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const parsed: ParsedScenario[] = [];
  for (const doc of docs) {
    const scenario = parseScenarioDoc(doc);
    if (!scenario) continue;
    if (scenario.archived && !options.includeArchived) continue;
    parsed.push(scenario);
  }

  const warnings: string[] = [];
  let defaultClaimed = false;
  const offenders: string[] = [];
  for (const scenario of parsed) {
    // An archived scenario never wins — not even when it is being listed.
    if (scenario.archived) {
      scenario.isDefault = false;
      continue;
    }
    if (scenario.rawIsDefault) {
      if (!defaultClaimed) {
        defaultClaimed = true;
        scenario.isDefault = true;
      } else {
        scenario.isDefault = false;
        offenders.push(scenario.filename);
      }
    }
  }
  if (offenders.length > 0) {
    const winner = parsed.find(s => s.isDefault)?.filename ?? '<none>';
    warnings.push(
      `Multiple scenarios mark themselves as default; using "${winner}". ` +
      `These are also marked default but are being ignored: ${offenders.map(o => `"${o}"`).join(', ')}.`,
    );
    logger.warn('Scenarios: multiple isDefault: true entries', {
      mountPointId,
      folderName,
      winner,
      offenders,
    });
  }

  return { scenarios: parsed, warnings };
}

/**
 * Read a single scenario by relative path and return its parsed shape. The
 * `isDefault` field reflects ONLY the file's own frontmatter — does not
 * cross-reference siblings.
 */
export async function readScenarioByPath(
  mountPointId: string,
  relativePath: string,
): Promise<ParsedScenario | null> {
  const repos = getRepositories();
  const doc = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, relativePath);
  if (!doc) return null;
  return parseScenarioDoc(doc);
}

/**
 * Resolve a scenario's body by `<folderName>/<filename>.md` path. Accepts bare
 * filename or full relative path. Returns null when the file is missing or has
 * no usable body. Used by chat creation to bake the scenario into
 * `chat.scenarioText`.
 *
 * Deliberately ignores `archived` — archiving hides a scenario from the menus,
 * it does not break the chats that already chose it.
 */
export async function resolveScenarioBody(
  mountPointId: string,
  scenarioPath: string,
  folderName: string,
): Promise<string | null> {
  let normalised = scenarioPath.trim();
  if (!normalised.startsWith(`${folderName}/`)) {
    normalised = `${folderName}/${normalised.replace(/^\/+/, '')}`;
  }
  if (!/\.md$/i.test(normalised)) {
    normalised = `${normalised}.md`;
  }

  try {
    const { content } = await readDatabaseDocument(mountPointId, normalised);
    const parsed = parseFrontmatter(content);
    const body = content.slice(parsed.bodyStartOffset).trim();
    return body.length > 0 ? body : null;
  } catch (error) {
    logger.warn('Failed to resolve scenario body', {
      mountPointId,
      scenarioPath,
      folderName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Set a single file as the scope's default. Sequenced multi-file write:
 *   1. Set `isDefault: true` on the chosen file.
 *   2. Demote any other files that had `isDefault: true` to `isDefault: false`.
 *
 * No transaction — partial failure leaves the alphabetical-tiebreaker rule
 * to handle the consequence (a soft warning surfaces to the user).
 */
export async function setScenarioDefaultInFolder(
  mountPointId: string,
  defaultPath: string,
  folderName: string,
): Promise<void> {
  const repos = getRepositories();
  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    folderName,
    '.md',
  );

  let chosenFound = false;

  for (const doc of docs) {
    if (doc.relativePath === defaultPath) {
      const updated = updateFrontmatterInContent(doc.content, { isDefault: true });
      if (updated !== doc.content) {
        await writeDatabaseDocument(mountPointId, doc.relativePath, updated);
      }
      chosenFound = true;
      break;
    }
  }

  if (!chosenFound) {
    throw new Error(`Cannot set default — scenario not found: ${defaultPath}`);
  }

  for (const doc of docs) {
    if (doc.relativePath === defaultPath) continue;
    const parsed = parseFrontmatter(doc.content);
    if (parsed.data?.isDefault === true) {
      const updated = updateFrontmatterInContent(doc.content, { isDefault: false });
      if (updated !== doc.content) {
        try {
          await writeDatabaseDocument(mountPointId, doc.relativePath, updated);
        } catch (error) {
          logger.warn('Failed to demote a previously-default scenario; alphabetical tiebreaker will compensate', {
            mountPointId,
            folderName,
            relativePath: doc.relativePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
}

/**
 * Build the full `.md` file content for a scenario from its inputs. Pulls
 * non-empty frontmatter keys into a YAML block and concatenates the body.
 */
export function buildScenarioFileContent(input: {
  name?: string;
  description?: string;
  isDefault?: boolean;
  archived?: boolean;
  body: string;
}): string {
  const frontmatter: Record<string, unknown> = {};
  if (input.name && input.name.trim().length > 0) {
    frontmatter.name = input.name.trim();
  }
  if (input.description && input.description.trim().length > 0) {
    frontmatter.description = input.description.trim();
  }
  if (input.isDefault) {
    frontmatter.isDefault = true;
  }
  // Omission means active — never write `archived: false`.
  if (input.archived) {
    frontmatter.archived = true;
  }
  const fmBlock = Object.keys(frontmatter).length > 0
    ? serializeFrontmatter(frontmatter)
    : '';
  return `${fmBlock}${fmBlock ? '\n' : ''}${input.body}`;
}

/**
 * Normalise a URL-decoded scenarioPath into a clean `<folderName>/<file>.md`
 * relative path. Rejects `..`, `//`, and nested paths under the folder.
 */
export function resolveScenarioPath(
  scenarioPath: string,
  folderName: string,
): { ok: true; path: string } | { ok: false; error: string } {
  let candidate = decodeURIComponent(scenarioPath).trim();
  if (!candidate) {
    return { ok: false, error: 'scenarioPath cannot be empty' };
  }
  if (candidate.includes('..') || candidate.includes('//')) {
    return { ok: false, error: 'Invalid scenarioPath' };
  }
  if (!candidate.startsWith(`${folderName}/`)) {
    candidate = `${folderName}/${candidate.replace(/^\/+/, '')}`;
  }
  if (!/\.md$/i.test(candidate)) {
    candidate = `${candidate}.md`;
  }
  const rest = candidate.slice(folderName.length + 1);
  if (rest.includes('/')) {
    return { ok: false, error: 'Scenarios cannot live in nested folders' };
  }
  return { ok: true, path: candidate };
}
