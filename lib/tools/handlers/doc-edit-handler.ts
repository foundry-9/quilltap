/**
 * Document Editing Tool Handler
 *
 * Consolidated dispatcher for all doc_* editing tools. Dispatches by tool
 * name to the appropriate operation. The individual operations live in the
 * `doc-edit/` directory, grouped by responsibility:
 *
 *   - shared.ts                   — context type, logging, cross-cutting helpers
 *   - text-handlers.ts            — read/write/str_replace/insert/grep/list
 *   - markdown-handlers.ts        — frontmatter + heading operations
 *   - file-management-handlers.ts — move/copy/delete files and folders
 *   - document-ui-handlers.ts     — open/close/focus document UI
 *   - blob-handlers.ts            — database-backed + universal blob layer
 *   - photo-handlers.ts           — keep_image / list_images / attach_image
 *
 * Scriptorium Phase 3.3
 *
 * @module tools/handlers/doc-edit-handler
 */

import { PathResolutionError } from '@/lib/doc-edit';

import { logger, type DocEditToolContext } from './doc-edit/shared';
import {
  handleReadFile,
  handleWriteFile,
  handleStrReplace,
  handleInsertText,
  handleGrep,
  handleListFiles,
} from './doc-edit/text-handlers';
import {
  handleReadFrontmatter,
  handleUpdateFrontmatter,
  handleReadHeading,
  handleUpdateHeading,
} from './doc-edit/markdown-handlers';
import {
  handleMoveFile,
  handleCopyFile,
  handleDeleteFile,
  handleCreateFolder,
  handleDeleteFolder,
  handleMoveFolder,
} from './doc-edit/file-management-handlers';
import {
  handleOpenDocument,
  handleCloseDocument,
  handleDocFocus,
} from './doc-edit/document-ui-handlers';
import {
  handleWriteBlob,
  handleReadBlob,
  handleListBlobs,
  handleDeleteBlob,
} from './doc-edit/blob-handlers';
import {
  handleKeepImage,
  handleListImages,
  handleAttachImage,
} from './doc-edit/photo-handlers';

import { validateDocReadFileInput, type DocReadFileInput } from '../doc-read-file-tool';
import { validateDocWriteFileInput, type DocWriteFileInput } from '../doc-write-file-tool';
import { validateDocStrReplaceInput, type DocStrReplaceInput } from '../doc-str-replace-tool';
import { validateDocInsertTextInput, type DocInsertTextInput } from '../doc-insert-text-tool';
import { validateDocGrepInput, type DocGrepInput } from '../doc-grep-tool';
import { validateDocListFilesInput, type DocListFilesInput } from '../doc-list-files-tool';
import { validateDocReadFrontmatterInput, type DocReadFrontmatterInput } from '../doc-read-frontmatter-tool';
import { validateDocUpdateFrontmatterInput, type DocUpdateFrontmatterInput } from '../doc-update-frontmatter-tool';
import { validateDocReadHeadingInput, type DocReadHeadingInput } from '../doc-read-heading-tool';
import { validateDocUpdateHeadingInput, type DocUpdateHeadingInput } from '../doc-update-heading-tool';
import { validateDocMoveFileInput, type DocMoveFileInput } from '../doc-move-file-tool';
import { validateDocCopyFileInput, type DocCopyFileInput } from '../doc-copy-file-tool';
import { validateDocDeleteFileInput, type DocDeleteFileInput } from '../doc-delete-file-tool';
import { validateDocCreateFolderInput, type DocCreateFolderInput } from '../doc-create-folder-tool';
import { validateDocDeleteFolderInput, type DocDeleteFolderInput } from '../doc-delete-folder-tool';
import { validateDocMoveFolderInput, type DocMoveFolderInput } from '../doc-move-folder-tool';
import { validateDocOpenDocumentInput, type DocOpenDocumentInput } from '../doc-open-document-tool';
import { validateDocCloseDocumentInput, type DocCloseDocumentInput } from '../doc-close-document-tool';
import { validateDocFocusInput, type DocFocusInput } from '../doc-focus-tool';
import { validateDocWriteBlobInput, type DocWriteBlobInput } from '../doc-write-blob-tool';
import { validateDocReadBlobInput, type DocReadBlobInput } from '../doc-read-blob-tool';
import { validateDocListBlobsInput, type DocListBlobsInput } from '../doc-list-blobs-tool';
import { validateDocDeleteBlobInput, type DocDeleteBlobInput } from '../doc-delete-blob-tool';
import { validateKeepImageInput, type KeepImageInput } from '../keep-image-tool';
import { validateListImagesInput, type ListImagesInput } from '../list-images-tool';
import { validateAttachImageInput, type AttachImageInput } from '../attach-image-tool';

export type { DocEditToolContext } from './doc-edit/shared';

// ============================================================================
// Tool name constants and dispatch
// ============================================================================

export const DOC_EDIT_TOOL_NAMES = new Set([
  'doc_read_file',
  'doc_write_file',
  'doc_str_replace',
  'doc_insert_text',
  'doc_grep',
  'doc_list_files',
  'doc_read_frontmatter',
  'doc_update_frontmatter',
  'doc_read_heading',
  'doc_update_heading',
  'doc_move_file',
  'doc_copy_file',
  'doc_delete_file',
  'doc_create_folder',
  'doc_delete_folder',
  'doc_move_folder',
  'doc_open_document',
  'doc_close_document',
  'doc_focus',
  'doc_write_blob',
  'doc_read_blob',
  'doc_list_blobs',
  'doc_delete_blob',
  'keep_image',
  'list_images',
  'attach_image',
]);

/**
 * Check if a tool name is a doc-edit tool.
 */
