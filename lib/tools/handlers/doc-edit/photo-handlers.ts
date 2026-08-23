/**
 * Photo Album Tool Handlers (keep_image / list_images / attach_image)
 *
 * Photos are documents in the character vault — a `photos/` subfolder in the
 * character's mount point. `keep_image` makes a hard link to an existing
 * image binary (dedup by sha256) and writes a Markdown context document
 * (prompt + scene snapshot + caption + tags) as the link's extractedText,
 * so the standard character-vault search picks it up. `list_images` is a
 * thin facade over the existing search infrastructure. `attach_image`
 * resurfaces a kept image into the current outgoing message.
 *
 * @module tools/handlers/doc-edit/photo-handlers
 */

import type { KeepImageInput, KeepImageOutput } from '../../keep-image-tool';
import type { ListImagesInput, ListImagesOutput, ListedImage } from '../../list-images-tool';
import type { AttachImageInput, AttachedImageDescriptor } from '../../attach-image-tool';
import type { DescribeImageInput, DescribeImageOutput } from '../../describe-image-tool';
import type { DocMountFileLinkWithContent } from '@/lib/schemas/mount-index.types';
import { getRepositories } from '@/lib/repositories/factory';
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge';
import {
  parseKeptImageFrontmatter,
  basenameOfRelativePath,
} from '@/lib/photos/keep-image-markdown';
import { isPhotosRelativePath, PHOTOS_FOLDER } from '@/lib/photos/photos-paths';
import { saveImageToAlbum, SaveImageToAlbumError } from '@/lib/photos/save-image-to-album';
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service';
import { searchDocumentChunks } from '@/lib/mount-index/document-search';
import {
  logger,
  type DocEditToolContext,
  collectPeerCharacterIdsForReads,
} from './shared';

// ============================================================================
// Photo Album Tools (keep_image / list_images / attach_image)
//
// Photos are documents in the character vault — a `photos/` subfolder in the
// character's mount point. `keep_image` makes a hard link to an existing
// image binary (dedup by sha256) and writes a Markdown context document
// (prompt + scene snapshot + caption + tags) as the link's extractedText,
// so the standard character-vault search picks it up. `list_images` is a
// thin facade over the existing search infrastructure. `attach_image`
// resurfaces a kept image into the current outgoing message.
// ============================================================================

interface ResolvedCharacterVault {
  characterId: string;
  characterName: string;
  mountPointId: string;
  mountPointName: string;
}

async function resolveActingCharacterVault(
  context: DocEditToolContext
): Promise<ResolvedCharacterVault | null> {
  if (!context.characterId) return null;
  const repos = getRepositories();
  const character = await repos.characters.findById(context.characterId);
  if (!character) return null;
  const vault = await getCharacterVaultStore(context.characterId);
  if (!vault) return null;
  return {
    characterId: character.id,
    characterName: character.name,
    mountPointId: vault.mountPointId,
    mountPointName: vault.mountPointName,
  };
}

async function findExistingPhotosLinkBySha(
  mountPointId: string,
  sha256: string
): Promise<{ id: string; relativePath: string; createdAt: string } | null> {
  const repos = getRepositories();
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  const collision = links.find(
    l => l.sha256 === sha256 && isPhotosRelativePath(l.relativePath)
  );
  if (!collision) return null;
  return {
    id: collision.id,
    relativePath: collision.relativePath,
    createdAt: collision.createdAt,
  };
}

