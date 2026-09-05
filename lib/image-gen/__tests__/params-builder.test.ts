/**
 * Unit tests for the shared image-params builder and the LoRA resolver.
 *
 * The first block pins the *existing* merge semantics the builder inherited
 * from `mergeParameters` — those had five call sites' behaviour riding on
 * them, and the byte-compatibility claim is only worth anything if something
 * checks it. The rest cover what is new: LoRA resolution, capping, trigger
 * phrases and the residual `profileParameters` bag.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
// The plugin registry is the only thing either module reaches for, and it is
// a server-side singleton loaded from disk; a plain stub is both faster and
// more precise than booting the real one.
jest.mock('@/lib/plugins/provider-registry', () => ({
  getImageProviderConstraints: jest.fn(),
  getImageGenerationModels: jest.fn(),
}));

// ── Subject ───────────────────────────────────────────────────────────────────
import { buildImageGenParams, resolveProfileLoras, HOST_OWNED_PARAMETER_KEYS } from '../params-builder';
import {
  capLoras,
  joinLoraTriggerPhrases,
  loraTriggerPhrases,
  readLorasFromParameters,
  resolveLoraSupport,
} from '../lora-support';

import {
  getImageProviderConstraints,
  getImageGenerationModels,
} from '@/lib/plugins/provider-registry';
import type {
  ImageGenerationModelInfo,
  ImageLoraSupport,
  ImageProviderConstraints,
} from '@quilltap/plugin-types';

const mockedConstraints = jest.mocked(getImageProviderConstraints);
const mockedModels = jest.mocked(getImageGenerationModels);

const INDEXED_SUPPORT: ImageLoraSupport = {
  maxLoras: 3,
  scale: { min: 0, max: 4, default: 1, step: 0.1 },
  sourceKinds: ['url', 'hf-repo'],
};

const SINGLE_SUPPORT: ImageLoraSupport = {
  maxLoras: 1,
  sourceKinds: ['url'],
};

/** Declare a provider with the given per-model and provider-level support. */
function givenProvider(options: {
  models?: ImageGenerationModelInfo[];
  constraints?: ImageProviderConstraints | null;
} = {}) {
  mockedModels.mockReturnValue(options.models ?? null);
  mockedConstraints.mockReturnValue(options.constraints ?? null);
}

