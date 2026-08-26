/**
 * Archived character scenarios: parse, serialize, and — the landmine —
 * survival through the vault projection sweep.
 *
 * `applyManagedFieldWrites` projects `patch.scenarios` over the whole
 * `Scenarios/` folder and DELETES every file the array doesn't contain. So the
 * array handed to it must carry archived scenarios too. Read → archive one →
 * write back is the exact round trip the character editor performs, and an
 * archived scenario silently deleted on the next save is data loss.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

const findManyByMountPointsInFolderMock = jest.fn();
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    docMountDocuments: {
      findManyByMountPointsInFolder: (...args: unknown[]) =>
        findManyByMountPointsInFolderMock(...args),
    },
  }),
}));

const writeDatabaseDocumentMock = jest.fn();
const deleteDatabaseDocumentMock = jest.fn();
jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: (...args: unknown[]) => writeDatabaseDocumentMock(...args),
  deleteDatabaseDocument: (...args: unknown[]) => deleteDatabaseDocumentMock(...args),
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn(async () => 'folder-id'),
}));

import { parseScenarioFile } from '@/lib/database/repositories/vault-overlay/parsers';
import { projectArrayIntoVaultFolder } from '@/lib/database/repositories/vault-overlay/vault-projection';
import { buildScenarioFile, sanitizeFileName } from '@/lib/mount-index/character-vault';
import { firstActiveScenarioContent } from '@/lib/characters/active-scenarios';
import type { CharacterScenario } from '@/lib/schemas/character.types';
import type { DocMountDocument } from '@/lib/database/repositories/doc-mount-documents.repository';

const MOUNT_ID = 'm-1';
const CHAR_ID = 'char-1';

function doc(fileName: string, content: string): DocMountDocument {
  return {
    id: `doc-${fileName}`,
    mountPointId: MOUNT_ID,
    relativePath: `Scenarios/${fileName}`,
    fileName,
    content,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as DocMountDocument;
}

/** The mapper `managed-fields.ts` hands to the scenario projection. */
const SCENARIO_MAPPER = (s: CharacterScenario) => ({
  fileName: `${sanitizeFileName(s.title)}.md`,
  content: buildScenarioFile(s),
});

beforeEach(() => {
  findManyByMountPointsInFolderMock.mockReset().mockResolvedValue([]);
  writeDatabaseDocumentMock.mockReset().mockResolvedValue({ mtime: 1 });
  deleteDatabaseDocumentMock.mockReset().mockResolvedValue(undefined);
});

// ============================================================================
// parse / serialize
// ============================================================================

describe('parseScenarioFile — archived frontmatter', () => {
  it('reads `archived: true`', () => {
    const parsed = parseScenarioFile(
      doc('shelved.md', '---\narchived: true\n---\n\n# Shelved\n\nBody.'),
      CHAR_ID,
    );
    expect(parsed?.archived).toBe(true);
    expect(parsed?.title).toBe('Shelved');
    expect(parsed?.content).toBe('Body.');
  });

  it('leaves `archived` off entirely for an active scenario', () => {
    const parsed = parseScenarioFile(doc('live.md', '# Live\n\nBody.'), CHAR_ID);
    expect(parsed).not.toHaveProperty('archived');
  });

  it('does not treat `archived: false` as archived', () => {
    const parsed = parseScenarioFile(
      doc('live.md', '---\narchived: false\n---\n\n# Live\n\nBody.'),
      CHAR_ID,
    );
    expect(parsed?.archived).toBeUndefined();
  });
});

describe('buildScenarioFile', () => {
  const base = {
    id: 'id-1',
    title: 'The Tavern',
    content: 'Body.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as CharacterScenario;

  it('emits no frontmatter for a plain active scenario', () => {
    expect(buildScenarioFile(base)).toBe('# The Tavern\n\nBody.');
  });

  it('emits `archived: true` when archived', () => {
    expect(buildScenarioFile({ ...base, archived: true }))
      .toBe('---\narchived: true\n---\n\n# The Tavern\n\nBody.');
  });

  it('round-trips title, description and archived through the parser', () => {
    const content = buildScenarioFile({ ...base, description: 'A cozy inn', archived: true });
    const parsed = parseScenarioFile(doc('the-tavern.md', content), CHAR_ID);
    expect(parsed).toMatchObject({
      title: 'The Tavern',
      content: 'Body.',
      description: 'A cozy inn',
      archived: true,
    });
  });
});

// ============================================================================
// The projection sweep
// ============================================================================

describe('scenario projection — archived files survive a resave', () => {
  it('rewrites, rather than deletes, an archived scenario carried in the array', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      doc('Live.md', '# Live\n\nStill here.'),
      doc('Shelved.md', '---\narchived: true\n---\n\n# Shelved\n\nPut away.'),
    ]);

    // What the character editor round-trips: everything it read, with one
    // unrelated edit. The archived scenario rides along flagged.
    const scenarios: CharacterScenario[] = [
      {
        id: 'id-live', title: 'Live', content: 'Edited.',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'id-shelved', title: 'Shelved', content: 'Put away.', archived: true,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    await projectArrayIntoVaultFolder(
      MOUNT_ID, 'Scenarios', scenarios, SCENARIO_MAPPER, CHAR_ID,
    );

    expect(deleteDatabaseDocumentMock).not.toHaveBeenCalled();
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(
      MOUNT_ID,
      'Scenarios/Shelved.md',
      '---\narchived: true\n---\n\n# Shelved\n\nPut away.',
    );
  });

  it('DOES delete the archived file if a caller filters it out of the array first', async () => {
    // Pins the failure mode the design guards against: filtering at the vault
    // read (rather than at the API boundary) is data loss, not just a hidden row.
    findManyByMountPointsInFolderMock.mockResolvedValue([
      doc('Shelved.md', '---\narchived: true\n---\n\n# Shelved\n\nPut away.'),
    ]);

    await projectArrayIntoVaultFolder(MOUNT_ID, 'Scenarios', [], SCENARIO_MAPPER, CHAR_ID);

    expect(deleteDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'Scenarios/Shelved.md');
  });
});

// ============================================================================
// Implicit default
// ============================================================================

describe('firstActiveScenarioContent', () => {
  const at = (i: number, archived?: boolean): CharacterScenario => ({
    id: `id-${i}`,
    title: `S${i}`,
    content: `body-${i}`,
    ...(archived && { archived: true }),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('skips an archived scenario sitting at index 0', () => {
    expect(firstActiveScenarioContent([at(0, true), at(1)])).toBe('body-1');
  });

  it('returns the first scenario when nothing is archived', () => {
    expect(firstActiveScenarioContent([at(0), at(1)])).toBe('body-0');
  });

  it('returns an empty string when every scenario is archived', () => {
    expect(firstActiveScenarioContent([at(0, true), at(1, true)])).toBe('');
  });

  it('tolerates null and undefined', () => {
    expect(firstActiveScenarioContent(null)).toBe('');
    expect(firstActiveScenarioContent(undefined)).toBe('');
  });
});
