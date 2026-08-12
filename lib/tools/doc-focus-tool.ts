/**
 * @fileoverview Tool definition for focusing the user's attention on a specific location in the open document.
 * This is a UI tool — it scrolls the viewport to the target, highlights text, and places an eye icon in the document gutter.
 * Scriptorium Phase 3.5.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the doc_focus tool's input.
 */
export const docFocusToolInputSchema = z
  .object({
    path: z
      .string()
      .describe('Which open document to focus, by file path. Optional when only one document is open; required to disambiguate when several are open. Omit to target the most recently opened document.')
      .optional(),
    scope: z
      .enum(['project', 'document_store', 'general'])
      .describe('Scope of the target document, matched alongside path/mount_point when several documents are open.')
      .optional(),
    mount_point: z
      .string()
      .describe('Mount point of the target document (for document_store scope), matched alongside path when several documents are open.')
      .optional(),
    anchor: z
      .string()
      .describe('Heading text (without # markers) to scroll to. Narrows the search for highlight matching.')
      .optional(),
    highlight: z
      .string()
      .describe('A short text string to find and briefly highlight in the document.')
      .optional(),
    line: llmNumber(
      z
        .number()
        .describe('Line number to scroll to. Used as fallback when string matching is not viable.')
    )
      .optional(),
    clear_focus: z
      .boolean()
      .describe('If true, removes the attention marker from the gutter. No other parameters needed.')
      .optional(),
  })
  .refine(
    (obj) =>
      obj.anchor !== undefined ||
      obj.highlight !== undefined ||
      obj.line !== undefined ||
      obj.clear_focus === true,
    'At least one parameter must be provided'
  );

/**
 * Input parameters for the doc_focus tool
 */
export type DocFocusInput = z.infer<typeof docFocusToolInputSchema>;

/**
 * Validates input for doc_focus tool.
 */
export function validateDocFocusInput(input: unknown): DocFocusInput | null {
  const parsed = docFocusToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const docFocusToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_focus',
    description:
      "Direct the user's attention to a specific location in an open document. Scrolls the viewport to the target, optionally highlights a text passage with a brief animation, and places an eye icon in the document gutter. Several documents may be open at once — pass `path` (and `scope`/`mount_point` if needed) to choose which one; omit it to target the most recently opened document.",
    parameters: zodToOpenAISchema(docFocusToolInputSchema),
  },
};

export interface DocFocusOutput {
  success: boolean;
  /** Identity of the document the focus was routed to, so the client can scroll
   * the correct pane when several documents are open. */
  chatDocumentId?: string;
  filePath?: string;
  scope?: string;
  mountPoint?: string | null;
  anchor?: string;
  highlight?: string;
  line?: number;
  clear_focus?: boolean;
  error?: string;
}
