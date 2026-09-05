/**
 * The single builder that turns an image profile (plus whatever the caller
 * wants to override) into the `ImageGenParams` handed to a plugin.
 *
 * Before this existed, five call sites assembled those params independently —
 * the `generate_image` tool and its Concierge reroute, the avatar job, the
 * story-background job, `POST /api/v1/images`, and the wardrobe preview — and
 * three of them read exactly one key off the profile (`quality`). Anything new
 * on a profile therefore worked in chat and vanished everywhere else. LoRAs
 * would have been the fourth such casualty, so they arrive with the drift
 * fixed instead.
 *
 * What the builder owns:
 *   - merging caller overrides over the profile's stored defaults, with the
 *     original `mergeParameters` semantics preserved key for key;
 *   - resolving the requested orientation onto the provider's own mechanism;
 *   - resolving, validating and capping `parameters.loras` against the
 *     provider/model's declared `loraSupport`, naming anything it drops;
 *   - handing the residual `parameters` bag to the plugin as
 *     `profileParameters`, so per-model options travel without the host
 *     enumerating them.
 *
 * @module lib/image-gen/params-builder
 */

import { logger } from '@/lib/logger';
import { resolveOrientation, type ResolvedOrientation } from './orientation';
import {
  capLoras,
  joinLoraTriggerPhrases,
  loraTriggerPhrases,
  readLorasFromParameters,
  resolveLoraSupport,
} from './lora-support';
import type {
  ImageGenParams,
  ImageLoraSpec,
  ImageLoraSupport,
  ImageOrientation,
} from '@quilltap/plugin-types';

/**
 * Parameter keys the host owns outright: each maps onto a named
 * `ImageGenParams` field, so forwarding it a second time in
 * `profileParameters` would just be the same value under two names.
 * Everything else on the profile is plugin business and rides the residual
 * bag untouched.
 */
export const HOST_OWNED_PARAMETER_KEYS: ReadonlySet<string> = new Set([
  'prompt',
  'negativePrompt',
  'model',
  'size',
  'aspectRatio',
  'orientation',
  'quality',
  'style',
  'n',
  'responseFormat',
  'seed',
  'guidanceScale',
  'steps',
  'loras',
]);

/** The slice of an image profile the builder actually reads. */
export interface ImageProfileLike {
  provider: string;
  modelName?: string | null;
  parameters?: Record<string, unknown> | null;
}

export interface BuildImageGenParamsOptions {
  /** The profile supplying provider, model, and stored defaults. */
  profile: ImageProfileLike;
  /**
   * The final prompt. Callers that expand or craft a prompt pass the expanded
   * form — the orientation hint and any un-handled LoRA trigger phrases are
   * appended to whatever arrives here.
   */
  prompt: string;
  /**
   * Caller-supplied values that outrank the profile's stored defaults: tool
   * input, a route body, or a job handler's fixed choices (`n: 1`,
   * `style: 'natural'`).
   */
  overrides?: Partial<Omit<ImageGenParams, 'prompt' | 'loras' | 'profileParameters'>>;
  /**
   * Semantic shape intent. Omit to leave `size`/`aspectRatio` exactly as the
   * merge produced them (the `POST /api/v1/images` route, which takes an
   * explicit size from its caller).
   */
  orientation?: ImageOrientation;
  /** Model of last resort when neither the override nor the profile names one. */
  fallbackModel?: string;
  /** Extra fields folded into this build's log lines (jobId, chatId, …). */
  logContext?: Record<string, unknown>;
}

export interface BuiltImageGenParams {
  /** Ready to hand to `provider.generateImage(...)`. */
  params: ImageGenParams;
  /** What the provider/model declared, or null when it declared nothing. */
  loraSupport: ImageLoraSupport | null;
  /** The adapters that survived validation and capping. */
  loras: ImageLoraSpec[];
  /** Those adapters' trigger phrases, joined; '' when none asks for one. */
  loraTriggerPhrase: string;
  /**
   * The phrases this build actually appended to the prompt — empty when the
   * prompt already carried them (the crafter having done the honours) or when
   * no adapter asks for one.
   */
  appendedTriggerPhrases: string[];
  /** The resolved orientation, or null when the caller asked for none. */
  orientation: ResolvedOrientation | null;
}

/**
 * `a || b` for the fields whose original merge used `||` — an empty string
 * from the caller means "unset", falling through to the profile's default.
 */
function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Resolve the LoRA story for a profile without building the whole request.
 *
 * The `generate_image` path needs the trigger phrases *before* it expands the
 * prompt (the crafter has to see them), which is earlier than it can build
 * the params. Same resolution, same capping, same logs — the builder calls
 * this itself, so the two can never disagree.
 */
export function resolveProfileLoras(
  profile: ImageProfileLike,
  logContext?: Record<string, unknown>,
): { support: ImageLoraSupport | null; loras: ImageLoraSpec[]; triggerPhrase: string } {
  const provider = profile.provider;
  const model = profile.modelName ?? undefined;
  const context = { provider, model, ...logContext };

  const support = resolveLoraSupport(provider, model);
  const stored = readLorasFromParameters(
    profile.parameters as Record<string, unknown> | null | undefined,
    context,
  );
  const loras = capLoras(stored, support, context);

  return { support, loras, triggerPhrase: joinLoraTriggerPhrases(loras) };
}

