/**
 * @fileoverview Tool definition for reading YAML frontmatter from markdown files.
 * Extracts frontmatter as structured data with optional filtering to specific keys.
 * Returns parsed frontmatter with the file path for reference.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc-read-frontmatter tool's input.
 */
export const docReadFrontmatterToolInputSchema = z.object({
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
    .describe('Relative path to the markdown file within the selected scope.')
    .optional(),
  keys: z
    .array(z.string())
    .describe('Specific frontmatter keys to retrieve. If omitted, returns all keys.')
    .optional(),
}).refine((d) => Boolean(d.uri || d.path), 'Provide either a `uri` or a `path`.');

/**
 * Input parameters for the doc-read-frontmatter tool
 */
export type DocReadFrontmatterInput = z.infer<typeof docReadFrontmatterToolInputSchema>;

export const docReadFrontmatterToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_read_frontmatter',
    description:
      'Read YAML frontmatter from a markdown file. Returns the frontmatter as structured data. Optionally specify keys to retrieve only specific properties. If no frontmatter block exists, returns null.',
    parameters: zodToOpenAISchema(docReadFrontmatterToolInputSchema),
  },
};

/**
 * Validates input for doc_read_frontmatter tool.
 */
export function validateDocReadFrontmatterInput(input: unknown): DocReadFrontmatterInput | null {
  const parsed = docReadFrontmatterToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}


export interface DocReadFrontmatterOutput {
  frontmatter: Record<string, unknown> | null;
  path: string;
  /** Canonical qtap:// URI for the file. */
  uri?: string;
}
