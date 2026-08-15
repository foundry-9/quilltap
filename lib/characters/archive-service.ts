/**
 * Character archive: pack a character into a `.qtap` bundle, commit a
 * tombstone, and **prune the vault in place** (§4.2a of the archive spec).
 *
 * Operator-only — no tool, no job, no sweep.
 *
 * Archiving does NOT delete the character's vault. It keeps the ten
 * managed-field documents, the avatar blob(s) and their link rows, and the
 * wardrobe — so a tombstone is still a readable character page and every id
 * old chats reference keeps resolving — and moves everything heavy (photos,
 * `Mail/`, conversation summaries, the character's own memories, and the
 * chunks of everything deleted) into the bundle before deleting it.
 *
 * **Ordering is chosen for crash-safety**, because the main DB and the mount
 * index cannot share a transaction:
 *
 * 1. Write the bundle to an ARCHIVE `files` row, encrypted under the instance
 *    passphrase (§4.2c — never the pepper; see lib/characters/archive-crypto).
 * 2. Verify it by decrypting and reading back the ciphertext that will be
 *    persisted — a hard gate before anything is deleted.
 * 3. Commit the tombstone in one main-DB write: `archivedAt` + `archiveFileId`,
 *    null the default-* FKs, flip chat seats to absent. Deliberately NOT
 *    touched: `characterDocumentMountPointId` (the vault survives),
 *    `defaultImageId` and `avatarOverrides` (they point at blobs the prune
 *    keeps — nulling them is what took the face off old messages).
 * 4. Prune (idempotent, re-runnable): own memories, the vector store, then
 *    every vault link outside the keep-set, through the document-store delete
 *    paths so link-group orphan GC runs.
 *
 * A failure before step 3 removes the bundle it wrote and leaves the character
 * fully live. A failure during step 4 reports `pruneComplete: false`; calling
 * `archiveCharacter` again re-runs the prune only and never rewrites the
 * bundle. Because the prune is a delete-set rather than a teardown, re-running
 * it is naturally idempotent — anything already gone stays gone, and the
 * keep-set is never a candidate.
 *
 * Untouched, by design: chats, messages, annotations, group membership,
 * project rosters, and *other* characters' memories about this one.
 */

import { createHash, randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getRepositories, getUserRepositories } from '@/lib/repositories/factory';
import {
  encryptArchive,
  decryptArchive,
  isEncryptedArchive,
  resolveArchivePassphrase,
} from '@/lib/characters/archive-crypto';
import { createNdjsonStream } from '@/lib/export/ndjson-writer';
import { assembleExportFromStream } from '@/lib/import/quilltap-import-stream';
import { readNdjsonLines } from '@/lib/import/ndjson-reader';
import { executeImport } from '@/lib/import/quilltap-import/execute';
import { reindexLinks } from '@/lib/mount-index/reindex';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { deleteMemoriesWithUnlinkBatch } from '@/lib/memory/memory-gate';
import { getVectorStoreManager } from '@/lib/embedding/vector-store';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { CHARACTER_WARDROBE_FOLDER } from '@/lib/mount-index/character-vault';
import {
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_METADATA_JSON_PATH,
  CHARACTER_IDENTITY_MD_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_MANIFESTO_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
  CHARACTER_WARDROBE_JSON_PATH,
} from '@/lib/database/repositories/vault-overlay/schema';
import type { FileCategory } from '@/lib/schemas/file.types';

export interface ArchiveCharacterResult {
  archived: boolean;
  archiveFileId: string | null;
  /**
   * False when any prune step failed. The character is still archived and the
   * bundle is still good; re-run `archiveCharacter` to finish the prune.
   */
  pruneComplete: boolean;
}

export interface RehydrateCharacterResult {
  rehydrated: boolean;
  archived: boolean;
  /**
   * The ARCHIVE bundle file deliberately left in the library after a
   * successful restore (§6 step 6 — cheap insurance). Null when the tombstone
   * had no bundle. The UI offers deletion; nothing here deletes it.
   */
  archiveBundleFileId: string | null;
  /** What the bundle import actually put back (absent when there was no bundle). */
  restored?: { memories: number; documents: number; blobs: number };
  /** Non-fatal import warnings, surfaced so a partial restore is visible. */
  warnings: string[];
}

