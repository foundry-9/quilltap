/**
 * @fileoverview Tool definition for reading file contents from document stores, projects, and general files.
 * Supports pagination via offset and limit for handling large files.
 * Returns file content with metadata including modification time for the read-then-replace workflow.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the doc-read-file tool's input.
 */
export const docReadFileToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  scope: z
    .enum(['document_store', 'project', 'general'])
    .default('document_store')
    .describe('The file source scope. "document_store" reads from mounted document stores, "project" reads from project files, "general" reads from general files.')
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name. Required when scope is "document_store". The reserved value "self" addresses your own character vault.')
    .optional(),
  path: z
    .string()
    .describe('Relative path to the file within the selected scope.')
    .optional(),
  offset: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .describe('Start line number (1-based) for pagination. Default is 1.')
  )
    .optional(),
  limit: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .describe('Maximum number of lines to return. Default returns all lines.')
  )
    .optional(),
}).refine((d) => Boolean(d.uri || d.path), 'Provide either a `uri` or a `path`.');

/**
 * Input parameters for the doc-read-file tool
 */
export type DocReadFileInput = z.infer<typeof docReadFileToolInputSchema>;

export const docReadFileToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_read_file',
    description:
      'Read the contents of a file from a document store, project files, or general files. Returns the file content with modification time for the read-then-replace workflow. Use offset and limit for large files.',
    parameters: zodToOpenAISchema(docReadFileToolInputSchema),
  },
};

/**
 * Validates input for doc_read_file tool.
 */
export function validateDocReadFileInput(input: unknown): DocReadFileInput | null {
  const parsed = docReadFileToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}


export interface DocReadFileOutput {
  content: string | unknown;  // raw string for text/*; parsed value for JSON/JSONL (string on parse failure)
  rawContent?: string;        // always populated for JSON/JSONL reads
  parsed?: boolean;           // true iff JSON/JSONL and parse succeeded (JSONL: true if at least one line parsed)
  parseError?: { message: string; line?: number };
  mimeType?: string;
  path: string;
  /** Canonical qtap:// URI for the file (e.g. "qtap://self/Notes/today.md"). */
  uri?: string;
  mtime: number;
  totalLines: number;
  truncated: boolean;
  // True when content is plain text derived from a binary blob (e.g. pdf/docx
  // extraction) rather than the file's original bytes. The blob's raw bytes
  // remain accessible via the blob read endpoint but are not returned here.
  derivedFromBlob?: boolean;
}
