/**
 * Smart typography, Part A — the shared render-time configuration.
 *
 * ⚠ This suite deliberately does NOT drive the remark pipelines. `unified`,
 * `remark-*` and `remark-smartypants` are ESM-only and this repo's Jest
 * transform does not process them (see the header of
 * `__tests__/unit/lib/services/markdown-renderer.service.test.ts`, which makes
 * the same concession). What CAN be pinned here is everything that actually
 * decides anything: the option object both pipelines pass, and the guard that
 * suppresses the typographer for a template it would break. The end-to-end
 * behaviour is verified against the real pipeline — see the Part A matrix in
 * `docs/developer/features/composer-smart-typography.md`.
 */

import {
  SMARTYPANTS_OPTIONS,
  isQuoteSensitiveRoleplayConfig,
  shouldCurlQuotes,
} from '@/lib/markdown/typography';
import {
  DEFAULT_RENDERING_PATTERNS,
  DEFAULT_DIALOGUE_DETECTION,
} from '@/lib/chat/roleplay-rendering';
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types';

describe('SMARTYPANTS_OPTIONS', () => {
  it('curls quotes', () => {
    expect(SMARTYPANTS_OPTIONS.quotes).toBe(true);
  });

  it('leaves dashes to Part B — PERMANENTLY', () => {
    // If this ever flips, `run it with --verbose` renders as `--verbose` with an
    // en dash and the writer cannot tell why, because the source is correct.
    // See "Why dashes are not a render-time rule" in the spec. This is not a
    // tuning question.
    expect(SMARTYPANTS_OPTIONS.dashes).toBe(false);
  });

  it('leaves the ellipsis to Part B', () => {
    expect(SMARTYPANTS_OPTIONS.ellipses).toBe(false);
  });

  it('never rewrites backticks', () => {
    // `backticks: true` turns `` into a curly double quote — catastrophic in a
    // markdown application.
    expect(SMARTYPANTS_OPTIONS.backticks).toBe(false);
  });

  it('uses exactly the option names retext-smartypants recognises', () => {
    // An unrecognised key is silently ignored, which would leave dashes ON at
    // their library default. Pin the key set so a rename is a test failure
    // rather than a silent regression.
    expect(Object.keys(SMARTYPANTS_OPTIONS).sort()).toEqual([
      'backticks',
      'dashes',
      'ellipses',
      'quotes',
    ]);
  });
});

