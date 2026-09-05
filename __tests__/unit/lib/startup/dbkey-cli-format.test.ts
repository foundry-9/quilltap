/**
 * The CLI's `.dbkey` reader/writer must agree with the server's, byte for byte.
 *
 * `packages/quilltap/lib/dbkey.js` is plain Node — it cannot import
 * `lib/startup/dbkey.ts`, so it MIRRORS the format and the PBKDF2 constants.
 * `quilltap instances restore-key` writes a real key file with that mirror, and
 * a drift there would hand the server a file it cannot unwrap: an instance that
 * boots into `needs-setup` on a database full of data.
 *
 * So this test drives both directions across real files in a real temp
 * directory — CLI writes, server reads; server writes, CLI reads.
 *
 * @jest-environment node
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const cliDbKey = require('../../../../packages/quilltap/lib/dbkey');

let tmpDir: string;

jest.mock('@/lib/paths', () => ({ getDataDir: () => global.__dbkeyTestDataDir }));
jest.mock('../../../../migrations/lib/logger', () => {
  const mockLogger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  mockLogger.child = jest.fn(() => mockLogger);
  return { logger: mockLogger };
});

declare global {
  var __dbkeyTestDataDir: string;
}

async function importServerDbKey() {
  jest.resetModules();
  return await import('@/lib/startup/dbkey');
}

describe('CLI .dbkey mirror matches lib/startup/dbkey.ts', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-dbkey-'));
    global.__dbkeyTestDataDir = tmpDir;
    delete process.env.ENCRYPTION_MASTER_PEPPER;
    delete global.__quilltapDbKeyState;
    delete global.__quilltapHasUserPassphrase;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ENCRYPTION_MASTER_PEPPER;
    delete global.__quilltapDbKeyState;
    delete global.__quilltapHasUserPassphrase;
  });

  it('the server resolves a no-passphrase file the CLI wrote', async () => {
    const pepper = 'q4YrhbUq4nQ0Ml3lJmA9m1kEmZ0Lz4G0mAqTUwPTJhE=';
    cliDbKey.writeDbKeyFile(
      tmpDir,
      cliDbKey.encryptDbKey(pepper, cliDbKey.INTERNAL_PASSPHRASE)
    );

    const { provisionDbKey } = await importServerDbKey();
    await expect(provisionDbKey()).resolves.toBe('resolved');
    expect(process.env.ENCRYPTION_MASTER_PEPPER).toBe(pepper);
  });

  it('the server asks for the passphrase on a file the CLI wrapped with one', async () => {
    const pepper = 'q4YrhbUq4nQ0Ml3lJmA9m1kEmZ0Lz4G0mAqTUwPTJhE=';
    cliDbKey.writeDbKeyFile(tmpDir, cliDbKey.encryptDbKey(pepper, 'the lamplighter'));

    const server = await importServerDbKey();
    await expect(server.provisionDbKey()).resolves.toBe('needs-passphrase');
    expect(server.unlockDbKey('the lamplighter')).toBe(true);
    expect(process.env.ENCRYPTION_MASTER_PEPPER).toBe(pepper);
  });

  it('the CLI reads back a file the server wrote', async () => {
    const server = await importServerDbKey();
    await server.provisionDbKey();
    const { pepper } = server.setupDbKey('the lamplighter');

    const data = cliDbKey.readDbKeyFile(tmpDir);
    expect(data).not.toBeNull();
    expect(cliDbKey.tryDecryptDbKey(data, cliDbKey.INTERNAL_PASSPHRASE)).toBeNull();
    expect(cliDbKey.decryptDbKey(data, 'the lamplighter')).toBe(pepper);
    expect(cliDbKey.hashPepper(pepper)).toBe(data.pepperHash);
  });

  it('mirrors the write-side crypto parameters exactly', async () => {
    const server = await importServerDbKey();
    await server.provisionDbKey();
    server.setupDbKey('');
    const serverWritten = cliDbKey.readDbKeyFile(tmpDir);

    fs.rmSync(cliDbKey.getDbKeyPath(tmpDir));
    cliDbKey.writeDbKeyFile(
      tmpDir,
      cliDbKey.encryptDbKey('q4YrhbUq4nQ0Ml3lJmA9m1kEmZ0Lz4G0mAqTUwPTJhE=', cliDbKey.INTERNAL_PASSPHRASE)
    );
    const cliWritten = cliDbKey.readDbKeyFile(tmpDir);

    for (const field of ['version', 'algorithm', 'kdf', 'kdfIterations', 'kdfDigest'] as const) {
      expect(cliWritten[field]).toBe(serverWritten[field]);
    }
    // Salt/IV lengths are structural, not incidental — a short salt still
    // "works" but silently weakens every file the CLI writes.
    expect(cliWritten.salt.length).toBe(serverWritten.salt.length);
    expect(cliWritten.iv.length).toBe(serverWritten.iv.length);
    expect(Object.keys(cliWritten).sort()).toEqual(Object.keys(serverWritten).sort());
  });

  it('the server exits fatally when a .dbkey holds a pepper the env var contradicts', async () => {
    // The reason restore-key proves the pepper against the databases first.
    cliDbKey.writeDbKeyFile(
      tmpDir,
      cliDbKey.encryptDbKey('q4YrhbUq4nQ0Ml3lJmA9m1kEmZ0Lz4G0mAqTUwPTJhE=', cliDbKey.INTERNAL_PASSPHRASE)
    );
    process.env.ENCRYPTION_MASTER_PEPPER = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

    const exit = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    const { provisionDbKey } = await importServerDbKey();
    await provisionDbKey();
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });
});
