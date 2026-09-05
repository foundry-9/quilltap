/**
 * LoRA scale bounds — the dependency-free half of `lora-support`.
 *
 * `lora-support` reads the in-process plugin registry and logs through the
 * server logger, so the browser-side `LoraListEditor` cannot import it; the
 * constant and the pure bounds resolver both sides need live here instead.
 *
 * @module lib/image-gen/lora-scale
 */

import type { ImageLoraSupport } from '@quilltap/plugin-types';

/**
 * Scale bounds used when a plugin declares `loraSupport` but no `scale` block.
 * Permissive on purpose — the provider's own default applies when the user
 * leaves the slider alone, and every provider surveyed tops out at or below 4.
 */
export const DEFAULT_LORA_SCALE = { min: 0, max: 2, default: 1, step: 0.05 } as const;

/** The scale bounds the editor and the capper should use for this support. */
export function resolveLoraScaleBounds(
  support: ImageLoraSupport,
): { min: number; max: number; default: number; step: number } {
  const declared = support.scale;
  if (!declared) {
    return { ...DEFAULT_LORA_SCALE };
  }
  return {
    min: declared.min,
    max: declared.max,
    default: declared.default,
    step: declared.step ?? DEFAULT_LORA_SCALE.step,
  };
}
