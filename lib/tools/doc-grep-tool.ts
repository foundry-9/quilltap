/**
 * @fileoverview Tool definition for searching text across files in document stores and project files.
 * Searches all available sources including mounted document stores and project files.
 * Returns matches with file paths, line numbers, and optional context.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the doc_grep tool's input.
 */
export const docGrepToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  query: z.string().describe('Search string or regex pattern to find.'),
  path: z
    .string()
    .describe('Optional: restrict search to a specific file or folder path. If a folder, searches recursively.')
    .optional(),
  mount_point: z
    .string()
    .describe('Optional: restrict search to a specific mount point (name or ID). Pass "self" to search only your own character vault. Without this, searches all mounted points.')
    .optional(),
  is_regex: z
    .boolean()
    .default(false)
    .describe('Treat query as a regular expression rather than literal text.')
    .optional(),
  case_sensitive: z
    .boolean()
    .default(false)
    .describe('Case-sensitive matching. Default is case-insensitive.')
    .optional(),
  normalize_diacritics: z
    .boolean()
    .default(true)
    .describe('Normalize Unicode diacritics for matching (e.g., "Nimue" matches "Nimuë"). Default is true.')
    .optional(),
  context_lines: llmNumber(
    z
      .number()
      .int()
      .min(0)
      .describe('Number of lines of context to include before and after each match.')
  )
    .default(0)
    .optional(),
  max_results: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .describe('Maximum number of matching lines to return.')
  )
    .default(100)
    .optional(),
});

/**
 * Input parameters for the doc_grep tool
 */
export type DocGrepInput = z.infer<typeof docGrepToolInputSchema>;

/**
 * Validates input for doc_grep tool.
 */
export function validateDocGrepInput(input: unknown): DocGrepInput | null {
  const parsed = docGrepToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const docGrepToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_grep',
    description:
      'Search for text across files in document stores and project files. Returns matching lines with file paths and line numbers. Searches all mount points linked to the current project plus project files.',
    parameters: zodToOpenAISchema(docGrepToolInputSchema),
  },
};

export interface DocGrepMatch {
  path: string;
  mount_point?: string;
  /** Canonical qtap:// URI for the matched file (document-store matches only). */
  uri?: string;
  line_number: number;
  match: string;
  context_before?: string[];
  context_after?: string[];
}

export interface DocGrepOutput {
  matches: DocGrepMatch[];
  total_matches: number;
}
