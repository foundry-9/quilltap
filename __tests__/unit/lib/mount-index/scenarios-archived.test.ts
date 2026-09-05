/**
 * Unit tests for the `archived` frontmatter flag on file-backed scenarios.
 *
 * Covers the whole chokepoint in `lib/mount-index/scenarios-common.ts`:
 * - parseScenarioDoc: `archived: true` / `"true"` / `false` / absent
 * - buildScenarioFileContent: omission-means-false round-trip
 * - listScenariosInFolder: hidden by default, revealed by includeArchived
 * - archived scenarios never win `isDefault` conflict resolution
 * - resolveScenarioBody still resolves an archived file (chats keep working)
 *
 * Strategy: mock getRepositories() and the database-store reader. No real
 * database or filesystem.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const stub = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  };
  stub.child.mockReturnValue(stub);
  return { logger: stub };
});

jest.mock('@/lib/repositories/factory');
jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn(),
  writeDatabaseDocument: jest.fn(),
}));

import {
  buildScenarioFileContent,
  isScenarioContentArchived,
  listScenariosInFolder,
  parseScenarioDoc,
  resolveScenarioBody,
} from '@/lib/mount-index/scenarios-common';
import type { DocMountDocumentWithLink } from '@/lib/database/repositories/doc-mount-documents.repository';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory')
  .getRepositories as jest.Mock;
const readDatabaseDocumentMock = jest.requireMock('@/lib/mount-index/database-store')
  .readDatabaseDocument as jest.Mock;

const MOUNT_ID = 'mount-001';
const FOLDER = 'Scenarios';

/** Build a minimal doc row for the parser. */
function doc(fileName: string, content: string): DocMountDocumentWithLink {
  return {
    id: `doc-${fileName}`,
    mountPointId: MOUNT_ID,
    relativePath: `${FOLDER}/${fileName}`,
    fileName,
    content,
    lastModified: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as DocMountDocumentWithLink;
}

function withFrontmatter(lines: string[], body: string): string {
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

let findManyByMountPointsInFolder: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  findManyByMountPointsInFolder = jest.fn();
  getRepositoriesMock.mockReturnValue({
    docMountDocuments: { findManyByMountPointsInFolder },
  });
});

// ============================================================================
// parseScenarioDoc
// ============================================================================

describe('parseScenarioDoc — archived flag', () => {
  it('reads a bare `archived: true`', () => {
    const parsed = parseScenarioDoc(doc('a.md', withFrontmatter(['archived: true'], 'Body.')));
    expect(parsed?.archived).toBe(true);
  });

  it('accepts the quoted string "true" the way isDefault-style coercion does', () => {
    const parsed = parseScenarioDoc(doc('a.md', withFrontmatter(['archived: "true"'], 'Body.')));
    expect(parsed?.archived).toBe(true);
  });

  it('treats `archived: false` as active', () => {
    const parsed = parseScenarioDoc(doc('a.md', withFrontmatter(['archived: false'], 'Body.')));
    expect(parsed?.archived).toBe(false);
  });

  it('treats an absent key as active', () => {
    const parsed = parseScenarioDoc(doc('a.md', withFrontmatter(['name: Alpha'], 'Body.')));
    expect(parsed?.archived).toBe(false);
  });

  it('treats a file with no frontmatter at all as active', () => {
    const parsed = parseScenarioDoc(doc('a.md', 'Just a body.'));
    expect(parsed?.archived).toBe(false);
  });

  it('does not mistake a non-boolean value for archived', () => {
    const parsed = parseScenarioDoc(doc('a.md', withFrontmatter(['archived: someday'], 'Body.')));
    expect(parsed?.archived).toBe(false);
  });
});

// ============================================================================
// buildScenarioFileContent
// ============================================================================

describe('buildScenarioFileContent — archived serialisation', () => {
  it('writes `archived: true` when archived', () => {
    const content = buildScenarioFileContent({ name: 'Alpha', archived: true, body: 'Body.' });
    expect(content).toContain('archived: true');
    expect(isScenarioContentArchived(content)).toBe(true);
  });

  it('omits the key entirely when active — never writes `archived: false`', () => {
    expect(buildScenarioFileContent({ name: 'Alpha', archived: false, body: 'Body.' }))
      .not.toContain('archived');
    expect(buildScenarioFileContent({ name: 'Alpha', body: 'Body.' }))
      .not.toContain('archived');
  });

  it('round-trips through the parser', () => {
    const content = buildScenarioFileContent({
      name: 'Alpha',
      description: 'A tale',
      isDefault: true,
      archived: true,
      body: 'Body.',
    });
    const parsed = parseScenarioDoc(doc('alpha.md', content));
    expect(parsed).toMatchObject({
      name: 'Alpha',
      description: 'A tale',
      rawIsDefault: true,
      archived: true,
      body: 'Body.',
    });
  });

  it('emits no frontmatter block at all for a bare active scenario', () => {
    expect(buildScenarioFileContent({ body: 'Body.' })).toBe('Body.');
  });
});

