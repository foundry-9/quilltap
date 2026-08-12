/**
 * @fileoverview Tool definition for writing file contents to document stores, projects, and general files.
 * Replaces entire file contents. Supports optimistic concurrency control via expected_mtime
 * for safer editing workflows with conflict detection.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the doc-write-file tool's input.
 */
export const docWriteFileToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  scope: z
    .enum(['document_store', 'project', 'general'])
    .default('document_store')
    .describe('The file destination scope. "document_store" writes to mounted document stores, "project" writes to project files, "general" writes to general files.')
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name. Required when scope is "document_store". The reserved value "self" addresses your own character vault.')
    .optional(),
  path: z
    .string()
    .describe('Relative path to the file within the selected scope.')
    .optional(),
  content: z
    .unknown()
    .describe('The complete new contents for the file. For JSON/JSONL files, can be a string (validated) or a native object/array (serialized).'),
  mime_type: z
    .string()
    .describe('Optional MIME type hint; extension detection takes precedence if absent.')
    .optional(),
  expected_mtime: llmNumber(
    z
      .number()
      .describe('Expected modification time from a previous read. If the file has been modified since this time, the write is rejected to prevent overwriting concurrent changes.')
  )
    .optional(),
}).refine((d) => Boolean(d.uri || d.path), 'Provide either a `uri` or a `path`.');

/**
 * Input parameters for the doc-write-file tool
 */
export type DocWriteFileInput = z.infer<typeof docWriteFileToolInputSchema>;

export const docWriteFileToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_write_file',
    description:
      'Write or create a file in a document store, project files, or general files. Replaces the entire file contents. Use expected_mtime for optimistic concurrency when editing existing files.',
    parameters: zodToOpenAISchema(docWriteFileToolInputSchema),
  },
};

/**
 * Validates input for doc_write_file tool.
 */
export function validateDocWriteFileInput(input: unknown): DocWriteFileInput | null {
  const parsed = docWriteFileToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}


export interface DocWriteFileOutput {
  success: boolean;
  path: string;
  /** Canonical qtap:// URI for the written file. */
  uri?: string;
  mtime: number;
}
