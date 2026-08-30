/**
 * LoRA support resolver.
 *
 * The single host-side helper that answers "may this provider/model take LoRA
 * adapters, and how many?" — and, given a user's stored list, produces the
 * capped, validated list that will actually ride the request.
 *
 * A plugin opts in by declaring `loraSupport`, either per-model on
 * `getImageGenerationModels()` or provider-wide on
 * `getImageProviderConstraints()`. A plugin that declares nothing resolves to
 * `null` here, the editor hides itself, and `ImageGenParams.loras` is never
 * set — which is the whole genericity guarantee: adding LoRAs to one provider
 * costs every other provider zero lines.
 *
 * Lookup order mirrors `resolveOrientation` exactly:
 *   1. Per-model `loraSupport` (exact id, then longest-prefix family match).
 *   2. Provider-level `loraSupport`.
 *   3. None.
 *
 * Like the orientation resolver this module is **pure** — it reads the
 * in-process plugin registry with no DB or network access, so it is safe to
 * call inside the forked background-job child.
 *
 * @module lib/image-gen/lora-support
 */

import {
  getImageProviderConstraints,
  getImageGenerationModels,
} from '@/lib/plugins/provider-registry';
import { logger } from '@/lib/logger';
import { matchModel } from './orientation';
import type { ImageLoraSpec, ImageLoraSupport } from '@quilltap/plugin-types';

/**
 * Scale bounds used when a plugin declares `loraSupport` but no `scale` block.
 * Permissive on purpose — the provider's own default applies when the user
 * leaves the slider alone, and every provider surveyed tops out at or below 4.
 */
export const DEFAULT_LORA_SCALE = { min: 0, max: 2, default: 1, step: 0.05 } as const;

/**
 * Resolve LoRA support for a provider/model pair. Returns `null` when neither
 * the model nor the provider declares any — the signal every caller reads as
 * "this profile has no LoRA story; do not offer one, do not send one."
 */
export function resolveLoraSupport(
  provider: string,
  model: string | undefined,
): ImageLoraSupport | null {
  const perModel = matchModel(getImageGenerationModels(provider), model)?.loraSupport;
  if (perModel) {
    return perModel;
  }
  return getImageProviderConstraints(provider)?.loraSupport ?? null;
}

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

/**
 * Read the `loras` list off an image profile's `parameters` bag.
 *
 * Storage is an opaque JSON blob that also round-trips through `.qtap`
 * imports and hand-edited backups, so this re-checks the shape rather than
 * trusting it: entries that are not objects with a non-empty `source` are
 * dropped, and a non-finite or out-of-range `scale` is dropped down to
 * "unset" rather than poisoning the request. Every drop is named in the log.
 */
export function readLorasFromParameters(
  parameters: Record<string, unknown> | null | undefined,
  logContext: { provider: string; model?: string },
): ImageLoraSpec[] {
  const raw = parameters?.loras;
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    logger.warn('[Image LoRA] Ignoring a `loras` parameter that is not a list', {
      ...logContext,
      storedType: typeof raw,
    });
    return [];
  }

  const kept: ImageLoraSpec[] = [];
  const dropped: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      dropped.push(String(entry));
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const source = typeof candidate.source === 'string' ? candidate.source.trim() : '';
    if (!source) {
      dropped.push('(entry with no source)');
      continue;
    }

    const spec: ImageLoraSpec = { source };

    if (candidate.scale !== undefined) {
      const scale = Number(candidate.scale);
      if (Number.isFinite(scale) && scale >= 0 && scale <= 10) {
        spec.scale = scale;
      } else {
        logger.warn('[Image LoRA] Dropping an out-of-range scale; the provider default applies', {
          ...logContext,
          source,
          storedScale: candidate.scale,
        });
      }
    }
    if (typeof candidate.triggerPhrase === 'string' && candidate.triggerPhrase.trim()) {
      spec.triggerPhrase = candidate.triggerPhrase.trim();
    }
    if (typeof candidate.label === 'string' && candidate.label.trim()) {
      spec.label = candidate.label.trim();
    }

    kept.push(spec);
  }

  if (dropped.length > 0) {
    logger.warn('[Image LoRA] Dropped malformed entries from a profile\'s stored LoRA list', {
      ...logContext,
      dropped,
      keptCount: kept.length,
    });
  }

  return kept;
}

/**
 * Cap a stored LoRA list against the resolved support, naming anything that
 * falls off. Never silently drops: an over-cap profile (saved against a
 * four-adapter model, then pointed at a one-adapter model) logs the sources
 * it is leaving behind, and the profile itself keeps them so switching the
 * model back loses nothing.
 */
export function capLoras(
  loras: ImageLoraSpec[],
  support: ImageLoraSupport | null,
  logContext: { provider: string; model?: string },
): ImageLoraSpec[] {
  if (loras.length === 0) {
    return [];
  }
  if (!support) {
    logger.warn('[Image LoRA] Stripping LoRAs — this provider/model declares no LoRA support', {
      ...logContext,
      stripped: loras.map(l => l.source),
    });
    return [];
  }

  const max = Math.max(0, Math.floor(support.maxLoras));
  if (loras.length <= max) {
    return loras;
  }

  const kept = loras.slice(0, max);
  logger.warn('[Image LoRA] Capping the LoRA list to the model\'s limit', {
    ...logContext,
    maxLoras: max,
    kept: kept.map(l => l.source),
    dropped: loras.slice(max).map(l => l.source),
  });
  return kept;
}

/**
 * The trigger phrases carried by a resolved LoRA list, in order, deduplicated
 * (two adapters from the same family often share a magic word) and with the
 * blanks removed.
 */
export function loraTriggerPhrases(loras: ImageLoraSpec[]): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const lora of loras) {
    const phrase = lora.triggerPhrase?.trim();
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }
  return phrases;
}

/**
 * Those same phrases as the single string the prompt crafter's
 * `styleTriggerPhrase` seam takes. Empty string when no adapter asks for one.
 */
export function joinLoraTriggerPhrases(loras: ImageLoraSpec[]): string {
  return loraTriggerPhrases(loras).join(', ');
}
