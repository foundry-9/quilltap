/**
 * NanoGPT LoRA wire dialects and per-model image options.
 *
 * NanoGPT spells LoRA fields three different ways across its model families,
 * and none of it is discoverable — the detailed listing tags a model `lora`
 * but leaves `allowed_passthrough_parameters` empty. So the dialect table is
 * static, and these tests are what keeps it honest:
 *
 *   1. each family maps to its own keys, with the right cap;
 *   2. an over-cap list is capped and the dropped sources are named — never
 *      silently trimmed;
 *   3. a model whose family is unknown gets NO wire mapping, because a guessed
 *      dialect posts a body the model ignores, which is the one failure nobody
 *      can see;
 *   4. the credential (`hf_api_token`) reaches only the families that can use
 *      it, and never rides the general passthrough list.
 */

import {
  applyLoras,
  applyPassthroughParameters,
  matchLoraFamily,
  NANOGPT_LORA_FAMILIES,
  NANOGPT_PASSTHROUGH_KEYS,
} from '@/plugins/dist/qtap-plugin-nanogpt/image-loras';
import { STATIC_IMAGE_MODELS } from '@/plugins/dist/qtap-plugin-nanogpt/models';
import { getNanoGPTImageOptionsSchema } from '@/plugins/dist/qtap-plugin-nanogpt/image-provider';
import { fieldAppliesToModel } from '@/lib/plugins/model-matchers';

describe('matchLoraFamily', () => {
  it('takes the longest matching prefix', () => {
    expect(matchLoraFamily('flux-lora/inpainting')?.prefix).toBe('flux-lora');
    expect(matchLoraFamily('flux-2-dev-lora-image-to-image')?.prefix).toBe('flux-2-dev-lora');
    expect(matchLoraFamily('wavespeed-ai/flux-2-klein-base-4b/edit-lora')?.prefix).toBe(
      'wavespeed-ai/flux-2-klein-base-4b',
    );
  });

  it('does not match a model outside every family', () => {
    expect(matchLoraFamily('hidream')).toBeUndefined();
    expect(matchLoraFamily('recraft-v3')).toBeUndefined();
    expect(matchLoraFamily(undefined)).toBeUndefined();
  });
});

describe('applyLoras — indexed dialect', () => {
  it('writes numbered url/scale pairs from 1', () => {
    const body: Record<string, unknown> = {};
    const result = applyLoras(
      body,
      'z-image-turbo-lora',
      [
        { source: 'owner/first', scale: 0.8 },
        { source: 'https://example.test/second.safetensors', scale: 1.2 },
      ],
      undefined,
    );

    expect(result.dialect).toBe('indexed');
    expect(body).toEqual({
      lora_url_1: 'owner/first',
      lora_scale_1: 0.8,
      lora_url_2: 'https://example.test/second.safetensors',
      lora_scale_2: 1.2,
    });
    expect(result.dropped).toEqual([]);
  });

  it('omits the scale key when the adapter carries no scale', () => {
    const body: Record<string, unknown> = {};
    applyLoras(body, 'z-image-turbo-lora', [{ source: 'owner/first' }], undefined);
    expect(body).toEqual({ lora_url_1: 'owner/first' });
  });

  it('gives the flux-2-dev-lora pair four slots and the rest three', () => {
    expect(matchLoraFamily('flux-2-dev-lora')?.support.maxLoras).toBe(4);
    expect(matchLoraFamily('flux-2-dev-lora-image-to-image')?.support.maxLoras).toBe(4);
    expect(matchLoraFamily('flux-2-klein-4b')?.support.maxLoras).toBe(3);
    expect(matchLoraFamily('wavespeed-ai/krea-v2/turbo-lora')?.support.maxLoras).toBe(3);
  });

  it('caps an over-long list and names what fell off', () => {
    const body: Record<string, unknown> = {};
    const result = applyLoras(
      body,
      'flux-2-klein-4b',
      [
        { source: 'a/one' },
        { source: 'a/two' },
        { source: 'a/three' },
        { source: 'a/four' },
      ],
      undefined,
    );

    expect(Object.keys(body)).toEqual(['lora_url_1', 'lora_url_2', 'lora_url_3']);
    expect(result.dropped).toEqual(['a/four']);
  });
});

describe('applyLoras — weights dialect', () => {
  it('writes lora_weights plus the scale', () => {
    const body: Record<string, unknown> = {};
    const result = applyLoras(
      body,
      'pruna-ai/p-image/text-to-image-lora',
      [{ source: 'owner/style', scale: 0.5 }],
      undefined,
    );
    expect(result.dialect).toBe('weights');
    expect(body).toEqual({ lora_weights: 'owner/style', lora_scale: 0.5 });
  });

  it('attaches the HuggingFace token when one is configured', () => {
    const body: Record<string, unknown> = {};
    const result = applyLoras(
      body,
      'pruna-ai/p-image/edit-lora',
      [{ source: 'owner/gated' }],
      { hf_api_token: 'hf_secret' },
    );
    expect(body.hf_api_token).toBe('hf_secret');
    expect(result.keys).toContain('hf_api_token');
  });

  it('takes only the first adapter — this family loads one', () => {
    const body: Record<string, unknown> = {};
    const result = applyLoras(
      body,
      'pruna-ai/p-image/edit-lora',
      [{ source: 'a/one' }, { source: 'a/two' }],
      undefined,
    );
    expect(body.lora_weights).toBe('a/one');
    expect(result.dropped).toEqual(['a/two']);
  });
});