beforeEach(() => {
  jest.clearAllMocks();
  givenProvider();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('buildImageGenParams — inherited merge semantics', () => {
  it('takes the model from the profile, falling back to the legacy dall-e-3', () => {
    const fromProfile = buildImageGenParams({
      profile: { provider: 'OPENAI', modelName: 'gpt-image-1', parameters: {} },
      prompt: 'a hansom cab',
    });
    expect(fromProfile.params.model).toBe('gpt-image-1');

    const fromNothing = buildImageGenParams({
      profile: { provider: 'OPENAI', parameters: {} },
      prompt: 'a hansom cab',
    });
    expect(fromNothing.params.model).toBe('dall-e-3');
  });

  it('defaults n through override, then profile, then 1', () => {
    const profile = { provider: 'OPENAI', modelName: 'dall-e-3', parameters: { n: 3 } };
    expect(buildImageGenParams({ profile, prompt: 'p' }).params.n).toBe(3);
    expect(buildImageGenParams({ profile, prompt: 'p', overrides: { n: 2 } }).params.n).toBe(2);
    expect(
      buildImageGenParams({
        profile: { ...profile, parameters: {} },
        prompt: 'p',
      }).params.n,
    ).toBe(1);
  });

  it('treats an empty-string override as unset, falling through to the profile', () => {
    // The original merge used `||` for the string fields, so '' meant "the LLM
    // said nothing". Changing that to `??` would let a blank size through and
    // a provider would reject it.
    const built = buildImageGenParams({
      profile: {
        provider: 'OPENAI',
        modelName: 'dall-e-3',
        parameters: { size: '1024x1024', quality: 'hd' },
      },
      prompt: 'p',
      overrides: { size: '', quality: undefined },
    });
    expect(built.params.size).toBe('1024x1024');
    expect(built.params.quality).toBe('hd');
  });

  it('carries seed, guidanceScale and steps off the profile', () => {
    const built = buildImageGenParams({
      profile: {
        provider: 'OPENAI',
        modelName: 'dall-e-3',
        parameters: { seed: 42, guidanceScale: 7.5, steps: 30 },
      },
      prompt: 'p',
    });
    expect(built.params).toMatchObject({ seed: 42, guidanceScale: 7.5, steps: 30 });
  });

  it('omits absent optional fields rather than writing undefined', () => {
    const built = buildImageGenParams({
      profile: { provider: 'OPENAI', modelName: 'dall-e-3', parameters: {} },
      prompt: 'p',
    });
    expect(Object.keys(built.params).sort()).toEqual(['model', 'n', 'prompt']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('buildImageGenParams — orientation', () => {
  it('lets orientation outrank a raw size from the caller', () => {
    givenProvider({
      constraints: {
        orientationSupport: {
          strategy: 'size',
          portrait: { size: '832x1248' },
          landscape: { size: '1248x832' },
        },
      },
    });

    const built = buildImageGenParams({
      profile: { provider: 'NANOGPT', modelName: 'hidream', parameters: { size: '1024x1024' } },
      prompt: 'p',
      orientation: 'portrait',
    });
    expect(built.params.size).toBe('832x1248');
  });

  it('leaves size alone when no orientation is asked for', () => {
    const built = buildImageGenParams({
      profile: { provider: 'NANOGPT', modelName: 'hidream', parameters: { size: '1024x1024' } },
      prompt: 'p',
    });
    expect(built.params.size).toBe('1024x1024');
    expect(built.orientation).toBeNull();
  });

  it('appends a prompt hint for prompt-strategy providers', () => {
    givenProvider({
      constraints: {
        orientationSupport: {
          strategy: 'prompt',
          portrait: { promptHint: 'tall and narrow' },
          landscape: { promptHint: 'wide' },
        },
      },
    });

    const built = buildImageGenParams({
      profile: { provider: 'GROK', modelName: 'grok-2-image', parameters: {} },
      prompt: 'a portrait',
      orientation: 'portrait',
    });
    expect(built.params.prompt).toBe('a portrait\n\ntall and narrow');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LoRA resolution', () => {
  it('prefers per-model support, then the provider constraint, then none', () => {
    givenProvider({
      models: [{ id: 'flux-lora', name: 'Flux LoRA', loraSupport: SINGLE_SUPPORT }],
      constraints: { loraSupport: INDEXED_SUPPORT },
    });
    expect(resolveLoraSupport('NANOGPT', 'flux-lora')).toBe(SINGLE_SUPPORT);
    expect(resolveLoraSupport('NANOGPT', 'hidream')).toBe(INDEXED_SUPPORT);

    givenProvider({ models: [], constraints: null });
    expect(resolveLoraSupport('OPENAI', 'dall-e-3')).toBeNull();
  });

  it('matches a family by longest prefix', () => {
    givenProvider({
      models: [
        { id: 'flux-2-dev', name: 'Flux 2 Dev' },
        { id: 'flux-2-dev-lora', name: 'Flux 2 Dev LoRA', loraSupport: INDEXED_SUPPORT },
      ],
    });
    // The longer, LoRA-bearing prefix wins over its plain sibling.
    expect(resolveLoraSupport('NANOGPT', 'flux-2-dev-lora-image-to-image')).toBe(INDEXED_SUPPORT);
    expect(resolveLoraSupport('NANOGPT', 'flux-2-dev-fp8')).toBeNull();
  });

  it('strips loras entirely for a provider that declares no support', () => {
    givenProvider();
    const built = buildImageGenParams({
      profile: {
        provider: 'OPENAI',
        modelName: 'dall-e-3',
        parameters: { loras: [{ source: 'owner/style' }] },
      },
      prompt: 'p',
    });
    expect(built.params.loras).toBeUndefined();
    expect(built.loras).toEqual([]);
  });

  it('caps an over-long list at the model limit, keeping the leading entries', () => {
    givenProvider({ constraints: { loraSupport: INDEXED_SUPPORT } });
    const loras = [
      { source: 'a/one' },
      { source: 'a/two' },
      { source: 'a/three' },
      { source: 'a/four' },
    ];
    const built = buildImageGenParams({
      profile: { provider: 'NANOGPT', modelName: 'z-image-turbo-lora', parameters: { loras } },
      prompt: 'p',
    });
    expect(built.params.loras?.map(l => l.source)).toEqual(['a/one', 'a/two', 'a/three']);
  });

  it('drops malformed stored entries without taking the good ones with them', () => {
    const kept = readLorasFromParameters(
      {
        loras: [
          { source: '  owner/good  ', scale: 0.8, triggerPhrase: ' ohwx ' },
          { source: '   ' },
          'not an object',
          { source: 'owner/bad-scale', scale: 99 },
        ],
      },
      { provider: 'NANOGPT', model: 'flux-lora' },
    );

    expect(kept).toEqual([
      { source: 'owner/good', scale: 0.8, triggerPhrase: 'ohwx' },
      // The out-of-range scale is dropped down to "unset"; the adapter stays.
      { source: 'owner/bad-scale' },
    ]);
  });

  it('reads nothing from a loras key that is not a list', () => {
    expect(
      readLorasFromParameters({ loras: 'owner/style' }, { provider: 'NANOGPT' }),
    ).toEqual([]);
  });

  it('caps against a null support by stripping everything', () => {
    expect(capLoras([{ source: 'a/one' }], null, { provider: 'OPENAI' })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LoRA trigger phrases', () => {
  it('deduplicates and skips blanks', () => {
    const loras = [
      { source: 'a', triggerPhrase: 'ohwx' },
      { source: 'b', triggerPhrase: '  ' },
      { source: 'c', triggerPhrase: 'OHWX' },
      { source: 'd', triggerPhrase: 'art deco' },
    ];
    expect(loraTriggerPhrases(loras)).toEqual(['ohwx', 'art deco']);
    expect(joinLoraTriggerPhrases(loras)).toBe('ohwx, art deco');
  });

  it('appends the phrases the prompt does not already carry', () => {
    givenProvider({ constraints: { loraSupport: INDEXED_SUPPORT } });
    const built = buildImageGenParams({
      profile: {
        provider: 'NANOGPT',
        modelName: 'z-image-turbo-lora',
        parameters: {
          loras: [
            { source: 'a/one', triggerPhrase: 'ohwx' },
            { source: 'a/two', triggerPhrase: 'art deco' },
          ],
        },
      },
      // The crafter already wove one phrase in; only the other should follow.
      prompt: 'a lobby in art deco style',
    });
    expect(built.appendedTriggerPhrases).toEqual(['ohwx']);
    expect(built.params.prompt).toBe('a lobby in art deco style\n\nohwx');
  });

  it('appends nothing when the prompt already says every phrase', () => {
    givenProvider({ constraints: { loraSupport: INDEXED_SUPPORT } });
    const built = buildImageGenParams({
      profile: {
        provider: 'NANOGPT',
        modelName: 'z-image-turbo-lora',
        parameters: { loras: [{ source: 'a/one', triggerPhrase: 'ohwx' }] },
      },
      prompt: 'a portrait, ohwx, in oils',
    });
    expect(built.appendedTriggerPhrases).toEqual([]);
    expect(built.params.prompt).toBe('a portrait, ohwx, in oils');
  });

  it('exposes the joined phrase for the prompt-crafter seam', () => {
    givenProvider({ constraints: { loraSupport: INDEXED_SUPPORT } });
    const { triggerPhrase } = resolveProfileLoras({
      provider: 'NANOGPT',
      modelName: 'z-image-turbo-lora',
      parameters: { loras: [{ source: 'a', triggerPhrase: 'ohwx' }] },
    });
    expect(triggerPhrase).toBe('ohwx');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('profileParameters residual bag', () => {
  it('forwards plugin keys and withholds every host-owned one', () => {
    givenProvider({ constraints: { loraSupport: INDEXED_SUPPORT } });
    const built = buildImageGenParams({
      profile: {
        provider: 'NANOGPT',
        modelName: 'flux-2-klein-4b',
        parameters: {
          size: '1024x1024',
          quality: 'hd',
          seed: 7,
          loras: [{ source: 'a/one' }],
          num_inference_steps: 28,
          guidance_scale: 3.5,
          hf_api_token: 'hf_secret',
        },
      },
      prompt: 'p',
    });

    expect(built.params.profileParameters).toEqual({
      num_inference_steps: 28,
      guidance_scale: 3.5,
      hf_api_token: 'hf_secret',
    });
    for (const key of Object.keys(built.params.profileParameters!)) {
      expect(HOST_OWNED_PARAMETER_KEYS.has(key)).toBe(false);
    }
  });

  it('omits the bag entirely when nothing is left over', () => {
    const built = buildImageGenParams({
      profile: {
        provider: 'OPENAI',
        modelName: 'dall-e-3',
        parameters: { size: '1024x1024', quality: 'hd' },
      },
      prompt: 'p',
    });
    expect(built.params.profileParameters).toBeUndefined();
  });
});
