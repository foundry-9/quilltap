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
import type { ImportOptions, IdMappingState, DocumentStoreImportCounts } from './types';
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
  const byName = new Map(existingStores.map(s => [s.name.toLowerCase(), s]));
  // Store names are one case-insensitive namespace; track every name we see
  // (pre-existing + created this run) so neither a clash with an existing
  // store nor a duplicate inside the import payload mints a colliding name.
  const takenNames = new Set(existingStores.map(s => s.name));

  for (const mp of mountPoints) {
    try {
      const existing = byName.get(mp.name.toLowerCase());
      if (existing) {
        if (options.conflictStrategy === 'skip') {
          idMap.set(mp.id, existing.id);
          continue;
        }
        if (options.conflictStrategy === 'overwrite') {
          // Drop existing documents, blobs, files, chunks before replacing.
          await globalRepos.docMountDocuments.deleteByMountPointId(existing.id);
          await globalRepos.docMountBlobs.deleteByMountPointId(existing.id);
          await globalRepos.docMountChunks.deleteByMountPointId(existing.id);
          await globalRepos.docMountFiles.deleteByMountPointId(existing.id);
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
        // 'duplicate' — fall through to create a freshly-named mount point.
      }

      const name = nextUniqueMountPointName(
        takenNames,
        existing && options.conflictStrategy === 'duplicate' ? `${mp.name} (imported)` : mp.name
      );
      takenNames.add(name);
      const created = await globalRepos.docMountPoints.create({
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
      });
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
  for (const folder of folders) {
    const targetMountId = idMap.get(folder.mountPointId);
    if (!targetMountId) continue;
    try {
      // Remap parentId if it exists
      let remappedParentId = folder.parentId;
      if (folder.parentId) {
        // Parent ID remapping: not applicable here since folder IDs are assigned new ones
        // For now, we'll create the folder structure but leave parentId as imported
        // The backfill process will handle this on first access
      }

      await globalRepos.docMountFolders.create({
        mountPointId: targetMountId,
        parentId: remappedParentId,
        name: folder.name,
        path: folder.path,
      });
      counts.folders++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to import folder "${folder.path}": ${msg}`);
    }
  }

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
    try {
      // linkDocumentContent handles file + document + link in one shot.
      const { link } = await globalRepos.docMountFileLinks.linkDocumentContent({
        mountPointId: targetMountId,
        relativePath: doc.relativePath,
        fileName: doc.fileName,
        folderId: doc.folderId ?? null,
        fileType: doc.fileType,
        content: doc.content,
        contentSha256: doc.contentSha256,
        plainTextLength: doc.plainTextLength,
        fileSizeBytes: Buffer.byteLength(doc.content, 'utf-8'),
      });
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
      });
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