/**
 * Thrown when the restore cannot run or did not complete: the bundle file is
 * missing from the library, or the bundle import reported failure. The
 * character is left archived with the bundle untouched (§6 failure semantics),
 * so fixing the cause and re-running is always safe.
 */
export class CharacterRehydrationError extends Error {
  constructor(characterId: string, detail: string) {
    super(`Character ${characterId} cannot be rehydrated: ${detail}`);
    this.name = 'CharacterRehydrationError';
  }
}

/** Thrown when the bundle we just wrote does not match the live character. */
export class ArchiveVerificationError extends Error {
  constructor(detail: string) {
    super(`Archive bundle verification failed: ${detail}`);
    this.name = 'ArchiveVerificationError';
  }
}

/**
 * The writer only emits `doc_mount_document` records for text file types;
 * everything else in a store travels as a blob. Verification has to apply the
 * same filter or it compares against a total the bundle was never going to
 * carry.
 */
const TEXT_DOCUMENT_FILE_TYPES = new Set(['markdown', 'txt', 'json', 'jsonl']);

/**
 * The §4.2a keep-set: vault paths that survive the prune. The ten managed-field
 * documents, plus everything under `Wardrobe/` (checked by prefix, not listed
 * here). Avatar links are kept by id, not path — see the prune.
 */
const KEPT_MANAGED_PATHS = new Set(
  [
    CHARACTER_PROPERTIES_JSON_PATH,
    CHARACTER_METADATA_JSON_PATH,
    CHARACTER_IDENTITY_MD_PATH,
    CHARACTER_DESCRIPTION_MD_PATH,
    CHARACTER_MANIFESTO_MD_PATH,
    CHARACTER_PERSONALITY_MD_PATH,
    CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
    CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
    CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
    CHARACTER_WARDROBE_JSON_PATH,
  ].map((p) => p.toLowerCase())
);

export async function archiveCharacter(
  userId: string,
  characterId: string
): Promise<ArchiveCharacterResult> {
  const repos = getUserRepositories(userId);
  const character = await repos.characters.findById(characterId);
  if (!character) {
    throw new Error(`Character ${characterId} not found`);
  }

  // Already archived: a previous run committed the tombstone and then failed
  // (or was killed) partway through the prune. Re-run the prune; never rewrite
  // the bundle, and never touch the tombstone fields again.
  if (character.archivedAt) {
    logger.info('Character already archived; re-running the prune only', { characterId });
    const pruneComplete = await pruneArchivedCharacterState(userId, characterId);
    return {
      archived: true,
      archiveFileId: character.archiveFileId ?? null,
      pruneComplete,
    };
  }

  const memories = await repos.memories.findByCharacterId(characterId);
  const mountPointId = character.characterDocumentMountPointId ?? null;

  // Resolve the encryption passphrase up front (§4.2c) — a named failure here
  // beats discovering it after the export has already streamed.
  const passphrase = resolveArchivePassphrase();

  const bundle = await createArchiveBundle(userId, characterId, passphrase);
  await verifyArchiveBundle(bundle, {
    characterId,
    expectedMemoryCount: memories.length,
    mountPointId,
  });

  // Everything from here to the commit is undone on failure: an orphan ARCHIVE
  // file per failed attempt would pile up in the library unnoticed.
  const written: string[] = [];
  try {
    const archiveFileId = await createArchiveFileRecord(userId, repos, bundle);
    written.push(archiveFileId);

    await flipCharacterParticipantsToAbsent(userId, characterId);

    // The commit. Note what is NOT here: characterDocumentMountPointId (the
    // vault survives the archive), defaultImageId and avatarOverrides (they
    // point at blobs the prune keeps — old messages keep their faces).
    await repos.characters.update(characterId, {
      archivedAt: new Date().toISOString(),
      archiveFileId,
      defaultPartnerId: null,
      defaultConnectionProfileId: null,
      defaultImageProfileId: null,
      defaultRoleplayTemplateId: null,
    } as never);

    const pruneComplete = await pruneArchivedCharacterState(userId, characterId);

    return { archived: true, archiveFileId, pruneComplete };
  } catch (error) {
    await discardWrittenFiles(userId, repos, written);
    throw error;
  }
}

