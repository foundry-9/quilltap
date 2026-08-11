/**
 * Bind planning for filesystem-backed document stores.
 *
 * The planner decides what a container is allowed to see, so its edges matter
 * more than its happy path: a nested store that shadows its parent, a missing
 * path that Docker would helpfully materialise as an empty directory, or a
 * Windows host where the whole path-identical scheme cannot work.
 *
 * @jest-environment node
 */

'use strict';

const {
  planStoreMounts,
  toDockerArgs,
  findMissingBinds,
  normalisePath,
} = require('../docker-mounts');

/** Build a doc_mount_points-shaped row with sensible defaults. */
function store(overrides = {}) {
  return {
    id: 'id-' + (overrides.name || 'x'),
    name: 'Store',
    mountType: 'filesystem',
    storeType: 'documents',
    basePath: '/vaults/one',
    enabled: 1,
    ...overrides,
  };
}

/** A path probe that treats the given list as the only existing directories. */
const existsIn = (paths) => (p) => paths.includes(p);

const linux = (rows, exists) => planStoreMounts(rows, { platform: 'linux', exists });
const macos = (rows, exists) => planStoreMounts(rows, { platform: 'darwin', exists });

describe('planStoreMounts', () => {
  it('binds an enabled filesystem store at its own host path', () => {
    const plan = linux([store({ name: 'Church', basePath: '/vaults/church' })], existsIn(['/vaults/church']));

    expect(plan.binds).toEqual([
      { hostPath: '/vaults/church', containerPath: '/vaults/church', stores: ['Church'] },
    ]);
  });

  it('treats obsidian stores as filesystem-backed', () => {
    const plan = linux(
      [store({ name: 'Malory', mountType: 'obsidian', basePath: '/vaults/malory' })],
      existsIn(['/vaults/malory'])
    );

    expect(plan.binds.map((b) => b.hostPath)).toEqual(['/vaults/malory']);
  });

  it('ignores database-backed and disabled stores', () => {
    const plan = linux(
      [
        store({ name: 'Vault', mountType: 'database', basePath: '' }),
        store({ name: 'Off', basePath: '/vaults/off', enabled: 0 }),
      ],
      existsIn(['/vaults/off'])
    );

    expect(plan.binds).toEqual([]);
  });

  it('emits one bind for several stores sharing a path', () => {
    const plan = linux(
      [
        store({ name: 'Church', basePath: '/vaults/shared' }),
        store({ name: 'Small Group', basePath: '/vaults/shared/' }),
      ],
      existsIn(['/vaults/shared'])
    );

    expect(plan.binds).toHaveLength(1);
    expect(plan.binds[0].stores).toEqual(['Church', 'Small Group']);
  });

  it('drops a store nested inside another bound store', () => {
    // Binding both would mount the child independently and shadow the
    // parent's view of that subdirectory.
    const plan = linux(
      [
        store({ name: 'Vault', basePath: '/vaults/obsidian' }),
        store({ name: 'Notes', basePath: '/vaults/obsidian/notes' }),
      ],
      existsIn(['/vaults/obsidian', '/vaults/obsidian/notes'])
    );

    expect(plan.binds.map((b) => b.hostPath)).toEqual(['/vaults/obsidian']);
  });

  it('does not treat a sibling with a shared prefix as nested', () => {
    const plan = linux(
      [
        store({ name: 'A', basePath: '/vaults/notes' }),
        store({ name: 'B', basePath: '/vaults/notes-archive' }),
      ],
      existsIn(['/vaults/notes', '/vaults/notes-archive'])
    );

    expect(plan.binds.map((b) => b.hostPath)).toEqual(['/vaults/notes', '/vaults/notes-archive']);
  });

  it('skips a missing path rather than letting Docker fabricate it', () => {
    const plan = linux([store({ name: 'Gone', basePath: '/vaults/gone' })], existsIn([]));

    expect(plan.binds).toEqual([]);
    expect(plan.skipped).toEqual([
      { hostPath: '/vaults/gone', stores: ['Gone'], reason: 'missing' },
    ]);
    expect(plan.warnings.join(' ')).toContain('does not exist');
  });

  it('rejects a relative base path', () => {
    const plan = linux([store({ name: 'Rel', basePath: 'relative/path' })], existsIn(['relative/path']));

    expect(plan.binds).toEqual([]);
    expect(plan.warnings.join(' ')).toContain('not absolute');
  });

  it('refuses path-identical binds on Windows', () => {
    const plan = planStoreMounts([store({ basePath: 'C:\\Users\\me\\Vault' })], {
      platform: 'win32',
      exists: () => true,
    });

    expect(plan.unsupported).toBe(true);
    expect(plan.binds).toEqual([]);
    expect(plan.warnings.join(' ')).toContain('not supported on Windows');
  });

  it('warns about macOS paths outside Docker Desktop default shares', () => {
    const plan = macos([store({ name: 'Odd', basePath: '/data/vault' })], existsIn(['/data/vault']));

    expect(plan.binds).toHaveLength(1);
    expect(plan.warnings.join(' ')).toContain('File sharing');
  });

  it('does not warn for macOS paths under a shared prefix', () => {
    const plan = macos([store({ name: 'Home', basePath: '/Users/me/Vault' })], existsIn(['/Users/me/Vault']));

    expect(plan.warnings.join(' ')).not.toContain('File sharing');
  });

  it('warns about host ownership on Linux', () => {
    const plan = linux([store({ basePath: '/vaults/one' })], existsIn(['/vaults/one']));

    expect(plan.warnings.join(' ')).toContain('--user');
  });
});

describe('toDockerArgs', () => {
  it('renders each bind as a -v pair', () => {
    const plan = linux(
      [
        store({ name: 'A', basePath: '/vaults/a' }),
        store({ name: 'B', basePath: '/vaults/b' }),
      ],
      existsIn(['/vaults/a', '/vaults/b'])
    );

    expect(toDockerArgs(plan)).toEqual([
      '-v', '/vaults/a:/vaults/a',
      '-v', '/vaults/b:/vaults/b',
    ]);
  });

  it('keeps a path containing spaces in a single argument', () => {
    // The argv is handed to execFileSync, so a space must not split the pair.
    const plan = linux([store({ basePath: '/vaults/Local Obsidian' })], existsIn(['/vaults/Local Obsidian']));

    expect(toDockerArgs(plan)).toEqual([
      '-v', '/vaults/Local Obsidian:/vaults/Local Obsidian',
    ]);
  });
});

describe('findMissingBinds', () => {
  const plan = () =>
    linux(
      [
        store({ name: 'A', basePath: '/vaults/a' }),
        store({ name: 'B', basePath: '/vaults/b' }),
      ],
      existsIn(['/vaults/a', '/vaults/b'])
    );

  it('reports binds a container was not created with', () => {
    expect(findMissingBinds(plan(), ['/vaults/a']).map((b) => b.hostPath)).toEqual(['/vaults/b']);
  });

  it('reports nothing when every bind is present', () => {
    expect(findMissingBinds(plan(), ['/vaults/a', '/vaults/b', '/data'])).toEqual([]);
  });

  it('ignores a trailing separator when comparing', () => {
    expect(findMissingBinds(plan(), ['/vaults/a/', '/vaults/b/'])).toEqual([]);
  });
});

describe('normalisePath', () => {
  it.each([
    ['/a/b/', '/a/b'],
    ['/a//b', '/a/b'],
    ['/a/./b', '/a/b'],
    ['/a/c/../b', '/a/b'],
    ['/', '/'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalisePath(input)).toBe(expected);
  });
});
