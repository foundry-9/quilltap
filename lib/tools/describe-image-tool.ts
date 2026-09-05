/**
 * @fileoverview Tool definition for `describe_image` — the "what is actually
 * in this picture?" verb.
 *
 * Before this existed, a character's entire image vocabulary was custodial:
 * `keep_image` (file it away), `attach_image` (show it to the room again) and
 * `list_images` (what have I filed?). None of them answers the question a
 * character actually has when a picture lands in the chat, so models reached
 * for `attach_image` — the only one whose name sounds like engagement — and
 * got told to file the image first, which is filing advice in answer to a
 * looking question (bug 92).
 *
 * The description usually costs nothing: chat uploads are auto-described on
 * arrival (`lib/photos/auto-describe-attachment.ts`) and Quilltap-generated
 * images carry the prompt that made them. The handler only spends a vision
 * call when neither exists.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the describe-image tool's input. The single source of truth
 * for both runtime validation and the derived OpenAI-format `parameters`.
 */
export const describeImageToolInputSchema = z.object({
  uuid: z
    .string()
    .min(1)
    .describe('UUID of the image to look at: the uuid from a Librarian upload announcement, an image-v2 file uuid, the id returned by generate_image, or an album link uuid from keep_image / list_images.'),
});

/**
 * Input parameters for the describe-image tool
 */
export type DescribeImageInput = z.infer<typeof describeImageToolInputSchema>;

export const describeImageToolDefinition = {
  type: 'function',
  function: {
    name: 'describe_image',
    description:
      "Look at an image and get a detailed description of what it contains. Use this whenever you need to know what is IN a picture — one the user just uploaded, one you generated, or one in an album. This is the only tool that tells you what an image depicts; keep_image and attach_image are filing and display, and neither shows you anything. Most images are already described, so this is usually instant; otherwise it runs a vision model. If the image was attached to a recent message and you can already see it, you don't need this — use it when you can't, or when you want the detail.",
    parameters: zodToOpenAISchema(describeImageToolInputSchema),
  },
};

export function validateDescribeImageInput(input: unknown): DescribeImageInput | null {
  const parsed = describeImageToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export interface DescribeImageOutput {
  /** Image-v2 FileEntry uuid the description belongs to. */
  file_id: string;
  filename: string;
  mime_type: string;
  width?: number;
  height?: number;
  /** The description itself. */
  description: string;
  /**
   * Where the text came from: a description stored at upload time, the prompt
   * that generated the image, or a vision call made just now.
   */
  source: 'stored-description' | 'generation-prompt' | 'vision-call';
}
