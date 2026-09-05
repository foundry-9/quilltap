import { resolveSamplingParams } from '../sampling-params';

describe('resolveSamplingParams', () => {
  it('reads the snake_case keys the profile editor writes', () => {
    // The exact blob a profile saved through the connection-profile form.
    expect(
      resolveSamplingParams({ temperature: 1, max_tokens: 16384, top_p: 0.95 })
    ).toEqual({ temperature: 1, maxTokens: 16384, topP: 0.95 });
  });

  it('tolerates the camelCase spelling on an imported or hand-edited blob', () => {
    expect(
      resolveSamplingParams({ temperature: 0.7, maxTokens: 4096, topP: 0.9 })
    ).toEqual({ temperature: 0.7, maxTokens: 4096, topP: 0.9 });
  });

  it('prefers the canonical snake_case key when a blob carries both', () => {
    expect(
      resolveSamplingParams({ max_tokens: 16384, maxTokens: 4096, top_p: 0.95, topP: 0.5 })
    ).toEqual({ temperature: undefined, maxTokens: 16384, topP: 0.95 });
  });

  it('parses numeric strings', () => {
    expect(
      resolveSamplingParams({ temperature: '0.8', max_tokens: '8192', top_p: '1' })
    ).toEqual({ temperature: 0.8, maxTokens: 8192, topP: 1 });
  });

  it('leaves absent knobs undefined rather than inventing a value', () => {
    expect(resolveSamplingParams({ temperature: 0.7 })).toEqual({
      temperature: 0.7,
      maxTokens: undefined,
      topP: undefined,
    });
    expect(resolveSamplingParams({})).toEqual({
      temperature: undefined,
      maxTokens: undefined,
      topP: undefined,
    });
    expect(resolveSamplingParams(undefined)).toEqual({
      temperature: undefined,
      maxTokens: undefined,
      topP: undefined,
    });
  });

  it('ignores unparseable values', () => {
    expect(
      resolveSamplingParams({ temperature: 'warm', max_tokens: null, top_p: {} })
    ).toEqual({ temperature: undefined, maxTokens: undefined, topP: undefined });
  });

  it('keeps a deliberate zero, which is not the same as unset', () => {
    expect(resolveSamplingParams({ temperature: 0, top_p: 0 })).toEqual({
      temperature: 0,
      maxTokens: undefined,
      topP: 0,
    });
  });

  it('ignores the non-sampling keys that share the parameters blob', () => {
    const params = {
      temperature: 1,
      max_tokens: 16384,
      top_p: 0.95,
      enable_thinking: true,
      request_timeout_seconds: 900,
      num_ctx: 65536,
    };
    expect(resolveSamplingParams(params)).toEqual({
      temperature: 1,
      maxTokens: 16384,
      topP: 0.95,
    });
  });
});
