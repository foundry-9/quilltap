/**
 * @fileoverview Tool definition for copying a file from one document store to another.
 *
 * Cross-store only: source_mount_point and dest_mount_point must resolve to
 * different mount points. For same-store duplication, the LLM can still read
 * the file and write a copy, or a future tool can add that capability.
 *
 * Text files only, matching doc_move_file / doc_write_file. Binary assets are
 * out of scope here — the blob family (doc_*_blob) handles those.
 *
 * Destination path semantics:
 *   - Empty / "." / "/"  → copy to dest store root using source basename
 *   - Existing directory → copy into directory using source basename
 *   - Otherwise          → treat as full path (parent folders auto-created)
 *
 * Refuses to overwrite an existing destination file, matching doc_move_file.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_copy_file tool's input.
 */
export const docCopyFileToolInputSchema = z.object({
  source_uri: z
    .string()
    .describe('A qtap:// URI for the source document, e.g. "qtap://self/Notes/today.md". When provided, it supersedes source_mount_point/source_path.')
    .optional(),
  dest_uri: z
    .string()
    .describe('A qtap:// URI for the destination, e.g. "qtap://Shared/Notes/today.md". When provided, it supersedes dest_mount_point/dest_path.')
    .optional(),
  source_mount_point: z
    .string()
    .min(1)
    .describe('Name (or ID) of the document store to copy the file from. Pass "self" for your own character vault.')
    .optional(),
  source_path: z
    .string()
    .min(1)
    .describe('Relative path to the source file within the source document store.')
    .optional(),
  dest_mount_point: z
    .string()
    .min(1)
    .describe('Name (or ID) of the document store to copy the file into. Pass "self" for your own character vault. Must be different from source_mount_point.')
    .optional(),
  dest_path: z
    .string()
    .describe(
      'Destination path within the destination document store. If this path already exists as a directory, the file is dropped into it with the source filename. Otherwise it is treated as the full path with filename. Use "" or "." to copy to the root of the destination store.'
    )
    .optional(),
}).refine((d) => Boolean((d.source_uri || (d.source_mount_point && d.source_path)) && (d.dest_uri || (d.dest_mount_point && d.dest_path !== undefined))), 'Provide source_uri or (source_mount_point + source_path), and dest_uri or (dest_mount_point + dest_path).');

/**
 * Input parameters for the doc_copy_file tool
 */
export type DocCopyFileInput = z.infer<typeof docCopyFileToolInputSchema>;

/**
 * Validates input for doc_copy_file tool.
 */
export function validateDocCopyFileInput(input: unknown): DocCopyFileInput | null {
  const parsed = docCopyFileToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const docCopyFileToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_copy_file',
    description:
      'Copy a file from one document store to a different document store. The source and destination must be in different document stores. If dest_path points to an existing folder, the file is copied into it using the source filename; otherwise dest_path is treated as the full destination path (with filename). Parent directories are created automatically. Will not overwrite an existing file at the destination.',
    parameters: zodToOpenAISchema(docCopyFileToolInputSchema),
  },
};

export interface DocCopyFileOutput {
  success: boolean;
  source_mount_point: string;
  source_path: string;
  dest_mount_point: string;
  dest_path: string;
  /** Canonical qtap:// URI for the copy's destination. */
  uri?: string;
  mtime: number;
}
