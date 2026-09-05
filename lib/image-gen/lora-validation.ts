/**
 * Write-side guard for the `parameters.loras` key on an image profile.
 *
 * `parameters` is an opaque JSON bag, which is exactly what makes LoRAs fit
 * without a migration — and exactly why nothing else would notice a malformed
 * list going in. This validates before the write, so a bad list is a 400 with
 * nothing stored, never a profile that saves cleanly and then fails at
 * generation time (the P4.55 / P4.D120 guard-order lesson).
 *
 * Bounds here are deliberately global and permissive: per-model caps and scale
 * ranges belong to the editor and the plugin, and a profile may legitimately
 * be edited before a model is chosen.
 *
 * @module lib/image-gen/lora-validation
 */

import { z } from 'zod';
import { ImageLoraSpecSchema } from '@/lib/schemas/profile.types';

/** The `loras` key inside a profile's `parameters` bag, when present. */
const ImageProfileLorasSchema = z.array(ImageLoraSpecSchema);

/**
 * Validate the `loras` key of an incoming `parameters` bag.
 *
 * Returns `null` when there is nothing to complain about — the key is absent,
 * or every entry parses. Returns the `ZodError` otherwise, for the caller to
 * hand to `validationError()`.
 */
export function validateProfileLoras(parameters: unknown): z.ZodError | null {
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    return null; // The caller's own "parameters must be an object" check owns this.
  }

  const raw = (parameters as Record<string, unknown>).loras;
  if (raw === undefined) {
    return null;
  }

  const result = ImageProfileLorasSchema.safeParse(raw);
  return result.success ? null : result.error;
}
