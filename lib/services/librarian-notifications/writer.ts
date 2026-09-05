/**
 * Writer for Document Mode chat notifications (the Librarian).
 *
 * When a document is opened in Document Mode or saved from the editor, this
 * helper injects a synthetic ASSISTANT-role chat message announcing the event
 * on behalf of the Librarian. Characters see the announcement in their recent
 * history and know the document is available (and who opened it), without the
 * user losing their turn to the LLM.
 *
 * Kinds of announcements:
 *   - 'opened-by-user'       → user-initiated Document Mode open
 *   - 'opened-by-character'  → character-initiated via the `doc_open_document` tool
 *   - 'saved'                → user autosave/manual-save from the editor (includes unified diff)
 *   - 'renamed'              → user-initiated rename via the Document Mode title input
 *   - 'deleted'              → file removed (user Delete button, or character `doc_delete_file` tool)
 *   - 'folder-created'       → character `doc_create_folder` tool
 *   - 'folder-deleted'       → character `doc_delete_folder` tool
 *   - 'created-by-*'         → a `doc_write_file` that brought a new file into being (reports its contents)
 *   - 'edited-by-*'          → an in-place content edit (`doc_write_file` overwrite, `doc_str_replace`,
 *                              `doc_insert_text`, `doc_update_frontmatter`, `doc_update_heading`) — includes a diff
 *   - 'moved-by-*'           → `doc_move_file` / `doc_move_folder` (move or rename)
 *   - 'copied-by-*'          → `doc_copy_file` (cross-store copy)
 *   - 'blob-written-by-*'    → `doc_write_blob` (a binary asset filed)
 *   The `-by-*` suffix is `-by-user` or `-by-character`, per the acting origin.
 *
 * Errors never propagate — document operations must never fail because an
 * announcement couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { formatScopedUri, formatSelfUri, formatDocStoreUri } from '@/lib/doc-edit/qtap-uri';
import { policyFromContent } from '@/lib/doc-edit/document-policy';
import type { MessageEvent } from '@/lib/schemas/types';

// ---------------------------------------------------------------------------
// Suppression for character_read:false documents.
//
// A document hidden from characters (`character_read: false`) must never be the
// subject of a Librarian announcement — the announcements are chat messages
// characters see, so even a "saved"/"renamed"/"deleted" note would leak the
// hidden document's existence (and, for writes, its contents) to them. Only the
// operator can touch such a document in the first place (characters are blocked
// by the doc_ gates), so this is the matching gate on the announcement side.
//
// Two helpers because the source of truth differs by timing:
//   - writes derive it from the content just written (the link's persisted
//     policy may lag behind the async reindex, and a brand-new hidden file has
//     no link row yet);
//   - moves / copies / deletes / opens / renames derive it from the already-
//     indexed link row (capture it BEFORE a destructive op, while the link
//     still exists).
// ---------------------------------------------------------------------------

/** True when a document's own frontmatter hides it from characters. Pure. */
export function contentHiddenFromCharacters(content: string): boolean {
  return !policyFromContent(content).characterRead;
}

/**
 * True when the indexed document at (mountPointId, relativePath) is
 * `character_read:false`. Returns false for non-mount scopes, missing links,
 * or any lookup error — an announcement is never blocked by a transient fault.
 */
export async function documentHiddenFromCharacters(
  mountPointId: string | null | undefined,
  relativePath: string | null | undefined,
): Promise<boolean> {
  if (!mountPointId || !relativePath) return false;
  try {
    const repos = getRepositories();
    const link = await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, relativePath);
    return link?.allowCharacterRead === false;
  } catch {
    return false;
  }
}

export type LibrarianOpenKind =
  | { kind: 'opened-by-user' }
  | { kind: 'opened-by-character'; characterName: string };

/**
 * Who initiated a destructive or structural change.
 * Shared by delete / folder-create / folder-delete announcements.
 */
export type LibrarianActorOrigin =
  | { kind: 'by-user' }
  | { kind: 'by-character'; characterName: string };

/**
 * The open announcement predates {@link LibrarianActorOrigin} and keeps its
 * own `opened-by-*` kinds; this is the one place the two vocabularies meet.
 */
export function toLibrarianOpenKind(origin: LibrarianActorOrigin): LibrarianOpenKind {
  return origin.kind === 'by-character'
    ? { kind: 'opened-by-character', characterName: origin.characterName }
    : { kind: 'opened-by-user' };
}

export interface LibrarianOpenAnnouncement {
  chatId: string;
  displayTitle: string;
  filePath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  isNew: boolean;
  origin: LibrarianOpenKind;
  /** When true, suppress the announcement (the document is character_read:false). */
  hiddenFromCharacters?: boolean;
}

