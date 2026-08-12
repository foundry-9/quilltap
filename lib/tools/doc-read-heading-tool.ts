/**
 * @fileoverview Tool definition for reading content under specific headings in markdown files.
 * Returns everything from the specified heading to the next heading of the same or higher level.
 * Supports disambiguation by heading level when heading text appears multiple times.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the doc-read-heading tool's input.
 */
export const docReadHeadingToolInputSchema = z.object({
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
  heading: z
    .string()
    .describe('Heading text without # markers. For example, "Character Backstory" for the heading "## Character Backstory".')
    .optional(),
  level: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(6)
      .describe('Heading level (1-6) if the heading text is ambiguous. Use this to disambiguate when the same heading text appears at different levels.')
  )
    .optional(),
}).refine((d) => Boolean(d.uri || d.path), 'Provide either a `uri` or a `path`.');

/**
 * Input parameters for the doc-read-heading tool
 */
export type DocReadHeadingInput = z.infer<typeof docReadHeadingToolInputSchema>;

export const docReadHeadingToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_read_heading',
    description:
      'Read all content under a specific heading in a markdown file. Returns everything from the heading to the next heading of the same or higher level. If the heading text is ambiguous (appears multiple times), use the level parameter to disambiguate.',
    parameters: zodToOpenAISchema(docReadHeadingToolInputSchema),
  },
};

/**
 * Validates input for doc_read_heading tool.
 */
export function validateDocReadHeadingInput(input: unknown): DocReadHeadingInput | null {
  const parsed = docReadHeadingToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}


export interface DocReadHeadingOutput {
  content: string;
  heading: string;
  level: number;
  path: string;
  /** Canonical qtap:// URI for the file (fragment carries the heading). */
  uri?: string;
}
