/**
 * NanoGPT LoRA dialects and per-model image options.
 *
 * NanoGPT's image route takes **flat, model-specific body keys** alongside the
 * common OpenAI-compatible fields — the same passthrough class as the
 * documented `guidance_scale` / `num_inference_steps` / `strength` / `seed`
 * controls. LoRAs ride that channel, and three different families spell them
 * three different ways:
 *
 *   - `indexed`  — `lora_url_1`/`lora_scale_1` … up to 3 or 4 pairs
 *                  (the wavespeed-hosted Flux 2 / Klein / Z-Image / Krea set)
 *   - `weights`  — a single `lora_weights` + `lora_scale`, plus an optional
 *                  `hf_api_token` for private or gated HuggingFace weights
 *                  (the pruna p-image set)
 *   - `url`      — a single `lora_url` + `lora_strength`, plus an optional
 *                  `lora_preset` (the fal-hosted flux-lora set)
 *
 * None of this is discoverable: the detailed model listing carries a `lora`
 * *tag* but leaves `allowed_passthrough_parameters` empty, so the tag can only
 * tell us a model takes adapters — never which spelling it wants. Hence a
 * static family table here, matched longest-prefix-first. A LoRA-tagged model
 * this table does not know gets the capability **without** a wire mapping and
 * a "family unknown" warning: guessing a dialect would post a body the model
 * silently ignores, which is the one failure mode nobody can see.
 *
 * @module qtap-plugin-nanogpt/image-loras
 */

import { createPluginLogger } from '@quilltap/plugin-utils';
import type { ImageLoraSpec, ImageLoraSupport } from './types';

const logger = createPluginLogger('qtap-plugin-nanogpt');

/** How a model family spells its LoRA fields on the wire. */
export type NanoGPTLoraDialect = 'indexed' | 'weights' | 'url';

export interface NanoGPTLoraFamily {
  /** Model-id prefix; the longest matching prefix wins. */
  prefix: string;
  dialect: NanoGPTLoraDialect;
  support: ImageLoraSupport;
}

/**
 * Wavespeed-hosted indexed families: `lora_scale_N` runs 0.0–4.0, default 1,
 * step 0.1. The Flux 2 dev LoRA pair takes four adapters; everything else in
 * the family takes three.
 */
const INDEXED_SCALE = { min: 0, max: 4, default: 1, step: 0.1 } as const;

/**
 * The family table, in no particular order — {@link matchLoraFamily} sorts by
 * prefix length so the more specific entry always wins (`flux-2-dev-lora`
 * covers `flux-2-dev-lora-image-to-image` only because the latter is not
 * listed separately; when both are listed, the longer one is chosen).
 */
export const NANOGPT_LORA_FAMILIES: NanoGPTLoraFamily[] = [
  // ---- indexed: lora_url_N / lora_scale_N ---------------------------------
  {
    prefix: 'flux-2-dev-lora',
    dialect: 'indexed',
    support: { maxLoras: 4, scale: INDEXED_SCALE, sourceKinds: ['url', 'hf-repo'] },
  },
  {
    prefix: 'flux-2-klein-4b',
    dialect: 'indexed',
    support: { maxLoras: 3, scale: INDEXED_SCALE, sourceKinds: ['url', 'hf-repo'] },
  },
  {
    prefix: 'flux-2-klein-9b',
    dialect: 'indexed',
    support: { maxLoras: 3, scale: INDEXED_SCALE, sourceKinds: ['url', 'hf-repo'] },
  },
  {
    prefix: 'wavespeed-ai/flux-2-klein-base-4b',
    dialect: 'indexed',
    support: { maxLoras: 3, scale: INDEXED_SCALE, sourceKinds: ['url', 'hf-repo'] },
  },
  {
    prefix: 'wavespeed-ai/flux-2-klein-base-9b',
    dialect: 'indexed',
    support: { maxLoras: 3, scale: INDEXED_SCALE, sourceKinds: ['url', 'hf-repo'] },
  },
  {
    prefix: 'z-image-turbo-lora',
    dialect: 'indexed',
    support: { maxLoras: 3, scale: INDEXED_SCALE, sourceKinds: ['url', 'hf-repo'] },
  },
  {
    prefix: 'wavespeed-ai/krea-v2/turbo-lora',
    dialect: 'indexed',
    support: { maxLoras: 3, scale: INDEXED_SCALE, sourceKinds: ['url', 'hf-repo'] },
  },

  // ---- weights: lora_weights / lora_scale / hf_api_token ------------------
  {
    prefix: 'pruna-ai/p-image/text-to-image-lora',
    dialect: 'weights',
    support: {
      maxLoras: 1,
      scale: { min: 0, max: 4, default: 0.5, step: 0.05 },
      sourceKinds: ['url', 'hf-repo'],
      supportsPrivateWeightsToken: true,
    },
  },
  {
    prefix: 'pruna-ai/p-image/edit-lora',
    dialect: 'weights',
    support: {
      maxLoras: 1,
      scale: { min: 0, max: 4, default: 1, step: 0.05 },
      sourceKinds: ['url', 'hf-repo'],
      supportsPrivateWeightsToken: true,
    },
  },

  // ---- url: lora_url / lora_strength / lora_preset ------------------------
  {
    prefix: 'flux-lora',
    dialect: 'url',
    support: {
      maxLoras: 1,
      // fal's lora_strength floor is 0.1, not 0 — a zero would be rejected
      // rather than read as "no adapter".
      scale: { min: 0.1, max: 4, default: 1, step: 0.1 },
      sourceKinds: ['url', 'hf-repo'],
    },
  },
];

