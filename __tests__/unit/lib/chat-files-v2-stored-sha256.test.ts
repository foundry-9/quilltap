/**
 * @jest-environment node
 *
 * Bug 117 — a chat upload's FileEntry must record the hash of the bytes that
 * were actually stored.
 *
 * `uploadChatFile` hashed the input buffer and let the storage bridge
 * transcode afterwards, so every bitmap the bridge converted to WebP produced
 * a `files` row whose `sha256` named bytes that exist nowhere. `files` then
 * spoke input-hash while the mount index spoke stored-hash, and every join
 * between them — the one that carries an auto-description into the search
 * index, and the one `describe_image` / `attach_image` use to resolve a mount
 * link back to its FileEntry — returned an empty result its caller read as
 * "no such file". In the instance that surfaced this, 118 of 239 uploaded
 * images, all of them converted WebP.
 *
 * These tests run the *real* transcode (the same `transcodeToWebP` the bridge
 * calls) against a real PNG, and stub only the bridge itself — hashing
 * whatever bytes it is handed, exactly as the real one does.
 */

import sharp from 'sharp';
import { createHash } from 'crypto';

import { uploadChatFile } from '@/lib/chat-files-v2';
import { getRepositories } from '@/lib/repositories/factory';
import { writeUserUploadToMountStore } from '@/lib/file-storage/user-uploads-bridge';
import { autoDescribeChatImageAttachment } from '@/lib/photos/auto-describe-attachment';

jest.mock('@/lib/photos/auto-describe-attachment', () => ({
  autoDescribeChatImageAttachment: jest.fn().mockResolvedValue({
    describedFileEntry: false,
    linksUpdated: 0,
    description: null,
  }),
}));

const USER_ID = '11111111-1111-1111-1111-111111111111';
const CHAT_ID = '22222222-2222-2222-2222-222222222222';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A real 8x8 PNG — small, but genuinely PNG-encoded, so sharp converts it. */
async function makePng(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 12, g: 90, b: 60 } },
  })
    .png()
    .toBuffer();
}

function fileFrom(buffer: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(buffer)], name, { type });
}

/**
 * Repositories stub. `files.create` records what it was asked to write so the
 * assertions can read the row that would have been persisted.
 */
function stubRepos() {
  const created: Array<Record<string, unknown>> = [];
  const repos = {
    files: {
      findBySha256: jest.fn(async () => [] as unknown[]),
      findByFilenameInProject: jest.fn(async () => [] as unknown[]),
      findByProjectId: jest.fn(async () => [] as unknown[]),
      findById: jest.fn(async () => null),
      addLink: jest.fn(async () => null),
      update: jest.fn(async () => null),
      delete: jest.fn(async () => undefined),
      create: jest.fn(async (data: Record<string, unknown>, opts?: { id?: string }) => {
        const row = { id: opts?.id ?? 'file-created', ...data };
        created.push(row);
        return row;
      }),
    },
  };
  return { repos, created };
}

/** The bridge, stubbed the way the real one behaves: it hashes what it stores. */
function bridgeHashesWhatItStores() {
  jest.mocked(writeUserUploadToMountStore).mockImplementation(async (input: any) => ({
    storageKey: 'mount-blob:mock-uploads-mount:mock-blob-id',
    mountPointId: 'mock-uploads-mount',
    blobId: 'mock-blob-id',
    relativePath: `chat/${input.filename}`,
    storedMimeType: input.contentType,
    sizeBytes: input.content.length,
    sha256: sha(input.content),
  }));
}

describe('Bug 117 — files.sha256 names the stored bytes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bridgeHashesWhatItStores();
    jest.mocked(autoDescribeChatImageAttachment).mockResolvedValue({
      describedFileEntry: false,
      linksUpdated: 0,
      description: null,
    });
  });

  it('records the transcoded hash, not the input PNG hash', async () => {
    const png = await makePng();
    const { repos, created } = stubRepos();
    jest.mocked(getRepositories).mockReturnValue(repos as never);

    const result = await uploadChatFile(fileFrom(png, 'kettle.png', 'image/png'), CHAT_ID, USER_ID);

    expect(created).toHaveLength(1);
    const row = created[0];

    // What actually reached the bridge is WebP, and that is what the row names.
    const storedBytes = jest.mocked(writeUserUploadToMountStore).mock.calls[0][0].content as Buffer;
    expect(row.mimeType).toBe('image/webp');
    expect(row.sha256).toBe(sha(storedBytes));
    expect(row.size).toBe(storedBytes.length);

    // Pre-fix this row carried the PNG's hash — bytes that exist nowhere.
    expect(row.sha256).not.toBe(sha(png));
    expect('sha256' in result && result.sha256).toBe(sha(storedBytes));
  });

  it('leaves an already-WebP upload alone, so the correct rows stay correct', async () => {
    // The 121 rows that always joined cleanly were the ones nothing converted.
    const webp = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .webp()
      .toBuffer();
    const { repos, created } = stubRepos();
    jest.mocked(getRepositories).mockReturnValue(repos as never);

    await uploadChatFile(fileFrom(webp, 'lamp.webp', 'image/webp'), CHAT_ID, USER_ID);

    expect(created[0].sha256).toBe(sha(webp));
    expect(created[0].mimeType).toBe('image/webp');
  });

  it('leaves a non-image upload alone', async () => {
    const pdf = Buffer.from('%PDF-1.4\nnot really a pdf\n', 'utf-8');
    const { repos, created } = stubRepos();
    jest.mocked(getRepositories).mockReturnValue(repos as never);

    await uploadChatFile(fileFrom(pdf, 'ledger.pdf', 'application/pdf'), CHAT_ID, USER_ID);

    expect(created[0].sha256).toBe(sha(pdf));
    expect(created[0].mimeType).toBe('application/pdf');
  });

  it('still detects a re-upload of the same source file as a duplicate', async () => {
    // Dedup compares stored-bytes hashes on both sides now. It has to keep
    // working: the whole reason `files.sha256` was left as the input hash was
    // that dedup was thought to depend on it.
    const png = await makePng();
    const { repos, created } = stubRepos();
    jest.mocked(getRepositories).mockReturnValue(repos as never);

    await uploadChatFile(fileFrom(png, 'kettle.png', 'image/png'), CHAT_ID, USER_ID);
    const storedSha = created[0].sha256 as string;

    // Second upload of the same source file: the repository now holds a row
    // under the stored hash, and the lookup must find it.
    const existing = {
      id: 'existing-file',
      originalFilename: 'kettle.png',
      mimeType: 'image/webp',
      size: 1,
      sha256: storedSha,
      linkedTo: [CHAT_ID],
      width: null,
      height: null,
    };
    repos.files.findBySha256.mockResolvedValue([existing]);

    const second = await uploadChatFile(
      fileFrom(png, 'kettle.png', 'image/png'),
      CHAT_ID,
      USER_ID
    );

    expect(repos.files.findBySha256).toHaveBeenLastCalledWith(storedSha);
    expect('id' in second && second.id).toBe('existing-file');
    // No second row was written.
    expect(created).toHaveLength(1);
  });
});
