/**
 * @fileoverview Tool definition for writing binary blob assets (images first)
 * into a document store. Accepts base64-encoded bytes; the server transcodes
 * images to WebP via sharp before storing in doc_mount_blobs.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc-write-blob tool's input.
 */
export const docWriteBlobToolInputSchema = z.object({
  uri: z
    .string()
    .describe('A qtap:// URI addressing the target, e.g. "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.')
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name or ID that should receive the blob. Pass "self" for your own character vault.')
    .optional(),
  path: z
    .string()
    .describe('Desired relative path within the mount point, e.g. "images/avatar.png". If the upload is transcoded to WebP the extension is rewritten to .webp.')
    .optional(),
  data_base64: z
    .string()
    .describe('Base64-encoded bytes of the asset to upload.'),
  original_filename: z
    .string()
    .describe('Original filename as the user provided it. Preserved as metadata.'),
  mime_type: z
    .string()
    .describe('MIME type of the uploaded bytes (e.g. image/png, image/jpeg).'),
  description: z
    .string()
    .describe('Optional human-authored description / transcript of the asset. Consumed by the embedding pipeline so the blob becomes searchable.')
    .optional(),
}).refine((d) => Boolean(d.uri || (d.mount_point && d.path)), 'Provide either a `uri` or both `mount_point` and `path`.');

/**
 * Input parameters for the doc-write-blob tool
 */
export type DocWriteBlobInput = z.infer<typeof docWriteBlobToolInputSchema>;

export const docWriteBlobToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_write_blob',
    description:
      'Upload a binary asset (image) into a document store. Accepts base64-encoded bytes and stores them in the mount-index database (SQLCipher-encrypted). Images are transcoded to WebP automatically. Use the returned relative_path in Markdown references like ![alt](images/my-pic.webp).',
    parameters: zodToOpenAISchema(docWriteBlobToolInputSchema),
  },
};

export function validateDocWriteBlobInput(input: unknown): DocWriteBlobInput | null {
  const parsed = docWriteBlobToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}


export interface DocWriteBlobOutput {
  success: boolean;
  mount_point: string;
  /** Final path the blob is stored under (may differ from input when transcoded). */
  relative_path: string;
  /** Canonical qtap:// URI for the stored blob. */
  uri?: string;
  size_bytes: number;
  stored_mime_type: string;
  sha256: string;
}
