/**
 * @fileoverview Tool definition for `keep_image` — saves a generated image
 * into the calling character's photo album (their character vault's
 * `photos/` folder). Creates a hard link to the existing image binary and
 * stores a Markdown context document (prompt + scene snapshot + caption) as
 * the link's per-mount text representation, making the photo searchable
 * through the standard character-vault search.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the keep-image tool's input. The single source of truth for both
 * runtime validation and the derived OpenAI-format `parameters` JSON Schema.
 */
export const keepImageToolInputSchema = z.object({
  uuid: z
    .string()
    .min(1)
    .describe('UUID of the image to keep. Use the id returned by generate_image, list_images, or the catalogue handle from a Librarian "Image attached" announcement.'),
  caption: z
    .string()
    .describe('Optional short caption describing what you wanted to remember about this image.')
    .optional(),
  tags: z
    .array(z.string())
    .describe('Optional freeform retrieval labels. Indexed alongside the prompt for semantic search.')
    .optional(),
});

/**
 * Input parameters for the keep-image tool
 */
export type KeepImageInput = z.infer<typeof keepImageToolInputSchema>;

export const keepImageToolDefinition = {
  type: 'function',
  function: {
    name: 'keep_image',
    description:
      "Save an image to your photo album (a `photos/` folder in your character vault) so it survives chat garbage collection and becomes searchable from your memory. Pass the UUID of an image that was generated in this chat, or the catalogue handle the Librarian announced when someone attached a photo from a gallery. Caption and tags are optional freeform labels for retrieval — they are not the platform's global Tag system. Returns the path the image now lives at in your vault. If you've already kept this image, the call fails — delete the existing copy first if you want to amend the caption or tags.",
    parameters: zodToOpenAISchema(keepImageToolInputSchema),
  },
};

export function validateKeepImageInput(input: unknown): KeepImageInput | null {
  const parsed = keepImageToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export interface KeepImageOutput {
  success: boolean;
  /** Mount-point display name where the photo now lives. */
  mount_point: string;
  /** Final path inside that mount, e.g. "photos/2026-05-14T07-22-33.000Z-foo.webp". */
  relative_path: string;
  /** UUID of the new doc_mount_file_links row. */
  link_id: string;
  /** ISO timestamp of the keep. */
  kept_at: string;
  /** Image-v2 FileEntry uuid that was kept (mirrors the input). */
  file_id: string;
  /** SHA-256 of the image binary. */
  sha256: string;
}