export async function handleKeepImage(
  input: KeepImageInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: KeepImageOutput; error?: string; formattedText?: string }> {
  if (!context.characterId) {
    return { success: false, error: 'keep_image requires a character context' };
  }

  const vault = await resolveActingCharacterVault(context);
  if (!vault) {
    return {
      success: false,
      error: 'No database-backed character vault is linked to the acting character',
    };
  }

  try {
    const saved = await saveImageToAlbum({
      mountPointId: vault.mountPointId,
      fileId: input.uuid,
      caption: input.caption ?? null,
      tags: input.tags ?? [],
      chatId: context.chatId ?? null,
      attribution: {
        name: vault.characterName,
        id: vault.characterId,
        role: 'character',
      },
    });

    const result: KeepImageOutput = {
      success: true,
      mount_point: saved.mountPointName,
      relative_path: saved.relativePath,
      link_id: saved.linkId,
      kept_at: saved.keptAt,
      file_id: saved.fileId,
      sha256: saved.sha256,
    };
    const formattedCaption = input.caption ? ` ("${input.caption}")` : '';
    return {
      success: true,
      result,
      formattedText: `Kept image ${saved.fileId} as [${saved.mountPointName}] ${saved.relativePath}${formattedCaption}`,
    };
  } catch (err) {
    if (err instanceof SaveImageToAlbumError) {
      // Preserve the original keep_image wording so existing LLM behaviour
      // and any tests that match against the error string still pass.
      if (err.code === 'ALREADY_SAVED' && err.existingRelativePath && err.existingCreatedAt) {
        return {
          success: false,
          error: `Image already kept by ${vault.characterName} on ${err.existingCreatedAt} as ${err.existingRelativePath}`,
        };
      }
      return { success: false, error: err.message };
    }
    throw err;
  }
}

interface VisiblePhotoVault {
  characterId: string;
  characterName: string;
  mountPointId: string;
  mountPointName: string;
}

async function collectVisiblePhotoVaults(
  context: DocEditToolContext,
  selfVault: ResolvedCharacterVault
): Promise<VisiblePhotoVault[]> {
  const vaults: VisiblePhotoVault[] = [{
    characterId: selfVault.characterId,
    characterName: selfVault.characterName,
    mountPointId: selfVault.mountPointId,
    mountPointName: selfVault.mountPointName,
  }];

  // Honour the Shared Vaults + systemTransparency gate that the rest of the
  // doc-edit tools use for cross-character reads.
  const peerIds = await collectPeerCharacterIdsForReads(context);
  if (peerIds.length === 0) return vaults;

  const repos = getRepositories();
  for (const peerId of peerIds) {
    const peer = await repos.characters.findById(peerId);
    if (!peer) continue;
    if (peer.systemTransparency !== true) continue;
    const peerVault = await getCharacterVaultStore(peerId);
    if (!peerVault) continue;
    vaults.push({
      characterId: peer.id,
      characterName: peer.name,
      mountPointId: peerVault.mountPointId,
      mountPointName: peerVault.mountPointName,
    });
  }
  return vaults;
}

function buildListedImage(
  link: DocMountFileLinkWithContent,
  vault: VisiblePhotoVault,
  generationPromptExcerpt: string,
  relevanceScore?: number
): ListedImage {
  const meta = parseKeptImageFrontmatter(link.extractedText ?? null);
  const listed: ListedImage = {
    uuid: link.id,
    relative_path: link.relativePath,
    mount_point: vault.mountPointName,
    linked_by: meta.linkedBy,
    linked_by_id: meta.linkedById,
    kept_at: link.createdAt,
    caption: meta.caption,
    tags: meta.tags,
    generation_prompt_excerpt: generationPromptExcerpt,
  };
  if (relevanceScore !== undefined) {
    listed.relevance_score = relevanceScore;
  }
  return listed;
}

function matchesTagFilter(linkTags: string[], filter: string[] | undefined): boolean {
  if (!filter || filter.length === 0) return true;
  const lowered = new Set(linkTags.map(t => t.toLowerCase()));
  return filter.some(f => lowered.has(f.toLowerCase()));
}

function matchesSavedByFilter(
  meta: { linkedBy: string | null; linkedById: string | null },
  filter: string | undefined
): boolean {
  if (!filter) return true;
  const f = filter.toLowerCase();
  return (
    (meta.linkedBy?.toLowerCase() === f) ||
    (meta.linkedById?.toLowerCase() === f)
  );
}

