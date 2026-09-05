/**
 * Bug 111 — a failed NanoGPT image generation was undiagnosable from the logs.
 *
 * The request body was recorded at `debug` on the way out and nowhere at all on
 * the way back. NanoGPT answers a rejected adapter, an unreachable weights repo
 * and a filtered prompt with the same generic 400 — "try a different prompt or
 * image" — so the body that was posted is the only thing separating those
 * causes, and at the `info` an instance actually runs at, the debug line is not
 * there to consult. Diagnosis cost another paid generation per guess.
 *
 * The fix logs the same facts at `error` on the failure path before re-raising.
 * The privacy half is as load-bearing as the diagnostic half: LoRA and
 * passthrough *key names* only, never values, which is what keeps `hf_api_token`
 * out of the log.
 */

import { NanoGPTImageProvider } from '@/plugins/dist/qtap-plugin-nanogpt/image-provider';
import * as pluginUtils from '@quilltap/plugin-utils';

// Mock OpenAI (NanoGPT's images route is OpenAI-shaped).
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      images: { generate: jest.fn() },
      models: { list: jest.fn() },
    })),
  };
});

// Intercept the plugin logger. `createPluginLogger` runs at module load, so the
// recorder has to be installed by the mock factory rather than injected after.
jest.mock('@quilltap/plugin-utils', () => {
  const actual = jest.requireActual('@quilltap/plugin-utils');
  const records: { level: string; message: string; context: Record<string, unknown> }[] = [];
  const record = (level: string) => (message: string, context: Record<string, unknown> = {}) => {
    records.push({ level, message, context });
  };
  const logger = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  };
  return {
    ...actual,
    __esModule: true,
    createPluginLogger: () => logger,
    __records: records,
  };
});

import OpenAI from 'openai';

type LogRecord = { level: string; message: string; context: Record<string, unknown> };

function logRecords(): LogRecord[] {
  return (pluginUtils as unknown as { __records: LogRecord[] }).__records;
}

function generateMock(): jest.Mock {
  const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
  const instance = MockOpenAI.mock.results[MockOpenAI.mock.results.length - 1]?.value;
  return instance.images.generate as jest.Mock;
}

const LORA_PARAMS = {
  prompt: 'a drawing room at dusk',
  model: 'fal-ai/flux-lora',
  size: '1024x1024',
  n: 1,
  loras: [{ source: 'owner/name', scale: 0.8 }],
  profileParameters: { hf_api_token: 'hf_SUPERSECRETTOKEN' },
};

beforeEach(() => {
  jest.clearAllMocks();
  logRecords().length = 0;
});

describe('bug 111 — the failure path records the body that was posted', () => {
  it('logs at error, not only at debug, when the generate call throws', async () => {
    const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
    (MockOpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: { generate: jest.fn().mockRejectedValue(new Error('400 try a different prompt')) },
      models: { list: jest.fn() },
    }));

    await expect(
      new NanoGPTImageProvider().generateImage(LORA_PARAMS as never, 'test-key'),
    ).rejects.toThrow('400 try a different prompt');

    const errors = logRecords().filter(r => r.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('NanoGPT image request failed');
  });

  it('names the model, size, LoRA dialect and every key that was posted', async () => {
    const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
    (MockOpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: { generate: jest.fn().mockRejectedValue(new Error('400 bad request')) },
      models: { list: jest.fn() },
    }));

    await expect(
      new NanoGPTImageProvider().generateImage(LORA_PARAMS as never, 'test-key'),
    ).rejects.toThrow();

    const context = logRecords().find(r => r.level === 'error')!.context;
    expect(context).toMatchObject({
      context: 'NanoGPTImageProvider.generateImage',
      model: 'fal-ai/flux-lora',
      size: '1024x1024',
      n: 1,
      error: '400 bad request',
    });
    expect(context).toHaveProperty('loraDialect');
    expect(context).toHaveProperty('loraKeys');
    expect(context).toHaveProperty('loraDropped');
    expect(context).toHaveProperty('passthroughKeys');
  });

  it('records key NAMES only — no credential reaches the log', async () => {
    const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
    (MockOpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: { generate: jest.fn().mockRejectedValue(new Error('400 bad request')) },
      models: { list: jest.fn() },
    }));

    await expect(
      new NanoGPTImageProvider().generateImage(LORA_PARAMS as never, 'test-key'),
    ).rejects.toThrow();

    const serialized = JSON.stringify(logRecords());
    expect(serialized).not.toContain('hf_SUPERSECRETTOKEN');
    expect(serialized).not.toContain('test-key');
  });

  it('re-raises the original error rather than swallowing it', async () => {
    const original = new Error('upstream exploded');
    const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
    (MockOpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: { generate: jest.fn().mockRejectedValue(original) },
      models: { list: jest.fn() },
    }));

    await expect(
      new NanoGPTImageProvider().generateImage(LORA_PARAMS as never, 'test-key'),
    ).rejects.toBe(original);
  });

  it('stringifies a non-Error rejection instead of logging "[object Object]"', async () => {
    const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
    (MockOpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: { generate: jest.fn().mockRejectedValue('plain string failure') },
      models: { list: jest.fn() },
    }));

    await expect(
      new NanoGPTImageProvider().generateImage(LORA_PARAMS as never, 'test-key'),
    ).rejects.toBe('plain string failure');

    expect(logRecords().find(r => r.level === 'error')!.context.error).toBe('plain string failure');
  });
});

describe('the success path stays quiet', () => {
  it('logs nothing at error when the generation succeeds', async () => {
    const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
    (MockOpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: {
        generate: jest.fn().mockResolvedValue({ data: [{ b64_json: 'QUJD' }] }),
      },
      models: { list: jest.fn() },
    }));

    await new NanoGPTImageProvider().generateImage(LORA_PARAMS as never, 'test-key');

    expect(logRecords().filter(r => r.level === 'error')).toEqual([]);
    expect(logRecords().some(r => r.message === 'Posting NanoGPT image request')).toBe(true);
  });

  it('logs at error when the response is the wrong shape', async () => {
    const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
    (MockOpenAI as unknown as jest.Mock).mockImplementation(() => ({
      images: { generate: jest.fn().mockResolvedValue({ nothing: 'useful' }) },
      models: { list: jest.fn() },
    }));

    await expect(
      new NanoGPTImageProvider().generateImage(LORA_PARAMS as never, 'test-key'),
    ).rejects.toThrow('Invalid response from NanoGPT Images API');

    expect(logRecords().filter(r => r.level === 'error')).toHaveLength(1);
  });
});
