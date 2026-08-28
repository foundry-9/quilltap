/**
 * @jest-environment node
 *
 * Base path availability — the check standing between a recursive `mkdir` and
 * an absent mount root.
 *
 * The bug this guards: `createFilesystemFolder` called `fs.mkdir(target, {
 * recursive: true })` without first confirming the store's own basePath was
 * there. Against a store whose path is missing — an unmounted volume, or a
 * host path never bound into a container — mkdir walks up to the topmost
 * missing ancestor and creates the whole chain, reporting success for a folder
 * that lives in a fabricated tree.
 *
 * The container case gets its own message because the remedy (recreate the
 * container with the store bound in) is not something ENOENT would ever
 * suggest.
 */

import {
  checkBasePathAvailability,
  assertBasePathAvailable,
  BasePathUnavailableError,
} from '../base-path-availability';
import fs from 'fs/promises';
import { isDockerEnvironment } from '@/lib/paths';

jest.mock('fs/promises', () => ({
  __esModule: true,
  default: { stat: jest.fn() },
}));

jest.mock('@/lib/paths', () => ({
  isDockerEnvironment: jest.fn(() => false),
}));

const mockStat = fs.stat as jest.Mock;
const mockIsDocker = isDockerEnvironment as jest.Mock;

/** Build an errno error the way Node's fs surfaces one. */
function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: mocked`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

const asDirectory = { isDirectory: () => true };
const asFile = { isDirectory: () => false };

beforeEach(() => {
  jest.clearAllMocks();
  mockIsDocker.mockReturnValue(false);
});

describe('checkBasePathAvailability', () => {
  it('accepts an existing directory', async () => {
    mockStat.mockResolvedValue(asDirectory);

    expect(await checkBasePathAvailability('/vaults/church')).toEqual({ available: true });
  });

  it('rejects a path that is a file', async () => {
    mockStat.mockResolvedValue(asFile);

    const result = await checkBasePathAvailability('/vaults/church.md');

    expect(result).toMatchObject({ available: false, reason: 'not-a-directory' });
  });

  it('reports a missing path', async () => {
    mockStat.mockRejectedValue(errno('ENOENT'));

    const result = await checkBasePathAvailability('/vaults/gone');

    expect(result).toMatchObject({ available: false, reason: 'missing', containerized: false });
    expect((result as { message: string }).message).toContain('does not exist');
  });

  it('distinguishes a permissions failure from a missing path', async () => {
    mockStat.mockRejectedValue(errno('EACCES'));

    const result = await checkBasePathAvailability('/vaults/locked');

    expect(result).toMatchObject({ available: false, reason: 'denied' });
    expect((result as { message: string }).message).toContain('permissions');
  });

  it('names bind mounts as the remedy when the path is missing inside Docker', async () => {
    mockIsDocker.mockReturnValue(true);
    mockStat.mockRejectedValue(errno('ENOENT'));

    const result = await checkBasePathAvailability('/Users/me/Vault');

    expect(result).toMatchObject({ available: false, reason: 'missing', containerized: true });
    const { message } = result as { message: string };
    expect(message).toContain('bind mounts');
    expect(message).toContain('--recreate');
  });

  it('does not offer the container remedy for a permissions failure', async () => {
    mockIsDocker.mockReturnValue(true);
    mockStat.mockRejectedValue(errno('EACCES'));

    const { message } = (await checkBasePathAvailability('/Users/me/Vault')) as { message: string };

    expect(message).not.toContain('--recreate');
    expect(message).toContain('non-root user');
  });
});

describe('assertBasePathAvailable', () => {
  it('resolves for an available path', async () => {
    mockStat.mockResolvedValue(asDirectory);

    await expect(assertBasePathAvailable('/vaults/church')).resolves.toBeUndefined();
  });

  it('throws a typed error carrying the diagnosis', async () => {
    mockIsDocker.mockReturnValue(true);
    mockStat.mockRejectedValue(errno('ENOENT'));

    await expect(assertBasePathAvailable('/Users/me/Vault')).rejects.toThrow(BasePathUnavailableError);

    // Re-run to inspect the instance: routes branch on these fields to choose
    // a status code rather than parsing the message.
    const err = await assertBasePathAvailable('/Users/me/Vault').catch((e) => e);
    expect(err).toMatchObject({
      basePath: '/Users/me/Vault',
      reason: 'missing',
      containerized: true,
    });
  });
});
