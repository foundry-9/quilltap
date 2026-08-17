/**
 * Unit tests for `chooseLLMOutfit`'s response parser.
 *
 * The parser is the gate that decides which of the model's picks survive, and
 * it's the reason `llm_choose` couldn't equip shared items: ids outside the
 * candidate pool are dropped. Now that the pool spans all three tiers, the
 * pool-membership check has to accept shared ids too.
 *
 * Strategy: mock `./core-execution` to capture the `parseResponse` callback and
 * drive it directly with model output — no provider, no network.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}));

const { chooseLLMOutfit } = require('@/lib/memory/cheap-llm-tasks/outfit-selection');
const { executeCheapLLMTask } = require('@/lib/memory/cheap-llm-tasks/core-execution');

const mockExecute = executeCheapLLMTask as jest.Mock;

type Slots = { top: string[]; bottom: string[]; footwear: string[]; accessories: string[]; hair: string[] };
type Choice = { slots: Slots; deliberatelyUnclothed: boolean };

const EMPTY: Slots = { top: [], bottom: [], footwear: [], accessories: [], hair: [] };

function item(id: string, types: string[], overrides: Record<string, unknown> = {}) {
  return {
    id,
    characterId: null,
    title: id,
    types,
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const POOL = [
  // A shared (characterId: null) item — the case that used to be unreachable.
  item('general-coat', ['top']),
  item('own-jeans', ['bottom'], { characterId: 'char-1' }),
  item('own-boots', ['footwear'], { characterId: 'char-1' }),
  item('own-braids', ['hair'], { characterId: 'char-1' }),
];

/** Run `chooseLLMOutfit` far enough to capture the parser, then drive it. */
async function parserFor(pool = POOL): Promise<(content: string) => Choice> {
  mockExecute.mockResolvedValue({ success: true, result: null });
  await chooseLLMOutfit(
    'Bertie',
    'd',
    'p',
    'm',
    pool,
    'a formal evening',
    { profileId: 'cheap' },
    'user-1',
    'chat-1',
    'char-1',
  );
  return mockExecute.mock.calls[0][3] as (content: string) => Choice;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('chooseLLMOutfit — response parsing', () => {
  it('accepts a shared item id present in the pool', async () => {
    const parse = await parserFor();
    expect(parse('{"top":["general-coat"],"bottom":[],"footwear":[],"accessories":[]}')).toEqual({
      slots: { ...EMPTY, top: ['general-coat'] },
      deliberatelyUnclothed: false,
    });
  });

  it('drops an id that is not in the pool', async () => {
    const parse = await parserFor();
    expect(
      parse('{"top":["hallucinated-cape"],"bottom":[],"footwear":[],"accessories":[]}').slots.top,
    ).toEqual([]);
  });

  it('drops an id whose types do not cover the slot it was placed in', async () => {
    const parse = await parserFor();
    // own-boots is footwear; the model put it in `top`.
    expect(parse('{"top":["own-boots"],"footwear":["own-boots"]}').slots).toEqual({
      ...EMPTY,
      footwear: ['own-boots'],
    });
  });

  it('tolerates the legacy single-id scalar shape', async () => {
    const parse = await parserFor();
    expect(parse('{"top":"general-coat","bottom":null}').slots).toEqual({
      ...EMPTY,
      top: ['general-coat'],
    });
  });

  it('dedupes repeated ids within a slot', async () => {
    const parse = await parserFor();
    expect(parse('{"top":["general-coat","general-coat"]}').slots.top).toEqual(['general-coat']);
  });

  it('strips markdown fences before parsing', async () => {
    const parse = await parserFor();
    const fenced = '```json\n{"bottom":["own-jeans"]}\n```';
    expect(parse(fenced).slots.bottom).toEqual(['own-jeans']);
  });

  it('returns empty slots for a non-object response', async () => {
    const parse = await parserFor();
    expect(parse('["general-coat"]')).toEqual({
      slots: EMPTY,
      deliberatelyUnclothed: false,
    });
  });

  // ─────────────────────────────────────────── deliberate nudity

  it('reports a flagged empty answer as deliberate', async () => {
    const parse = await parserFor();
    expect(
      parse('{"deliberate":true,"top":[],"bottom":[],"footwear":[],"accessories":[]}'),
    ).toEqual({ slots: EMPTY, deliberatelyUnclothed: true });
  });

  it('does not report an unflagged empty answer as deliberate', async () => {
    const parse = await parserFor();
    expect(parse('{"top":[],"bottom":[],"footwear":[],"accessories":[]}').deliberatelyUnclothed).toBe(
      false,
    );
  });

  // ─────────────────────────────────────────── the hair slot

  it('accepts a hair-typed item placed in the hair slot', async () => {
    const parse = await parserFor();
    expect(parse('{"hair":["own-braids"]}').slots).toEqual({
      ...EMPTY,
      hair: ['own-braids'],
    });
  });

  it('rejects a hair-typed item offered to a clothing slot', async () => {
    const parse = await parserFor();
    expect(parse('{"top":["own-braids"]}').slots).toEqual(EMPTY);
  });

  it('keeps a styled hairdo alongside a deliberate-nudity flag', async () => {
    const parse = await parserFor();
    const out = parse('{"deliberate":true,"top":[],"bottom":[],"footwear":[],"accessories":[],"hair":["own-braids"]}');
    expect(out.deliberatelyUnclothed).toBe(true);
    expect(out.slots).toEqual({ ...EMPTY, hair: ['own-braids'] });
  });

  it('requires a real boolean — a stringy "true" is not a deliberate claim', async () => {
    const parse = await parserFor();
    expect(parse('{"deliberate":"true","top":[]}').deliberatelyUnclothed).toBe(false);
  });

  it('keeps picked items alongside a deliberate flag', async () => {
    const parse = await parserFor();
    const out = parse('{"deliberate":true,"top":["general-coat"]}');
    expect(out.slots.top).toEqual(['general-coat']);
    expect(out.deliberatelyUnclothed).toBe(true);
  });

  it('short-circuits to empty slots without calling the model for an empty pool', async () => {
    mockExecute.mockResolvedValue({ success: true, result: null });
    const result = await chooseLLMOutfit(
      'Bertie',
      null,
      null,
      null,
      [],
      null,
      { profileId: 'cheap' },
      'user-1',
    );
    expect(mockExecute).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      result: { slots: EMPTY, deliberatelyUnclothed: false },
    });
  });
});
