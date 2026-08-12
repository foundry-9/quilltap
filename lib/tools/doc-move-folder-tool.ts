/**
 * @fileoverview Tool definition for moving or renaming folders in document stores.
 * Cascades to all descendant folders and documents. Destination parent is auto-created
 * for database-backed stores (matching mkdir -p semantics).
 *
 * Scriptorium Phase 4.0 Deliverable 3 - Phase B
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc-move-folder tool's input.
 */
export const docMoveFolderToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  scope: z
    .enum(['document_store'])
    .default('document_store')
    .describe('The folder scope. Only "document_store" is supported for folder operations.')
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name. Required when scope is "document_store". The reserved value "self" addresses your own character vault.')
    .optional(),
  path: z
    .string()
    .describe('Current relative path to the folder within the selected scope.')
    .optional(),
  new_path: z
    .string()
    .describe('Destination relative path for the folder. Parent directories are created automatically for database-backed stores.'),
}).refine((d) => Boolean(d.uri || d.path), 'Provide either a `uri` or a `path`.');

/**
 * Input parameters for the doc-move-folder tool
 */
export type DocMoveFolderInput = z.infer<typeof docMoveFolderToolInputSchema>;

export const docMoveFolderToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_move_folder',
    description:
      'Move or rename a folder in a document store. When moving to a different directory, moves the entire folder and its contents. When renaming within the same directory, renames it. For database-backed stores, the destination parent directory is created automatically if it does not exist (mkdir -p semantics). Will not overwrite an existing folder at the destination.',
    parameters: zodToOpenAISchema(docMoveFolderToolInputSchema),
  },
};

/**
 * Validates input for doc_move_folder tool.
 */
export function validateDocMoveFolderInput(input: unknown): DocMoveFolderInput | null {
  const parsed = docMoveFolderToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}


export interface DocMoveFolderOutput {
  success: boolean;
  old_path: string;
  new_path: string;
  /** Canonical qtap:// URI for the folder's new location. */
  uri?: string;
}