/**
 * Bring an archived character back (WP B4 / spec §6).
 *
 * §4.2a made this "restore the pruned material back into a mount that still
 * exists", not "import a bundle into empty space": the mount point, the ten
 * managed documents, the avatar and the wardrobe never left, and everything
 * the prune deleted comes back at its original ids.
 *
 * 1. Load the bundle from `archiveFileId`, decrypt it (§4.2c — a wrong
 *    passphrase reports the "predates your passphrase change" diagnosis, not a
 *    GCM failure), and verify the plaintext against the file row's recorded
 *    digest.
 * 2. Import it with `preserveIds` in **skip-if-present** mode: an id already
 *    present inside this character's own vault (the whole keep-set, by
 *    construction) is skipped; an id living anywhere else still refuses
 *    atomically. The import is additive and id-preserving, so a partial
 *    restore re-run skips what the first pass already put back.
 * 3. Clear `archivedAt` (the single-key patch the §4.4 guard sanctions), then
 *    — on the now-live row — `archiveFileId` and any pre-revision
 *    `archivedAvatarFileId` (whose thumbnail file row is deleted).
 * 4. Flip absent chat seats back to active, re-chunk the restored text
 *    documents, and enqueue embedding jobs. Restored memories were already
 *    enqueued by the import itself.
 *
 * Any failure before step 3's clear throws and leaves the character archived
 * with the bundle intact. The bundle file stays in the library afterwards
 * (cheap insurance); the UI offers its deletion.
 *
 * A tombstone with no bundle (nothing was ever packed, so nothing was pruned)
 * is simply un-flagged.
 */
