/**
 * @fileoverview Tool definition for creating folders in document stores, projects, and general files.
 * Creates parent directories as needed (like mkdir -p). Idempotent — succeeds if folder already exists.
 *
 * Scriptorium Phase 3.4
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_create_folder tool's input.
 */
export const docCreateFolderToolInputSchema = z.object({
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
    .describe('Relative path for the folder to create within the selected scope.')
    .optional(),
}).refine((d) => Boolean(d.uri || d.path), 'Provide either a `uri` or a `path`.');

/**
 * Input parameters for the doc_create_folder tool
 */
export type DocCreateFolderInput = z.infer<typeof docCreateFolderToolInputSchema>;

/**
 * Validates input for doc_create_folder tool.
 */
export function validateDocCreateFolderInput(input: unknown): DocCreateFolderInput | null {
  const parsed = docCreateFolderToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const docCreateFolderToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_create_folder',
    description:
      'Create a new folder in a document store, project files, or general files. Creates parent folders automatically. Succeeds silently if the folder already exists.',
    parameters: zodToOpenAISchema(docCreateFolderToolInputSchema),
  },
};

export interface DocCreateFolderOutput {
  success: boolean;
  path: string;
  /** Canonical qtap:// URI for the created folder. */
  uri?: string;
}
