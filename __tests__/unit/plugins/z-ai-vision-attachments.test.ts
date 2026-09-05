/**
 * Bug 104 — the Z.AI plugin kept its own list of which GLM models read
 * pictures, and a new model outgrew it.
 *
 * `provider.ts` matched only ids carrying a `v` immediately after the
 * generation number (`glm-4.6v`, `glm-5v`). Z.AI's 5.3 line reads images
 * without a separate `v` variant, so `glm-5.3-flash` fell through to `failed`
 * and the bytes never reached the wire — while the host, reading the profile's
 * `supportsImageUpload` flag, had already suppressed the describe-fallback.
 * The turn succeeded and the character wrote about a backdrop it had never been
 * shown. That is bug 91's shape exactly, and the fix is bug 91's fix: one
 * question, one answer, asked by the host.
 *
 * So the assertion that matters is a negative one — the plugin must hold NO
 * opinion about which model ids read images. An attachment arriving here means
 * the operator has asserted this model reads them, and the plugin's job is to
 * send it. The MIME gate stays, because that one is about the wire format
 * rather than the model.
 */

import { ZAIProvider } from '@/plugins/dist/qtap-plugin-z-ai/provider';

// Mock the OpenAI SDK so sendMessage hits a stub whose request body we inspect.
jest.mock('openai', () => {
  const create = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create } },
      models: { list: jest.fn() },
    })),
  };
});

import OpenAI from 'openai';

const FAKE_COMPLETION = {
  choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const PNG = {
  id: 'attachment-1',
  filename: 'backdrop.png',
  mimeType: 'image/png',
  size: 2048,
  data: 'QUJD',
};

function getCreateMock(): jest.Mock {
  const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
  const instance = MockOpenAI.mock.results[MockOpenAI.mock.results.length - 1]?.value;
  return instance.chat.completions.create as jest.Mock;
}

/** Send one image on `model` and report what the plugin did with it. */
async function sendImageOn(model: string, attachment = PNG) {
  const provider = new ZAIProvider();
  const response = await provider.sendMessage(
    {
      model,
      messages: [{ role: 'user' as const, content: 'What is in this picture?', attachments: [attachment] }],
    } as never,
    'test-key',
  );
  const body = (getCreateMock().mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
  return { body, attachmentResults: (response as { attachmentResults?: { sent: string[]; failed: { id: string; error: string }[] } }).attachmentResults };
}

beforeEach(() => {
  jest.clearAllMocks();
  const MockOpenAI = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;
  (MockOpenAI as unknown as jest.Mock).mockImplementation(() => ({
    chat: { completions: { create: jest.fn().mockResolvedValue(FAKE_COMPLETION) } },
    models: { list: jest.fn() },
  }));
});

describe('bug 104 — the model id no longer decides whether an image is sent', () => {
  it.each([
    'glm-5.3-flash', // the id that reported the bug
    'glm-5.3',
    'glm-5.1',
    'glm-5.2',
    'glm-6',
    'glm-4.6v', // matched the old private list
    'glm-5v', // ditto
    'glm-4.6', // never matched it
    'some-future-glm',
  ])('forwards the bytes on %s', async model => {
    const { body, attachmentResults } = await sendImageOn(model);

    expect(attachmentResults?.failed).toEqual([]);
    expect(attachmentResults?.sent).toEqual([PNG.id]);

    const content = (body.messages as { role: string; content: unknown }[])[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toEqual(
      expect.arrayContaining([
        { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG.data}` } },
      ]),
    );
  });

  it('never answers "does not support image input" — the host owns that question', async () => {
    const { attachmentResults } = await sendImageOn('glm-5.3-flash');
    const errors = (attachmentResults?.failed ?? []).map(f => f.error).join(' ');
    expect(errors).not.toMatch(/does not support image input/i);
    expect(errors).not.toMatch(/vision model/i);
  });

  it('keeps the prompt text alongside the image part', async () => {
    const { body } = await sendImageOn('glm-5.3-flash');
    const content = (body.messages as { content: { type: string; text?: string }[] }[])[0].content;
    expect(content[0]).toEqual({ type: 'text', text: 'What is in this picture?' });
  });
});

describe('the gates that DO still belong to the plugin', () => {
  it('refuses a MIME type Z.AI cannot carry — a wire-format question, not a model one', async () => {
    const { attachmentResults } = await sendImageOn('glm-5.3-flash', {
      ...PNG,
      filename: 'notes.pdf',
      mimeType: 'application/pdf',
    });

    expect(attachmentResults?.sent).toEqual([]);
    expect(attachmentResults?.failed).toHaveLength(1);
    expect(attachmentResults?.failed[0].error).toMatch(/Unsupported file type: application\/pdf/);
  });

  it('refuses an attachment carrying neither data nor a URL', async () => {
    const { attachmentResults } = await sendImageOn('glm-5.3-flash', {
      ...PNG,
      data: undefined,
    } as never);

    expect(attachmentResults?.sent).toEqual([]);
    expect(attachmentResults?.failed[0].error).toMatch(/missing data or URL/i);
  });

  it('sends a plain string when there is nothing attached', async () => {
    const provider = new ZAIProvider();
    await provider.sendMessage(
      { model: 'glm-5.3-flash', messages: [{ role: 'user' as const, content: 'hello' }] } as never,
      'test-key',
    );
    const body = (getCreateMock().mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect((body.messages as { content: unknown }[])[0].content).toBe('hello');
  });
});

describe('the private vision list is gone from the source', () => {
  it('holds no VISION_MODEL_PATTERNS table', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const source = fs.readFileSync(
      path.join(process.cwd(), 'plugins/dist/qtap-plugin-z-ai/provider.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/VISION_MODEL_PATTERNS/);
  });
});