/**
 * The family whose dialect applies to `model` — exact prefix match, longest
 * first, so `flux-lora/inpainting` lands on `flux-lora` and
 * `wavespeed-ai/flux-2-klein-base-4b/edit-lora` lands on its own base entry
 * rather than on some shorter neighbour.
 */
export function matchLoraFamily(model: string | undefined): NanoGPTLoraFamily | undefined {
  if (!model) return undefined;
  return NANOGPT_LORA_FAMILIES
    .filter((family) => model === family.prefix || model.startsWith(family.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
}

/**
 * The `profileParameters` keys this plugin forwards to NanoGPT, and nothing
 * else. The host hands over the profile's whole residual bag on purpose —
 * deciding what reaches the wire is the plugin's job, and an allow-list is the
 * only version of that decision that cannot leak a stray key into someone's
 * bill.
 */
export const NANOGPT_PASSTHROUGH_KEYS: readonly string[] = [
  'num_inference_steps',
  'guidance_scale',
  'steps',
  'strength',
];

/**
 * The two LoRA-adjacent keys deliberately *absent* from the list above.
 *
 * `hf_api_token` is a credential: it goes on the wire only when a `weights`
 * family model is actually loading gated weights, never broadcast to whatever
 * model the profile happens to point at. `lora_preset` means something only to
 * the fal-hosted `url` family. Both are attached inside {@link applyLoras},
 * where the dialect is known.
 */
export const NANOGPT_LORA_SCOPED_KEYS: readonly string[] = ['hf_api_token', 'lora_preset'];

/**
 * Copy the allow-listed profile parameters onto a request body, skipping
 * blanks (an empty string is how the options panel spells "unset"). Returns
 * the keys it actually attached, for the debug log.
 */
export function applyPassthroughParameters(
  body: Record<string, unknown>,
  profileParameters: Record<string, unknown> | undefined,
): string[] {
  if (!profileParameters) return [];

  const attached: string[] = [];
  for (const key of NANOGPT_PASSTHROUGH_KEYS) {
    const value = profileParameters[key];
    if (value === undefined || value === null || value === '') continue;
    body[key] = value;
    attached.push(key);
  }
  return attached;
}

export interface AppliedLoras {
  /** Wire keys written onto the body. */
  keys: string[];
  /** Sources that did not fit the model's cap, named for the log. */
  dropped: string[];
  /** The family that decided the spelling, or null when none is known. */
  dialect: NanoGPTLoraDialect | null;
}

/**
 * Translate the host's canonical `loras` list into NanoGPT's wire dialect for
 * `model`, mutating `body`.
 *
 * The host has already capped the list against whatever `loraSupport` this
 * plugin declared for the model, so an over-cap list should not reach here —
 * but a model whose family this table does not know resolves capability from
 * the live catalog's `lora` tag alone, and then there is no cap and no
 * spelling. That case drops the whole list loudly rather than posting a body
 * the model will ignore.
 */
export function applyLoras(
  body: Record<string, unknown>,
  model: string,
  loras: ImageLoraSpec[] | undefined,
  profileParameters: Record<string, unknown> | undefined,
): AppliedLoras {
  if (!loras || loras.length === 0) {
    return { keys: [], dropped: [], dialect: null };
  }

  const family = matchLoraFamily(model);
  if (!family) {
    logger.warn('LoRA family unknown for this model; dropping the adapters rather than guessing a dialect', {
      context: 'NanoGPTImageProvider.applyLoras',
      model,
      dropped: loras.map((l) => l.source),
    });
    return { keys: [], dropped: loras.map((l) => l.source), dialect: null };
  }

  const max = family.support.maxLoras;
  const kept = loras.slice(0, max);
  const dropped = loras.slice(max).map((l) => l.source);
  if (dropped.length > 0) {
    logger.warn('Capping the LoRA list to this model\'s limit', {
      context: 'NanoGPTImageProvider.applyLoras',
      model,
      dialect: family.dialect,
      maxLoras: max,
      kept: kept.map((l) => l.source),
      dropped,
    });
  }

  const keys: string[] = [];

  if (family.dialect === 'indexed') {
    kept.forEach((lora, index) => {
      const urlKey = `lora_url_${index + 1}`;
      body[urlKey] = lora.source;
      keys.push(urlKey);
      if (lora.scale !== undefined) {
        const scaleKey = `lora_scale_${index + 1}`;
        body[scaleKey] = lora.scale;
        keys.push(scaleKey);
      }
    });
  } else if (family.dialect === 'weights') {
    body.lora_weights = kept[0].source;
    keys.push('lora_weights');
    if (kept[0].scale !== undefined) {
      body.lora_scale = kept[0].scale;
      keys.push('lora_scale');
    }
    // Private / gated HuggingFace weights need a token, which rides the
    // options panel as an ordinary parameter rather than living on the LoRA
    // row — one token serves whatever weights the profile points at.
    const token = profileParameters?.hf_api_token;
    if (typeof token === 'string' && token.length > 0) {
      body.hf_api_token = token;
      keys.push('hf_api_token');
    }
  } else {
    body.lora_url = kept[0].source;
    keys.push('lora_url');
    if (kept[0].scale !== undefined) {
      body.lora_strength = kept[0].scale;
      keys.push('lora_strength');
    }
    const preset = profileParameters?.lora_preset;
    if (typeof preset === 'string' && preset.length > 0) {
      body.lora_preset = preset;
      keys.push('lora_preset');
    }
  }

  return { keys, dropped, dialect: family.dialect };
}
