/**
 * Regression tests for lib/doc-edit/path-resolver.ts
 *
 * Covers the symlink-aware boundary check. On macOS the canonical iCloud
 * data directory `~/iCloud` is a symlink to
 * `~/Library/Mobile Documents/com~apple~CloudDocs`. When a project file
 * under that tree is read, `fs.realpath` expands the symlink while a
 * naïvely-joined `baseDir` does not — and a containment check on the two
 * sides used to reject every existing file as a "Path escapes project
 * boundary" error. The fix realpaths both sides; these tests pin that
 * behavior so the regression cannot return.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const getFilesDirMock = jest.fn<() => string>();

jest.mock('@/lib/paths', () => ({
  getFilesDir: () => getFilesDirMock(),
}));

const projectsFindByIdMock = jest.fn<(id: string) => Promise<{ id: string; officialMountPointId: string | null } | null>>();
const docMountPointsFindByIdMock = jest.fn<(id: string) => Promise<unknown>>();
const charactersFindByIdRawMock = jest.fn<(id: string) => Promise<unknown>>();

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    projects: { findById: projectsFindByIdMock },
    docMountPoints: { findById: docMountPointsFindByIdMock },
    characters: { findByIdRaw: charactersFindByIdRawMock },
  }),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn(),
  writeDatabaseDocument: jest.fn(),
  DatabaseStoreError: class extends Error {
    constructor(message: string, public code: string) {
      super(message);
    }
  },
}));

import {
  resolveDocEditPath,
  resolveSelfVaultMountPointId,
  PathResolutionError,
} from '@/lib/doc-edit/path-resolver';

const PROJECT_ID = 'proj-1234';

let realRoot: string;
let linkRoot: string;
let realFilesDir: string;
let linkedFilesDir: string;

beforeEach(async () => {
  // realRoot/  ← actual storage
  // linkRoot/  ← symlink → realRoot (mimics ~/iCloud → ~/Library/Mobile Documents/...)
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-path-resolver-'));
  realRoot = path.join(tmp, 'real');
  linkRoot = path.join(tmp, 'link');
  await fs.mkdir(realRoot, { recursive: true });
  await fs.symlink(realRoot, linkRoot, 'dir');

  realFilesDir = path.join(realRoot, 'files');
  linkedFilesDir = path.join(linkRoot, 'files');
  await fs.mkdir(path.join(realFilesDir, PROJECT_ID, 'Folio Drafts'), { recursive: true });
  await fs.mkdir(path.join(realFilesDir, '_general'), { recursive: true });
  await fs.writeFile(
    path.join(realFilesDir, PROJECT_ID, 'Folio Drafts', 'the-third-arrives.md'),
    'concierge prose',
    'utf-8',
  );

  getFilesDirMock.mockReturnValue(linkedFilesDir);
  // Default: project has no official mount, so scope:project falls through
  // to the legacy filesystem layout that these tests exercise. Individual
  // tests can override to verify the official-mount dispatch path.
  projectsFindByIdMock.mockResolvedValue({ id: PROJECT_ID, officialMountPointId: null });
});

afterEach(async () => {
  // realRoot lives under tmpdir; clean up the whole sibling pair.
  const parent = path.dirname(realRoot);
  await fs.rm(parent, { recursive: true, force: true });
  getFilesDirMock.mockReset();
  projectsFindByIdMock.mockReset();
  docMountPointsFindByIdMock.mockReset();
});

describe('resolveDocEditPath — project scope under a symlinked data directory', () => {
  it('resolves an existing project file whose data dir is reached through a symlink', async () => {
    const resolved = await resolveDocEditPath(
      'project',
      'Folio Drafts/the-third-arrives.md',
      { projectId: PROJECT_ID },
    );

    expect(resolved.scope).toBe('project');
    expect(resolved.relativePath).toBe('Folio Drafts/the-third-arrives.md');
    // The absolute path must point at the *real* file. Verify we can read it.
    const contents = await fs.readFile(resolved.absolutePath, 'utf-8');
    expect(contents).toBe('concierge prose');
  });

  it('resolves a not-yet-created project file (new write) under a symlinked data dir', async () => {
    const resolved = await resolveDocEditPath(
      'project',
      'Folio Drafts/the-fourth-arrives.md',
      { projectId: PROJECT_ID },
    );

    expect(resolved.scope).toBe('project');
    // We should be able to write to the resolved path without it falling
    // outside the realpath'd base — i.e. boundary check must not have
    // rejected it just because the leaf doesn't exist yet.
    await fs.writeFile(resolved.absolutePath, 'new draft', 'utf-8');
    const onDisk = await fs.readFile(
      path.join(realFilesDir, PROJECT_ID, 'Folio Drafts', 'the-fourth-arrives.md'),
      'utf-8',
    );
    expect(onDisk).toBe('new draft');
  });

  it('still rejects path-traversal attempts (..) under a symlinked data dir', async () => {
    await expect(
      resolveDocEditPath('project', '../escape.md', { projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(PathResolutionError);
  });

  it('still rejects absolute paths under a symlinked data dir', async () => {
    await expect(
      resolveDocEditPath('project', '/etc/passwd', { projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(PathResolutionError);
  });
});

describe('resolveDocEditPath — project scope dispatches through officialMountPointId', () => {
  // The migration to database-backed project stores left scope:project pointed
  // at the legacy filesystem in path-resolver, so writes via doc_write_file
  // landed in <filesDir>/<projectId>/ while the Document Mode UI read from
  // the database mount. These tests pin the new behavior: when the project
  // has an officialMountPointId, scope:project dispatches through that mount.

  const OFFICIAL_MOUNT_ID = 'mp-official-123';

  it('returns a database-backed ResolvedPath when the official mount is database-backed', async () => {
    projectsFindByIdMock.mockResolvedValue({
      id: PROJECT_ID,
      officialMountPointId: OFFICIAL_MOUNT_ID,
    });
    docMountPointsFindByIdMock.mockResolvedValue({
      id: OFFICIAL_MOUNT_ID,
      name: 'Project Files: Test',
      mountType: 'database',
      basePath: '',
      enabled: true,
    });

    const resolved = await resolveDocEditPath(
      'project',
      'Scenarios/Good Morning.md',
      { projectId: PROJECT_ID },
    );

    expect(resolved.scope).toBe('project');
    expect(resolved.mountType).toBe('database');
    expect(resolved.mountPointId).toBe(OFFICIAL_MOUNT_ID);
    expect(resolved.relativePath).toBe('Scenarios/Good Morning.md');
    // Database-backed paths intentionally have no absolutePath — callers
    // dispatch on mountType to route through the database-store module.
    expect(resolved.absolutePath).toBe('');
  });

  it('returns a filesystem ResolvedPath under the mount basePath when the official mount is filesystem-backed', async () => {
    const customBase = path.join(realRoot, 'custom-mount');
    await fs.mkdir(path.join(customBase, 'sub'), { recursive: true });
    await fs.writeFile(path.join(customBase, 'sub', 'note.md'), 'hi', 'utf-8');

    projectsFindByIdMock.mockResolvedValue({
      id: PROJECT_ID,
      officialMountPointId: OFFICIAL_MOUNT_ID,
    });
    docMountPointsFindByIdMock.mockResolvedValue({
      id: OFFICIAL_MOUNT_ID,
      name: 'Filesystem Mount',
      mountType: 'filesystem',
      basePath: customBase,
      enabled: true,
    });

    const resolved = await resolveDocEditPath(
      'project',
      'sub/note.md',
      { projectId: PROJECT_ID },
    );

    expect(resolved.scope).toBe('project');
    expect(resolved.mountType).toBe('filesystem');
    expect(resolved.mountPointId).toBe(OFFICIAL_MOUNT_ID);
    // The resolver realpaths both base and joined paths — match against
    // the realpath of the expected location so macOS /var ↔ /private/var
    // symlink resolution doesn't trip the equality check.
    const expectedAbsolute = await fs.realpath(path.join(customBase, 'sub', 'note.md'));
    expect(resolved.absolutePath).toBe(expectedAbsolute);
    const contents = await fs.readFile(resolved.absolutePath, 'utf-8');
    expect(contents).toBe('hi');
  });

  it('falls back to the legacy <filesDir>/<projectId>/ layout when the official mount is missing or disabled', async () => {
    projectsFindByIdMock.mockResolvedValue({
      id: PROJECT_ID,
      officialMountPointId: OFFICIAL_MOUNT_ID,
    });
    // Mount lookup returns null — e.g. the FK was set but the row was later
    // hard-deleted. Resolver should keep the project working via the legacy fs.
    docMountPointsFindByIdMock.mockResolvedValue(null);

    const resolved = await resolveDocEditPath(
      'project',
      'Folio Drafts/the-third-arrives.md',
      { projectId: PROJECT_ID },
    );

    expect(resolved.scope).toBe('project');
    expect(resolved.mountType).toBeUndefined();
    expect(resolved.mountPointId).toBeUndefined();
    const contents = await fs.readFile(resolved.absolutePath, 'utf-8');
    expect(contents).toBe('concierge prose');
  });
});

describe('resolveDocEditPath — missing/malformed path guard', () => {
  // A tool call truncated at the model's output-token limit can arrive with
  // `path` undefined. Before the guard this crashed in hasTraversalSegments
  // with "Cannot read properties of undefined (reading 'split')"; now it must
  // throw a clean, model-readable PathResolutionError instead.
  it('throws PathResolutionError(INVALID_PATH) for an undefined path', async () => {
    expect.assertions(2);
    try {
      await resolveDocEditPath('project', undefined as unknown as string, { projectId: PROJECT_ID });
    } catch (err) {
      expect(err).toBeInstanceOf(PathResolutionError);
      expect((err as PathResolutionError).code).toBe('INVALID_PATH');
    }
  });

  it('throws PathResolutionError(INVALID_PATH) for a null path', async () => {
    await expect(
      resolveDocEditPath('document_store', null as unknown as string, { projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(PathResolutionError);
  });

  it('throws PathResolutionError(INVALID_PATH) for a non-string path', async () => {
    await expect(
      resolveDocEditPath('general', { 0: 'a' } as unknown as string, {}),
    ).rejects.toBeInstanceOf(PathResolutionError);
  });
});

describe('resolveDocEditPath — general scope under a symlinked data directory', () => {
  it('resolves an existing file in general storage reached through a symlink', async () => {
    await fs.writeFile(path.join(realFilesDir, '_general', 'Amy.md'), 'character notes', 'utf-8');

    const resolved = await resolveDocEditPath('general', 'Amy.md', {});

    expect(resolved.scope).toBe('general');
    const contents = await fs.readFile(resolved.absolutePath, 'utf-8');
    expect(contents).toBe('character notes');
  });
});

describe('resolveSelfVaultMountPointId — archived characters', () => {
  afterEach(() => {
    charactersFindByIdRawMock.mockReset();
  });

  it('resolves a live character to its vault mount', async () => {
    charactersFindByIdRawMock.mockResolvedValue({
      id: 'char-1',
      archivedAt: null,
      characterDocumentMountPointId: 'mount-1',
    });

    await expect(resolveSelfVaultMountPointId('char-1')).resolves.toBe('mount-1');
  });

  it('refuses an archived character even though its vault survives the prune (§4.2a)', async () => {
    // Archiving keeps a live vault behind the character, so the old
    // "tombstone has no pointer → tools degrade" safety no longer happens on
    // its own. The explicit check must refuse, or an archived character could
    // edit its own vault through doc_edit while read-only.
    charactersFindByIdRawMock.mockResolvedValue({
      id: 'char-1',
      archivedAt: '2026-08-10T00:00:00.000Z',
      characterDocumentMountPointId: 'mount-1',
    });

    await expect(resolveSelfVaultMountPointId('char-1')).resolves.toBeNull();
  });
});