describe('isQuoteSensitiveRoleplayConfig', () => {
  it('passes the shipped defaults — they survive curling', () => {
    // The built-in dialogue pattern carries no rpBody group, and
    // DEFAULT_DIALOGUE_DETECTION lists the curly forms alongside the straight
    // ones (bug 62). Neither is quote-sensitive.
    expect(
      isQuoteSensitiveRoleplayConfig(DEFAULT_RENDERING_PATTERNS, DEFAULT_DIALOGUE_DETECTION)
    ).toBe(false);
  });

  it('flags a template that claims the double quote as a wrap delimiter', () => {
    // What `buildWrapPattern` emits for a same-open/close `"` delimiter.
    const patterns: RenderingPattern[] = [
      { pattern: '(?<!")"(?<rpBody>[^"]+)"(?!")', className: 'qt-chat-dialogue' },
    ];
    expect(isQuoteSensitiveRoleplayConfig(patterns, DEFAULT_DIALOGUE_DETECTION)).toBe(true);
  });

  it('flags a template that claims the single quote as a wrap delimiter', () => {
    const patterns: RenderingPattern[] = [
      { pattern: "(?<!')'(?<rpBody>[^']+)'(?!')", className: 'qt-chat-whisper' },
    ];
    expect(isQuoteSensitiveRoleplayConfig(patterns, DEFAULT_DIALOGUE_DETECTION)).toBe(true);
  });

  it('ignores a wrap delimiter that has nothing to do with quotes', () => {
    const patterns: RenderingPattern[] = [
      { pattern: '(?<!\\+)\\+(?<rpBody>[^+]+)\\+(?!\\+)', className: 'qt-chat-narration' },
    ];
    expect(isQuoteSensitiveRoleplayConfig(patterns, DEFAULT_DIALOGUE_DETECTION)).toBe(false);
  });

  it('does NOT flag a legacy built-in that merely mentions a quote', () => {
    // The fixed default dialogue pattern names the straight quote AND both
    // curly ones, and has no rpBody group. Curling is safe for it — flagging it
    // would disable the whole feature for every default chat.
    const patterns: RenderingPattern[] = [
      { pattern: '["“][^"”]+["”]', className: 'qt-chat-dialogue' },
    ];
    expect(isQuoteSensitiveRoleplayConfig(patterns, DEFAULT_DIALOGUE_DETECTION)).toBe(false);
  });

  it('flags straight-only dialogue detection — the bug-62 shape from a custom template', () => {
    const straightOnly: DialogueDetection = {
      openingChars: ['"'],
      closingChars: ['"'],
      className: 'qt-chat-dialogue',
    };
    expect(isQuoteSensitiveRoleplayConfig(DEFAULT_RENDERING_PATTERNS, straightOnly)).toBe(true);
  });

  it('accepts dialogue detection that declares straight AND curly', () => {
    const both: DialogueDetection = {
      openingChars: ['"', '“'],
      closingChars: ['"', '”'],
      className: 'qt-chat-dialogue',
    };
    expect(isQuoteSensitiveRoleplayConfig(DEFAULT_RENDERING_PATTERNS, both)).toBe(false);
  });

  it('accepts dialogue detection that declares only the curly forms', () => {
    const curlyOnly: DialogueDetection = {
      openingChars: ['“'],
      closingChars: ['”'],
      className: 'qt-chat-dialogue',
    };
    expect(isQuoteSensitiveRoleplayConfig(DEFAULT_RENDERING_PATTERNS, curlyOnly)).toBe(false);
  });

  it('flags straight-only SINGLE-quote dialogue detection', () => {
    const straightSingle: DialogueDetection = {
      openingChars: ["'"],
      closingChars: ["'"],
      className: 'qt-chat-dialogue',
    };
    expect(isQuoteSensitiveRoleplayConfig(DEFAULT_RENDERING_PATTERNS, straightSingle)).toBe(true);
  });

  it('tolerates an absent dialogue config', () => {
    expect(isQuoteSensitiveRoleplayConfig(DEFAULT_RENDERING_PATTERNS, null)).toBe(false);
    expect(isQuoteSensitiveRoleplayConfig(DEFAULT_RENDERING_PATTERNS, undefined)).toBe(false);
  });
});

describe('shouldCurlQuotes', () => {
  const safe = {
    renderingPatterns: DEFAULT_RENDERING_PATTERNS,
    dialogueDetection: DEFAULT_DIALOGUE_DETECTION,
  };

  it('is off when the setting is off', () => {
    expect(shouldCurlQuotes({ displayQuotes: false, ...safe })).toBe(false);
  });

  it('is off when the setting is absent (the default)', () => {
    expect(shouldCurlQuotes({ displayQuotes: undefined, ...safe })).toBe(false);
  });

  it('is on when the setting is on and the template is safe', () => {
    expect(shouldCurlQuotes({ displayQuotes: true, ...safe })).toBe(true);
  });

  it('is off when the setting is on but the template claims a quote delimiter', () => {
    expect(
      shouldCurlQuotes({
        displayQuotes: true,
        renderingPatterns: [
          { pattern: '(?<!")"(?<rpBody>[^"]+)"(?!")', className: 'qt-chat-dialogue' },
        ],
        dialogueDetection: DEFAULT_DIALOGUE_DETECTION,
      })
    ).toBe(false);
  });
});
