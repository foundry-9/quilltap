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
  handleDescribeImage,
} from './doc-edit/photo-handlers';

import { validateDocReadFileInput } from '../doc-read-file-tool';
import { validateDocWriteFileInput } from '../doc-write-file-tool';
import { validateDocStrReplaceInput } from '../doc-str-replace-tool';
import { validateDocInsertTextInput } from '../doc-insert-text-tool';
import { validateDocGrepInput } from '../doc-grep-tool';
import { validateDocListFilesInput } from '../doc-list-files-tool';
import { validateDocReadFrontmatterInput } from '../doc-read-frontmatter-tool';
import { validateDocUpdateFrontmatterInput } from '../doc-update-frontmatter-tool';
import { validateDocReadHeadingInput } from '../doc-read-heading-tool';
import { validateDocUpdateHeadingInput } from '../doc-update-heading-tool';
import { validateDocMoveFileInput } from '../doc-move-file-tool';
import { validateDocCopyFileInput } from '../doc-copy-file-tool';
import { validateDocDeleteFileInput } from '../doc-delete-file-tool';
import { validateDocCreateFolderInput } from '../doc-create-folder-tool';
import { validateDocDeleteFolderInput } from '../doc-delete-folder-tool';
import { validateDocMoveFolderInput } from '../doc-move-folder-tool';
import { validateDocOpenDocumentInput } from '../doc-open-document-tool';
import { validateDocCloseDocumentInput } from '../doc-close-document-tool';
import { validateDocFocusInput } from '../doc-focus-tool';
import { validateDocWriteBlobInput } from '../doc-write-blob-tool';
import { validateDocReadBlobInput } from '../doc-read-blob-tool';
import { validateDocListBlobsInput } from '../doc-list-blobs-tool';
import { validateDocDeleteBlobInput } from '../doc-delete-blob-tool';
import { validateKeepImageInput } from '../keep-image-tool';
import { validateListImagesInput } from '../list-images-tool';
import { validateAttachImageInput } from '../attach-image-tool';
import { validateDescribeImageInput } from '../describe-image-tool';

export type { DocEditToolContext } from './doc-edit/shared';

// ============================================================================
// Tool registry and dispatch
// ============================================================================

/** The shape every doc-edit handler answers with. */
export interface DocEditToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  formattedText?: string;
}

/**
 * One registered doc-edit tool: its Zod-backed validator and the handler that
 * consumes the parsed input. The generic is erased at the registry boundary
 * (see {@link defineDocEditTool}) so tools with different input types can
 * share one table; the pairing is type-checked where each entry is built.
 */
interface DocEditTool {
  validate: (input: unknown) => unknown | null;
  handle: (input: never, context: DocEditToolContext) => Promise<DocEditToolResult>;
}

/** Pair a validator with its handler, checking that their input types agree. */
function defineDocEditTool<I>(
  validate: (input: unknown) => I | null,
  handle: (input: I, context: DocEditToolContext) => Promise<DocEditToolResult>,
): DocEditTool {
  return { validate, handle: handle as DocEditTool['handle'] };
}

/**
 * Every doc-edit tool, keyed by the name the model calls it by. This is the
 * single source of truth for both {@link DOC_EDIT_TOOL_NAMES} and dispatch.
 */
const DOC_EDIT_TOOLS: Record<string, DocEditTool> = {
  doc_read_file: defineDocEditTool(validateDocReadFileInput, handleReadFile),
  doc_write_file: defineDocEditTool(validateDocWriteFileInput, handleWriteFile),
  doc_str_replace: defineDocEditTool(validateDocStrReplaceInput, handleStrReplace),
  doc_insert_text: defineDocEditTool(validateDocInsertTextInput, handleInsertText),
  doc_grep: defineDocEditTool(validateDocGrepInput, handleGrep),
  doc_list_files: defineDocEditTool(validateDocListFilesInput, handleListFiles),
  doc_read_frontmatter: defineDocEditTool(validateDocReadFrontmatterInput, handleReadFrontmatter),
  doc_update_frontmatter: defineDocEditTool(validateDocUpdateFrontmatterInput, handleUpdateFrontmatter),
  doc_read_heading: defineDocEditTool(validateDocReadHeadingInput, handleReadHeading),
  doc_update_heading: defineDocEditTool(validateDocUpdateHeadingInput, handleUpdateHeading),
  doc_move_file: defineDocEditTool(validateDocMoveFileInput, handleMoveFile),
  doc_copy_file: defineDocEditTool(validateDocCopyFileInput, handleCopyFile),
  doc_delete_file: defineDocEditTool(validateDocDeleteFileInput, handleDeleteFile),
  doc_create_folder: defineDocEditTool(validateDocCreateFolderInput, handleCreateFolder),
  doc_delete_folder: defineDocEditTool(validateDocDeleteFolderInput, handleDeleteFolder),
  doc_move_folder: defineDocEditTool(validateDocMoveFolderInput, handleMoveFolder),
  doc_open_document: defineDocEditTool(validateDocOpenDocumentInput, handleOpenDocument),
  doc_close_document: defineDocEditTool(validateDocCloseDocumentInput, handleCloseDocument),
  doc_focus: defineDocEditTool(validateDocFocusInput, handleDocFocus),
  doc_write_blob: defineDocEditTool(validateDocWriteBlobInput, handleWriteBlob),
  doc_read_blob: defineDocEditTool(validateDocReadBlobInput, handleReadBlob),
  doc_list_blobs: defineDocEditTool(validateDocListBlobsInput, handleListBlobs),
  doc_delete_blob: defineDocEditTool(validateDocDeleteBlobInput, handleDeleteBlob),
  keep_image: defineDocEditTool(validateKeepImageInput, handleKeepImage),
  list_images: defineDocEditTool(validateListImagesInput, handleListImages),
  attach_image: defineDocEditTool(validateAttachImageInput, handleAttachImage),
  describe_image: defineDocEditTool(validateDescribeImageInput, handleDescribeImage),
};

export const DOC_EDIT_TOOL_NAMES = new Set(Object.keys(DOC_EDIT_TOOLS));

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
): Promise<DocEditToolResult> {

  // Each tool's schema runs first so the handler sees the PARSED input —
  // defaults materialized and llmNumber's quoted-number coercions in effect.
  // On a failed parse the raw input passes through unchanged: the handlers'
  // own lenient per-field checks still produce their friendlier errors, and
  // pre-schema flows (e.g. a qtap:// uri standing in for path) keep working
  // exactly as before.
  try {
    const tool = Object.prototype.hasOwnProperty.call(DOC_EDIT_TOOLS, toolName)
      ? DOC_EDIT_TOOLS[toolName]
      : undefined;
    if (!tool) {
      return { success: false, error: `Unknown doc-edit tool: ${toolName}` };
    }
    return await tool.handle((tool.validate(input) ?? input) as never, context);
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
  result: DocEditToolResult
): string {
  if (result.formattedText) {
    return result.formattedText;
  }
  if (!result.success) {
    return `Error: ${result.error || 'Unknown error'}`;
  }
  return JSON.stringify(result.result, null, 2);
}
