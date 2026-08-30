/**
 * Image Orientation Resolver
 *
 * The single host-side helper that turns a semantic `(provider, model,
 * orientation)` request into the concrete mutation each provider understands —
 * a `size` string, an `aspectRatio` string, or a phrase appended to the prompt.
 *
 * Callers (avatars, story backgrounds, the `generate_image` tool) speak only
 * `portrait | landscape | square`; this module owns the mapping so no call site
 * re-implements it. It is **pure** — it reads the in-process plugin registry
 * with no DB or network access, so it is safe to call inside the forked
 * background-job child.
 *
 * Lookup order:
 *   1. Per-model `orientationSupport` (from the provider's
 *      `getImageGenerationModels()` declaration), matched on `model`.
 *   2. Provider-level `orientationSupport` (from `getImageProviderConstraints()`).
 *   3. Host fallback — generic prompt hints, flagged non-authoritative — so
 *      portrait/landscape always resolve to *something*, even for a plugin that
 *      declares nothing.
 *
 * @module lib/image-gen/orientation
 */

import {
  getImageProviderConstraints,
  getImageGenerationModels,
} from '@/lib/plugins/provider-registry';
import type {
  ImageGenParams,
  ImageGenerationModelInfo,
  ImageOrientation,
  ImageOrientationSupport,
  OrientationMapping,
} from '@quilltap/plugin-types';

export interface ResolvedOrientation {
  /** Mutations to merge into ImageGenParams before calling generateImage. */
  params: Partial<Pick<ImageGenParams, 'size' | 'aspectRatio'>>;
  /** Phrase to append to the prompt (prompt-strategy / fallback), else ''. */
  promptHint: string;
  /**
   * Whether the returned dimensions are trustworthy a priori. False for
   * prompt-strategy providers and the host fallback — callers measure the
   * result regardless, so this is for UI/optimistic display and logging only.
   */
  dimensionsAuthoritative: boolean;
  /** Nominal dims for UI/optimistic display only. */
  nominalWidth?: number;
  nominalHeight?: number;
}

/** Generic, provider-agnostic phrasing used when nothing more specific exists. */
const HOST_FALLBACK_HINTS: Record<ImageOrientation, string> = {
  portrait: 'vertical portrait composition, taller than wide',
  landscape: 'wide landscape composition, wider than tall',
  square: 'square composition',
};

/**
 * Find the model-info entry whose declarations apply to `model`.
 *
 * Exact id match wins; otherwise the longest-prefix family match (so a plugin
 * can list just `gpt-image-1` / `dall-e-3` / `dall-e-2` and still match dated
 * SKUs like `gpt-image-1-mini`). Returns undefined when nothing matches.
 *
 * Exported because LoRA support resolves the same way orientation does — one
 * matcher, two capabilities, no second implementation to drift.
 */
export function matchModel(
  models: ImageGenerationModelInfo[] | null,
  model: string | undefined,
): ImageGenerationModelInfo | undefined {
  if (!models || !model) {
    return undefined;
  }
  const exact = models.find(m => m.id === model);
  if (exact) {
    return exact;
  }
  return models
    .filter(m => model.startsWith(m.id))
    .sort((a, b) => b.id.length - a.id.length)[0];
}

/**
 * Turn a concrete orientation mapping into a ResolvedOrientation, honouring the
 * provider's strategy. A `size`/`aspectRatio` strategy whose mapping is missing
 * its concrete field (e.g. dall-e-2 portrait) degrades to a prompt hint rather
 * than emitting a value the provider would reject.
 */
function realize(
  strategy: ImageOrientationSupport['strategy'],
  mapping: OrientationMapping,
  fallbackHint: string,
): ResolvedOrientation {
  const nominal = { nominalWidth: mapping.nominalWidth, nominalHeight: mapping.nominalHeight };

  if (strategy === 'size' && mapping.size) {
    return { params: { size: mapping.size }, promptHint: '', dimensionsAuthoritative: true, ...nominal };
  }
  if (strategy === 'aspectRatio' && mapping.aspectRatio) {
    return { params: { aspectRatio: mapping.aspectRatio }, promptHint: '', dimensionsAuthoritative: true, ...nominal };
  }
  // 'prompt' strategy, or a size/aspectRatio mapping that only carries a hint.
  return {
    params: {},
    promptHint: mapping.promptHint ?? fallbackHint,
    dimensionsAuthoritative: false,
    ...nominal,
  };
}

/**
 * Resolve a semantic orientation into the concrete request mutation for a
 * specific provider/model. Always returns a usable result (never throws on an
 * unknown provider) thanks to the host fallback.
 */
export function resolveOrientation(
  provider: string,
  model: string | undefined,
  orientation: ImageOrientation,
): ResolvedOrientation {
  const fallbackHint = HOST_FALLBACK_HINTS[orientation];

  // 1. Per-model override, then 2. provider-level default.
  const support: ImageOrientationSupport | undefined =
    matchModel(getImageGenerationModels(provider), model)?.orientationSupport ??
    getImageProviderConstraints(provider)?.orientationSupport ??
    undefined;

  if (support) {
    const mapping = support[orientation];
    if (mapping) {
      return realize(support.strategy, mapping, fallbackHint);
    }
    // Orientation declared-but-absent (e.g. dall-e-2 has square only): fall
    // through to the generic hint below.
  }

  // 3. Host fallback — generic prompt hints, never authoritative.
  return { params: {}, promptHint: fallbackHint, dimensionsAuthoritative: false };
}