export interface LibrarianDeleteAnnouncement {
  chatId: string;
  displayTitle: string;
  filePath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  origin: LibrarianActorOrigin;
  /** When true, suppress the announcement (the document is character_read:false). */
  hiddenFromCharacters?: boolean;
}

export interface LibrarianFolderCreatedAnnouncement {
  chatId: string;
  folderPath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  origin: LibrarianActorOrigin;
}

export interface LibrarianFolderDeletedAnnouncement {
  chatId: string;
  folderPath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  origin: LibrarianActorOrigin;
}

export interface LibrarianSaveAnnouncement {
  chatId: string;
  /** Pre-formatted diff content (from formatAutosaveNotification) — caller owns the diff */
  diffContent: string;
  /** When true, suppress the announcement (the document is character_read:false). */
  hiddenFromCharacters?: boolean;
}

export interface LibrarianRenameAnnouncement {
  chatId: string;
  oldDisplayTitle: string;
  newDisplayTitle: string;
  oldFilePath: string;
  newFilePath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  /** When true, suppress the announcement (the document is character_read:false). */
  hiddenFromCharacters?: boolean;
}

/**
 * Announcement that the user has pinned a Scriptorium document-store file
 * to the chat for the LLM to consult. The doc_mount_files row id rides on
 * the synthetic message's `attachments` so the existing assistant-attachment
 * walker surfaces the bytes to the next character turn — text excerpts go
 * through fallback, images go to vision providers natively.
 *
 * For images, an optional `description` is woven into the announcement body
 * so non-vision providers (which would otherwise see only the announcement
 * sentence and silently drop the bytes) still know what was placed before
 * them. The description is generated from the image once at attach time and
 * cached on `doc_mount_blobs.description`.
 */
export interface LibrarianAttachAnnouncement {
  chatId: string;
  displayTitle: string;
  filePath: string;
  mountPoint?: string | null;
  /**
   * `doc_mount_file_links.id` of the attached file — the same id placed on
   * the announcement message's `attachments` array, and the id LLMs are
   * invited to pass to `keep_image` / `attach_image`. (The field was named
   * `mountFileId` historically but the route resolves via
   * `findByMountPointAndPath`, which returns a link row.)
   */
  mountFileId: string;
  /** MIME type (storedMimeType from the blob row) */
  mimeType: string;
  /**
   * Description body to include after the lead sentence. For images in a
   * `photos/` folder this is built from the kept-image markdown
   * (generation prompt + scene state + caption); for other mount files
   * it's the cached / freshly-generated vision-LLM description. Empty
   * when neither source has anything to say.
   */
  description?: string;
}

/**
 * Single canonical qtap:// URI for a Librarian-announced document, built from
 * the scope/mountPoint/path the announcement already carries — replacing the
 * old three-part `path/scope/mount_point` detail string. `mountPoint` may be
 * the reserved 'self' literal (a character acting on its own vault).
 */
function librarianUri(
  scope: 'project' | 'document_store' | 'general',
  mountPoint: string | null | undefined,
  path: string,
): string {
  if (scope === 'project' || scope === 'general') return formatScopedUri(scope, path);
  if (!mountPoint || mountPoint.toLowerCase() === 'self') return formatSelfUri(path);
  return formatDocStoreUri({ mountPointName: mountPoint, mountPointId: '', path });
}

function scopeLabel(scope: 'project' | 'document_store' | 'general', mountPoint?: string | null): string {
  if (scope === 'document_store' && mountPoint) {
    return `the document store "${mountPoint}"`;
  }
  if (scope === 'project') {
    return 'the project library';
  }
  return 'the general library';
}

function requesterLabel(origin: LibrarianOpenKind): string {
  return origin.kind === 'opened-by-user'
    ? "the user's request"
    : `${origin.characterName}'s request`;
}

function actorLabel(origin: LibrarianActorOrigin): string {
  return origin.kind === 'by-user'
    ? "the user's instruction"
    : `${origin.characterName}'s instruction`;
}

