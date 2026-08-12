/**
 * @fileoverview Tool definition for listing binary blob assets in a document store.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_list_blobs tool's input.
 */
export const docListBlobsToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  mount_point: z.string().describe('Mount point name or ID to enumerate blobs for. Pass "self" for your own character vault.').optional(),
  folder: z
    .string()
    .describe('Optional folder prefix to filter results (e.g. "images").')
    .optional(),
}).refine((d) => Boolean(d.uri || d.mount_point), 'Provide either a `uri` or a `mount_point`.');

/**
 * Input parameters for the doc_list_blobs tool
 */
export type DocListBlobsInput = z.infer<typeof docListBlobsToolInputSchema>;

/**
 * Validates input for doc_list_blobs tool.
 */
export function validateDocListBlobsInput(input: unknown): DocListBlobsInput | null {
  const parsed = docListBlobsToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const docListBlobsToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_list_blobs',
    description:
      'List binary assets (images, etc.) stored in a document store. Returns metadata only — use doc_read_blob with include_bytes for the raw bytes.',
    parameters: zodToOpenAISchema(docListBlobsToolInputSchema),
  },
};

export interface DocBlobSummary {
  relative_path: string;
  /** Canonical qtap:// URI for the blob. */
  uri?: string;
  original_filename: string;
  original_mime_type: string;
  stored_mime_type: string;
  size_bytes: number;
  description: string;
}

export interface DocListBlobsOutput {
  mount_point: string;
  blobs: DocBlobSummary[];
  total: number;
}
