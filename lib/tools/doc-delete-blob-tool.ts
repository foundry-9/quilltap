/**
 * @fileoverview Tool definition for deleting a binary blob asset from a document store.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_delete_blob tool's input.
 */
export const docDeleteBlobToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  mount_point: z.string().describe('Mount point name or ID holding the blob. Pass "self" for your own character vault.').optional(),
  path: z.string().describe('Relative path to the blob within the mount point.').optional(),
}).refine((d) => Boolean(d.uri || (d.mount_point && d.path)), 'Provide either a `uri` or both `mount_point` and `path`.');

/**
 * Input parameters for the doc_delete_blob tool
 */
export type DocDeleteBlobInput = z.infer<typeof docDeleteBlobToolInputSchema>;

/**
 * Validates input for doc_delete_blob tool.
 */
export function validateDocDeleteBlobInput(input: unknown): DocDeleteBlobInput | null {
  const parsed = docDeleteBlobToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const docDeleteBlobToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_delete_blob',
    description:
      'Delete a binary asset from a document store. Markdown references to the deleted blob will 404 until re-uploaded.',
    parameters: zodToOpenAISchema(docDeleteBlobToolInputSchema),
  },
};

export interface DocDeleteBlobOutput {
  success: boolean;
  mount_point: string;
  relative_path: string;
  /** Canonical qtap:// URI for the (now-deleted) blob. */
  uri?: string;
}
