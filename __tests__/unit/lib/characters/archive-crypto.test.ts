/**
 * @jest-environment node
 *
 * Archive bundle encryption (§4.2c / §7 of the character-archive spec).
 * Real crypto throughout — PBKDF2 at the production 600k iterations — so the
 * suite proves the actual parameters round-trip, not a softened stand-in.
 */

import { createHash } from 'crypto';
import { describe, expect, it, beforeEach } from '@jest/globals';

const mockGetHasUserPassphrase = jest.fn();

jest.mock('@/lib/startup/dbkey', () => ({
  INTERNAL_PASSPHRASE: '__quilltap_no_passphrase__',
  // Deferred through an arrow so the hoisted factory doesn't hit the const
  // before initialization.
  getHasUserPassphrase: () => mockGetHasUserPassphrase(),
}));

import {
  encryptArchive,
  decryptArchive,
  isEncryptedArchive,
  resolveArchivePassphrase,
  ArchivePassphraseMismatchError,
  ArchiveIntegrityError,
  ArchiveFormatError,
  ArchiveKeyUnavailableError,
} from '@/lib/characters/archive-crypto';
import {
  cacheRuntimePassphrase,
  clearRuntimePassphrase,
} from '@/lib/startup/passphrase-cache';

const INTERNAL = '__quilltap_no_passphrase__';

/** Deterministic pseudo-random payload — larger than one 3 MB blob chunk. */
function bigPayload(): Buffer {
  const size = 3 * 1024 * 1024 + 512 * 1024;
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i += 4) buf.writeUInt32LE((i * 2654435761) >>> 0, i);
  return buf;
}

describe('archive crypto — round trip', () => {
  it('round-trips byte-for-byte at a size above one blob chunk', () => {
    const plaintext = bigPayload();

    const encrypted = encryptArchive(plaintext, 'a passphrase of some length');
    const decrypted = decryptArchive(encrypted, 'a passphrase of some length');

    expect(isEncryptedArchive(encrypted)).toBe(true);
    expect(isEncryptedArchive(plaintext)).toBe(false);
    expect(decrypted.length).toBe(plaintext.length);
    // Byte-for-byte, compared by digest to keep the failure output readable.
    expect(createHash('sha256').update(decrypted).digest('hex')).toBe(
      createHash('sha256').update(plaintext).digest('hex')
    );
    // The ciphertext is binary, not hex-inflated: overhead is header + tag,
    // never a doubling (the failure mode of the string helpers §4.2c bans).
    expect(encrypted.length).toBeLessThan(plaintext.length + 2048);
  });

  it('writes the .dbkey parameters into the header', () => {
    const encrypted = encryptArchive(Buffer.from('tiny'), 'pw');

    const headerLength = encrypted.readUInt32BE(8);
    const header = JSON.parse(encrypted.subarray(12, 12 + headerLength).toString('utf8'));

    expect(header).toMatchObject({
      version: 1,
      algorithm: 'aes-256-gcm',
      kdf: 'pbkdf2',
      kdfIterations: 600000,
      kdfDigest: 'sha256',
    });
    expect(header.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(header.iv).toMatch(/^[0-9a-f]{32}$/);
    expect(header.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses a fresh salt and IV per bundle', () => {
    const a = encryptArchive(Buffer.from('same bytes'), 'pw');
    const b = encryptArchive(Buffer.from('same bytes'), 'pw');

    expect(a.equals(b)).toBe(false);
    const headerOf = (buf: Buffer) =>
      JSON.parse(buf.subarray(12, 12 + buf.readUInt32BE(8)).toString('utf8'));
    expect(headerOf(a).salt).not.toBe(headerOf(b).salt);
    expect(headerOf(a).iv).not.toBe(headerOf(b).iv);
  });
});

describe('archive crypto — failure diagnosis', () => {
  it('diagnoses a wrong passphrase by name, not as a GCM failure', () => {
    const encrypted = encryptArchive(Buffer.from('sealed material'), 'old-passphrase');

    expect(() => decryptArchive(encrypted, 'new-passphrase')).toThrow(
      ArchivePassphraseMismatchError
    );
    expect(() => decryptArchive(encrypted, 'new-passphrase')).toThrow(
      /predates your passphrase change/
    );
  });

  it('reports tampered ciphertext as an integrity failure, not a passphrase problem', () => {
    const encrypted = encryptArchive(Buffer.from('sealed material'), 'pw');
    // Flip one ciphertext byte (past the header, before the tag).
    const headerEnd = 12 + encrypted.readUInt32BE(8);
    encrypted[headerEnd] ^= 0xff;

    expect(() => decryptArchive(encrypted, 'pw')).toThrow(ArchiveIntegrityError);
  });

  it('refuses bytes that are not an encrypted archive', () => {
    expect(() => decryptArchive(Buffer.from('{"plain":"ndjson"}'), 'pw')).toThrow(
      ArchiveFormatError
    );
    expect(() => decryptArchive(Buffer.alloc(0), 'pw')).toThrow(ArchiveFormatError);
  });

  it('refuses a truncated bundle', () => {
    const encrypted = encryptArchive(Buffer.from('sealed material'), 'pw');
    expect(() => decryptArchive(encrypted.subarray(0, 10), 'pw')).toThrow(ArchiveFormatError);
  });
});

describe('archive crypto — no-passphrase portability (§4.2c)', () => {
  it('a bundle sealed under the internal sentinel opens with the constant alone', () => {
    // "Instance A" writes with the sentinel; "instance B" holds no state from
    // A — only the constant that ships in every build. This is the property
    // the pepper would have broken: the pepper never travels, the constant
    // always does.
    const plaintext = Buffer.from('portable across instances');
    const sealedOnInstanceA = encryptArchive(plaintext, INTERNAL);

    const openedOnInstanceB = decryptArchive(sealedOnInstanceA, INTERNAL);

    expect(openedOnInstanceB.equals(plaintext)).toBe(true);
  });
});

describe('resolveArchivePassphrase', () => {
  beforeEach(() => {
    clearRuntimePassphrase();
    mockGetHasUserPassphrase.mockReset();
  });

  it('prefers the passphrase this process last proved', () => {
    cacheRuntimePassphrase('proved-at-unlock');
    expect(resolveArchivePassphrase()).toBe('proved-at-unlock');
  });

  it('falls back to the internal sentinel on a no-passphrase instance', () => {
    mockGetHasUserPassphrase.mockReturnValue(false);
    expect(resolveArchivePassphrase()).toBe(INTERNAL);
  });

  it('refuses with a named error when a user passphrase exists but was never seen', () => {
    mockGetHasUserPassphrase.mockReturnValue(true);
    expect(() => resolveArchivePassphrase()).toThrow(ArchiveKeyUnavailableError);
  });
});
