/**
 * @fileoverview Tool definition for deleting empty folders from document stores, projects, and general files.
 * Only deletes empty folders — rejects non-empty folders for safety.
 *
 * Scriptorium Phase 3.4
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_delete_folder tool's input.
 */
export const docDeleteFolderToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  scope: z
    .enum(['document_store', 'project', 'general'])
    .default('document_store')
    .describe(
      'The file scope. "document_store" for mounted document stores, "project" for project files, "general" for general files.'
    )
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name. Required when scope is "document_store". The reserved value "self" addresses your own character vault.')
    .optional(),
  path: z
    .string()
    .describe('Relative path to the empty folder to delete within the selected scope.')
    .optional(),
}).refine((d) => Boolean(d.uri || d.path), 'Provide either a `uri` or a `path`.');

/**
 * Input parameters for the doc_delete_folder tool
 */
export type DocDeleteFolderInput = z.infer<typeof docDeleteFolderToolInputSchema>;

/**
 * Validates input for doc_delete_folder tool.
 */
export function validateDocDeleteFolderInput(input: unknown): DocDeleteFolderInput | null {
  const parsed = docDeleteFolderToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const docDeleteFolderToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_delete_folder',
    description:
      'Delete an empty folder from a document store, project files, or general files. The folder must be empty (no files or subfolders). Use doc_list_files to check folder contents first.',
    parameters: zodToOpenAISchema(docDeleteFolderToolInputSchema),
  },
};

export interface DocDeleteFolderOutput {
  success: boolean;
  path: string;
  /** Canonical qtap:// URI for the (now-deleted) folder. */
  uri?: string;
}
