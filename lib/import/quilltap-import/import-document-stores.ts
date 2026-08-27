/**
 * Import document stores (Scriptorium): mount-point configs plus, for
 * database-backed mounts, folder structures, document bodies, blobs, and
 * project↔store links. Source mount-point ids are mapped onto the created/
 * reused targets and promoted onto idMaps.mountPoints for later reconciliation
 * (e.g. characterDocumentMountPointId).
 *
 * @module import/quilltap-import/import-document-stores
 */

import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type {
  ExportedDocumentStore,
  ExportedDocumentStoreDocument,
  ExportedDocumentStoreBlob,
  ExportedProjectDocMountLink,
} from '@/lib/export/types';
import { type ImportOptions, type IdMappingState, type DocumentStoreImportCounts, getPreserveIdsCreateOptions } from './types';
import { nextUniqueMountPointName } from '@/lib/mount-index/unique-mount-point-name';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

export async function importDocumentStores(
  mountPoints: ExportedDocumentStore[],
  folders: any[],
  documents: ExportedDocumentStoreDocument[],
  blobs: ExportedDocumentStoreBlob[],
  projectLinks: ExportedProjectDocMountLink[],
  options: ImportOptions,
  _userRepos: ReturnType<typeof getUserRepositories>,
  idMaps: IdMappingState,
  warnings: string[]
): Promise<DocumentStoreImportCounts> {
  const counts: DocumentStoreImportCounts = { mountPoints: 0, folders: 0, documents: 0, blobs: 0, projectLinks: 0 };

  // Document stores are instance-scoped, not user-scoped — use the global
  // repository container.
  const globalRepos = getRepositories();

  // Map source mountPointId → target mountPointId so we can rewrite
  // documents/blobs to the mount points we end up creating or reusing.
  // Also promoted onto idMaps.mountPoints for cross-entity reconciliation
  // (e.g. characterDocumentMountPointId).
  const idMap = idMaps.mountPoints;

  const existingStores = await globalRepos.docMountPoints.findAll();
  // Identity is the store id, not its name (Bug 11 fix 2). Matching by name
  // silently redirected an overwrite onto an unrelated store that happened to
  // inherit the old name after a rename; matching by id targets the store the
  // archive actually came from.
  const byId = new Map(existingStores.map(s => [s.id, s]));
  // Store names are one case-insensitive namespace; track every name we see
  // (pre-existing + created this run) so neither a clash with an existing
  // store nor a duplicate inside the import payload mints a colliding name.
  const takenNames = new Set(existingStores.map(s => s.name));

  for (const mp of mountPoints) {
    try {
      // Skip-if-present rehydrate (spec §6/F4): the mount survived the prune.
      // Resolve source → target as identity and leave its settings untouched.
      if (options.preserveIds && idMaps.preserveIdsSkips.has(mp.id)) {
        idMap.set(mp.id, mp.id);
        continue;
      }

      const existing = byId.get(mp.id);
      if (existing) {
        if (options.conflictStrategy === 'skip') {
          idMap.set(mp.id, existing.id);
          continue;
        }
        if (options.conflictStrategy === 'overwrite') {
          // Drop existing documents, blobs, files, chunks, AND folders before
          // replacing. Folders were left standing pre-fix, so an identical
          // re-import kept stale husks and logged UNIQUE warnings (Bug 11 fix 1).
          await globalRepos.docMountDocuments.deleteByMountPointId(existing.id);
          await globalRepos.docMountBlobs.deleteByMountPointId(existing.id);
          await globalRepos.docMountChunks.deleteByMountPointId(existing.id);
          await globalRepos.docMountFiles.deleteByMountPointId(existing.id);
          await globalRepos.docMountFolders.deleteByMountPointId(existing.id);
          await globalRepos.docMountPoints.update(existing.id, {
            name: mp.name,
            basePath: mp.mountType === 'database' ? '' : mp.basePath,
            mountType: mp.mountType,
            storeType: mp.storeType ?? 'documents',
            includePatterns: mp.includePatterns,
            excludePatterns: mp.excludePatterns,
            enabled: mp.enabled,
          });
          idMap.set(mp.id, existing.id);
          counts.mountPoints++;
          continue;
        }
        // 'duplicate' — fall through to create a freshly-named, freshly-id'd
        // mount point (the archive id is already taken, so it can't be reused).
      }

      const name = nextUniqueMountPointName(
        takenNames,
        existing && options.conflictStrategy === 'duplicate' ? `${mp.name} (imported)` : mp.name
      );
      takenNames.add(name);
      // Preserve the archive's store id on create (Bug 11 fix 3) so a later
      // re-import is recognised as an overwrite of this store rather than
      // stranger-cloned every time. Only when the id is free — a 'duplicate'
      // import onto an id clash must mint a fresh id instead.
      const preserveArchiveId = !existing;
      const createOptions = getPreserveIdsCreateOptions(mp.id, options);
      const created = options.preserveIds
        ? await globalRepos.docMountPoints.create(
            {
              name,
              basePath: mp.mountType === 'database' ? '' : mp.basePath,
              mountType: mp.mountType,
              storeType: mp.storeType ?? 'documents',
              includePatterns: mp.includePatterns,
              excludePatterns: mp.excludePatterns,
              enabled: mp.enabled,
              lastScannedAt: null,
              scanStatus: 'idle',
              lastScanError: null,
              conversionStatus: 'idle',
              conversionError: null,
              fileCount: 0,
              chunkCount: 0,
              totalSizeBytes: 0,
            },
            createOptions
          )
        : await globalRepos.docMountPoints.create(
            {
              name,
              basePath: mp.mountType === 'database' ? '' : mp.basePath,
              mountType: mp.mountType,
              storeType: mp.storeType ?? 'documents',
              includePatterns: mp.includePatterns,
              excludePatterns: mp.excludePatterns,
              enabled: mp.enabled,
              lastScannedAt: null,
              scanStatus: 'idle',
              lastScanError: null,
              conversionStatus: 'idle',
              conversionError: null,
              fileCount: 0,
              chunkCount: 0,
              totalSizeBytes: 0,
            },
            preserveArchiveId ? { id: mp.id } : undefined
          );
      idMap.set(mp.id, created.id);
      counts.mountPoints++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to import mount point "${mp.name}": ${msg}`);
      moduleLogger.warn('Failed to import mount point', { name: mp.name, error: msg });
    }
  }

  // Folders — database-backed only; filesystem/obsidian sources don't export folders.
  // Import folders before documents so document folderId FKs resolve correctly.
  //
  // Two lookup maps let later records resolve their folder in the target store:
  //  - folderIdBySourceId: source folder id → created folder id (exports carry
  //    `id` on folder records since F4; older bundles omit it);
  //  - folderIdByPath: (target mount, path) → created folder id, used to
  //    resolve parentId (folders arrive parent-first, shortest path first) and
  //    as the fallback for bundles that predate carried folder ids.
  // The folder namespace is case-insensitive, so path keys are lowercased.
  const folderIdBySourceId = new Map<string, string>();
  const folderIdByPath = new Map<string, string>();
  const folderPathKey = (mountId: string, path: string) => `${mountId}::${path.toLowerCase()}`;

  for (const folder of folders) {
    const targetMountId = idMap.get(folder.mountPointId);
    if (!targetMountId) continue;

    const rememberFolder = (createdId: string) => {
      if (folder.id) folderIdBySourceId.set(folder.id, createdId);
      folderIdByPath.set(folderPathKey(targetMountId, folder.path), createdId);
    };

    // Skip-if-present rehydrate (spec §6/F4): the folder survived the prune
    // at exactly this id — record it for path/parent resolution and move on.
    if (options.preserveIds && folder.id && idMaps.preserveIdsSkips.has(folder.id)) {
      rememberFolder(folder.id);
      continue;
    }

    try {
      // Under preserveIds the bundle's folder ids ARE the created ids, so the
      // verbatim parentId is simply correct — the parent row was created at
      // exactly that id one iteration earlier. Without preserveIds the source
      // parentId means nothing here; resolve the parent by path instead
      // (parent-first ordering guarantees it is already in the map).
      const preserveFolderId =
        options.preserveIds && folder.id ? { id: folder.id as string } : undefined;
      const parentPath = folder.path.includes('/')
        ? folder.path.slice(0, folder.path.lastIndexOf('/'))
        : '';
      const parentId = preserveFolderId
        ? folder.parentId ?? null
        : parentPath
          ? folderIdByPath.get(folderPathKey(targetMountId, parentPath)) ?? null
          : null;

      const created = await globalRepos.docMountFolders.create(
        {
          mountPointId: targetMountId,
          parentId,
          name: folder.name,
          path: folder.path,
        },
        preserveFolderId
      );
      rememberFolder(created.id);
      counts.folders++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to import folder "${folder.path}": ${msg}`);
    }
  }

  /**
   * Resolve a record's folder in the *target* store. The bundle's folderId is
   * a source-instance row id: it maps through folderIdBySourceId when the
   * bundle carried folder ids, and falls back to the containing directory of
   * the record's relativePath for older bundles. linkDocumentContent /
   * linkBlobContent derive folderId from relativePath as the single source of
   * truth regardless — this keeps the caller's value honest so the "caller
   * folderId disagrees" warning stays meaningful.
   */
  const resolveTargetFolderId = (
    sourceFolderId: string | null | undefined,
    relativePath: string,
    targetMountId: string
  ): string | null => {
    if (sourceFolderId) {
      const mapped = folderIdBySourceId.get(sourceFolderId);
      if (mapped) return mapped;
    }
    const dir = relativePath.includes('/')
      ? relativePath.slice(0, relativePath.lastIndexOf('/'))
      : '';
    return dir ? folderIdByPath.get(folderPathKey(targetMountId, dir)) ?? null : null;
  };

  // Documents — database-backed only; filesystem/obsidian sources keep their
  // documents on disk.
  //
  // Hard-link groups are re-established in a second pass, keyed by the group id
  // the export carried. The imported ids are never reused directly: they are
  // only a grouping token here, and re-binding through bindLinkGroup mints a
  // fresh id, so importing the same archive twice can't fuse the two copies
  // into one group.
  const membersByExportedGroup = new Map<string, string[]>();

  for (const doc of documents) {
    const targetMountId = idMap.get(doc.mountPointId);
    if (!targetMountId) continue;

    // Skip-if-present rehydrate (spec §6/F4): this link survived the prune —
    // the live row wins over the bundle's copy.
    if (options.preserveIds && doc.linkId && idMaps.preserveIdsSkips.has(doc.linkId)) {
      idMaps.docMountFileLinks.set(doc.linkId, doc.linkId);
      continue;
    }

    try {
      // linkDocumentContent handles file + document + link in one shot. Under
      // preserveIds the bundle's carried row ids are claimed (they are only
      // honored for rows actually created — content-addressed dedup wins).
      const { link } = await globalRepos.docMountFileLinks.linkDocumentContent({
        mountPointId: targetMountId,
        relativePath: doc.relativePath,
        fileName: doc.fileName,
        folderId: resolveTargetFolderId(doc.folderId, doc.relativePath, targetMountId),
        fileType: doc.fileType,
        content: doc.content,
        contentSha256: doc.contentSha256,
        plainTextLength: doc.plainTextLength,
        fileSizeBytes: Buffer.byteLength(doc.content, 'utf-8'),
        ...(options.preserveIds
          ? { fileId: doc.fileId ?? undefined, linkId: doc.linkId ?? undefined }
          : {}),
      });
      if (doc.linkId) {
        idMaps.docMountFileLinks.set(doc.linkId, link.id);
      }
      if (doc.linkGroupId) {
        const existing = membersByExportedGroup.get(doc.linkGroupId);
        if (existing) existing.push(link.id);
        else membersByExportedGroup.set(doc.linkGroupId, [link.id]);
      }
      counts.documents++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to import document "${doc.relativePath}": ${msg}`);
    }
  }

  // A group whose other members fell outside the export's scope arrives with a
  // single member and is simply left un-linked — a group of one is not a link.
  for (const [exportedGroupId, memberLinkIds] of membersByExportedGroup) {
    if (memberLinkIds.length < 2) continue;
    const [anchor, ...rest] = memberLinkIds;
    for (const memberId of rest) {
      try {
        await globalRepos.docMountFileLinks.bindLinkGroup(anchor, memberId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to restore hard link for group "${exportedGroupId}": ${msg}`);
      }
    }
  }

  // Blobs — universal across mount types.
  for (const blob of blobs) {
    const targetMountId = idMap.get(blob.mountPointId);
    if (!targetMountId) continue;

    // Skip-if-present rehydrate (spec §6/F4): the avatar blob and its link
    // survived the prune — the live rows win over the bundle's copy.
    if (options.preserveIds && blob.linkId && idMaps.preserveIdsSkips.has(blob.linkId)) {
      idMaps.docMountFileLinks.set(blob.linkId, blob.linkId);
      continue;
    }

    try {
      const data = Buffer.from(blob.dataBase64, 'base64');
      const created = await globalRepos.docMountBlobs.create({
        mountPointId: targetMountId,
        relativePath: blob.relativePath,
        originalFileName: blob.originalFileName,
        originalMimeType: blob.originalMimeType,
        storedMimeType: blob.storedMimeType,
        sha256: blob.sha256,
        description: blob.description,
        data,
        ...(options.preserveIds
          ? {
              fileId: blob.fileId ?? undefined,
              linkId: blob.linkId ?? undefined,
              blobId: blob.blobId ?? undefined,
            }
          : {}),
      });
      if (blob.linkId) {
        idMaps.docMountFileLinks.set(blob.linkId, created.linkId);
      }
      // Restore the extractedText sidecar on imports from 4.3-dev+ exports.
      // Older exports omit these fields; keep the blob in the default 'none'
      // state so on-upload extraction has nothing to re-run.
      const hasExtractionMetadata =
        blob.extractedText !== undefined ||
        blob.extractionStatus !== undefined ||
        blob.extractionError !== undefined;
      if (hasExtractionMetadata) {
        await globalRepos.docMountBlobs.updateExtractedText(created.id, {
          extractedText: blob.extractedText ?? null,
          extractedTextSha256: blob.extractedTextSha256 ?? null,
          extractionStatus: blob.extractionStatus ?? 'none',
          extractionError: blob.extractionError ?? null,
        });
      }
      counts.blobs++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to import blob "${blob.relativePath}": ${msg}`);
    }
  }

  // Project ↔ mount-point links — remap both IDs through the respective
  // maps. Projects are imported earlier in the pipeline so idMaps.projects
  // is already populated by the time we get here. Skip any link whose
  // project or mount point didn't survive the import.
  const existingLinks = projectLinks.length > 0
    ? await globalRepos.projectDocMountLinks.findAll()
    : [];
  const existingLinkKeys = new Set(
    existingLinks.map(l => `${l.projectId}::${l.mountPointId}`)
  );
  for (const link of projectLinks) {
    const targetMountId = idMap.get(link.mountPointId);
    const targetProjectId = idMaps.projects.get(link.projectId);
    if (!targetMountId || !targetProjectId) {
      continue;
    }
    const key = `${targetProjectId}::${targetMountId}`;
    if (existingLinkKeys.has(key)) {
      // Already linked after an overwrite/skip on an existing mount point.
      continue;
    }
    try {
      await globalRepos.projectDocMountLinks.create({
        projectId: targetProjectId,
        mountPointId: targetMountId,
      });
      existingLinkKeys.add(key);
      counts.projectLinks++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(
        `Failed to link project ${targetProjectId} to mount point ${targetMountId}: ${msg}`
      );
    }
  }

  return counts;
}