/**
 * Build the parameters for one image generation call.
 */
export function buildImageGenParams(
  options: BuildImageGenParamsOptions,
): BuiltImageGenParams {
  const {
    profile,
    prompt,
    overrides = {},
    orientation,
    fallbackModel = 'dall-e-3',
    logContext = {},
  } = options;

  const defaults = (profile.parameters ?? {}) as Record<string, unknown>;
  const provider = profile.provider;

  // ---- 1. Merge, preserving the original mergeParameters semantics ---------
  const model =
    firstNonEmptyString(overrides.model, profile.modelName, defaults.model) ?? fallbackModel;

  const params: ImageGenParams = {
    prompt,
    model,
    n: overrides.n ?? asNumber(defaults.n) ?? 1,
  };

  const negativePrompt = firstNonEmptyString(overrides.negativePrompt, defaults.negativePrompt);
  if (negativePrompt !== undefined) params.negativePrompt = negativePrompt;

  const size = firstNonEmptyString(overrides.size, defaults.size);
  if (size !== undefined) params.size = size;

  const aspectRatio = firstNonEmptyString(overrides.aspectRatio, defaults.aspectRatio);
  if (aspectRatio !== undefined) params.aspectRatio = aspectRatio;

  const quality = firstNonEmptyString(overrides.quality, defaults.quality);
  if (quality !== undefined) params.quality = quality as ImageGenParams['quality'];

  const style = firstNonEmptyString(overrides.style, defaults.style);
  if (style !== undefined) params.style = style as ImageGenParams['style'];

  const responseFormat = firstNonEmptyString(overrides.responseFormat, defaults.responseFormat);
  if (responseFormat !== undefined) {
    params.responseFormat = responseFormat as ImageGenParams['responseFormat'];
  }

  const seed = overrides.seed ?? asNumber(defaults.seed);
  if (seed !== undefined) params.seed = seed;

  const guidanceScale = overrides.guidanceScale ?? asNumber(defaults.guidanceScale);
  if (guidanceScale !== undefined) params.guidanceScale = guidanceScale;

  const steps = overrides.steps ?? asNumber(defaults.steps);
  if (steps !== undefined) params.steps = steps;

  // ---- 2. Orientation -----------------------------------------------------
  let resolvedOrientation: ResolvedOrientation | null = null;
  if (orientation) {
    resolvedOrientation = resolveOrientation(provider, model, orientation);
    // Orientation outranks any raw size/aspectRatio that arrived above: the
    // caller asked for a shape, not for a string.
    if (resolvedOrientation.params.size) {
      params.size = resolvedOrientation.params.size;
    }
    if (resolvedOrientation.params.aspectRatio) {
      params.aspectRatio = resolvedOrientation.params.aspectRatio;
    }
    if (resolvedOrientation.promptHint) {
      params.prompt = `${params.prompt}\n\n${resolvedOrientation.promptHint}`;
    }
  }

  // ---- 3. LoRAs -----------------------------------------------------------
  const { support, loras, triggerPhrase } = resolveProfileLoras(profile, logContext);
  const appendedTriggerPhrases: string[] = [];
  if (loras.length > 0) {
    params.loras = loras;

    // A LoRA's trigger phrase has to reach the prompt or the adapter fires at
    // half strength. The `generate_image` path already hands the phrases to
    // the prompt crafter through the same seam a style's trigger phrase uses,
    // so the crafted prompt usually carries them — but crafting is skipped
    // when there is nothing to expand, and it can fall back to plain
    // substitution when it fails. Rather than thread a "did the crafter get
    // them?" flag through five call sites and be wrong on the fallback, look:
    // append only the phrases the prompt does not already say.
    const haystack = params.prompt.toLowerCase();
    for (const phrase of loraTriggerPhrases(loras)) {
      if (!haystack.includes(phrase.toLowerCase())) {
        appendedTriggerPhrases.push(phrase);
      }
    }
    if (appendedTriggerPhrases.length > 0) {
      params.prompt = `${params.prompt}\n\n${appendedTriggerPhrases.join(', ')}`;
    }
  }

  // ---- 4. Residual bag ----------------------------------------------------
  const profileParameters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (HOST_OWNED_PARAMETER_KEYS.has(key)) continue;
    if (value === undefined) continue;
    profileParameters[key] = value;
  }
  if (Object.keys(profileParameters).length > 0) {
    params.profileParameters = profileParameters;
  }

  logger.debug('[Image Params] Built image generation parameters', {
    ...logContext,
    provider,
    model,
    orientation: orientation ?? null,
    size: params.size ?? null,
    aspectRatio: params.aspectRatio ?? null,
    n: params.n,
    loraSupport: support
      ? { maxLoras: support.maxLoras, sourceKinds: support.sourceKinds }
      : null,
    loraCount: loras.length,
    loraSources: loras.map(l => l.source),
    loraTriggerPhrase: triggerPhrase || null,
    appendedTriggerPhrases,
    profileParameterKeys: Object.keys(profileParameters),
  });

  return {
    params,
    loraSupport: support,
    loras,
    loraTriggerPhrase: triggerPhrase,
    appendedTriggerPhrases,
    orientation: resolvedOrientation,
  };
}
