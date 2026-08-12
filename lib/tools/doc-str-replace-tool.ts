/**
 * @fileoverview Tool definition for finding and replacing exact text in files.
 * The find text must be unique within the file — operations fail if the pattern
 * appears zero times or multiple times. This is the primary editing tool for precise changes.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc-str-replace tool's input.
 */
export const docStrReplaceToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  scope: z
    .enum(['document_store', 'project', 'general'])
    .default('document_store')
    .describe('The file source scope. "document_store" operates on mounted document stores, "project" on project files, "general" on general files.')
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name. Required when scope is "document_store". The reserved value "self" addresses your own character vault.')
    .optional(),
  path: z
    .string()
    .describe('Relative path to the file within the selected scope.')
    .optional(),
  find: z
    .string()
    .describe('Exact text to find in the file. Must be unique — appears exactly once. Include sufficient context to guarantee uniqueness.'),
  replace: z
    .string()
    .describe('Text to replace the find text with. Can be empty string for deletion.'),
  case_sensitive: z
    .boolean()
    .default(true)
    .describe('Whether the find text matching is case-sensitive. Default is true.')
    .optional(),
  normalize_diacritics: z
    .boolean()
    .default(true)
    .describe('Normalize Unicode diacritics for matching (e.g., "Nimue" matches "Nimuë"). Default is true.')
    .optional(),
}).refine((d) => Boolean(d.uri || d.path), 'Provide either a `uri` or a `path`.');

/**
 * Input parameters for the doc-str-replace tool
 */
export type DocStrReplaceInput = z.infer<typeof docStrReplaceToolInputSchema>;

export const docStrReplaceToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_str_replace',
    description:
      'Find and replace exact text in a file. The find text MUST be unique within the file — if it appears zero times or more than once, the operation fails with an error. Include enough surrounding context in the find text to make it unique. This is the primary editing tool: read the file first, identify what to change, then call this tool with enough context for a unique match. For .json / .jsonl / .ndjson files this operates on the raw serialized string; prefer doc_write_file with a native object or array for structural edits.',
    parameters: zodToOpenAISchema(docStrReplaceToolInputSchema),
  },
};

/**
 * Validates input for doc_str_replace tool.
 */
export function validateDocStrReplaceInput(input: unknown): DocStrReplaceInput | null {
  const parsed = docStrReplaceToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}


export interface DocStrReplaceOutput {
  success: boolean;
  path: string;
  /** Canonical qtap:// URI for the edited file. */
  uri?: string;
  mtime: number;
  line_number: number;
}