export function buildOpenContent(params: LibrarianOpenAnnouncement): string {
  const { displayTitle, filePath, scope, mountPoint, isNew, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = requesterLabel(origin);
  const pathDetails = librarianUri(scope, mountPoint, filePath);

  if (isNew) {
    return `The Librarian has laid out a fresh, blank page titled "${displayTitle}" upon the table at ${who}. You may use doc_read_file and the other doc_* editing tools to read or amend it (${pathDetails}).`;
  }
  return `The Librarian has set out "${displayTitle}" from ${where} at ${who}. You may use doc_read_file and the other doc_* editing tools to consult or revise it (${pathDetails}).`;
}

export function buildOpenOpaqueContent(params: LibrarianOpenAnnouncement): string {
  const { displayTitle, filePath, scope, mountPoint, isNew, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = origin.kind === 'opened-by-user' ? "the user's request" : `${origin.characterName}'s request`;
  const pathDetails = librarianUri(scope, mountPoint, filePath);

  if (isNew) {
    return `Document created: "${displayTitle}" — opened blank at ${who}. Use doc_read_file and the other doc_* editing tools to read or amend it (${pathDetails}).`;
  }
  return `Document opened: "${displayTitle}" from ${where} at ${who}. Use doc_read_file and the other doc_* editing tools to consult or revise it (${pathDetails}).`;
}

export function buildRenameContent(params: LibrarianRenameAnnouncement): string {
  const { oldDisplayTitle, newDisplayTitle, oldFilePath, newFilePath, scope, mountPoint } = params;
  const where = scopeLabel(scope, mountPoint);
  const pathDetails = `was ${librarianUri(scope, mountPoint, oldFilePath)}, now ${librarianUri(scope, mountPoint, newFilePath)}`;
  return `The Librarian has rechristened the volume formerly catalogued as "${oldDisplayTitle}" in ${where} — it now answers to "${newDisplayTitle}", and the card in the catalogue has been amended to suit. Subsequent references should use the new name (${pathDetails}).`;
}

export function buildRenameOpaqueContent(params: LibrarianRenameAnnouncement): string {
  const { oldDisplayTitle, newDisplayTitle, oldFilePath, newFilePath, scope, mountPoint } = params;
  const where = scopeLabel(scope, mountPoint);
  const pathDetails = `was ${librarianUri(scope, mountPoint, oldFilePath)}, now ${librarianUri(scope, mountPoint, newFilePath)}`;
  return `Document renamed in ${where}: "${oldDisplayTitle}" → "${newDisplayTitle}". Subsequent references should use the new name (${pathDetails}).`;
}

export function buildSaveContent(diffContent: string): string {
  // diffContent is the pre-formatted "I've made changes to …\n```diff…```" from formatAutosaveNotification.
  // Strip the leading "I've made changes to" phrasing and re-attribute to the Librarian so the LLM
  // doesn't think the user spoke a turn.
  const rephrased = diffContent.replace(/^I've made changes to (".+?"):/, 'The Librarian has filed the following alterations to $1:');
  if (rephrased === diffContent) {
    // Fallback in case the prefix didn't match — prepend Librarian framing.
    return `The Librarian has filed the following alterations:\n\n${diffContent}`;
  }
  return rephrased;
}

export function buildSaveOpaqueContent(diffContent: string): string {
  const rephrased = diffContent.replace(/^I've made changes to (".+?"):/, 'The following changes were filed to $1:');
  if (rephrased === diffContent) {
    return `The following changes were filed:\n\n${diffContent}`;
  }
  return rephrased;
}

async function postLibrarianMessage(
  chatId: string,
  content: string,
  opaqueContent: string | null,
  kindLabel: string,
  attachments: string[] = [],
  targetParticipantIds: string[] | null = null,
  summaryAnchor: { compactionGeneration: number } | null = null,
): Promise<MessageEvent | null> {
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments,
      createdAt: now,
      participantId: null,
      systemSender: 'librarian',
      systemKind: kindLabel,
      targetParticipantIds: targetParticipantIds && targetParticipantIds.length > 0 ? targetParticipantIds : null,
      summaryAnchor: summaryAnchor ?? null,
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[LibrarianNotification] Announcement posted', {
      context: 'librarian-notifications',
      chatId,
      messageId,
      kindLabel,
      attachmentCount: attachments.length,
      targetParticipantIds,
    });

    return message;
  } catch (error) {
    logger.error('[LibrarianNotification] Failed to post announcement', {
      context: 'librarian-notifications',
      chatId,
      kindLabel,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export async function postLibrarianOpenAnnouncement(
  params: LibrarianOpenAnnouncement,
): Promise<MessageEvent | null> {
  if (params.hiddenFromCharacters) return null;
  const content = buildOpenContent(params);
  const opaqueContent = buildOpenOpaqueContent(params);
  const kindLabel = params.origin.kind;
  return postLibrarianMessage(params.chatId, content, opaqueContent, kindLabel);
}

export async function postLibrarianSaveAnnouncement(
  params: LibrarianSaveAnnouncement,
): Promise<MessageEvent | null> {
  if (params.hiddenFromCharacters) return null;
  if (!params.diffContent || !params.diffContent.trim()) {
    return null;
  }
  const content = buildSaveContent(params.diffContent);
  const opaqueContent = buildSaveOpaqueContent(params.diffContent);
  return postLibrarianMessage(params.chatId, content, opaqueContent, 'saved');
}

export async function postLibrarianRenameAnnouncement(
  params: LibrarianRenameAnnouncement,
): Promise<MessageEvent | null> {
  if (params.hiddenFromCharacters) return null;
  const content = buildRenameContent(params);
  const opaqueContent = buildRenameOpaqueContent(params);
  return postLibrarianMessage(params.chatId, content, opaqueContent, 'renamed');
}

export function buildDeleteContent(params: LibrarianDeleteAnnouncement): string {
  const { displayTitle, filePath, scope, mountPoint, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = actorLabel(origin);
  const pathDetails = librarianUri(scope, mountPoint, filePath);
  return `The Librarian has removed "${displayTitle}" from ${where} at ${who}. The volume is gone from the shelves, and its card struck from the catalogue (${pathDetails}).`;
}

export function buildDeleteOpaqueContent(params: LibrarianDeleteAnnouncement): string {
  const { displayTitle, filePath, scope, mountPoint, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = origin.kind === 'by-user' ? "the user's instruction" : `${origin.characterName}'s instruction`;
  const pathDetails = librarianUri(scope, mountPoint, filePath);
  return `Document removed: "${displayTitle}" from ${where} at ${who} (${pathDetails}).`;
}

export function buildFolderCreatedContent(params: LibrarianFolderCreatedAnnouncement): string {
  const { folderPath, scope, mountPoint, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = actorLabel(origin);
  const pathDetails = librarianUri(scope, mountPoint, folderPath);
  return `The Librarian has set aside a fresh shelf for "${folderPath}" in ${where} at ${who} — a new folder, presently empty, awaiting its tenants (${pathDetails}).`;
}

export function buildFolderCreatedOpaqueContent(params: LibrarianFolderCreatedAnnouncement): string {
  const { folderPath, scope, mountPoint, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = origin.kind === 'by-user' ? "the user's instruction" : `${origin.characterName}'s instruction`;
  const pathDetails = librarianUri(scope, mountPoint, folderPath);
  return `Folder created: "${folderPath}" in ${where} at ${who} — currently empty (${pathDetails}).`;
}

export function buildFolderDeletedContent(params: LibrarianFolderDeletedAnnouncement): string {
  const { folderPath, scope, mountPoint, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = actorLabel(origin);
  const pathDetails = librarianUri(scope, mountPoint, folderPath);
  return `The Librarian has dismantled the empty shelf at "${folderPath}" in ${where} at ${who}. The folder has been cleared from the catalogue (${pathDetails}).`;
}

export function buildFolderDeletedOpaqueContent(params: LibrarianFolderDeletedAnnouncement): string {
  const { folderPath, scope, mountPoint, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = origin.kind === 'by-user' ? "the user's instruction" : `${origin.characterName}'s instruction`;
  const pathDetails = librarianUri(scope, mountPoint, folderPath);
  return `Folder removed: "${folderPath}" in ${where} at ${who} (${pathDetails}).`;
}

export async function postLibrarianDeleteAnnouncement(
  params: LibrarianDeleteAnnouncement,
): Promise<MessageEvent | null> {
  if (params.hiddenFromCharacters) return null;
  const content = buildDeleteContent(params);
  const opaqueContent = buildDeleteOpaqueContent(params);
  const kindLabel = params.origin.kind === 'by-user' ? 'deleted-by-user' : 'deleted-by-character';
  return postLibrarianMessage(params.chatId, content, opaqueContent, kindLabel);
}

export async function postLibrarianFolderCreatedAnnouncement(
  params: LibrarianFolderCreatedAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildFolderCreatedContent(params);
  const opaqueContent = buildFolderCreatedOpaqueContent(params);
  const kindLabel = params.origin.kind === 'by-user' ? 'folder-created-by-user' : 'folder-created-by-character';
  return postLibrarianMessage(params.chatId, content, opaqueContent, kindLabel);
}

function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/');
}

/**
 * Trailer that names the link id and tells the LLM what it can do with it.
 * Mirrors the upload announcement (`buildUploadContent`) so characters can
 * call `keep_image` or `attach_image` on a Librarian-attached photo just as
 * they would on a user-uploaded one.
 */
function attachIdHint(linkId: string, isImage: boolean): string {
  if (!isImage) {
    return `Catalogue handle: \`${linkId}\`.`;
  }
  return `The illustration is catalogued under uuid \`${linkId}\` — call describe_image with it to be told what it depicts, file it in your own album with keep_image, or hold it up to the room again later with attach_image.`;
}

export function buildAttachContent(params: LibrarianAttachAnnouncement): string {
  const { displayTitle, filePath, mountPoint, mimeType, description, mountFileId } = params;
  const where = mountPoint ? `the document store "${mountPoint}"` : 'the document store';
  const pathDetails = librarianUri('document_store', mountPoint, filePath);
  const isImage = isImageMime(mimeType);
  const kindPhrase = isImage
    ? `the illustration "${displayTitle}"`
    : `the volume "${displayTitle}"`;
  const lead = `The user has bid the Librarian set ${kindPhrase} from ${where} upon the table for your perusal — please consult it as part of your reply (${pathDetails}).`;
  const handle = attachIdHint(mountFileId, isImage);
  // Splice the description into the announcement body for the benefit of
  // non-vision providers that would otherwise see only the lead sentence.
  // Vision providers see both the description text *and* the image bytes.
  const trimmed = description?.trim();
  if (trimmed) {
    return `${lead}\n\n${handle}\n\nThe Librarian's catalogue describes the illustration thus:\n\n${trimmed}`;
  }
  return `${lead}\n\n${handle}`;
}

export function buildAttachOpaqueContent(params: LibrarianAttachAnnouncement): string {
  const { displayTitle, filePath, mountPoint, mimeType, description, mountFileId } = params;
  const where = mountPoint ? `the document store "${mountPoint}"` : 'the document store';
  const pathDetails = librarianUri('document_store', mountPoint, filePath);
  const isImage = isImageMime(mimeType);
  const kindPhrase = isImage
    ? `Image attached: "${displayTitle}"`
    : `Document attached: "${displayTitle}"`;
  const lead = `${kindPhrase} from ${where} — the user has placed it before you for your reply (${pathDetails}).`;
  const handle = attachIdHint(mountFileId, isImage);
  const trimmed = description?.trim();
  if (trimmed) {
    return `${lead}\n\n${handle}\n\nDescription:\n\n${trimmed}`;
  }
  return `${lead}\n\n${handle}`;
}

export async function postLibrarianAttachAnnouncement(
  params: LibrarianAttachAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildAttachContent(params);
  const opaqueContent = buildAttachOpaqueContent(params);
  return postLibrarianMessage(params.chatId, content, opaqueContent, 'attached', [params.mountFileId]);
}

export async function postLibrarianFolderDeletedAnnouncement(
  params: LibrarianFolderDeletedAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildFolderDeletedContent(params);
  const opaqueContent = buildFolderDeletedOpaqueContent(params);
  const kindLabel = params.origin.kind === 'by-user' ? 'folder-deleted-by-user' : 'folder-deleted-by-character';
  return postLibrarianMessage(params.chatId, content, opaqueContent, kindLabel);
}

// ---------------------------------------------------------------------------
// Character-initiated content writes, moves, copies, and blob uploads.
//
// These mirror the Document-Mode (user) announcements for the change-effecting
// `doc_*` tools that previously ran silently. Each carries the acting origin
// (character or user/operator) and the canonical qtap:// URI the handler has
// already computed. Edits embed a unified diff; creations report the new
// contents; both are capped so a large change can't blow the LLM context
// budget when the announcement rides into history.
// ---------------------------------------------------------------------------

/** Soft caps for an embedded diff / new-file body in an announcement. */
const ANNOUNCEMENT_MAX_LINES = 150;
const ANNOUNCEMENT_MAX_CHARS = 6000;

/**
 * Cap a diff or new-file body so a large change doesn't bloat the chat history
 * (and thus the LLM context). When trimmed, append a notice naming roughly how
 * much was elided and where to read the document in full.
 */
function truncateForAnnouncement(text: string, uri: string): string {
  const lines = text.split('\n');
  let kept = text;
  let truncated = false;
  if (lines.length > ANNOUNCEMENT_MAX_LINES) {
    kept = lines.slice(0, ANNOUNCEMENT_MAX_LINES).join('\n');
    truncated = true;
  }
  if (kept.length > ANNOUNCEMENT_MAX_CHARS) {
    kept = kept.slice(0, ANNOUNCEMENT_MAX_CHARS);
    truncated = true;
  }
  if (!truncated) return text;
  const keptLineCount = kept.split('\n').length;
  const remaining = Math.max(0, lines.length - keptLineCount);
  const moreNote = remaining > 0
    ? `${remaining} more line${remaining === 1 ? '' : 's'}`
    : 'more content';
  return `${kept}\n… [truncated — ${moreNote}; open the full document at ${uri}]`;
}

export interface LibrarianWriteAnnouncement {
  chatId: string;
  displayTitle: string;
  /** Canonical qtap:// URI for the written document (precomputed by the handler). */
  uri: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  origin: LibrarianActorOrigin;
  change:
    | { kind: 'created'; body: string }
    | { kind: 'edited'; diff: string };
  /** When true, suppress the announcement (the document is character_read:false). */
  hiddenFromCharacters?: boolean;
}

export function buildWriteContent(params: LibrarianWriteAnnouncement): string {
  const { displayTitle, uri, scope, mountPoint, origin, change } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = actorLabel(origin);
  if (change.kind === 'created') {
    const body = change.body.trim();
    if (!body) {
      return `The Librarian has set down a fresh, empty page titled "${displayTitle}" in ${where} at ${who} (${uri}).`;
    }
    const fenced = '```\n' + truncateForAnnouncement(change.body, uri) + '\n```';
    return `The Librarian has set down a new volume, "${displayTitle}", in ${where} at ${who} (${uri}). Its contents read:\n\n${fenced}`;
  }
  const fenced = '```diff\n' + truncateForAnnouncement(change.diff, uri) + '\n```';
  return `The Librarian has filed fresh alterations to "${displayTitle}" in ${where} at ${who} (${uri}):\n\n${fenced}`;
}

export function buildWriteOpaqueContent(params: LibrarianWriteAnnouncement): string {
  const { displayTitle, uri, scope, mountPoint, origin, change } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = actorLabel(origin);
  if (change.kind === 'created') {
    const body = change.body.trim();
    if (!body) {
      return `Document created (empty): "${displayTitle}" in ${where} at ${who} (${uri}).`;
    }
    const fenced = '```\n' + truncateForAnnouncement(change.body, uri) + '\n```';
    return `Document created: "${displayTitle}" in ${where} at ${who} (${uri}). Contents:\n\n${fenced}`;
  }
  const fenced = '```diff\n' + truncateForAnnouncement(change.diff, uri) + '\n```';
  return `Document edited: "${displayTitle}" in ${where} at ${who} (${uri}):\n\n${fenced}`;
}

export interface LibrarianMoveAnnouncement {
  chatId: string;
  oldDisplayTitle: string;
  newDisplayTitle: string;
  oldUri: string;
  newUri: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  origin: LibrarianActorOrigin;
  isFolder: boolean;
  /** When true, suppress the announcement (the document is character_read:false). */
  hiddenFromCharacters?: boolean;
}

export function buildMoveContent(params: LibrarianMoveAnnouncement): string {
  const { oldDisplayTitle, newDisplayTitle, oldUri, newUri, scope, mountPoint, origin, isFolder } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = actorLabel(origin);
  const thing = isFolder ? 'shelf' : 'volume';
  return `The Librarian has relocated the ${thing} "${oldDisplayTitle}" within ${where} at ${who} — it now rests as "${newDisplayTitle}", and the card in the catalogue has been amended to suit. Subsequent references should use the new address (was ${oldUri}, now ${newUri}).`;
}

export function buildMoveOpaqueContent(params: LibrarianMoveAnnouncement): string {
  const { oldDisplayTitle, newDisplayTitle, oldUri, newUri, scope, mountPoint, isFolder } = params;
  const where = scopeLabel(scope, mountPoint);
  const noun = isFolder ? 'Folder' : 'File';
  return `${noun} moved in ${where}: "${oldDisplayTitle}" → "${newDisplayTitle}". Subsequent references should use the new address (was ${oldUri}, now ${newUri}).`;
}

export interface LibrarianCopyAnnouncement {
  chatId: string;
  sourceDisplayTitle: string;
  destDisplayTitle: string;
  sourceMountPoint: string;
  destMountPoint: string;
  sourceUri: string;
  destUri: string;
  origin: LibrarianActorOrigin;
  /** When true, suppress the announcement (the source document is character_read:false). */
  hiddenFromCharacters?: boolean;
}

export function buildCopyContent(params: LibrarianCopyAnnouncement): string {
  const { sourceDisplayTitle, destDisplayTitle, sourceMountPoint, destMountPoint, sourceUri, destUri, origin } = params;
  const who = actorLabel(origin);
  return `The Librarian has transcribed a copy of "${sourceDisplayTitle}" from the document store "${sourceMountPoint}" into "${destMountPoint}" at ${who} — the original remains where it sat, and a faithful duplicate now answers to "${destDisplayTitle}" (from ${sourceUri} to ${destUri}).`;
}

export function buildCopyOpaqueContent(params: LibrarianCopyAnnouncement): string {
  const { sourceDisplayTitle, destDisplayTitle, sourceMountPoint, destMountPoint, sourceUri, destUri } = params;
  return `File copied: "${sourceDisplayTitle}" from "${sourceMountPoint}" to "${destMountPoint}" as "${destDisplayTitle}" (from ${sourceUri} to ${destUri}).`;
}

export interface LibrarianBlobWriteAnnouncement {
  chatId: string;
  displayTitle: string;
  uri: string;
  mountPoint?: string | null;
  mimeType: string;
  sizeBytes: number;
  description?: string;
  origin: LibrarianActorOrigin;
}

export function buildBlobWriteContent(params: LibrarianBlobWriteAnnouncement): string {
  const { displayTitle, uri, mountPoint, mimeType, sizeBytes, description, origin } = params;
  const where = mountPoint ? `the document store "${mountPoint}"` : 'the document store';
  const who = actorLabel(origin);
  const kindPhrase = isImageMime(mimeType) ? 'illustration' : 'asset';
  const lead = `The Librarian has affixed the ${kindPhrase} "${displayTitle}" to ${where} at ${who} — ${mimeType}, ${sizeBytes} bytes (${uri}).`;
  const trimmed = description?.trim();
  return trimmed ? `${lead}\n\nThe catalogue describes it thus: ${trimmed}` : lead;
}

export function buildBlobWriteOpaqueContent(params: LibrarianBlobWriteAnnouncement): string {
  const { displayTitle, uri, mountPoint, mimeType, sizeBytes, description } = params;
  const where = mountPoint ? `the document store "${mountPoint}"` : 'the document store';
  const kindWord = isImageMime(mimeType) ? 'Image' : 'Asset';
  const lead = `${kindWord} added: "${displayTitle}" to ${where} — ${mimeType}, ${sizeBytes} bytes (${uri}).`;
  const trimmed = description?.trim();
  return trimmed ? `${lead}\n\nDescription: ${trimmed}` : lead;
}

export async function postLibrarianWriteAnnouncement(
  params: LibrarianWriteAnnouncement,
): Promise<MessageEvent | null> {
  if (params.hiddenFromCharacters) return null;
  // An edit with an empty diff means nothing actually changed — stay silent.
  if (params.change.kind === 'edited' && !params.change.diff.trim()) {
    return null;
  }
  const content = buildWriteContent(params);
  const opaqueContent = buildWriteOpaqueContent(params);
  const verb = params.change.kind === 'created' ? 'created' : 'edited';
  const kindLabel = params.origin.kind === 'by-user' ? `${verb}-by-user` : `${verb}-by-character`;
  return postLibrarianMessage(params.chatId, content, opaqueContent, kindLabel);
}

export async function postLibrarianMoveAnnouncement(
  params: LibrarianMoveAnnouncement,
): Promise<MessageEvent | null> {
  if (params.hiddenFromCharacters) return null;
  const content = buildMoveContent(params);
  const opaqueContent = buildMoveOpaqueContent(params);
  const kindLabel = params.origin.kind === 'by-user' ? 'moved-by-user' : 'moved-by-character';
  return postLibrarianMessage(params.chatId, content, opaqueContent, kindLabel);
}

export async function postLibrarianCopyAnnouncement(
  params: LibrarianCopyAnnouncement,
): Promise<MessageEvent | null> {
  if (params.hiddenFromCharacters) return null;
  const content = buildCopyContent(params);
  const opaqueContent = buildCopyOpaqueContent(params);
  const kindLabel = params.origin.kind === 'by-user' ? 'copied-by-user' : 'copied-by-character';
  return postLibrarianMessage(params.chatId, content, opaqueContent, kindLabel);
}

export async function postLibrarianBlobWriteAnnouncement(
  params: LibrarianBlobWriteAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildBlobWriteContent(params);
  const opaqueContent = buildBlobWriteOpaqueContent(params);
  const kindLabel = params.origin.kind === 'by-user' ? 'blob-written-by-user' : 'blob-written-by-character';
  return postLibrarianMessage(params.chatId, content, opaqueContent, kindLabel);
}

// ---------------------------------------------------------------------------
// Phase F: conversation-summary whispers. Replaces the per-turn `## Previous
// Conversation Summary` system-prompt block. Posted whenever the chat's
// `contextSummary` is regenerated by the cheap-LLM summariser. As of the
// per-character summary refactor these are always whispered to a single
// participant — the whole chat doesn't share one summary, since each
// character may have entered mid-stream or stepped away and back.
// ---------------------------------------------------------------------------

/**
 * Announcement that the user has uploaded one or more image files inline as
 * attachments on their next message. The bytes are already carried by the
 * user's own message (`attachments: [fileId, ...]`), so this whisper does NOT
 * re-attach them — its sole job is to surface each file's UUID in the chat
 * transcript so the LLM has the handle required to call `describe_image` /
 * `keep_image` / `attach_image`. Mirrors the avatar / background announcements posted by the
 * Lantern notifications writer.
 *
 * Non-image uploads are out of scope: the photo album tools only operate on
 * images, so non-image attachments don't need this whisper.
 */
export interface LibrarianUploadAnnouncement {
  chatId: string;
  uploads: Array<{ fileId: string; filename: string }>;
}

export function buildUploadContent(params: LibrarianUploadAnnouncement): string {
  const { uploads } = params;
  if (uploads.length === 0) return '';
  if (uploads.length === 1) {
    const { fileId, filename } = uploads[0];
    return `The Librarian has catalogued the user's freshly-uploaded illustration "${filename}" under uuid \`${fileId}\`. The bytes ride with the user's message, and if your eyes read pictures you are looking at it already. If they do not — or if you want the particulars set down in words — call describe_image with that uuid and the Librarian will read it aloud to you. It may also be filed in your own album with keep_image, or held up to the room again later with attach_image; neither of those shows it to you.`;
  }
  const list = uploads.map(u => `- "${u.filename}" — uuid \`${u.fileId}\``).join('\n');
  return `The Librarian has catalogued the user's freshly-uploaded illustrations. The bytes ride with the user's message, and if your eyes read pictures you are looking at them already. If they do not — or if you want the particulars set down in words — call describe_image with the uuid of any of them. Each may also be filed in your own album with keep_image, or held up to the room again later with attach_image; neither of those shows it to you:\n\n${list}`;
}

export function buildUploadOpaqueContent(params: LibrarianUploadAnnouncement): string {
  const { uploads } = params;
  if (uploads.length === 0) return '';
  if (uploads.length === 1) {
    const { fileId, filename } = uploads[0];
    return `The user has uploaded an illustration: "${filename}" — uuid \`${fileId}\`. The bytes ride with the user's message, so a vision-capable model can see it already. To have its contents described in words, call describe_image with that uuid. keep_image files it in your album and attach_image shows it to the room again; neither one shows it to you.`;
  }
  const list = uploads.map(u => `- "${u.filename}" — uuid \`${u.fileId}\``).join('\n');
  return `The user has uploaded illustrations. The bytes ride with the user's message, so a vision-capable model can see them already. To have any of them described in words, call describe_image with its uuid. keep_image files one in your album and attach_image shows it to the room again; neither one shows it to you:\n\n${list}`;
}

export async function postLibrarianUploadAnnouncement(
  params: LibrarianUploadAnnouncement,
): Promise<MessageEvent | null> {
  if (params.uploads.length === 0) return null;
  const content = buildUploadContent(params);
  const opaqueContent = buildUploadOpaqueContent(params);
  // Leave the announcement's `attachments` array empty — the user's own
  // message already carries the file ids, and the lantern-image walker only
  // looks at ASSISTANT attachments, so duplicating here would double-feed any
  // future vision-bearing walker without buying anything for the photo-album
  // surface.
  return postLibrarianMessage(params.chatId, content, opaqueContent, 'uploaded');
}

export const SUMMARY_CONTENT_PREFIX =
  'The Librarian deposits a précis of the conversation to date upon the table — file it for reference:';

export const SUMMARY_OPAQUE_CONTENT_PREFIX =
  'Précis of the conversation to date — file it for reference:';

export interface LibrarianSummaryAnnouncement {
  chatId: string;
  summary: string;
  /**
   * Participant IDs that should receive this summary as a whisper. When
   * provided, the summary becomes a private message visible only to the
   * sender and the listed participants.
   */
  targetParticipantIds?: string[] | null;
  /**
   * Phase 3c: anchor tying this whisper to the compaction generation under
   * which it was produced. The summarisation pipeline sweeps stale anchors
   * deterministically when `compactionGeneration` bumps. NULL is permitted
   * for legacy callers; the sweep treats null as "older than current".
   */
  summaryAnchor?: { compactionGeneration: number } | null;
}

export function buildSummaryContent(summary: string): string {
  return [
    SUMMARY_CONTENT_PREFIX,
    '',
    summary.trim(),
  ].join('\n');
}

export function buildSummaryOpaqueContent(summary: string): string {
  return [
    SUMMARY_OPAQUE_CONTENT_PREFIX,
    '',
    summary.trim(),
  ].join('\n');
}

export async function postLibrarianSummaryAnnouncement(
  params: LibrarianSummaryAnnouncement,
): Promise<MessageEvent | null> {
  if (!params.summary || params.summary.trim().length === 0) {
    return null;
  }
  const content = buildSummaryContent(params.summary);
  const opaqueContent = buildSummaryOpaqueContent(params.summary);
  return postLibrarianMessage(
    params.chatId,
    content,
    opaqueContent,
    'summary',
    [],
    params.targetParticipantIds ?? null,
    params.summaryAnchor ?? null,
  );
}