export function isDocEditTool(name: string): boolean {
  return DOC_EDIT_TOOL_NAMES.has(name);
}

/**
 * Execute a doc-edit tool call.
 */
export async function executeDocEditTool(
  toolName: string,
  input: Record<string, unknown>,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: unknown; error?: string; formattedText?: string }> {

  // Each case runs the tool's schema first so the handler sees the PARSED
  // input — defaults materialized and llmNumber's quoted-number coercions in
  // effect. On a failed parse the raw input passes through unchanged: the
  // handlers' own lenient per-field checks still produce their friendlier
  // errors, and pre-schema flows (e.g. a qtap:// uri standing in for path)
  // keep working exactly as before.
  try {
    switch (toolName) {
      case 'doc_read_file':
        return await handleReadFile(validateDocReadFileInput(input) ?? (input as unknown as DocReadFileInput), context);
      case 'doc_write_file':
        return await handleWriteFile(validateDocWriteFileInput(input) ?? (input as unknown as DocWriteFileInput), context);
      case 'doc_str_replace':
        return await handleStrReplace(validateDocStrReplaceInput(input) ?? (input as unknown as DocStrReplaceInput), context);
      case 'doc_insert_text':
        return await handleInsertText(validateDocInsertTextInput(input) ?? (input as unknown as DocInsertTextInput), context);
      case 'doc_grep':
        return await handleGrep(validateDocGrepInput(input) ?? (input as unknown as DocGrepInput), context);
      case 'doc_list_files':
        return await handleListFiles(validateDocListFilesInput(input) ?? (input as unknown as DocListFilesInput), context);
      case 'doc_read_frontmatter':
        return await handleReadFrontmatter(validateDocReadFrontmatterInput(input) ?? (input as unknown as DocReadFrontmatterInput), context);
      case 'doc_update_frontmatter':
        return await handleUpdateFrontmatter(validateDocUpdateFrontmatterInput(input) ?? (input as unknown as DocUpdateFrontmatterInput), context);
      case 'doc_read_heading':
        return await handleReadHeading(validateDocReadHeadingInput(input) ?? (input as unknown as DocReadHeadingInput), context);
      case 'doc_update_heading':
        return await handleUpdateHeading(validateDocUpdateHeadingInput(input) ?? (input as unknown as DocUpdateHeadingInput), context);
      case 'doc_move_file':
        return await handleMoveFile(validateDocMoveFileInput(input) ?? (input as unknown as DocMoveFileInput), context);
      case 'doc_copy_file':
        return await handleCopyFile(validateDocCopyFileInput(input) ?? (input as unknown as DocCopyFileInput), context);
      case 'doc_delete_file':
        return await handleDeleteFile(validateDocDeleteFileInput(input) ?? (input as unknown as DocDeleteFileInput), context);
      case 'doc_create_folder':
        return await handleCreateFolder(validateDocCreateFolderInput(input) ?? (input as unknown as DocCreateFolderInput), context);
      case 'doc_delete_folder':
        return await handleDeleteFolder(validateDocDeleteFolderInput(input) ?? (input as unknown as DocDeleteFolderInput), context);
      case 'doc_move_folder':
        return await handleMoveFolder(validateDocMoveFolderInput(input) ?? (input as unknown as DocMoveFolderInput), context);
      case 'doc_open_document':
        return await handleOpenDocument(validateDocOpenDocumentInput(input) ?? (input as unknown as DocOpenDocumentInput), context);
      case 'doc_close_document':
        return await handleCloseDocument(validateDocCloseDocumentInput(input) ?? (input as unknown as DocCloseDocumentInput), context);
      case 'doc_focus':
        return await handleDocFocus(validateDocFocusInput(input) ?? (input as unknown as DocFocusInput), context);
      case 'doc_write_blob':
        return await handleWriteBlob(validateDocWriteBlobInput(input) ?? (input as unknown as DocWriteBlobInput), context);
      case 'doc_read_blob':
        return await handleReadBlob(validateDocReadBlobInput(input) ?? (input as unknown as DocReadBlobInput), context);
      case 'doc_list_blobs':
        return await handleListBlobs(validateDocListBlobsInput(input) ?? (input as unknown as DocListBlobsInput), context);
      case 'doc_delete_blob':
        return await handleDeleteBlob(validateDocDeleteBlobInput(input) ?? (input as unknown as DocDeleteBlobInput), context);
      case 'keep_image':
        return await handleKeepImage(validateKeepImageInput(input) ?? (input as unknown as KeepImageInput), context);
      case 'list_images':
        return await handleListImages(validateListImagesInput(input) ?? (input as unknown as ListImagesInput), context);
      case 'attach_image':
        return await handleAttachImage(validateAttachImageInput(input) ?? (input as unknown as AttachImageInput), context);
      default:
        return { success: false, error: `Unknown doc-edit tool: ${toolName}` };
    }
  } catch (error) {
    if (error instanceof PathResolutionError) {
      logger.warn('Path resolution error in doc-edit tool', {
        toolName,
        code: error.code,
        message: error.message,
      });
      return {
        success: false,
        error: error.message,
        formattedText: `Error: ${error.message}`,
      };
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Unexpected error in doc-edit tool', { toolName, error: errorMsg });
    return {
      success: false,
      error: errorMsg,
      formattedText: `Error: ${errorMsg}`,
    };
  }
}

/**
 * Format doc-edit tool results for LLM consumption.
 */
export function formatDocEditResults(
  toolName: string,
  result: { success: boolean; result?: unknown; error?: string; formattedText?: string }
): string {
  if (result.formattedText) {
    return result.formattedText;
  }
  if (!result.success) {
    return `Error: ${result.error || 'Unknown error'}`;
  }
  return JSON.stringify(result.result, null, 2);
}