function extractPromptExcerpt(extractedText: string | null | undefined): string {
  if (!extractedText) return '';
  // Body starts with "## Original prompt\n\n<prompt>\n\n..."; pluck the
  // paragraph between the heading and the next blank line / heading.
  const match = extractedText.match(/##\s+Original prompt\s*\n+([^\n][^\n]*(?:\n[^\n#][^\n]*)*)/);
  if (!match) return '';
  const para = match[1].trim();
  return para.length > 200 ? `${para.slice(0, 200).trimEnd()}…` : para;
}

export async function handleListImages(
  input: ListImagesInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: ListImagesOutput; error?: string; formattedText?: string }> {
  if (!context.characterId) {
    return { success: false, error: 'list_images requires a character context' };
  }

  const selfVault = await resolveActingCharacterVault(context);
  if (!selfVault) {
    return {
      success: false,
      error: 'No database-backed character vault is linked to the acting character',
    };
  }

  const vaults = await collectVisiblePhotoVaults(context, selfVault);
  const vaultByMountPoint = new Map(vaults.map(v => [v.mountPointId, v]));
  const mountPointIds = vaults.map(v => v.mountPointId);

  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const offset = Math.max(0, input.offset ?? 0);

  const repos = getRepositories();
  const trimmedQuery = input.query?.trim() ?? '';
  const tagsFilter = input.tags;
  const savedByFilter = input.saved_by;

  // Branch 1: semantic search across the visible vaults' photos/ folders.
  if (trimmedQuery.length > 0) {
    try {
      const embeddingResult = await generateEmbeddingForUser(trimmedQuery, context.userId);
      const overscan = Math.max(limit * 3, 30);
      const hits = await searchDocumentChunks(embeddingResult.embedding, {
        mountPointIds,
        pathPrefix: `${PHOTOS_FOLDER}/`,
        limit: overscan,
        minScore: 0.3,
        query: trimmedQuery,
        applyLiteralPhraseBoost: true,
      });

      const bestByLink = new Map<string, { score: number; mountPointId: string; relativePath: string }>();
      for (const hit of hits) {
        const existing = bestByLink.get(hit.fileId);
        if (!existing || hit.score > existing.score) {
          bestByLink.set(hit.fileId, {
            score: hit.score,
            mountPointId: hit.mountPointId,
            relativePath: hit.relativePath,
          });
        }
      }

      const matched: ListedImage[] = [];
      for (const [_linkId, entry] of bestByLink) {
        const vault = vaultByMountPoint.get(entry.mountPointId);
        if (!vault) continue;
        const link = await repos.docMountFileLinks.findByMountPointAndPath(
          entry.mountPointId,
          entry.relativePath
        );
        if (!link) continue;
        if (!isPhotosRelativePath(link.relativePath)) continue;
        const meta = parseKeptImageFrontmatter(link.extractedText ?? null);
        if (!matchesTagFilter(meta.tags, tagsFilter)) continue;
        if (!matchesSavedByFilter(meta, savedByFilter)) continue;
        const excerpt = extractPromptExcerpt(link.extractedText);
        matched.push(buildListedImage(link, vault, excerpt, entry.score));
      }

      matched.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
      const total = matched.length;
      const page = matched.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      const result: ListImagesOutput = { images: page, total, has_more: hasMore };
      const formatted = page.length === 0
        ? `No images matched query "${trimmedQuery}".`
        : page.map(img => formatListedImageLine(img)).join('\n');
      return { success: true, result, formattedText: formatted };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('list_images semantic branch failed; falling back to listing', {
        error: msg,
        characterId: context.characterId,
      });
      // Fall through to the listing branch on embedding/search failure.
    }
  }

  // Branch 2: plain listing of photos/ across visible vaults.
  const candidates: Array<{ link: DocMountFileLinkWithContent; vault: VisiblePhotoVault }> = [];
  for (const vault of vaults) {
    const links = await repos.docMountFileLinks.findByMountPointId(vault.mountPointId);
    for (const link of links) {
      if (!isPhotosRelativePath(link.relativePath)) continue;
      candidates.push({ link, vault });
    }
  }

  candidates.sort((a, b) => b.link.createdAt.localeCompare(a.link.createdAt));

  const filtered: ListedImage[] = [];
  for (const { link, vault } of candidates) {
    const meta = parseKeptImageFrontmatter(link.extractedText ?? null);
    if (!matchesTagFilter(meta.tags, tagsFilter)) continue;
    if (!matchesSavedByFilter(meta, savedByFilter)) continue;
    const excerpt = extractPromptExcerpt(link.extractedText);
    filtered.push(buildListedImage(link, vault, excerpt));
  }

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  const result: ListImagesOutput = { images: page, total, has_more: hasMore };
  const formatted = page.length === 0
    ? 'No images saved yet.'
    : page.map(img => formatListedImageLine(img)).join('\n');
  return { success: true, result, formattedText: formatted };
}

function formatListedImageLine(img: ListedImage): string {
  const score = img.relevance_score !== undefined ? ` [score ${img.relevance_score.toFixed(2)}]` : '';
  const tags = img.tags.length > 0 ? ` [${img.tags.join(', ')}]` : '';
  const caption = img.caption ? `: ${img.caption}` : '';
  return `  ${img.uuid}  ${img.relative_path}  (kept by ${img.linked_by ?? 'unknown'})${score}${tags}${caption}`;
}

export async function handleAttachImage(
  input: AttachImageInput,
  context: DocEditToolContext
): Promise<{
  success: boolean;
  result?: AttachedImageDescriptor[];
  error?: string;
  formattedText?: string;
}> {
  if (!context.characterId) {
    return { success: false, error: 'attach_image requires a character context' };
  }

  const vault = await resolveActingCharacterVault(context);
  if (!vault) {
    return {
      success: false,
      error: 'No database-backed character vault is linked to the acting character',
    };
  }

  const repos = getRepositories();

  // Try the uuid as a link id first; fall back to an image-v2 file uuid that
  // resolves to a link in *this* character's vault by sha256.
  let link = await repos.docMountFileLinks.findByIdWithContent(input.uuid);

  if (!link) {
    const { getImageById } = await import('@/lib/images-v2');
    const fallbackFileEntry = await getImageById(input.uuid);
    if (fallbackFileEntry && fallbackFileEntry.category === 'IMAGE') {
      const collision = await findExistingPhotosLinkBySha(vault.mountPointId, fallbackFileEntry.sha256);
      if (collision) {
        link = await repos.docMountFileLinks.findByIdWithContent(collision.id);
      }
    }
  }

  if (!link) {
    return {
      success: false,
      error: `No kept image found for uuid ${input.uuid} in ${vault.characterName}'s vault. attach_image only shows images you have already filed with keep_image — file it first if you want to hold it up again. If what you actually wanted was to see what the image depicts, call describe_image with this uuid instead; it does not require the image to be in your album.`,
    };
  }

  // Attach is scoped to the caller's own vault. Cross-character attach
  // requires that character to keep_image first into their own album.
  if (link.mountPointId !== vault.mountPointId) {
    return {
      success: false,
      error: `Image ${link.id} lives in another character's vault — keep it in your own photos folder first`,
    };
  }
  if (!isPhotosRelativePath(link.relativePath)) {
    return {
      success: false,
      error: `Link ${link.id} is not a kept image (path: ${link.relativePath})`,
    };
  }

  const meta = parseKeptImageFrontmatter(link.extractedText ?? null);
  const filename = basenameOfRelativePath(link.relativePath);
  const filepath = `/api/v1/mount-points/${link.mountPointId}/blobs/${encodeURI(link.relativePath)}`;

  // Width/height aren't recorded on the mount-index link; opportunistically
  // join from image-v2 by sha256 so the chat UI can lay out the bubble.
  let width: number | undefined;
  let height: number | undefined;
  try {
    const sisters = await repos.files.findBySha256(link.sha256);
    const sister = sisters[0];
    if (sister?.width != null) width = sister.width;
    if (sister?.height != null) height = sister.height;
  } catch {
    /* best effort — descriptors without dimensions still render */
  }

  const descriptor: AttachedImageDescriptor = {
    id: link.id,
    filename,
    filepath,
    mimeType: link.originalMimeType ?? 'application/octet-stream',
    size: link.fileSizeBytes,
    width,
    height,
    sha256: link.sha256,
  };

  logger.info('Attached kept image', {
    linkId: link.id,
    mountPointId: link.mountPointId,
    relativePath: link.relativePath,
    characterId: vault.characterId,
  });

  const captionFragment = meta.caption ? ` ("${meta.caption}")` : '';
  const tagsFragment = meta.tags.length > 0 ? ` [${meta.tags.join(', ')}]` : '';
  return {
    success: true,
    result: [descriptor],
    formattedText: `Attached ${filename} kept by ${meta.linkedBy ?? vault.characterName}${captionFragment}${tagsFragment}`,
  };
}

// ============================================================================
// describe_image — the looking verb.
//
// Resolves any handle a character might be holding (image-v2 file uuid,
// generate_image id, Librarian catalogue handle, or an album link uuid) to a
// FileEntry, then answers with the best description available, spending a
// vision call only when there isn't one. See bug 92 for why this exists: the
// photo tools were all custodial, so models reached for attach_image to look
// at things and were told to file them instead.
// ============================================================================

/**
 * Resolve a describe_image uuid to its image-v2 FileEntry. Accepts a file
 * uuid directly, or a doc_mount_file_links id whose sha256 identifies the
 * bytes. Album membership is deliberately NOT required — a character may want
 * to look at an image they have not filed, which was the whole trap.
 */
async function resolveDescribableFileEntry(uuid: string) {
  const repos = getRepositories();
  const { getImageById } = await import('@/lib/images-v2');

  const direct = await getImageById(uuid);
  if (direct && direct.category === 'IMAGE') return direct;

  const link = await repos.docMountFileLinks.findByIdWithContent(uuid);
  if (link?.sha256) {
    const sisters = await repos.files.findBySha256(link.sha256);
    const sister = sisters.find(f => f.category === 'IMAGE') ?? sisters[0];
    if (sister) return sister;
  }
  return null;
}

export async function handleDescribeImage(
  input: DescribeImageInput,
  context: DocEditToolContext
): Promise<{
  success: boolean;
  result?: DescribeImageOutput;
  error?: string;
  formattedText?: string;
}> {
  const entry = await resolveDescribableFileEntry(input.uuid);
  if (!entry) {
    return {
      success: false,
      error: `No image found for uuid ${input.uuid}. Use the uuid from the Librarian's upload announcement, the id generate_image returned, or a uuid from list_images.`,
    };
  }
  if (!entry.mimeType?.startsWith('image/')) {
    return {
      success: false,
      error: `${entry.originalFilename} is not an image (${entry.mimeType}).`,
    };
  }

  const base = {
    file_id: entry.id,
    filename: entry.originalFilename,
    mime_type: entry.mimeType,
    width: entry.width ?? undefined,
    height: entry.height ?? undefined,
  };

  const respond = (
    description: string,
    source: DescribeImageOutput['source']
  ) => {
    logger.info('Described image for character', {
      fileEntryId: entry.id,
      characterId: context.characterId,
      source,
      descriptionLength: description.length,
    });
    return {
      success: true,
      result: { ...base, description, source },
      formattedText: `${entry.originalFilename}:\n\n${description}`,
    };
  };

  // 1. A description stored at upload time — the common case, and free.
  const stored = entry.description?.trim();
  if (stored) return respond(stored, 'stored-description');

  // 2. Quilltap generated it, so the prompt that made it is the most faithful
  //    account available, and also free.
  const prompt = entry.generationRevisedPrompt?.trim() || entry.generationPrompt?.trim();
  if (prompt) return respond(prompt, 'generation-prompt');

  // 3. Nothing on file: describe it now. This persists onto the FileEntry and
  //    its blank links, so the next caller lands in case 1.
  const repos = getRepositories();
  const { autoDescribeChatImageAttachment } = await import('@/lib/photos/auto-describe-attachment');
  const result = await autoDescribeChatImageAttachment({
    fileEntryId: entry.id,
    userId: context.userId,
    repos,
  });

  if (result.description) return respond(result.description, 'vision-call');

  // `already-described` means another writer won the race between our read
  // and this call — re-read rather than reporting a failure.
  if (result.skipReason === 'already-described') {
    const fresh = (await repos.files.findById(entry.id))?.description?.trim();
    if (fresh) return respond(fresh, 'stored-description');
  }

  return {
    success: false,
    error: `Could not describe ${entry.originalFilename}: the vision describer produced nothing (${result.skipReason ?? 'unknown reason'}). Check Settings → Chat → Image Description Profile.`,
  };
}
