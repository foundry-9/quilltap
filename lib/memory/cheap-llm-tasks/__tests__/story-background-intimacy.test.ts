/**
 * The story-background crafter's intimacy guidance is not fixed: it swaps on
 * `uncensoredImageTarget`. A prompt bound for a moderated provider still gets
 * the cinematic-concealment treatment (drapery, occlusion, silhouette); one
 * bound for a Concierge uncensored provider gets candid depiction instead,
 * because the concealment exists only to clear moderation that target does not
 * apply. Both variants must keep the background-framing rules.
 *
 * executeCheapLLMTask is mocked so we can read the system message handed to the
 * cheap LLM. Mock style matches the sibling suites: subject import first, bare
 * jest.mock() factory, behaviour wired in beforeEach.
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import { craftStoryBackgroundPrompt } from '../image-scene-tasks';

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { executeCheapLLMTask } from '../core-execution';
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm';

const SELECTION: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-test',
  connectionProfileId: 'profile-1',
  isLocal: false,
} as never;

const BASE = {
  sceneContext: 'the morning after, in a shuttered bedroom',
  characters: [{ name: 'Ariel', description: 'a young woman' }],
  provider: 'OPENAI',
};

function lastSystemMessage(): string {
  const calls = jest.mocked(executeCheapLLMTask).mock.calls;
  const messages = calls[calls.length - 1][1] as Array<{ role: string; content: string }>;
  return messages.find((m) => m.role === 'system')!.content;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(executeCheapLLMTask).mockImplementation(
    async (_sel, _msgs, _uid, parse) =>
      ({ success: true, result: (parse as (c: string) => unknown)('out') }) as never,
  );
});

describe('craftStoryBackgroundPrompt intimacy guidance', () => {
  it('defaults to cinematic concealment when the flag is absent', async () => {
    await craftStoryBackgroundPrompt(BASE, SELECTION, 'user-1', 'chat-1');
    const system = lastSystemMessage();

    expect(system).toContain('do NOT render explicit nudity');
    expect(system).toContain('cinematic concealment');
    expect(system).toContain('Drapery:');
    expect(system).toContain('BAD (too explicit, will be rejected)');
    expect(system).not.toContain('The target image provider accepts adult content');
  });

  it('keeps concealment when the target is an ordinary moderated provider', async () => {
    await craftStoryBackgroundPrompt(
      { ...BASE, uncensoredImageTarget: false },
      SELECTION,
      'user-1',
      'chat-1',
    );
    const system = lastSystemMessage();

    expect(system).toContain('cinematic concealment');
    expect(system).not.toContain('The target image provider accepts adult content');
  });

  it('swaps in candid depiction for an uncensored image target', async () => {
    await craftStoryBackgroundPrompt(
      { ...BASE, uncensoredImageTarget: true },
      SELECTION,
      'user-1',
      'chat-1',
    );
    const system = lastSystemMessage();

    expect(system).toContain('The target image provider accepts adult content');
    expect(system).toContain('BAD (needlessly coy');
    // None of the concealment machinery survives.
    expect(system).not.toContain('cinematic concealment');
    expect(system).not.toContain('Drapery:');
    expect(system).not.toContain('Foreground occlusion:');
    expect(system).not.toContain('tasteful concealment');
  });

  it('refuses to re-dress the scene in either variant', async () => {
    for (const uncensoredImageTarget of [false, true]) {
      await craftStoryBackgroundPrompt(
        { ...BASE, uncensoredImageTarget },
        SELECTION,
        'user-1',
        'chat-1',
      );
      expect(lastSystemMessage()).toContain('"wearing pajamas"');
    }
  });

  it('keeps the shared background-framing rules in both variants', async () => {
    for (const uncensoredImageTarget of [false, true]) {
      await craftStoryBackgroundPrompt(
        { ...BASE, uncensoredImageTarget },
        SELECTION,
        'user-1',
        'chat-1',
      );
      const system = lastSystemMessage();

      expect(system).toContain('This is for a BACKGROUND image, not a portrait');
      expect(system).toContain('Characters should be toward the left and right of the frame');
      expect(system).toContain('AESTHETIC & DEPICTION GUIDELINES');
      expect(system).toContain('MANDATORY, binding constraints');
      expect(system).toContain('Respond with ONLY the final prompt');
    }
  });
});
