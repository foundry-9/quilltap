/**
 * @fileoverview Tool definition for deleting files from document stores, projects, and general files.
 * Permanently deletes the file (no trash/recycle bin).
 *
 * Scriptorium Phase 3.4
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_delete_file tool's input.
 */
export const docDeleteFileToolInputSchema = z.object({
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
    .describe('Relative path to the file to delete within the selected scope.')
    .optional(),
}).refine((d) => Boolean(d.uri || d.path), 'Provide either a `uri` or a `path`.');

/**
 * Input parameters for the doc_delete_file tool
 */
export type DocDeleteFileInput = z.infer<typeof docDeleteFileToolInputSchema>;

/**
 * Validates input for doc_delete_file tool.
 */
export function validateDocDeleteFileInput(input: unknown): DocDeleteFileInput | null {
  const parsed = docDeleteFileToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const docDeleteFileToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_delete_file',
    description:
      'Permanently delete a file from a document store, project files, or general files. This action cannot be undone — confirm intent before calling.',
    parameters: zodToOpenAISchema(docDeleteFileToolInputSchema),
  },
};

export interface DocDeleteFileOutput {
  success: boolean;
  path: string;
  /** Canonical qtap:// URI for the (now-deleted) file. */
  uri?: string;
}