describe('applyLoras — url dialect', () => {
  it('writes lora_url plus lora_strength', () => {
    const body: Record<string, unknown> = {};
    const result = applyLoras(
      body,
      'flux-lora',
      [{ source: 'owner/style', scale: 2 }],
      undefined,
    );
    expect(result.dialect).toBe('url');
    expect(body).toEqual({ lora_url: 'owner/style', lora_strength: 2 });
  });

  it('forwards a configured preset', () => {
    const body: Record<string, unknown> = {};
    applyLoras(body, 'flux-lora/inpainting', [{ source: 'owner/style' }], {
      lora_preset: 'anime',
    });
    expect(body.lora_preset).toBe('anime');
  });
});

describe('applyLoras — refusals', () => {
  it('writes nothing and names the loss for an unknown family', () => {
    const body: Record<string, unknown> = {};
    const result = applyLoras(body, 'hidream', [{ source: 'owner/style' }], undefined);
    expect(body).toEqual({});
    expect(result.dialect).toBeNull();
    expect(result.dropped).toEqual(['owner/style']);
  });

  it('writes nothing for an empty or absent list', () => {
    const body: Record<string, unknown> = {};
    expect(applyLoras(body, 'flux-lora', [], undefined).keys).toEqual([]);
    expect(applyLoras(body, 'flux-lora', undefined, undefined).keys).toEqual([]);
    expect(body).toEqual({});
  });
});

describe('applyPassthroughParameters', () => {
  it('forwards only the allow-listed keys', () => {
    const body: Record<string, unknown> = {};
    const attached = applyPassthroughParameters(body, {
      num_inference_steps: 28,
      guidance_scale: 3.5,
      reasoning_effort: 'high',
      enablePromptCaching: true,
    });
    expect(body).toEqual({ num_inference_steps: 28, guidance_scale: 3.5 });
    expect(attached).toEqual(['num_inference_steps', 'guidance_scale']);
  });

  it('treats a blank string as unset', () => {
    const body: Record<string, unknown> = {};
    applyPassthroughParameters(body, { guidance_scale: '', strength: 0.4 });
    expect(body).toEqual({ strength: 0.4 });
  });

  it('never carries the HuggingFace credential on the general list', () => {
    // The token is a credential: it belongs on the wire only when a weights-
    // family model is actually loading gated weights, not broadcast to
    // whatever model the profile happens to name.
    expect(NANOGPT_PASSTHROUGH_KEYS).not.toContain('hf_api_token');
    const body: Record<string, unknown> = {};
    applyPassthroughParameters(body, { hf_api_token: 'hf_secret' });
    expect(body).toEqual({});
  });
});

describe('declared model catalogue', () => {
  it('declares loraSupport for every family in the dialect table', () => {
    for (const family of NANOGPT_LORA_FAMILIES) {
      const model = STATIC_IMAGE_MODELS.find(m => m.id === family.prefix);
      expect(model).toBeDefined();
      expect(model!.loraSupport).toEqual(family.support);
    }
  });

  it('leaves the non-LoRA flagships without loraSupport', () => {
    for (const id of ['hidream', 'recraft-v3', 'gpt-image-1.5']) {
      expect(STATIC_IMAGE_MODELS.find(m => m.id === id)?.loraSupport).toBeUndefined();
    }
  });
});

describe('image options schema', () => {
  it('offers a size list even with a cold catalog', () => {
    const schema = getNanoGPTImageOptionsSchema('hidream');
    const size = schema.groups[0].fields.find(f => f.key === 'size');
    expect(size?.type).toBe('enum');
    expect(size?.enumValues?.length).toBeGreaterThan(0);
    expect(size?.enumValues?.some(v => v.value === '1024x1024')).toBe(true);
  });

  it('gates the LoRA preset to the one family that takes it', () => {
    const field = getNanoGPTImageOptionsSchema('flux-lora').groups[0].fields.find(
      f => f.key === 'lora_preset',
    );
    expect(field).toBeDefined();
    expect(fieldAppliesToModel(field!.appliesToModels, 'flux-lora')).toBe(true);
    expect(fieldAppliesToModel(field!.appliesToModels, 'hidream')).toBe(false);
  });

  it('gates the HuggingFace token to the families that can load gated weights', () => {
    const field = getNanoGPTImageOptionsSchema('pruna-ai/p-image/edit-lora').groups[0].fields.find(
      f => f.key === 'hf_api_token',
    );
    expect(field).toBeDefined();
    expect(fieldAppliesToModel(field!.appliesToModels, 'pruna-ai/p-image/edit-lora')).toBe(true);
    expect(fieldAppliesToModel(field!.appliesToModels, 'z-image-turbo-lora')).toBe(false);
  });

  it('offers no LoRA url or scale fields — those belong to the dedicated editor', () => {
    const keys = getNanoGPTImageOptionsSchema('flux-2-dev-lora').groups[0].fields.map(f => f.key);
    expect(keys).not.toContain('lora_url');
    expect(keys).not.toContain('lora_url_1');
    expect(keys).not.toContain('lora_scale');
    expect(keys).not.toContain('lora_weights');
  });
});
