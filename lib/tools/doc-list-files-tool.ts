/**
 * @fileoverview Tool definition for listing files available in document stores and project files.
 * Without parameters, lists all files across all linked mount points and project files.
 * Supports filtering by mount point, scope, folder, and glob patterns.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_list_files tool's input.
 */
export const docListFilesToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  mount_point: z
    .string()
    .describe('Optional: restrict listing to a specific mount point (name or ID). Pass "self" to list only your own character vault. Without this, lists all mount points.')
    .optional(),
  scope: z
    .enum(['document_store', 'project', 'general', 'group'])
    .describe(
      'Optional: restrict to files in a specific scope. "document_store" for mounted stores, "project" for project files, "general" for general files, "group" for the document stores of the groups the responding character is a member of.'
    )
    .optional(),
  folder: z
    .string()
    .describe('Optional: list files within a specific subfolder path. Allows exploring directory structure.')
    .optional(),
  pattern: z
    .string()
    .describe('Optional: glob pattern to filter results (e.g., "*.md", "*.{ts,tsx}", "src/**/*.js").')
    .optional(),
  recursive: z
    .boolean()
    .default(true)
    .describe('Include files in subfolders. Default is true.')
    .optional(),
  includeAutomaticImages: z
    .boolean()
    .default(false)
    .describe(
      'Include auto-generated avatar/background images (from character-avatars/story-backgrounds). Default false.'
    )
    .optional(),
});

/**
 * Input parameters for the doc_list_files tool
 */
export type DocListFilesInput = z.infer<typeof docListFilesToolInputSchema>;

/**
 * Validates input for doc_list_files tool.
 */
export function validateDocListFilesInput(input: unknown): DocListFilesInput | null {
  const parsed = docListFilesToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const docListFilesToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_list_files',
    description:
      'List files available in document stores and project files. Without parameters, lists all files across all linked mount points and project files.',
    parameters: zodToOpenAISchema(docListFilesToolInputSchema),
  },
};

export interface DocFileInfo {
  path: string;
  mount_point?: string;
  /** Canonical qtap:// URI addressing this entry. */
  uri?: string;
  scope: 'document_store' | 'project' | 'general' | 'group';
  size: number;
  modified: number;
  kind?: 'file' | 'folder';
}

export interface DocListFilesOutput {
  files: DocFileInfo[];
  total: number;
}
