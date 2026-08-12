/**
 * @jest-environment node
 *
 * Unit tests for `quilltap` CLI character resolution after the 4.6 vault
 * cutover, which dropped the `aliases` (and `pronouns`) columns from the
 * `characters` table. `resolveCharacter` must no longer SELECT those columns
 * (regression: `no such column: aliases`) and must instead resolve aliases by
 * reading each vault's `properties.json` from the mount-index DB.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const QUILLTAP_PKG = path.join(__dirname, '..', '..', '..', '..', 'packages', 'quilltap');
const {
  resolveCharacter,
  resolveCharactersByAlias,
  readVaultAliases,
} = require(path.join(QUILLTAP_PKG, 'lib', 'db-helpers'));

function loadDriver() {
  try {
    return require(path.join(QUILLTAP_PKG, 'node_modules', 'better-sqlite3-multiple-ciphers'));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      return require(path.join(QUILLTAP_PKG, '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}

// Valid-format UUIDs so the UUID fast-path in resolveCharacter is exercised.
const AMY = '3b476cd1-670c-4812-9e3f-58dc48b0368c';
const ANJALI = 'a8db5958-3fe9-400d-998e-bd2261be7cb1';
const BOB = '53a13656-7199-4545-afaf-01cd39d40085';

describe('resolveCharacter (post-4.6-cutover)', () => {
  let main;
  let tempDir;
  let mountsPath;

  beforeEach(() => {
    const Database = loadDriver();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-dbhelpers-test-'));

    // Main DB: deliberately a post-cutover `characters` table with NO `aliases`
    // / `pronouns` columns — the shape that broke the old resolveCharacter.
    main = new Database(path.join(tempDir, 'main.db'));
    main.exec(`
      CREATE TABLE characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        characterDocumentMountPointId TEXT
      )
    `);
    const insChar = main.prepare(
      'INSERT INTO characters (id, name, characterDocumentMountPointId) VALUES (?, ?, ?)'
    );
    insChar.run(AMY, 'Amy', 'mp-amy');
    insChar.run(ANJALI, 'Anjali Rajan', 'mp-anjali');
    insChar.run(BOB, 'Bob', null); // no vault

    // Mount-index DB: properties.json per vault holds the aliases now.
    mountsPath = path.join(tempDir, 'mounts.db');
    const mounts = new Database(mountsPath);
    mounts.exec(`
      CREATE TABLE doc_mount_file_links (mountPointId TEXT, relativePath TEXT, fileId TEXT);
      CREATE TABLE doc_mount_documents (fileId TEXT, content TEXT);
    `);
    const linkProps = (mp, fileId, aliases) => {
      mounts.prepare('INSERT INTO doc_mount_file_links (mountPointId, relativePath, fileId) VALUES (?, ?, ?)')
        .run(mp, 'properties.json', fileId);
      mounts.prepare('INSERT INTO doc_mount_documents (fileId, content) VALUES (?, ?)')
        .run(fileId, JSON.stringify({ aliases }));
    };
    linkProps('mp-amy', 'f-amy', ['Ember', 'Anna']);
    linkProps('mp-anjali', 'f-anjali', ['Anji']);
    mounts.close();
  });

  afterEach(() => {
    if (main) main.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Each call opens a fresh readonly handle, mirroring ctx.openMounts; the
  // resolver closes it when done.
  const openMounts = () => loadDriver()(mountsPath, { readonly: true });

  test('regression: resolving by name does not throw "no such column: aliases"', () => {
    expect(() => resolveCharacter(main, 'Amy')).not.toThrow();
  });

  test('resolves by UUID', () => {
    expect(resolveCharacter(main, AMY)).toMatchObject({ id: AMY, name: 'Amy' });
  });

  test('resolves by exact name, case-insensitively', () => {
    expect(resolveCharacter(main, 'amy').id).toBe(AMY);
  });

  test('resolves by fuzzy name substring', () => {
    expect(resolveCharacter(main, 'Anjali').id).toBe(ANJALI);
  });

  test('resolves by vault alias when a mount opener is supplied', () => {
    expect(resolveCharacter(main, 'Ember', openMounts).id).toBe(AMY);
  });

  test('an alias is NOT resolvable without a mount opener', () => {
    expect(() => resolveCharacter(main, 'Ember')).toThrow(/No character matching/);
  });

  test('alias matches fold in alongside name matches (ambiguity surfaces)', () => {
    // "an" matches the name "Anjali" and Amy's alias "Anna" → ambiguous only
    // once the vault aliases are considered.
    expect(resolveCharacter(main, 'an').id).toBe(ANJALI); // name-only: unique
    expect(() => resolveCharacter(main, 'an', openMounts)).toThrow(/Multiple characters/);
  });

  test('unknown query throws not-found', () => {
    expect(() => resolveCharacter(main, 'Zzqq', openMounts)).toThrow(/No character matching/);
  });

  test('a duplicate exact name is reported as ambiguous', () => {
    main.prepare('INSERT INTO characters (id, name, characterDocumentMountPointId) VALUES (?, ?, ?)')
      .run('d13e6667-0000-4000-8000-000000000001', 'Amy', null);
    expect(() => resolveCharacter(main, 'Amy')).toThrow(/Multiple characters/);
  });
});

describe('readVaultAliases', () => {
  let mounts;
  let tempDir;

  beforeEach(() => {
    const Database = loadDriver();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-aliases-test-'));
    mounts = new Database(path.join(tempDir, 'mounts.db'));
    mounts.exec(`
      CREATE TABLE doc_mount_file_links (mountPointId TEXT, relativePath TEXT, fileId TEXT);
      CREATE TABLE doc_mount_documents (fileId TEXT, content TEXT);
    `);
    mounts.prepare('INSERT INTO doc_mount_file_links (mountPointId, relativePath, fileId) VALUES (?, ?, ?)')
      .run('mp1', 'properties.json', 'f1');
    mounts.prepare('INSERT INTO doc_mount_documents (fileId, content) VALUES (?, ?)')
      .run('f1', JSON.stringify({ aliases: ['Ember', 'Anna'], pronouns: 'she/her' }));
  });

  afterEach(() => {
    if (mounts) mounts.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('reads the aliases array from properties.json', () => {
    expect(readVaultAliases(mounts, 'mp1')).toEqual(['Ember', 'Anna']);
  });

  test('returns [] for an unknown mount point', () => {
    expect(readVaultAliases(mounts, 'nope')).toEqual([]);
  });

  test('returns [] when given no mount handle', () => {
    expect(readVaultAliases(null, 'mp1')).toEqual([]);
  });

  test('matches the relativePath case-insensitively', () => {
    mounts.prepare('INSERT INTO doc_mount_file_links (mountPointId, relativePath, fileId) VALUES (?, ?, ?)')
      .run('mp2', 'Properties.JSON', 'f2');
    mounts.prepare('INSERT INTO doc_mount_documents (fileId, content) VALUES (?, ?)')
      .run('f2', JSON.stringify({ aliases: ['Casey'] }));
    expect(readVaultAliases(mounts, 'mp2')).toEqual(['Casey']);
  });
});