export async function rehydrateCharacter(
  userId: string,
  characterId: string
): Promise<RehydrateCharacterResult> {
  const repos = getUserRepositories(userId);
  const character = await repos.characters.findById(characterId);
  if (!character) {
    throw new Error(`Character ${characterId} not found`);
  }

  if (!character.archivedAt) {
    throw new Error(`Character ${characterId} is not archived`);
  }

  const archiveFileId = character.archiveFileId ?? null;
  let restored: RehydrateCharacterResult['restored'];
  let warnings: string[] = [];

  if (archiveFileId) {
    const outcome = await restoreArchiveBundle(userId, characterId, character, archiveFileId);
    restored = outcome.restored;
    warnings = outcome.warnings;
  }

  // The commit. The §4.4 guard sanctions exactly one patch on an archived
  // row — { archivedAt: null } alone — so the pointer cleanup rides second.
  await repos.characters.update(characterId, { archivedAt: null } as never);

  const followUp: Record<string, null> = {};
  if (archiveFileId) followUp.archiveFileId = null;
  if (character.archivedAvatarFileId) followUp.archivedAvatarFileId = null;
  if (Object.keys(followUp).length > 0) {
    await repos.characters.update(characterId, followUp as never);
  }

  // A pre-revision tombstone carried a standalone avatar thumbnail; the live
  // character resolves its face through the vault again, so the thumbnail
  // row goes (§6 step 4). Cosmetic — never fails the rehydrate.
  if (character.archivedAvatarFileId) {
    try {
      await repos.files.delete(character.archivedAvatarFileId);
    } catch (error) {
      logger.warn('Failed to delete pre-revision archived-avatar thumbnail', {
        characterId,
        fileId: character.archivedAvatarFileId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await flipCharacterParticipantsToPresent(userId, characterId);

  // Re-chunk + re-embed the restored vault content (§6 step 5). Non-fatal:
  // the boot reconcile sweep is the backstop, and the character is already
  // live either way.
  if (archiveFileId && character.characterDocumentMountPointId) {
    await rechunkAndEmbedVault(characterId, character.characterDocumentMountPointId);
  }

  logger.info('Character rehydrated from archive', {
    characterId,
    archiveBundleFileId: archiveFileId,
    restored,
    warningCount: warnings.length,
  });

  return {
    rehydrated: true,
    archived: false,
    archiveBundleFileId: archiveFileId,
    ...(restored ? { restored } : {}),
    warnings,
  };
}

/**
 * §6 steps 1–3: load, decrypt, verify, and import the bundle. Throws on any
 * failure, leaving the character archived and the bundle untouched.
 */
async function restoreArchiveBundle(
  userId: string,
  characterId: string,
  character: { characterDocumentMountPointId?: string | null },
  archiveFileId: string
): Promise<{ restored: NonNullable<RehydrateCharacterResult['restored']>; warnings: string[] }> {
  const repos = getUserRepositories(userId);

  const fileRow = await repos.files.findById(archiveFileId);
  if (!fileRow) {
    throw new CharacterRehydrationError(
      characterId,
      `its archive bundle (file ${archiveFileId}) is missing from the library. ` +
        'If the bundle is gone for good, the pruned material is unrecoverable; delete the character to let them go.'
    );
  }

  const raw = await fileStorageManager.downloadFile(fileRow);
  // §4.2c: bundles written since the encryption revision carry the QTAPARC1
  // magic; a pre-encryption bundle is plaintext NDJSON and passes through.
  // decryptArchive resolves the instance passphrase itself and diagnoses a
  // wrong one as ArchivePassphraseMismatchError ("predates your passphrase
  // change") via the header's key hash, before touching the ciphertext.
  const plaintext = isEncryptedArchive(raw) ? decryptArchive(raw) : raw;

  // The file row's sha256 is the plaintext digest (§4.2d) — the one check
  // that survives re-encryption and actually verifies content.
  const digest = createHash('sha256').update(plaintext).digest('hex');
  const clobberWarnings: string[] = [];
  if (fileRow.sha256 && digest !== fileRow.sha256) {
    // Bug 69 self-heal. Until the file watcher learned to leave content
    // digests alone, it re-derived this row's sha256 from the encrypted bytes
    // seconds after the archive was written, and every rehydrate afterwards
    // failed here. If the recorded digest is exactly the digest of the file as
    // stored, the bundle is intact and the ROW is what was damaged: repair it
    // and carry on. Any other mismatch is a genuinely corrupt bundle.
    const storedDigest = createHash('sha256').update(raw).digest('hex');
    if (fileRow.sha256 !== storedDigest) {
      throw new ArchiveVerificationError(
        `the bundle's decrypted content does not match its recorded digest (expected ${fileRow.sha256}, got ${digest}) — the bundle is corrupt`
      );
    }
    logger.warn('Repairing an archive row whose plaintext digest was overwritten with the ciphertext digest (bug 69)', {
      characterId,
      archiveFileId,
      recordedDigest: fileRow.sha256.slice(0, 12) + '...',
      plaintextDigest: digest.slice(0, 12) + '...',
    });
    clobberWarnings.push(
      "The bundle's recorded digest had been overwritten with the digest of its encrypted bytes; " +
        'the contents verified against the file as stored, and the record has been repaired.'
    );
    try {
      await repos.files.update(archiveFileId, { sha256: digest });
    } catch (error) {
      logger.warn('Failed to repair the archive row digest; the rehydrate continues', {
        characterId,
        archiveFileId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const exportData = await assembleExportFromStream(
    readNdjsonLines(bufferToByteStream(plaintext))
  );

  const manifest = exportData.manifest;
  if (manifest?.format !== 'quilltap-export' || manifest?.settings?.preserveIds !== true) {
    throw new ArchiveVerificationError(
      'the bundle is not a preserve-ids character archive — its manifest is missing or was written without preserveIds'
    );
  }

  const data = exportData.data;
  const characters = (data && 'characters' in data ? data.characters : undefined) ?? [];
  if (characters.length !== 1 || characters[0]?.id !== characterId) {
    throw new ArchiveVerificationError(
      `the bundle does not carry character ${characterId} (it holds ${characters.length} character record(s))`
    );
  }

  const result = await executeImport(userId, exportData, {
    conflictStrategy: 'skip',
    includeMemories: true,
    includeRelatedEntities: false,
    preserveIds: true,
    preserveIdsMode: {
      mode: 'skip-if-present',
      targetCharacterId: characterId,
      targetVaultMountPointId: character.characterDocumentMountPointId ?? null,
    },
  });

  if (!result.success) {
    // Failing before the tombstone clear is the whole contract (§6): the
    // character stays archived, the bundle stays put, and because the import
    // is additive at preserved ids a re-run skips whatever did land.
    const detail = result.warnings.length > 0 ? result.warnings.join('; ') : 'unknown import error';
    // Say "rehydrate" in the log. The importer's own warning names only the
    // import module, so a failed rehydrate otherwise leaves no log line that
    // grepping for the operation would ever find.
    logger.error('Rehydrate failed: the archive bundle import was refused', {
      characterId,
      archiveFileId,
      detail,
    });
    throw new CharacterRehydrationError(characterId, `the bundle import failed: ${detail}`);
  }

  return {
    restored: {
      memories: result.imported.memories ?? 0,
      documents: result.imported.documentStoreDocuments ?? 0,
      blobs: result.imported.documentStoreBlobs ?? 0,
    },
    warnings: [...clobberWarnings, ...result.warnings],
  };
}

/** Wrap a buffer as the single-chunk byte stream the NDJSON reader expects. */
function bufferToByteStream(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(buffer);
      controller.close();
    },
  });
}

/**
 * §6 step 5: restored text documents come back with no chunks — `reindexLinks`
 * without `force` chunks exactly the links whose chunkCount is 0, leaving the
 * keep-set (which never lost its chunks) alone — then the embedding scheduler
 * enqueues jobs for every un-embedded chunk in the mount.
 */
async function rechunkAndEmbedVault(characterId: string, mountPointId: string): Promise<void> {
  const globalRepos = getRepositories();
  try {
    const mountPoint = await globalRepos.docMountPoints.findById(mountPointId);
    if (mountPoint) {
      await reindexLinks(mountPoint, {});
      await globalRepos.docMountPoints.refreshStats(mountPointId);
    }
    await enqueueEmbeddingJobsForMountPoint(mountPointId);
  } catch (error) {
    logger.warn('Failed to re-chunk or re-embed the rehydrated vault; the boot reconcile will catch up', {
      characterId,
      mountPointId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

interface ArchiveBundle {
  /** The NDJSON export in the clear — hashed, verified, never persisted. */
  plaintext: Buffer;
  /** What actually lands on disk (§4.2c). */
  encrypted: Buffer;
  exportData: Awaited<ReturnType<typeof assembleExportFromStream>>;
}

/**
 * Run the live characters export into a buffer, encrypt it (§4.2c), then
 * decrypt the ciphertext and read *that* back — so verification covers the
 * artifact that will actually be persisted, encryption round-trip included,
 * rather than what we meant to write.
 */
async function createArchiveBundle(
  userId: string,
  characterId: string,
  passphrase: string
): Promise<ArchiveBundle> {
  const stream = createNdjsonStream(userId, {
    type: 'characters',
    scope: 'selected',
    selectedIds: [characterId],
    includeMemories: true,
    preserveIds: true,
  });

  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const plaintext = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const encrypted = encryptArchive(plaintext, passphrase);
  const roundTripped = decryptArchive(encrypted, passphrase);
  const exportData = await assembleExportFromStream(
    readNdjsonLines(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(roundTripped);
          controller.close();
        },
      })
    )
  );

  return { plaintext, encrypted, exportData };
}

/**
 * The hard gate before anything is deleted (parent §11.1).
 *
 * Checks three things, in the order they'd betray a problem:
 *   - the bundle carries the character and every one of its memories;
 *   - it carries the vault — mount point, text documents and blobs — matching
 *     what the live store actually holds;
 *   - the footer counts agree with the records that were parsed, so a bundle
 *     that under-reports itself can't slip through.
 *
 * Reading the bundle back also exercises the reader's own truncation checks:
 * a blob missing chunks throws before we get here.
 */
async function verifyArchiveBundle(
  bundle: ArchiveBundle,
  expected: { characterId: string; expectedMemoryCount: number; mountPointId: string | null }
): Promise<void> {
  const { manifest, data } = bundle.exportData;
  const counts = manifest?.counts ?? {};

  const parsed = data && 'characters' in data ? data : null;
  const characters = parsed?.characters ?? [];
  const memories = parsed?.memories ?? [];
  const mountPoints = (parsed as { mountPoints?: unknown[] } | null)?.mountPoints ?? [];
  const documents = (parsed as { documents?: unknown[] } | null)?.documents ?? [];
  const blobs = (parsed as { blobs?: unknown[] } | null)?.blobs ?? [];

  if (characters.length !== 1 || characters[0]?.id !== expected.characterId) {
    throw new ArchiveVerificationError(
      `expected exactly the character ${expected.characterId}, got ${characters.length} character record(s)`
    );
  }

  if (memories.length !== expected.expectedMemoryCount) {
    throw new ArchiveVerificationError(
      `memory count mismatch: bundle has ${memories.length}, character has ${expected.expectedMemoryCount}`
    );
  }

  // Footer honesty: the counts a reader will trust must match what is there.
  assertCount('characters', counts.characters, characters.length);
  assertCount('memories', counts.memories, memories.length);
  assertCount('documentStores', counts.documentStores, mountPoints.length);
  assertCount('documentStoreDocuments', counts.documentStoreDocuments, documents.length);
  assertCount('documentStoreBlobs', counts.documentStoreBlobs, blobs.length);

  if (!expected.mountPointId) {
    if (mountPoints.length !== 0) {
      throw new ArchiveVerificationError(
        `character has no vault but the bundle carries ${mountPoints.length} store(s)`
      );
    }
    return;
  }

  const live = await countLiveVault(expected.mountPointId);
  if (mountPoints.length !== 1) {
    throw new ArchiveVerificationError(
      `expected the character's vault in the bundle, got ${mountPoints.length} store(s)`
    );
  }
  if (documents.length !== live.documents) {
    throw new ArchiveVerificationError(
      `vault document count mismatch: bundle has ${documents.length}, vault has ${live.documents}`
    );
  }
  if (blobs.length !== live.blobs) {
    throw new ArchiveVerificationError(
      `vault blob count mismatch: bundle has ${blobs.length}, vault has ${live.blobs}`
    );
  }
}

function assertCount(label: string, reported: number | undefined, actual: number): void {
  if ((reported ?? 0) !== actual) {
    throw new ArchiveVerificationError(
      `footer count for ${label} says ${reported ?? 0}, bundle carries ${actual}`
    );
  }
}

/** What the live vault holds, filtered the way the writer filters it. */
async function countLiveVault(mountPointId: string): Promise<{ documents: number; blobs: number }> {
  const globalRepos = getRepositories();
  const documents = await globalRepos.docMountDocuments.findByMountPointId(mountPointId);
  const blobs = await globalRepos.docMountBlobs.listByMountPoint(mountPointId);
  return {
    documents: documents.filter((d) => TEXT_DOCUMENT_FILE_TYPES.has(d.fileType)).length,
    blobs: blobs.length,
  };
}

/**
 * Create the ARCHIVE `files` row and upload the encrypted bytes.
 *
 * The recorded sha256 is the digest of the **plaintext** bundle (§4.2d step
 * 1), not the ciphertext: this row is the only copy of an archived
 * character's pruned material, and the plaintext digest is what rehydration
 * verifies after decrypting — a ciphertext digest would change on every
 * re-encryption (passphrase change) and verify nothing about the content.
 * `size` is the real on-disk (encrypted) byte count.
 */
async function createArchiveFileRecord(
  userId: string,
  repos: ReturnType<typeof getUserRepositories>,
  bundle: ArchiveBundle
): Promise<string> {
  const sha256 = createHash('sha256').update(bundle.plaintext).digest('hex');
  const mimeType = 'application/octet-stream';

  // Mint the id up front so the row carries its storageKey from the first
  // write. The bytes land on disk *after* the row exists, so the file
  // watcher's add event finds the record by storageKey and stays silent —
  // creating the row keyless and patching it post-upload raced the watcher
  // into adopting the fresh bundle as an orphaned DOCUMENT.
  const fileId = randomUUID();
  const storageKey = `${fileId}/character-archive.qtap`;

  const file = await repos.files.create(
    {
      userId,
      sha256,
      originalFilename: `${new Date().toISOString().replace(/[:.]/g, '-')}-character-archive.qtap`,
      mimeType,
      size: bundle.encrypted.length,
      source: 'SYSTEM',
      category: 'ARCHIVE' as FileCategory,
      linkedTo: [],
      tags: [],
      projectId: null,
      folderPath: '/archives',
      storageKey,
      fileStatus: 'ok',
    } as never,
    { id: fileId }
  );

  await fileStorageManager.uploadRaw({
    storageKey,
    content: bundle.encrypted,
    contentType: mimeType,
  });

  return file.id;
}

/** Roll back the file rows a failed pre-commit attempt created. */
async function discardWrittenFiles(
  userId: string,
  repos: ReturnType<typeof getUserRepositories>,
  fileIds: string[]
): Promise<void> {
  for (const fileId of fileIds) {
    try {
      await repos.files.delete(fileId);
    } catch (error) {
      logger.warn('Failed to discard an archive file after a failed archive attempt', {
        userId,
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function flipCharacterParticipantsToAbsent(userId: string, characterId: string): Promise<void> {
  const repos = getUserRepositories(userId);

  try {
    const chats = await repos.chats.findByCharacterId(characterId);
    await Promise.allSettled(
      chats.flatMap((chat) =>
        (chat.participants ?? [])
          .filter((participant) => participant.characterId === characterId && participant.type === 'CHARACTER')
          .map((participant) => repos.chats.setParticipantStatus(chat.id, participant.id, 'absent'))
      )
    );
  } catch (error) {
    logger.warn('Failed to flip character participants to absent during archive', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The archive flip's inverse (§4.5): every seat the archive parked at
 * `absent` comes back `active`. Only `absent` seats are touched — a
 * `removed` participant left the chat before the archive and stays gone.
 * Best-effort like its sibling: a stubborn seat must not fail the rehydrate.
 */
async function flipCharacterParticipantsToPresent(userId: string, characterId: string): Promise<void> {
  const repos = getUserRepositories(userId);

  try {
    const chats = await repos.chats.findByCharacterId(characterId);
    await Promise.allSettled(
      chats.flatMap((chat) =>
        (chat.participants ?? [])
          .filter(
            (participant) =>
              participant.characterId === characterId &&
              participant.type === 'CHARACTER' &&
              participant.status === 'absent'
          )
          .map((participant) => repos.chats.setParticipantStatus(chat.id, participant.id, 'active'))
      )
    );
  } catch (error) {
    logger.warn('Failed to flip character participants back to active during rehydrate', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Idempotent prune of everything the bundle now carries (§4.2a).
 *
 * Every step reports whether it succeeded and the result is their conjunction —
 * a caller must be able to tell "archived, prune incomplete" from "archived,
 * done", or the failure semantics are a fiction. Steps do not abort each other:
 * a vault link that refuses to delete should not also strand the memories.
 */
async function pruneArchivedCharacterState(userId: string, characterId: string): Promise<boolean> {
  const steps = [
    await deleteOwnMemories(userId, characterId),
    await deleteVectorStore(characterId),
    await pruneVault(characterId),
  ];
  const complete = steps.every(Boolean);
  if (!complete) {
    logger.warn('Archive prune incomplete; re-run archiveCharacter to finish', { characterId });
  }
  return complete;
}

async function deleteOwnMemories(userId: string, characterId: string): Promise<boolean> {
  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();
  try {
    const memories = await repos.memories.findByCharacterId(characterId);
    if (memories.length > 0) {
      // Through the gate, never repos.memories.delete*: it scrubs the deleted
      // ids out of surviving neighbours' relatedMemoryIds first.
      await deleteMemoriesWithUnlinkBatch(memories.map((memory) => memory.id));
      for (const memory of memories) {
        await globalRepos.embeddingStatus.deleteByEntity('MEMORY', memory.id);
      }
    }
    return true;
  } catch (error) {
    logger.warn('Failed to delete memories for archived character', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function deleteVectorStore(characterId: string): Promise<boolean> {
  try {
    await getVectorStoreManager().deleteStore(characterId);
    return true;
  } catch (error) {
    logger.warn('Failed to delete vector store for archived character', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Prune the vault in place: delete every link outside the keep-set, then any
 * folder left with nothing kept beneath it.
 *
 * The keep-set (§4.2a): the ten managed-field documents, everything under
 * `Wardrobe/`, and the avatar links — `defaultImageId` plus every
 * `avatarOverrides[].imageId`. Those are ids old chat messages resolve through;
 * keeping the rows is what keeps their faces.
 *
 * Deletion goes through `deleteWithGC` — the document-store delete path — so
 * chunks cascade, the underlying file row is ref-counted before it is
 * collected, and link-group orphan GC runs. Never `deleteStoreCascade`: that
 * tears down the whole store, which is exactly what this revision stopped
 * doing. The mount point and `characterDocumentMountPointId` are never touched.
 *
 * Honesty check: after the loop the surviving links are re-listed; any doomed
 * link still present (deleteWithGC swallows backend errors into a no-op)
 * fails the step so the caller reports "prune incomplete".
 */
async function pruneVault(characterId: string): Promise<boolean> {
  const globalRepos = getRepositories();
  try {
    // Raw read (global repo — the user-scoped one doesn't expose it): the
    // prune needs only pointer + avatar ids, and must work even if the overlay
    // is somehow broken mid-archive. Ownership was checked at entry.
    const character = await globalRepos.characters.findByIdRaw(characterId);
    const mountPointId = character?.characterDocumentMountPointId;
    if (!mountPointId) {
      // No vault: a pre-§4.2a tombstone whose vault was deleted outright, or a
      // character that never had one. Nothing to prune.
      return true;
    }

    const keptLinkIds = new Set<string>();
    if (character?.defaultImageId) keptLinkIds.add(character.defaultImageId);
    for (const override of character?.avatarOverrides ?? []) {
      if (override.imageId) keptLinkIds.add(override.imageId);
    }

    const wardrobePrefix = `${CHARACTER_WARDROBE_FOLDER.toLowerCase()}/`;
    const isKeptLink = (link: { id: string; relativePath: string }): boolean => {
      if (keptLinkIds.has(link.id)) return true;
      const path = link.relativePath.toLowerCase();
      return KEPT_MANAGED_PATHS.has(path) || path.startsWith(wardrobePrefix);
    };

    const links = await globalRepos.docMountFileLinks.findByMountPointId(mountPointId);
    const doomed = links.filter((link) => !isKeptLink(link));

    for (const link of doomed) {
      // Chunk ids first: the delete cascades them away, and their
      // embedding_status rows would otherwise linger as permanent orphans.
      const chunks = await globalRepos.docMountChunks.findByLinkId(link.id);
      await globalRepos.docMountFileLinks.deleteWithGC(link.id);
      for (const chunk of chunks) {
        await globalRepos.embeddingStatus.deleteByEntity('MOUNT_CHUNK', chunk.id);
      }
    }

    const survivors = await globalRepos.docMountFileLinks.findByMountPointId(mountPointId);
    const undead = survivors.filter((link) => !isKeptLink(link));
    if (undead.length > 0) {
      logger.warn('Vault prune left doomed links behind', {
        characterId,
        mountPointId,
        remaining: undead.length,
      });
      return false;
    }

    await pruneEmptyFolders(mountPointId, survivors, wardrobePrefix);

    logger.debug('Pruned vault for archived character', {
      characterId,
      mountPointId,
      deleted: doomed.length,
      kept: survivors.length,
    });
    return true;
  } catch (error) {
    logger.warn('Failed to prune vault for archived character', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Delete folder rows with no kept content beneath them (`Mail/`,
 * `Conversation Summaries/`, photo folders, …). The `Wardrobe/` folder is in
 * the keep-set explicitly — it survives even when empty — and so does any
 * folder that still shelters a surviving link.
 */
async function pruneEmptyFolders(
  mountPointId: string,
  survivors: ReadonlyArray<{ relativePath: string }>,
  wardrobePrefix: string
): Promise<void> {
  const globalRepos = getRepositories();
  const keptPaths = survivors.map((link) => link.relativePath.toLowerCase());
  const wardrobeFolder = wardrobePrefix.slice(0, -1);

  const folders = await globalRepos.docMountFolders.findByMountPointId(mountPointId);
  for (const folder of folders) {
    const folderPath = folder.path.toLowerCase();
    if (folderPath === '' || folderPath === wardrobeFolder || folderPath.startsWith(wardrobePrefix)) {
      continue;
    }
    const shelters = keptPaths.some((path) => path.startsWith(`${folderPath}/`));
    if (!shelters) {
      await globalRepos.docMountFolders.delete(folder.id);
    }
  }
}
