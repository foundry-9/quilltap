/**
 * @jest-environment node
 */

/**
 * HuggingFace lookup for LoRA sources.
 *
 * The module exists so a user can see what a repository declares about itself
 * before trusting it to a paid generation. These tests pin the three things
 * that would make it worse than useless:
 *
 *   1. it reads the facts out of a real payload shape correctly — a base model
 *      spelled either of the two ways HuggingFace spells it, and the
 *      `instance_prompt` that is the whole reason the button earns its place;
 *   2. it never upgrades a 401 into "does not exist", because HuggingFace
 *      fuses "no such repository" with "private and not yours" on purpose;
 *   3. it renders NO compatibility verdict — there is no field in which one
 *      could hide.
 */

import {
  extractHuggingFaceRepoId,
  huggingFaceCardUrl,
  lookupHuggingFaceLora,
} from '@/lib/image-gen/huggingface-lookup';

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

/** Trimmed from the live response for XLabs-AI/flux-RealismLora. */
const REALISM_LORA_PAYLOAD = {
  id: 'XLabs-AI/flux-RealismLora',
  private: false,
  pipeline_tag: 'text-to-image',
  library_name: 'diffusers',
  tags: [
    'diffusers',
    'lora',
    'Flux',
    'text-to-image',
    'base_model:black-forest-labs/FLUX.1-dev',
    'base_model:adapter:black-forest-labs/FLUX.1-dev',
    'license:other',
  ],
  downloads: 15707,
  likes: 1232,
  gated: false,
  lastModified: '2024-08-22T10:19:23.000Z',
  cardData: {
    license: 'other',
    pipeline_tag: 'text-to-image',
    tags: ['lora', 'Flux', 'diffusers'],
    base_model: 'black-forest-labs/FLUX.1-dev',
  },
  siblings: [
    { rfilename: '.gitattributes' },
    { rfilename: 'README.md' },
    { rfilename: 'lora.safetensors' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('extractHuggingFaceRepoId', () => {
  it('accepts a bare owner/name', () => {
    expect(extractHuggingFaceRepoId('XLabs-AI/flux-RealismLora')).toBe('XLabs-AI/flux-RealismLora');
    expect(extractHuggingFaceRepoId('  Datou1111/shou_xin  ')).toBe('Datou1111/shou_xin');
    expect(extractHuggingFaceRepoId('ostris/flux2_berthe_morisot')).toBe('ostris/flux2_berthe_morisot');
  });

  it('recovers the repository from a huggingface.co weights URL', () => {
    expect(
      extractHuggingFaceRepoId(
        'https://huggingface.co/lovis93/Flux-2-Multi-Angles-LoRA-v2/resolve/main/weights-fal.safetensors'
      )
    ).toBe('lovis93/Flux-2-Multi-Angles-LoRA-v2');
    expect(extractHuggingFaceRepoId('https://huggingface.co/owner/name')).toBe('owner/name');
  });

  it('declines anything with no repository behind it', () => {
    // Weights hosted elsewhere have no card to read, so the editor must not
    // offer a button that could only ever fail.
    expect(extractHuggingFaceRepoId('https://cdn.example.com/weights.safetensors')).toBeNull();
    expect(extractHuggingFaceRepoId('')).toBeNull();
    expect(extractHuggingFaceRepoId('   ')).toBeNull();
    expect(extractHuggingFaceRepoId('justonesegment')).toBeNull();
    expect(extractHuggingFaceRepoId('too/many/segments')).toBeNull();
    expect(extractHuggingFaceRepoId('owner name/with space')).toBeNull();
    expect(extractHuggingFaceRepoId('https://huggingface.co/owner')).toBeNull();
    // A lookalike host must not be mistaken for the registry.
    expect(extractHuggingFaceRepoId('https://nothuggingface.co/owner/name')).toBeNull();
  });
});

describe('huggingFaceCardUrl', () => {
  it('points at the public model card', () => {
    expect(huggingFaceCardUrl('owner/name')).toBe('https://huggingface.co/owner/name');
  });
});

describe('lookupHuggingFaceLora', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('reads the facts out of a real payload', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(REALISM_LORA_PAYLOAD));

    const result = await lookupHuggingFaceLora('XLabs-AI/flux-RealismLora');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a successful lookup');
    expect(result.facts).toMatchObject({
      repoId: 'XLabs-AI/flux-RealismLora',
      url: 'https://huggingface.co/XLabs-AI/flux-RealismLora',
      baseModels: ['black-forest-labs/FLUX.1-dev'],
      isAdapter: true,
      isLora: true,
      pipelineTag: 'text-to-image',
      gated: false,
      weightFiles: ['lora.safetensors'],
      triggerPhrase: null,
      likes: 1232,
    });
  });

  it('renders no compatibility verdict of any kind', async () => {
    // The guard that keeps this module honest: if a `compatible` / `works` /
    // `verdict` field ever appears, the UI will start believing it, and a
    // wrong "this will not work" is worse than the silence it replaced.
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(REALISM_LORA_PAYLOAD));

    const result = await lookupHuggingFaceLora('XLabs-AI/flux-RealismLora');
    if (!result.ok) throw new Error('expected a successful lookup');

    const keys = Object.keys(result.facts);
    expect(keys).not.toContain('compatible');
    expect(keys).not.toContain('compatibility');
    expect(keys).not.toContain('verdict');
    expect(keys).not.toContain('works');
    expect(keys).not.toContain('supported');
  });

  it('surfaces the declared trigger phrase, which is the point of the button', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        id: 'Datou1111/shou_xin',
        tags: ['lora', 'base_model:adapter:black-forest-labs/FLUX.1-dev'],
        cardData: { instance_prompt: 'shou_xin, pencil sketch' },
        siblings: [{ rfilename: 'shou_xin.safetensors' }],
      })
    );

    const result = await lookupHuggingFaceLora('Datou1111/shou_xin');
    if (!result.ok) throw new Error('expected a successful lookup');
    expect(result.facts.triggerPhrase).toBe('shou_xin, pencil sketch');
  });

  it('merges a list-valued base_model with the adapter tags, without duplicating', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        id: 'someone/multi-base',
        tags: [
          'lora',
          'base_model:adapter:black-forest-labs/FLUX.1-dev',
          'base_model:adapter:black-forest-labs/FLUX.2-dev',
        ],
        cardData: { base_model: ['black-forest-labs/FLUX.1-dev'] },
        siblings: [],
      })
    );

    const result = await lookupHuggingFaceLora('someone/multi-base');
    if (!result.ok) throw new Error('expected a successful lookup');
    expect(result.facts.baseModels).toEqual([
      'black-forest-labs/FLUX.1-dev',
      'black-forest-labs/FLUX.2-dev',
    ]);
  });

  it('reports a gated repository as gated', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ ...REALISM_LORA_PAYLOAD, gated: 'auto' })
    );

    const result = await lookupHuggingFaceLora('XLabs-AI/flux-RealismLora');
    if (!result.ok) throw new Error('expected a successful lookup');
    expect(result.facts.gated).toBe('auto');
  });

  it('names every .safetensors, so an ambiguous repository shows as ambiguous', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        id: 'lovis93/Flux-2-Multi-Angles-LoRA-v2',
        tags: ['lora'],
        siblings: [
          { rfilename: 'README.md' },
          { rfilename: 'flux-multi-angles-v2-72poses-comfy.safetensors' },
          { rfilename: 'flux-multi-angles-v2-72poses-fal.safetensors' },
        ],
      })
    );

    const result = await lookupHuggingFaceLora('lovis93/Flux-2-Multi-Angles-LoRA-v2');
    if (!result.ok) throw new Error('expected a successful lookup');
    expect(result.facts.weightFiles).toHaveLength(2);
  });

  it('never claims a 401 means the repository does not exist', async () => {
    // HuggingFace answers "no such repository" and "private, and not yours"
    // identically and deliberately. Guessing which would be wrong exactly when
    // it matters most.
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'Invalid username or password.' }, 401));

    const result = await lookupHuggingFaceLora('nobody/nothing-at-all');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failed lookup');
    expect(result.reason).toBe('missing-or-private');
    expect(result.reason).not.toBe('not-found');
    // The card link survives the failure, so "go look yourself" stays open.
    expect(result.url).toBe('https://huggingface.co/nobody/nothing-at-all');
  });

  it('reports a genuine 404 as a genuine absence', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ error: 'Repo not found' }, 404));

    const result = await lookupHuggingFaceLora('nobody/nothing-at-all', 'hf_token');
    if (result.ok) throw new Error('expected a failed lookup');
    expect(result.reason).toBe('not-found');
  });

  it('distinguishes rate limiting from every other disappointment', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, 429));

    const result = await lookupHuggingFaceLora('owner/name');
    if (result.ok) throw new Error('expected a failed lookup');
    expect(result.reason).toBe('rate-limited');
  });

  it('sends the token as a bearer credential when one is supplied', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(REALISM_LORA_PAYLOAD));
    global.fetch = fetchMock;

    await lookupHuggingFaceLora('XLabs-AI/flux-RealismLora', 'hf_secret_token');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://huggingface.co/api/models/XLabs-AI/flux-RealismLora');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer hf_secret_token');
  });

  it('sends no Authorization header when there is no token', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(REALISM_LORA_PAYLOAD));
    global.fetch = fetchMock;

    await lookupHuggingFaceLora('XLabs-AI/flux-RealismLora');

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('never puts the token in the log', async () => {
    const { logger } = jest.requireMock('@/lib/logger');
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(REALISM_LORA_PAYLOAD));

    await lookupHuggingFaceLora('XLabs-AI/flux-RealismLora', 'hf_secret_token');

    const everythingLogged = JSON.stringify([
      logger.debug.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(everythingLogged).not.toContain('hf_secret_token');
    expect(everythingLogged).toContain('"hasToken":true');
  });

  it('does not go to the network for a source with no repository behind it', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const result = await lookupHuggingFaceLora('https://cdn.example.com/weights.safetensors');
    if (result.ok) throw new Error('expected a failed lookup');
    expect(result.reason).toBe('not-a-repo-id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a timeout as a timeout rather than a missing repository', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    global.fetch = jest.fn().mockRejectedValue(timeoutError);

    const result = await lookupHuggingFaceLora('owner/name');
    if (result.ok) throw new Error('expected a failed lookup');
    expect(result.reason).toBe('timeout');
  });

  it('survives a body that is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    } as unknown as Response);

    const result = await lookupHuggingFaceLora('owner/name');
    if (result.ok) throw new Error('expected a failed lookup');
    expect(result.reason).toBe('http');
  });
});
