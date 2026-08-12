/**
 * @fileoverview Tool definition for `list_images` — searches and lists
 * images previously kept to a character's photo album (and, when Shared
 * Vaults is on, the visible albums of other characters in the chat).
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the list-images tool's input. The single source of truth for both
 * runtime validation and the derived OpenAI-format `parameters` JSON Schema.
 */
export const listImagesToolInputSchema = z.object({
  query: z
    .string()
    .describe('Optional semantic search query. Searches the saved prompt, scene, caption, and tags.')
    .optional(),
  tags: z
    .array(z.string())
    .describe('Optional tag filter. An image matches if any of its tags appears in the list.')
    .optional(),
  saved_by: z
    .string()
    .describe('Optional filter: character name or id of the character who saved the image. Defaults to all visible albums.')
    .optional(),
  limit: llmNumber(
    z
      .number()
      .describe('Maximum results to return. Defaults to 20.')
  )
    .optional(),
  offset: llmNumber(
    z
      .number()
      .describe('Pagination offset. Defaults to 0.')
  )
    .optional(),
});

/**
 * Input parameters for the list-images tool
 */
export type ListImagesInput = z.infer<typeof listImagesToolInputSchema>;

export const listImagesToolDefinition = {
  type: 'function',
  function: {
    name: 'list_images',
    description:
      "List images previously saved to your photo album (and other characters' albums if cross-character vault reads are enabled for this chat). When `query` is set, results are ranked by semantic similarity over the saved image's prompt, scene snapshot, caption, and tags. The returned metadata includes the prompt excerpt so even a non-image-capable model can reason about each entry without rendering it. Use the returned uuid with `attach_image` to show one of these images again in the chat.",
    parameters: zodToOpenAISchema(listImagesToolInputSchema),
  },
};

export function validateListImagesInput(input: unknown): ListImagesInput | null {
  const parsed = listImagesToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export interface ListedImage {
  /** doc_mount_file_links.id — the album link uuid; pass this to attach_image. */
  uuid: string;
  /** Path inside the vault mount point. */
  relative_path: string;
  /** Mount point display name. */
  mount_point: string;
  /** Saver. */
  linked_by: string | null;
  linked_by_id: string | null;
  /** ISO timestamp the photo was kept. */
  kept_at: string;
  caption: string | null;
  tags: string[];
  /** First ~200 chars of the generation prompt for at-a-glance scanning. */
  generation_prompt_excerpt: string;
  /** Set when `query` was supplied: cosine score (with literal boosts) of the top hit. */
  relevance_score?: number;
}

export interface ListImagesOutput {
  images: ListedImage[];
  total: number;
  has_more: boolean;
}
