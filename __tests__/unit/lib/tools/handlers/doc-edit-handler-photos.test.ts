/**
 * Unit tests for keep_image / list_images / attach_image / describe_image handlers.
 *
 * The pure-function builders (buildKeptImageMarkdown, parseKeptImageFrontmatter,
 * buildSlugAndFilename) are exercised under __tests__/unit/lib/photos/.
 * Here we drive the handlers end-to-end against heavily mocked repos and
 * file-storage helpers.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the module under test.
// ---------------------------------------------------------------------------

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/doc-edit', () => {
  class PathResolutionError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'PathResolutionError';
      this.code = code;
    }
  }
  return {
    resolveDocEditPath: jest.fn(),
    readFileWithMtime: jest.fn(),
    writeFileWithMtimeCheck: jest.fn(),
    getAccessibleMountPoints: jest.fn().mockResolvedValue([]),
    isTextFile: jest.fn(),
    PathResolutionError,
    findUniqueMatch: jest.fn(),
    findAllMatches: jest.fn(),
    reindexSingleFile: jest.fn().mockResolvedValue(undefined),
    parseFrontmatter: jest.requireActual('@/lib/doc-edit/markdown-parser').parseFrontmatter,
    updateFrontmatterInContent: jest.fn(),
    findHeadingSection: jest.fn(),
    readHeadingContent: jest.fn(),
    replaceHeadingContent: jest.fn(),
  };
});

jest.mock('@/lib/doc-edit/mime-registry', () => ({
  detectMimeFromExtension: jest.fn(),
  isJsonFamily: jest.fn(),
  isJsonMime: jest.fn(),
  isJsonlMime: jest.fn(),
  parseContent: jest.fn(),
  serializeContent: jest.fn(),
  validateJson: jest.fn(),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  databaseDocumentExists: jest.fn(),
  databaseFolderExists: jest.fn(),
  deleteDatabaseDocument: jest.fn(),
  moveDatabaseDocument: jest.fn(),
  createDatabaseFolder: jest.fn(),
  deleteDatabaseFolder: jest.fn(),
  moveDatabaseFolder: jest.fn(),
  listDatabaseFiles: jest.fn(),
}));

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn().mockResolvedValue(0),
}));

jest.mock('@/lib/mount-index/mount-chunk-cache', () => ({
  invalidateMountPoint: jest.fn(),
}));

jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue('folder-photos-id'),
}));

jest.mock('@/lib/mount-index/blob-transcode', () => ({
  transcodeToWebP: jest.fn(),
  normaliseBlobRelativePath: jest.fn(),
}));

jest.mock('@/lib/file-storage/bridge-path-helpers', () => ({
  resolveUniqueRelativePath: jest.fn(async (_mountPointId: string, desired: string) => desired),
}));

jest.mock('@/lib/file-storage/character-vault-bridge', () => ({
  getCharacterVaultStore: jest.fn(),
}));

jest.mock('@/lib/photos/auto-describe-attachment', () => ({
  autoDescribeChatImageAttachment: jest.fn(),
}));

jest.mock('@/lib/images-v2', () => ({
  getImageById: jest.fn(),
  readImageBuffer: jest.fn(),
}));

jest.mock('@/lib/photos/chunk-extracted-text', () => ({
  chunkAndInsertExtractedText: jest.fn().mockResolvedValue({ chunksCreated: 2, plainTextLength: 1000 }),
}));

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn().mockResolvedValue({
    embedding: new Float32Array([0.1, 0.2, 0.3]),
    model: 'test-model',
    dimensions: 3,
    provider: 'test',
  }),
}));

jest.mock('@/lib/mount-index/document-search', () => ({
  searchDocumentChunks: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/lib/services/librarian-notifications/writer', () => ({
  postLibrarianOpenAnnouncement: jest.fn(),
  postLibrarianDeleteAnnouncement: jest.fn(),
  postLibrarianFolderCreatedAnnouncement: jest.fn(),
  postLibrarianFolderDeletedAnnouncement: jest.fn(),
  postLibrarianWriteAnnouncement: jest.fn(),
  postLibrarianMoveAnnouncement: jest.fn(),
  postLibrarianCopyAnnouncement: jest.fn(),
  postLibrarianBlobWriteAnnouncement: jest.fn(),
  contentHiddenFromCharacters: jest.fn(() => false),
  documentHiddenFromCharacters: jest.fn(async () => false),
}));

const mockRepos = {
  files: {
    findById: jest.fn(),
    findBySha256: jest.fn().mockResolvedValue([]),
  },
  chats: { findById: jest.fn().mockResolvedValue(null) },
  characters: { findById: jest.fn() },
  docMountPoints: { findById: jest.fn(), refreshStats: jest.fn().mockResolvedValue(undefined) },
  docMountFileLinks: {
    linkBlobContent: jest.fn(),
    findByMountPointId: jest.fn().mockResolvedValue([]),
    findByMountPointAndPath: jest.fn(),
    findByIdWithContent: jest.fn(),
  },
  docMountChunks: { deleteByLinkId: jest.fn(), bulkInsert: jest.fn() },
  projectDocMountLinks: { findByProjectId: jest.fn().mockResolvedValue([]) },
};

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(() => mockRepos),
}));

// The handler imports `getRepositories` from the factory, not the raw module.
// Mock the factory directly so the proxy-routing branch can't sneak past the
// raw-module mock and hit a real repository.
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => mockRepos),
}));

import { executeDocEditTool, DOC_EDIT_TOOL_NAMES } from '@/lib/tools/handlers/doc-edit-handler';
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge';
import { getImageById, readImageBuffer } from '@/lib/images-v2';
import { autoDescribeChatImageAttachment } from '@/lib/photos/auto-describe-attachment';
import { chunkAndInsertExtractedText } from '@/lib/photos/chunk-extracted-text';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { searchDocumentChunks } from '@/lib/mount-index/document-search';
import { sha256OfBuffer } from '@/lib/utils/sha256';

// The stored image bytes saveImageToAlbum reads back. Their real hash differs
// from the FileEntry's upload-time input sha ('a'.repeat(64)) — dedup and the
// recorded sha key off the bytes hash, not the input hash.
const IMAGE_BYTES = Buffer.from('imagebytes');
const IMAGE_BYTES_SHA = sha256OfBuffer(IMAGE_BYTES);

const mockGetCharacterVaultStore = getCharacterVaultStore as jest.MockedFunction<typeof getCharacterVaultStore>;
const mockGetImageById = getImageById as jest.MockedFunction<typeof getImageById>;
const mockAutoDescribe = autoDescribeChatImageAttachment as jest.MockedFunction<typeof autoDescribeChatImageAttachment>;
const mockReadImageBuffer = readImageBuffer as jest.MockedFunction<typeof readImageBuffer>;
const mockChunkAndInsert = chunkAndInsertExtractedText as jest.MockedFunction<typeof chunkAndInsertExtractedText>;
const mockEnqueueEmbedding = enqueueEmbeddingJobsForMountPoint as jest.MockedFunction<typeof enqueueEmbeddingJobsForMountPoint>;
const mockSearchDocChunks = searchDocumentChunks as jest.MockedFunction<typeof searchDocumentChunks>;

const baseContext = { userId: 'user-1', chatId: 'chat-1', characterId: 'char-friday' };

const fridayCharacter = {
  id: 'char-friday',
  name: 'Friday',
  characterDocumentMountPointId: 'mp-friday',
  systemTransparency: true,
};

const fridayVault = { mountPointId: 'mp-friday', mountPointName: "Friday's Vault" };

function buildFileEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'img-uuid-1',
    userId: 'user-1',
    sha256: 'a'.repeat(64),
    originalFilename: 'generated.webp',
    mimeType: 'image/webp',
    size: 1234,
    width: 1024,
    height: 1024,
    linkedTo: [],
    source: 'GENERATED' as const,
    category: 'IMAGE' as const,
    generationPrompt: 'A glass-roofed sunroom at dusk',
    generationRevisedPrompt: null,
    generationModel: 'grok-image-v2',
    description: null,
    tags: [],
    storageKey: 'local:image/img-uuid-1.webp',
    fileStatus: 'ok' as const,
    createdAt: '2026-05-14T07:21:00.000Z',
    updatedAt: '2026-05-14T07:21:00.000Z',
    ...overrides,
  };
}

function buildLink(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    fileId: 'file-row-1',
    mountPointId: 'mp-friday',
    relativePath: 'photos/2026-05-14T07-22-33.000Z-the-night-we-built-the-sunroom.webp',
    fileName: '2026-05-14T07-22-33.000Z-the-night-we-built-the-sunroom.webp',
    folderId: 'folder-photos-id',
    originalFileName: 'generated.webp',
    originalMimeType: 'image/webp',
    description: 'the night we built the sunroom',
    descriptionUpdatedAt: '2026-05-14T07:22:33.000Z',
    conversionStatus: 'skipped' as const,
    conversionError: null,
    plainTextLength: 1000,
    extractedText:
      '---\ntags:\n  - covenant\n  - sunroom\nlinkedBy: Friday\nlinkedById: char-friday\ngenerationModel: grok-image-v2\n---\n\n## Original prompt\n\nA glass-roofed sunroom at dusk\n\nFriday saved this image at 2026-05-14T07:22:33.000Z with this caption: the night we built the sunroom\n',
    extractedTextSha256: 'b'.repeat(64),
    extractionStatus: 'converted' as const,
    extractionError: null,
    chunkCount: 2,
    lastModified: '2026-05-14T07:22:33.000Z',
    createdAt: '2026-05-14T07:22:33.000Z',
    updatedAt: '2026-05-14T07:22:33.000Z',
    sha256: 'a'.repeat(64),
    fileSizeBytes: 1234,
    fileType: 'blob' as const,
    source: 'database' as const,
    ...overrides,
  };
}

describe('photo album handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCharacterVaultStore.mockResolvedValue(fridayVault);
    mockRepos.characters.findById.mockImplementation(async (id: string) =>
      id === 'char-friday' ? fridayCharacter : null
    );
    // saveImageToAlbum reads the mount point row to label the result; return
    // Friday's vault for its mount-point id.
    mockRepos.docMountPoints.findById.mockImplementation(async (id: string) =>
      id === 'mp-friday'
        ? { id: 'mp-friday', name: "Friday's Vault", mountType: 'database', storeType: 'character' }
        : null
    );
    mockRepos.docMountFileLinks.findByMountPointId.mockResolvedValue([]);
    mockRepos.docMountFileLinks.linkBlobContent.mockResolvedValue({
      link: buildLink(),
      file: { id: 'file-row-1', sha256: 'a'.repeat(64), fileSizeBytes: 1234, fileType: 'blob', source: 'database' },
      blobId: 'blob-1',
    });
    mockReadImageBuffer.mockResolvedValue(IMAGE_BYTES);
  });

  it('registers keep_image, list_images, attach_image in DOC_EDIT_TOOL_NAMES', () => {
    expect(DOC_EDIT_TOOL_NAMES.has('keep_image')).toBe(true);
    expect(DOC_EDIT_TOOL_NAMES.has('list_images')).toBe(true);
    expect(DOC_EDIT_TOOL_NAMES.has('attach_image')).toBe(true);
  });

  describe('keep_image', () => {
    it('happy path: links blob, chunks extractedText, returns SavedImage', async () => {
      mockGetImageById.mockResolvedValue(buildFileEntry());

      const result = await executeDocEditTool(
        'keep_image',
        { uuid: 'img-uuid-1', caption: 'the night we built the sunroom', tags: ['covenant', 'sunroom'] },
        baseContext
      );

      expect(result.success).toBe(true);
      expect(mockRepos.docMountFileLinks.linkBlobContent).toHaveBeenCalledTimes(1);
      const linkArgs = mockRepos.docMountFileLinks.linkBlobContent.mock.calls[0][0];
      expect(linkArgs.mountPointId).toBe('mp-friday');
      expect(linkArgs.relativePath).toMatch(/^photos\//);
      expect(linkArgs.sha256).toBe(IMAGE_BYTES_SHA);
      expect(linkArgs.extractedText).toContain('## Original prompt');
      expect(linkArgs.extractedText).toContain('Friday saved this image at');
      expect(linkArgs.extractedText).toContain('the night we built the sunroom');
      expect(linkArgs.extractionStatus).toBe('converted');
      expect(mockChunkAndInsert).toHaveBeenCalledTimes(1);
      expect(mockEnqueueEmbedding).toHaveBeenCalledWith('mp-friday');
      const out = (result.result ?? {}) as Record<string, unknown>;
      expect(out.success).toBe(true);
      expect(out.file_id).toBe('img-uuid-1');
      expect(out.relative_path).toMatch(/^photos\//);
    });

    it('rejects when image is not found', async () => {
      mockGetImageById.mockResolvedValue(null);
      const result = await executeDocEditTool('keep_image', { uuid: 'missing' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Image not found/);
    });

    it('rejects non-image files', async () => {
      mockGetImageById.mockResolvedValue(buildFileEntry({ category: 'DOCUMENT' }));
      const result = await executeDocEditTool('keep_image', { uuid: 'img-uuid-1' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not an image/);
    });

    it('rejects when the character has no vault', async () => {
      mockGetImageById.mockResolvedValue(buildFileEntry());
      mockGetCharacterVaultStore.mockResolvedValue(null);
      const result = await executeDocEditTool('keep_image', { uuid: 'img-uuid-1' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no database-backed character vault/i);
    });

    it('rejects re-keep when an existing photos/ link shares the sha', async () => {
      mockGetImageById.mockResolvedValue(buildFileEntry());
      mockRepos.docMountFileLinks.findByMountPointId.mockResolvedValue([
        buildLink({
          relativePath: 'photos/old.webp',
          sha256: IMAGE_BYTES_SHA,
          createdAt: '2026-05-13T00:00:00.000Z',
        }),
      ]);
      const result = await executeDocEditTool('keep_image', { uuid: 'img-uuid-1' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already kept by Friday/);
      expect(mockRepos.docMountFileLinks.linkBlobContent).not.toHaveBeenCalled();
    });

    it('rejects when context has no characterId', async () => {
      mockGetImageById.mockResolvedValue(buildFileEntry());
      const result = await executeDocEditTool(
        'keep_image',
        { uuid: 'img-uuid-1' },
        { userId: 'user-1', chatId: 'chat-1' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/requires a character context/);
    });

    it('does not duplicate the Revised prompt when it matches the original', async () => {
      mockGetImageById.mockResolvedValue(
        buildFileEntry({ generationRevisedPrompt: 'A glass-roofed sunroom at dusk' })
      );
      await executeDocEditTool('keep_image', { uuid: 'img-uuid-1' }, baseContext);
      const md = mockRepos.docMountFileLinks.linkBlobContent.mock.calls[0][0].extractedText as string;
      expect(md.match(/## Revised prompt/g)).toBeNull();
    });
  });

  describe('list_images', () => {
    it('lists photos/ links when no query is given', async () => {
      mockRepos.docMountFileLinks.findByMountPointId.mockResolvedValue([
        buildLink(),
        buildLink({
          id: 'link-other',
          relativePath: 'Wardrobe/outfit.md',
        }),
      ]);

      const result = await executeDocEditTool('list_images', {}, baseContext);
      expect(result.success).toBe(true);
      const payload = result.result as { images: unknown[]; total: number; has_more: boolean };
      expect(payload.images).toHaveLength(1);
      expect(payload.total).toBe(1);
      expect(payload.has_more).toBe(false);
    });

    it('filters by tag', async () => {
      mockRepos.docMountFileLinks.findByMountPointId.mockResolvedValue([buildLink()]);
      const result = await executeDocEditTool('list_images', { tags: ['none-such'] }, baseContext);
      const payload = result.result as { images: unknown[] };
      expect(payload.images).toHaveLength(0);
    });

    it('filters by saved_by (character name)', async () => {
      mockRepos.docMountFileLinks.findByMountPointId.mockResolvedValue([buildLink()]);
      const result = await executeDocEditTool('list_images', { saved_by: 'Amy' }, baseContext);
      const payload = result.result as { images: unknown[] };
      expect(payload.images).toHaveLength(0);
    });

    it('runs semantic search when query is set, then dedupes by linkId', async () => {
      mockSearchDocChunks.mockResolvedValue([
        {
          chunkId: 'c1',
          mountPointId: 'mp-friday',
          mountPointName: "Friday's Vault",
          fileId: 'file-row-1',
          fileName: 'pic.webp',
          relativePath: 'photos/pic.webp',
          chunkIndex: 0,
          headingContext: 'Original prompt',
          content: 'sunroom...',
          score: 0.82,
        },
        {
          chunkId: 'c2',
          mountPointId: 'mp-friday',
          mountPointName: "Friday's Vault",
          fileId: 'file-row-1',
          fileName: 'pic.webp',
          relativePath: 'photos/pic.webp',
          chunkIndex: 1,
          headingContext: null,
          content: 'sunroom continued...',
          score: 0.75,
        },
      ]);
      mockRepos.docMountFileLinks.findByMountPointAndPath.mockResolvedValue(buildLink({ relativePath: 'photos/pic.webp' }));

      const result = await executeDocEditTool('list_images', { query: 'sunroom dusk' }, baseContext);
      expect(result.success).toBe(true);
      const payload = result.result as { images: Array<Record<string, unknown>>; total: number };
      expect(payload.total).toBe(1);
      expect(payload.images[0].relevance_score).toBeCloseTo(0.82, 2);
    });
  });

  describe('attach_image', () => {
    it('attaches by link id when the link lives in the caller vault', async () => {
      mockRepos.docMountFileLinks.findByIdWithContent.mockResolvedValue(buildLink());
      const result = await executeDocEditTool('attach_image', { uuid: 'link-1' }, baseContext);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.result)).toBe(true);
      const descriptors = result.result as Array<Record<string, unknown>>;
      expect(descriptors).toHaveLength(1);
      expect(descriptors[0].id).toBe('link-1');
      expect(descriptors[0].filepath).toMatch(/\/api\/v1\/mount-points\/mp-friday\/blobs\/photos\//);
      expect(descriptors[0].sha256).toBe('a'.repeat(64));
    });

    it('falls back to image-v2 uuid when no link by that id exists', async () => {
      mockRepos.docMountFileLinks.findByIdWithContent.mockResolvedValue(null);
      mockGetImageById.mockResolvedValue(buildFileEntry());
      mockRepos.docMountFileLinks.findByMountPointId.mockResolvedValue([buildLink()]);
      // The second findByIdWithContent inside the fallback resolves to the link.
      mockRepos.docMountFileLinks.findByIdWithContent.mockResolvedValueOnce(null);
      mockRepos.docMountFileLinks.findByIdWithContent.mockResolvedValueOnce(buildLink());

      const result = await executeDocEditTool('attach_image', { uuid: 'img-uuid-1' }, baseContext);
      expect(result.success).toBe(true);
      const descriptors = result.result as Array<Record<string, unknown>>;
      expect(descriptors[0].id).toBe('link-1');
    });

    it('refuses when the image-v2 uuid has no matching photos/ link in the caller vault', async () => {
      mockRepos.docMountFileLinks.findByIdWithContent.mockResolvedValue(null);
      mockGetImageById.mockResolvedValue(buildFileEntry());
      mockRepos.docMountFileLinks.findByMountPointId.mockResolvedValue([]);

      const result = await executeDocEditTool('attach_image', { uuid: 'img-uuid-1' }, baseContext);
      expect(result.success).toBe(false);
      // Bug 92: the error must redirect a model that wanted to LOOK at the
      // image, not just repeat the filing instruction it already misread.
      expect(result.error).toMatch(/keep_image/);
      expect(result.error).toMatch(/describe_image/);
    });

    it('refuses cross-vault link ids', async () => {
      mockRepos.docMountFileLinks.findByIdWithContent.mockResolvedValue(
        buildLink({ mountPointId: 'mp-someone-else' })
      );
      const result = await executeDocEditTool('attach_image', { uuid: 'link-1' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/another character/);
    });

    it('refuses non-photos paths', async () => {
      mockRepos.docMountFileLinks.findByIdWithContent.mockResolvedValue(
        buildLink({ relativePath: 'images/avatar.webp' })
      );
      const result = await executeDocEditTool('attach_image', { uuid: 'link-1' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not a kept image/);
    });
  });

  // -------------------------------------------------------------------------
  // describe_image — the looking verb (bug 92)
  // -------------------------------------------------------------------------
  describe('describe_image', () => {
    const imageEntry = {
      id: 'file-1',
      category: 'IMAGE',
      mimeType: 'image/webp',
      originalFilename: 'generated_1787445517192.webp',
      width: 1024,
      height: 1024,
      description: null as string | null,
      generationPrompt: null as string | null,
      generationRevisedPrompt: null as string | null,
    };

    it('serves the description auto-describe stored at upload, with no vision call', async () => {
      mockGetImageById.mockResolvedValue({
        ...imageEntry,
        description: 'Two women beside a pool; one has emerald hair, one has dragonfly wings.',
      } as never);

      const result = await executeDocEditTool('describe_image', { uuid: 'file-1' }, baseContext);

      expect(result.success).toBe(true);
      expect((result.result as { source: string }).source).toBe('stored-description');
      expect(result.formattedText).toContain('emerald hair');
      // The whole point: this costs nothing. The description was already there.
      expect(mockAutoDescribe).not.toHaveBeenCalled();
    });

    it('falls back to the prompt that generated the image', async () => {
      mockGetImageById.mockResolvedValue({
        ...imageEntry,
        generationRevisedPrompt: 'A dim, amber-lit bedroom in an Art Deco lodge.',
      } as never);

      const result = await executeDocEditTool('describe_image', { uuid: 'file-1' }, baseContext);

      expect(result.success).toBe(true);
      expect((result.result as { source: string }).source).toBe('generation-prompt');
      expect(mockAutoDescribe).not.toHaveBeenCalled();
    });

    it('spends a vision call only when nothing is on file', async () => {
      mockGetImageById.mockResolvedValue({ ...imageEntry } as never);
      mockAutoDescribe.mockResolvedValue({
        describedFileEntry: true,
        linksUpdated: 1,
        description: 'A freshly described picture.',
      } as never);

      const result = await executeDocEditTool('describe_image', { uuid: 'file-1' }, baseContext);

      expect(mockAutoDescribe).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect((result.result as { source: string }).source).toBe('vision-call');
    });

    it('does NOT require the image to be in the caller`s album', async () => {
      // The album requirement is exactly what made attach_image a dead end for
      // a model that only wanted to look. Reproducing it here would rebuild
      // the trap.
      mockGetImageById.mockResolvedValue({ ...imageEntry, description: 'A picture.' } as never);
      mockRepos.docMountFileLinks.findByIdWithContent.mockResolvedValue(null);

      const result = await executeDocEditTool('describe_image', { uuid: 'file-1' }, baseContext);

      expect(result.success).toBe(true);
    });

    it('resolves an album link uuid via its sha256', async () => {
      mockGetImageById.mockResolvedValue(null as never);
      mockRepos.docMountFileLinks.findByIdWithContent.mockResolvedValue(
        buildLink({ sha256: 'abc123' })
      );
      mockRepos.files.findBySha256.mockResolvedValue([
        { ...imageEntry, description: 'From the album.' },
      ] as never);

      const result = await executeDocEditTool('describe_image', { uuid: 'link-1' }, baseContext);

      expect(result.success).toBe(true);
      expect(result.formattedText).toContain('From the album.');
    });

    it('reports an unresolvable uuid without pretending', async () => {
      mockGetImageById.mockResolvedValue(null as never);
      mockRepos.docMountFileLinks.findByIdWithContent.mockResolvedValue(null);

      const result = await executeDocEditTool('describe_image', { uuid: 'nope' }, baseContext);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No image found/);
    });
  });
});
