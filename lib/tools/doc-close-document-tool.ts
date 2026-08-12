/**
 * @fileoverview Tool definition for closing the Document Mode editor pane.
 * This is a UI tool — it closes the document pane and returns to the normal chat layout.
 * Scriptorium Phase 3.5.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_close_document tool's input.
 */
export const docCloseDocumentToolInputSchema = z.object({
  path: z
    .string()
    .describe('Which open document to close, by file path. Optional when only one document is open; omit to close the most recently opened document.')
    .optional(),
  scope: z
    .enum(['project', 'document_store', 'general'])
    .describe('Scope of the target document, matched alongside path/mount_point when several documents are open.')
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point of the target document (for document_store scope), matched alongside path when several documents are open.')
    .optional(),
  reason: z
    .string()
    .describe('Optional reason for closing the document. Shown to the user as a system note.')
    .optional(),
});

/**
 * Input parameters for the doc_close_document tool
 */
export type DocCloseDocumentInput = z.infer<typeof docCloseDocumentToolInputSchema>;

/**
 * Validates input for doc_close_document tool.
 */
export function validateDocCloseDocumentInput(input: unknown): DocCloseDocumentInput | null {
  const parsed = docCloseDocumentToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const docCloseDocumentToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_close_document',
    description:
      'Close one open Document Mode editor pane. Any pending changes are saved automatically before closing. Several documents may be open at once — pass `path` (and `scope`/`mount_point` if needed) to choose which one; omit it to close the most recently opened document. The document state is cached for the session — reopening it does not require a full reload.',
    parameters: zodToOpenAISchema(docCloseDocumentToolInputSchema),
  },
};

export interface DocCloseDocumentOutput {
  success: boolean;
  message: string;
}
