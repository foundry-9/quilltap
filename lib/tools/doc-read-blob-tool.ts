/**
 * @fileoverview Tool definition for reading a binary blob asset's metadata
 * (and optionally its bytes as base64) from a document store.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc-read-blob tool's input.
 */
export const docReadBlobToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name or ID holding the blob. Pass "self" for your own character vault.')
    .optional(),
  path: z
    .string()
    .describe('Relative path to the blob within the mount point (e.g. images/avatar.webp).')
    .optional(),
  include_bytes: z
    .boolean()
    .default(false)
    .describe('When true, returns the blob bytes as base64 alongside its metadata. Default false keeps responses compact.')
    .optional(),
}).refine((d) => Boolean(d.uri || (d.mount_point && d.path)), 'Provide either a `uri` or both `mount_point` and `path`.');

/**
 * Input parameters for the doc-read-blob tool
 */
export type DocReadBlobInput = z.infer<typeof docReadBlobToolInputSchema>;

export const docReadBlobToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_read_blob',
    description:
      'Read metadata (and optionally bytes) for a binary asset previously uploaded to a document store via doc_write_blob.',
    parameters: zodToOpenAISchema(docReadBlobToolInputSchema),
  },
};

export function validateDocReadBlobInput(input: unknown): DocReadBlobInput | null {
  const parsed = docReadBlobToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}


export interface DocReadBlobOutput {
  mount_point: string;
  relative_path: string;
  /** Canonical qtap:// URI for the blob. */
  uri?: string;
  original_filename: string;
  original_mime_type: string;
  stored_mime_type: string;
  size_bytes: number;
  sha256: string;
  description: string;
  data_base64?: string;
}