// ============================================================================
// listScenariosInFolder
// ============================================================================

describe('listScenariosInFolder — archived filtering', () => {
  beforeEach(() => {
    findManyByMountPointsInFolder.mockResolvedValue([
      doc('active.md', withFrontmatter(['name: Active'], 'Body.')),
      doc('shelved.md', withFrontmatter(['name: Shelved', 'archived: true'], 'Body.')),
    ]);
  });

  it('hides archived scenarios by default', async () => {
    const { scenarios } = await listScenariosInFolder(MOUNT_ID, FOLDER);
    expect(scenarios.map(s => s.name)).toEqual(['Active']);
  });

  it('reveals archived scenarios when includeArchived is set', async () => {
    const { scenarios } = await listScenariosInFolder(MOUNT_ID, FOLDER, { includeArchived: true });
    expect(scenarios.map(s => s.name)).toEqual(['Active', 'Shelved']);
    expect(scenarios.find(s => s.name === 'Shelved')?.archived).toBe(true);
  });
});

describe('listScenariosInFolder — archived scenarios cannot be the default', () => {
  it('does not let an archived file claim the default, even when listed', async () => {
    // `a-shelved.md` sorts first and claims isDefault, but it is archived.
    findManyByMountPointsInFolder.mockResolvedValue([
      doc('a-shelved.md', withFrontmatter(['isDefault: true', 'archived: true'], 'Body.')),
      doc('b-live.md', withFrontmatter(['isDefault: true'], 'Body.')),
    ]);

    const { scenarios } = await listScenariosInFolder(MOUNT_ID, FOLDER, { includeArchived: true });
    const shelved = scenarios.find(s => s.filename === 'a-shelved');
    const live = scenarios.find(s => s.filename === 'b-live');

    expect(shelved?.isDefault).toBe(false);
    expect(shelved?.rawIsDefault).toBe(true);
    expect(live?.isDefault).toBe(true);
  });

  it('does not warn about a default conflict the archived file cannot join', async () => {
    findManyByMountPointsInFolder.mockResolvedValue([
      doc('a-shelved.md', withFrontmatter(['isDefault: true', 'archived: true'], 'Body.')),
      doc('b-live.md', withFrontmatter(['isDefault: true'], 'Body.')),
    ]);

    const { warnings } = await listScenariosInFolder(MOUNT_ID, FOLDER, { includeArchived: true });
    expect(warnings).toEqual([]);
  });

  it('leaves the scope with no default when the only default is archived', async () => {
    findManyByMountPointsInFolder.mockResolvedValue([
      doc('shelved.md', withFrontmatter(['isDefault: true', 'archived: true'], 'Body.')),
      doc('plain.md', withFrontmatter(['name: Plain'], 'Body.')),
    ]);

    const { scenarios } = await listScenariosInFolder(MOUNT_ID, FOLDER, { includeArchived: true });
    expect(scenarios.some(s => s.isDefault)).toBe(false);
  });

  it('still resolves a conflict between two live defaults alphabetically', async () => {
    findManyByMountPointsInFolder.mockResolvedValue([
      doc('a-live.md', withFrontmatter(['isDefault: true'], 'Body.')),
      doc('b-live.md', withFrontmatter(['isDefault: true'], 'Body.')),
    ]);

    const { scenarios, warnings } = await listScenariosInFolder(MOUNT_ID, FOLDER);
    expect(scenarios.find(s => s.filename === 'a-live')?.isDefault).toBe(true);
    expect(scenarios.find(s => s.filename === 'b-live')?.isDefault).toBe(false);
    expect(warnings).toHaveLength(1);
  });
});

// ============================================================================
// resolveScenarioBody — deliberately archived-blind
// ============================================================================

describe('resolveScenarioBody — archiving does not break existing chats', () => {
  it('resolves the body of an archived scenario', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: withFrontmatter(['name: Shelved', 'archived: true'], 'The body still resolves.'),
    });

    await expect(resolveScenarioBody(MOUNT_ID, 'shelved', FOLDER))
      .resolves.toBe('The body still resolves.');
  });
});
