/**
 * Unit tests for markdown-renderer.service.ts
 * Tests canPreRenderMessage function logic
 *
 * NOTE: Full integration tests for renderMarkdownToHtml would require ESM support
 * or should be tested in end-to-end tests. The renderMarkdownToHtml function heavily
 * depends on unified/remark/rehype libraries which are ESM-only and difficult to test
 * in Jest's CommonJS environment. The actual implementation is tested manually and
 * through browser-based E2E tests.
 *
 * To avoid ESM module loading issues, we test the canPreRenderMessage logic directly
 * by reimplementing it here based on the source code.
 */

// The pure roleplay-rendering core is import-safe in Jest (no ESM-only deps).
// The local HTML wrappers below delegate to it so this test exercises the REAL
// match-walk / escaping, not a drifting reimplementation.
import {
  type CompiledRule,
  DEFAULT_RENDERING_PATTERNS,
  DEFAULT_DIALOGUE_DETECTION,
  compileRenderingPatterns,
  escapeMarkdownInBrackets as coreEscapeMarkdownInBrackets,
  tokenizeInline,
  segmentsToHtml,
  lineMatchFor,
  wrapBlockMatchFor,
  isDialogueParagraph as coreIsDialogueParagraph,
} from '@/lib/chat/roleplay-rendering';

// Mock logger to suppress log output during tests
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

/**
 * Types needed for testing helper functions
 */
interface RenderingPattern {
  pattern: string;
  className: string;
  flags?: string;
}

interface CompiledPattern {
  regex: RegExp;
  className: string;
}

interface DialogueDetection {
  openingChars: string[];
  closingChars: string[];
  className: string;
}

/**
 * Reimplementation of canPreRenderMessage for testing without ESM dependencies
 * This mirrors the actual implementation in markdown-renderer.service.ts
 */
function canPreRenderMessage(
  role: string,
  hasAttachments: boolean,
  hasEmbeddedTool: boolean = false
): boolean {
  // Only USER and ASSISTANT messages can be pre-rendered
  if (role !== 'USER' && role !== 'ASSISTANT') {
    return false;
  }

  // Messages with attachments need client-side handling for image display
  if (hasAttachments) {
    return false;
  }

  // Messages with embedded tools need client-side interactivity
  if (hasEmbeddedTool) {
    return false;
  }

  return true;
}

/** Escaping is the shared core function (no reimplementation). */
const escapeMarkdownInBrackets = coreEscapeMarkdownInBrackets;

/** Adapt a test CompiledPattern to the core CompiledRule shape. */
function toRule(p: CompiledPattern, scope: 'inline' | 'line' = 'inline'): CompiledRule {
  return { regex: new RegExp(p.regex.source, p.regex.flags.replace('g', '')), className: p.className, scope };
}

/**
 * HTML wrapper mirroring markdown-renderer.service.applyRoleplayPatterns, but the
 * inner match-walk delegates to the REAL shared tokenizeInline + segmentsToHtml.
 */
function applyRoleplayPatterns(html: string, compiledPatterns: CompiledPattern[]): string {
  const rules = compiledPatterns.map((p) => toRule(p));
  const tagRegex = /(<[^>]*>)/g;
  const parts = html.split(tagRegex);

  let inCodeBlock = 0;

  const processedParts = parts.map((part, index) => {
    if (index % 2 === 1) {
      const lowerPart = part.toLowerCase();
      if (lowerPart.startsWith('<code') || lowerPart.startsWith('<pre')) {
        inCodeBlock++;
      } else if (lowerPart === '</code>' || lowerPart === '</pre>') {
        inCodeBlock = Math.max(0, inCodeBlock - 1);
      }
      return part;
    }

    if (inCodeBlock > 0) {
      return part;
    }

    return segmentsToHtml(tokenizeInline(part, rules));
  });

  return processedParts.join('');
}

/** Dialogue predicate is the shared core function. */
const isDialogueParagraph = coreIsDialogueParagraph;

/**
 * HTML wrapper mirroring markdown-renderer.service.applyDialogueDetection.
 */
function applyDialogueDetection(html: string, detection: DialogueDetection): string {
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (match, attrs, content) => {
    const plainText = content.replace(/<[^>]+>/g, '');

    if (isDialogueParagraph(plainText, detection)) {
      if (attrs.includes('class="')) {
        const newAttrs = attrs.replace(/class="([^"]*)"/, `class="$1 ${detection.className}"`);
        return `<p${newAttrs}>${content}</p>`;
      } else {
        return `<p${attrs} class="${detection.className}">${content}</p>`;
      }
    }

    return match;
  });
}

/**
 * HTML wrapper mirroring markdown-renderer.service.applyWrapBlockClasses: a block
 * that is wholly a hidden-delimiter wrap gets its delimiters stripped and its body
 * wrapped in an inline styled span (preserving any inner markdown HTML).
 */
function applyWrapBlockClasses(html: string, rules: CompiledRule[]): string {
  const wrapRules = rules.filter((r) => r.scope === 'inline' && r.hideDelimiters);
  if (wrapRules.length === 0) return html;
  return html.replace(/<(p|li|blockquote|h[1-6])([^>]*)>([\s\S]*?)<\/\1>/g, (match, tag, attrs, content) => {
    const plainText = (content as string).replace(/<[^>]+>/g, '');
    const wrap = wrapBlockMatchFor(plainText, wrapRules);
    if (!wrap) return match;
    let inner = content as string;
    if (wrap.prefix && inner.startsWith(wrap.prefix)) inner = inner.slice(wrap.prefix.length);
    if (wrap.suffix && inner.endsWith(wrap.suffix)) inner = inner.slice(0, inner.length - wrap.suffix.length);
    return `<${tag}${attrs}><span class="${wrap.className}">${inner}</span></${tag}>`;
  });
}

/**
 * HTML wrapper mirroring markdown-renderer.service.applyLineScopedClasses: a
 * line-scoped rule's class lands on the whole block element, not an inline span.
 */
function applyLineScopedClasses(html: string, rules: CompiledRule[]): string {
  const lineRules = rules.filter((r) => r.scope === 'line');
  if (lineRules.length === 0) return html;
  return html.replace(/<(p|li|blockquote|h[1-6])([^>]*)>([\s\S]*?)<\/\1>/g, (match, tag, attrs, content) => {
    const plainText = content.replace(/<[^>]+>/g, '');
    const cls = lineMatchFor(plainText, lineRules)?.className;
    if (!cls) return match;
    if (attrs.includes('class="')) {
      const newAttrs = attrs.replace(/class="([^"]*)"/, `class="$1 ${cls}"`);
      return `<${tag}${newAttrs}>${content}</${tag}>`;
    }
    return `<${tag}${attrs} class="${cls}">${content}</${tag}>`;
  });
}

describe('markdown-renderer.service', () => {
  describe('canPreRenderMessage', () => {
    describe('USER role', () => {
      it('should return true for USER role with no attachments or tools', () => {
        const result = canPreRenderMessage('USER', false, false);
        expect(result).toBe(true);
      });

      it('should return false for USER role with attachments', () => {
        const result = canPreRenderMessage('USER', true, false);
        expect(result).toBe(false);
      });

      it('should return false for USER role with embedded tool', () => {
        const result = canPreRenderMessage('USER', false, true);
        expect(result).toBe(false);
      });

      it('should return false for USER role with both attachments and tools', () => {
        const result = canPreRenderMessage('USER', true, true);
        expect(result).toBe(false);
      });
    });

    describe('ASSISTANT role', () => {
      it('should return true for ASSISTANT role with no attachments or tools', () => {
        const result = canPreRenderMessage('ASSISTANT', false, false);
        expect(result).toBe(true);
      });

      it('should return false for ASSISTANT role with attachments', () => {
        const result = canPreRenderMessage('ASSISTANT', true, false);
        expect(result).toBe(false);
      });

      it('should return false for ASSISTANT role with embedded tool', () => {
        const result = canPreRenderMessage('ASSISTANT', false, true);
        expect(result).toBe(false);
      });

      it('should return false for ASSISTANT role with both attachments and tools', () => {
        const result = canPreRenderMessage('ASSISTANT', true, true);
        expect(result).toBe(false);
      });
    });

    describe('TOOL role', () => {
      it('should return false for TOOL role regardless of attachments or tools', () => {
        expect(canPreRenderMessage('TOOL', false, false)).toBe(false);
        expect(canPreRenderMessage('TOOL', true, false)).toBe(false);
        expect(canPreRenderMessage('TOOL', false, true)).toBe(false);
        expect(canPreRenderMessage('TOOL', true, true)).toBe(false);
      });
    });

    describe('SYSTEM role', () => {
      it('should return false for SYSTEM role regardless of attachments or tools', () => {
        expect(canPreRenderMessage('SYSTEM', false, false)).toBe(false);
        expect(canPreRenderMessage('SYSTEM', true, false)).toBe(false);
        expect(canPreRenderMessage('SYSTEM', false, true)).toBe(false);
        expect(canPreRenderMessage('SYSTEM', true, true)).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should handle hasEmbeddedTool parameter default (undefined)', () => {
        // Third parameter is optional with default false
        expect(canPreRenderMessage('USER', false)).toBe(true);
        expect(canPreRenderMessage('ASSISTANT', false)).toBe(true);
      });

      it('should return false for unknown roles', () => {
        expect(canPreRenderMessage('UNKNOWN', false, false)).toBe(false);
        expect(canPreRenderMessage('CUSTOM', false, false)).toBe(false);
        expect(canPreRenderMessage('', false, false)).toBe(false);
      });

      it('should be case sensitive for role names', () => {
        // The function checks for exact string matches
        expect(canPreRenderMessage('user', false, false)).toBe(false);
        expect(canPreRenderMessage('assistant', false, false)).toBe(false);
      });
    });
  });

  describe('escapeMarkdownInBrackets', () => {
    const BRACKET_NARRATION: RenderingPattern = { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' };
    const BRACE_MONOLOGUE: RenderingPattern = { pattern: '(?<!\\{)\\{[^{}]+\\}(?!\\})', className: 'qt-chat-inner-monologue' };
    const ASTERISK_NARRATION: RenderingPattern = { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' };

    it('should return content unchanged when no matching patterns', () => {
      const content = 'This is plain text with no special formatting';
      const result = escapeMarkdownInBrackets(content, []);
      expect(result).toBe(content);
    });

    it('should escape markdown chars inside [...] when bracket narration pattern present', () => {
      const content = '[narration with *emphasis* and _underline_]';
      const result = escapeMarkdownInBrackets(content, [BRACKET_NARRATION]);
      expect(result).toContain('\\*');
      expect(result).toContain('\\_');
    });

    it('should preserve [...] links: [text](url) not escaped', () => {
      const content = '[link text](https://example.com)';
      const result = escapeMarkdownInBrackets(content, [BRACKET_NARRATION]);
      expect(result).toBe(content);
    });

    it('should escape inside {...} when brace monologue pattern present', () => {
      const content = '{thoughts with *emphasis* here}';
      const result = escapeMarkdownInBrackets(content, [BRACE_MONOLOGUE]);
      expect(result).toContain('\\*');
    });

    it('should not escape {{template}} variables (double braces)', () => {
      const content = '{{character_name}} speaks';
      const result = escapeMarkdownInBrackets(content, [BRACE_MONOLOGUE]);
      expect(result).toBe(content);
    });

    it('should escape _~` inside *...* when asterisk narration pattern present', () => {
      const content = '*narration with _underline_ and `code`*';
      const result = escapeMarkdownInBrackets(content, [ASTERISK_NARRATION]);
      expect(result).toContain('\\_');
      expect(result).toContain('\\`');
    });

    it('should not escape * inside *...* (would break the delimiter)', () => {
      const content = '*narration with asterisks*';
      const result = escapeMarkdownInBrackets(content, [ASTERISK_NARRATION]);
      // The outer asterisks should be preserved
      expect(result).toMatch(/^\*.*\*$/);
    });

    it('should preserve code blocks unchanged (```code```)', () => {
      const content = '[bracket] and ```code with [brackets] and {braces}``` end';
      const result = escapeMarkdownInBrackets(content, [BRACKET_NARRATION, BRACE_MONOLOGUE]);
      // Code block content should be preserved exactly
      expect(result).toContain('code with [brackets] and {braces}');
    });

    it('should handle content with multiple brackets', () => {
      const content = '[first *bracket*] and [second _bracket_]';
      const result = escapeMarkdownInBrackets(content, [BRACKET_NARRATION]);
      const escapedCount = (result.match(/\\\*/g) || []).length;
      expect(escapedCount).toBeGreaterThan(0);
    });

    it('should handle mixed patterns in same content', () => {
      const content = '[action *with* emphasis] and {thought _with_ style}';
      const result = escapeMarkdownInBrackets(content, [BRACKET_NARRATION, BRACE_MONOLOGUE]);
      expect(result).toContain('\\*');
      expect(result).toContain('\\_');
    });
  });

  describe('applyRoleplayPatterns', () => {
    const createCompiledPattern = (pattern: string, className: string): CompiledPattern => ({
      regex: new RegExp(pattern, 'g'),
      className,
    });

    it('should wrap matched text in span with className', () => {
      const html = '<p>This is *narration* text</p>';
      const patterns = [createCompiledPattern('\\*[^*]+\\*', 'qt-chat-narration')];
      const result = applyRoleplayPatterns(html, patterns);
      expect(result).toContain('<span class="qt-chat-narration">*narration*</span>');
    });

    it('should not modify HTML tags (attributes preserved)', () => {
      const html = '<p class="message" id="msg-1">Text</p>';
      const patterns = [createCompiledPattern('Text', 'qt-highlight')];
      const result = applyRoleplayPatterns(html, patterns);
      expect(result).toContain('class="message"');
      expect(result).toContain('id="msg-1"');
    });

    it('should skip content inside <code> blocks', () => {
      const html = '<p>Normal *text* and <code>*code*</code> end</p>';
      const patterns = [createCompiledPattern('\\*[^*]+\\*', 'qt-narration')];
      const result = applyRoleplayPatterns(html, patterns);
      // Only the first match should be wrapped, not the one in code
      const spans = (result.match(/<span class="qt-narration">/g) || []).length;
      expect(spans).toBe(1);
    });

    it('should skip content inside <pre> blocks', () => {
      const html = '<pre>*code block* text</pre>';
      const patterns = [createCompiledPattern('\\*[^*]+\\*', 'qt-narration')];
      const result = applyRoleplayPatterns(html, patterns);
      expect(result).not.toContain('<span class="qt-narration">');
    });

    it('should handle nested code blocks (depth tracking)', () => {
      const html = '<div><code>first *code*</code> <code>second *code*</code></div>';
      const patterns = [createCompiledPattern('\\*[^*]+\\*', 'qt-narration')];
      const result = applyRoleplayPatterns(html, patterns);
      // Neither code block content should be wrapped
      expect((result.match(/<span class="qt-narration">/g) || []).length).toBe(0);
    });

    it('should apply multiple patterns in order', () => {
      const html = '<p>"dialogue" and *narration*</p>';
      const patterns = [
        createCompiledPattern('"[^"]*"', 'qt-dialogue'),
        createCompiledPattern('\\*[^*]+\\*', 'qt-narration'),
      ];
      const result = applyRoleplayPatterns(html, patterns);
      expect(result).toContain('<span class="qt-dialogue">"dialogue"</span>');
      expect(result).toContain('<span class="qt-narration">*narration*</span>');
    });

    it('should handle content with no matches', () => {
      const html = '<p>Plain text with no patterns</p>';
      const patterns = [createCompiledPattern('\\*[^*]+\\*', 'qt-narration')];
      const result = applyRoleplayPatterns(html, patterns);
      expect(result).toBe(html);
    });
  });

  describe('applyDialogueDetection', () => {
    const DEFAULT_DETECTION: DialogueDetection = {
      openingChars: ['"', '\u201c'],
      closingChars: ['"', '\u201d'],
      className: 'qt-chat-dialogue',
    };

    it('should add dialogue class to paragraphs that start/end with quotes', () => {
      const html = '<p>"This is dialogue."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('class="qt-chat-dialogue"');
    });

    it('should handle curly quotes (smart quotes)', () => {
      const html = '<p>\u201cThis is dialogue.\u201d</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('class="qt-chat-dialogue"');
    });

    it('should not modify non-dialogue paragraphs', () => {
      const html = '<p>This is not dialogue.</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toBe(html);
    });

    it('should merge with existing class attribute', () => {
      const html = '<p class="message-content">"Dialogue here."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('class="message-content qt-chat-dialogue"');
    });

    it('should add new class attribute when none exists', () => {
      const html = '<p>"Dialogue."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('class="qt-chat-dialogue"');
    });

    it('should ignore very short text (< 2 chars)', () => {
      const html = '<p>"a</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toBe(html);
    });

    it('should handle paragraphs with nested HTML tags', () => {
      const html = '<p>"The <em>famous</em> quote."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('class="qt-chat-dialogue"');
      expect(result).toContain('<em>famous</em>');
    });

    it('should handle multiple paragraphs in content', () => {
      const html = '<p>"First dialogue."</p><p>Not dialogue.</p><p>"Second dialogue."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      const dialogueMatches = (result.match(/class="qt-chat-dialogue"/g) || []).length;
      expect(dialogueMatches).toBe(2);
    });

    it('should preserve paragraph attributes other than class', () => {
      const html = '<p id="p1" data-id="msg-1">"Dialogue."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('id="p1"');
      expect(result).toContain('data-id="msg-1"');
      expect(result).toContain('class="qt-chat-dialogue"');
    });

    it('should not add dialogue class if only start OR end quote present', () => {
      const html1 = '<p>"Only start quote</p>';
      const result1 = applyDialogueDetection(html1, DEFAULT_DETECTION);
      expect(result1).not.toContain('class="qt-chat-dialogue"');

      const html2 = '<p>Only end quote"</p>';
      const result2 = applyDialogueDetection(html2, DEFAULT_DETECTION);
      expect(result2).not.toContain('class="qt-chat-dialogue"');
    });
  });

  describe('applyLineScopedClasses', () => {
    const lineRules: CompiledRule[] = [
      { regex: /^\/\/ .+$/, className: 'qt-chat-ooc', scope: 'line' },
      { regex: /^\[(?:[^\p{Ll}]+)\].*$/u, className: 'qt-chat-tag', scope: 'line' },
    ];

    it('adds the line class to a paragraph whose whole text is a line prefix', () => {
      const result = applyLineScopedClasses('<p>// an aside</p>', lineRules);
      expect(result).toContain('class="qt-chat-ooc"');
    });

    it('adds the line class to a tag-prefixed paragraph (uppercase token)', () => {
      const result = applyLineScopedClasses('<p>[CAPTAIN] All hands!</p>', lineRules);
      expect(result).toContain('class="qt-chat-tag"');
    });

    it('does not match a lowercase tag token', () => {
      const result = applyLineScopedClasses('<p>[captain] hi</p>', lineRules);
      expect(result).not.toContain('class="qt-chat-tag"');
    });

    it('applies the class to other block elements (h2, li, blockquote)', () => {
      expect(applyLineScopedClasses('<h2>// note</h2>', lineRules)).toContain('class="qt-chat-ooc"');
      expect(applyLineScopedClasses('<li>// note</li>', lineRules)).toContain('class="qt-chat-ooc"');
      expect(applyLineScopedClasses('<blockquote>// note</blockquote>', lineRules)).toContain('class="qt-chat-ooc"');
    });

    it('leaves a non-matching paragraph untouched', () => {
      const html = '<p>just ordinary prose</p>';
      expect(applyLineScopedClasses(html, lineRules)).toBe(html);
    });

    it('is a no-op when there are no line-scoped rules', () => {
      const html = '<p>// looks like ooc</p>';
      const inlineOnly: CompiledRule[] = [{ regex: /\*[^*]+\*/, className: 'qt-chat-narration', scope: 'inline' }];
      expect(applyLineScopedClasses(html, inlineOnly)).toBe(html);
    });
  });

  describe('applyWrapBlockClasses', () => {
    // The "Covenant RP" narration: +…+, delimiters hidden.
    const wrapRules: CompiledRule[] = [
      {
        regex: /(?<!\+)\+(?<rpBody>[^+]+)\+(?!\+)/,
        className: 'qt-chat-narration qt-rp-italic',
        scope: 'inline',
        hideDelimiters: true,
      },
    ];

    it('wraps a whole-block hidden wrap in a styled span and strips the delimiters', () => {
      const result = applyWrapBlockClasses('<p>+the room holds its breath+</p>', wrapRules);
      expect(result).toBe(
        '<p><span class="qt-chat-narration qt-rp-italic">the room holds its breath</span></p>',
      );
    });

    it('PRESERVES inner markdown (the bug): an <em> inside the wrap survives', () => {
      // This is exactly the reported failure: markdown inside +…+ used to leave the
      // delimiters literal and unstyled. Now the <em> is kept inside the span.
      const html = '<p>+al-Latif called his father <em>Father</em> in public+</p>';
      const result = applyWrapBlockClasses(html, wrapRules);
      expect(result).toBe(
        '<p><span class="qt-chat-narration qt-rp-italic">al-Latif called his father <em>Father</em> in public</span></p>',
      );
    });

    it('does not touch a block that is only partly wrapped', () => {
      const html = '<p>she said +softly+ to him</p>';
      expect(applyWrapBlockClasses(html, wrapRules)).toBe(html);
    });

    it('handles other block elements (h2, li, blockquote)', () => {
      expect(applyWrapBlockClasses('<h2>+a beat+</h2>', wrapRules)).toContain(
        '<h2><span class="qt-chat-narration qt-rp-italic">a beat</span></h2>',
      );
      expect(applyWrapBlockClasses('<li>+a beat+</li>', wrapRules)).toContain(
        '<li><span class="qt-chat-narration qt-rp-italic">a beat</span></li>',
      );
    });

    it('is a no-op when there are no hidden-delimiter wrap rules', () => {
      const html = '<p>+narration+</p>';
      const shown: CompiledRule[] = [
        { regex: /(?<!\+)\+(?<rpBody>[^+]+)\+(?!\+)/, className: 'qt-chat-narration', scope: 'inline', hideDelimiters: false },
      ];
      expect(applyWrapBlockClasses(html, shown)).toBe(html);
    });
  });

  /**
   * Bug 62 regression: the SHARED DEFAULTS, exercised through the same wrappers
   * as everything else — no options passed.
   *
   * Every other suite here hands the renderer explicit patterns, which is how a
   * straight-quote-only default survived for so long: the seeded Standard
   * Roleplay template is correct, so the template path always looked fine. These
   * assert the fallback itself.
   *
   * `resolveOptions` mirrors renderMarkdownToHtml's two fallback lines verbatim
   * (`lib/services/markdown-renderer.service.ts` — the `length > 0 ? … : DEFAULT`
   * re-assert and the `dialogueDetection || DEFAULT` re-assert), so the empty-array
   * and null cases are covered, not just an absent options object.
   */
  describe('shared defaults (fallback path, no options passed)', () => {
    function resolveOptions(options: {
      renderingPatterns?: RenderingPattern[];
      dialogueDetection?: DialogueDetection | null;
    } = {}) {
      const {
        renderingPatterns = DEFAULT_RENDERING_PATTERNS,
        dialogueDetection = DEFAULT_DIALOGUE_DETECTION,
      } = options;
      return {
        patterns: renderingPatterns.length > 0 ? renderingPatterns : DEFAULT_RENDERING_PATTERNS,
        dialogueConfig: dialogueDetection || DEFAULT_DIALOGUE_DETECTION,
      };
    }

    /** Run a paragraph through the default fallback the way step 6 + step 8 do. */
    function renderParagraph(
      text: string,
      options?: Parameters<typeof resolveOptions>[0]
    ): string {
      const { patterns, dialogueConfig } = resolveOptions(options);
      const rules = compileRenderingPatterns(patterns);
      let html = applyRoleplayPatterns(`<p>${text}</p>`, rules);
      html = applyDialogueDetection(html, dialogueConfig);
      return html;
    }

    // Guard the bytes, not the glyphs. Comparing rendered output alone would let
    // a literal-curly-glyph regression through; these compare against explicit
    // code points, which is the check the original defect would have failed.
    describe('character-level integrity', () => {
      it('DEFAULT_DIALOGUE_DETECTION carries the real curly code points, not duplicated 0x22', () => {
        expect(DEFAULT_DIALOGUE_DETECTION.openingChars).toEqual(['"', '\u201c']);
        expect(DEFAULT_DIALOGUE_DETECTION.closingChars).toEqual(['"', '\u201d']);
        expect(new Set(DEFAULT_DIALOGUE_DETECTION.openingChars).size).toBe(2);
        expect(new Set(DEFAULT_DIALOGUE_DETECTION.closingChars).size).toBe(2);
      });

      it('the default dialogue pattern compiles to a regex that accepts curly quotes', () => {
        const entry = DEFAULT_RENDERING_PATTERNS.find(
          (p) => p.className === 'qt-chat-dialogue'
        );
        expect(entry).toBeDefined();
        const regex = new RegExp(entry!.pattern);
        expect(regex.test('\u201cGet down,\u201d')).toBe(true);
        expect(regex.test('"Get down,"')).toBe(true);
      });
    });

    describe('inline dialogue pattern', () => {
      it('styles curly-quoted dialogue', () => {
        expect(renderParagraph('\u201cGet down,\u201d she said.')).toContain(
          '<span class="qt-chat-dialogue">\u201cGet down,\u201d</span>'
        );
      });

      it('still styles straight-quoted dialogue', () => {
        expect(renderParagraph('"Get down," she said.')).toContain(
          '<span class="qt-chat-dialogue">"Get down,"</span>'
        );
      });

      it('leaves apostrophes alone (single quotes are deliberately not dialogue)', () => {
        const html = renderParagraph("She didn't move; the writers' room was quiet.");
        expect(html).not.toContain('qt-chat-dialogue');
      });

      it('leaves curly apostrophes alone', () => {
        const html = renderParagraph('She didn\u2019t move.');
        expect(html).not.toContain('qt-chat-dialogue');
      });
    });

    describe('paragraph-level dialogue detection', () => {
      it('tags a wholly curly-quoted paragraph', () => {
        expect(renderParagraph('\u201cGet down.\u201d')).toContain('class="qt-chat-dialogue"');
      });

      it('tags a wholly straight-quoted paragraph', () => {
        expect(renderParagraph('"Get down."')).toContain('class="qt-chat-dialogue"');
      });

      it('leaves a narrative paragraph untagged', () => {
        expect(renderParagraph('She said nothing at all.')).not.toContain('qt-chat-dialogue');
      });
    });

    describe('empty / null options fall through to the same defaults', () => {
      it('an empty renderingPatterns array still styles curly dialogue', () => {
        expect(
          renderParagraph('\u201cGet down,\u201d she said.', { renderingPatterns: [] })
        ).toContain('<span class="qt-chat-dialogue">\u201cGet down,\u201d</span>');
      });

      it('a null dialogueDetection still tags a curly-quoted paragraph', () => {
        expect(renderParagraph('\u201cGet down.\u201d', { dialogueDetection: null })).toContain(
          'class="qt-chat-dialogue"'
        );
      });
    });

    describe('the template path must not move', () => {
      // Standard Roleplay's stored dialogue config, copied from
      // lib/database/repositories/roleplay-templates.repository.ts.
      const SEEDED_PATTERNS: RenderingPattern[] = [
        { pattern: '["\u201c][^"\u201d]+["\u201d]', className: 'qt-chat-dialogue' },
      ];
      const SEEDED_DETECTION: DialogueDetection = {
        openingChars: ['"', '\u201c'],
        closingChars: ['"', '\u201d'],
        className: 'qt-chat-dialogue',
      };

      it.each([
        ['\u201cGet down,\u201d she said.'],
        ['"Get down," she said.'],
        ['\u201cGet down.\u201d'],
        ['"Get down."'],
        ['She said nothing at all.'],
      ])('the defaults now agree with the seeded template on %p', (text) => {
        const withDefaults = renderParagraph(text);
        const withTemplate = renderParagraph(text, {
          renderingPatterns: SEEDED_PATTERNS,
          dialogueDetection: SEEDED_DETECTION,
        });
        expect(withDefaults).toBe(withTemplate);
      });
    });
  });

  // NOTE: renderMarkdownToHtml tests should be added as integration tests
  // The function depends on ESM-only libraries (unified, remark, rehype) that are
  // difficult to test in Jest's CommonJS environment. Consider:
  // 1. Adding integration tests that run in a real Node ESM environment
  // 2. Adding E2E tests that verify markdown rendering in the browser
  // 3. Manual testing of key scenarios:
  //    - Basic markdown (headers, bold, italic, lists, links, blockquotes)
  //    - Code blocks (fenced with/without language, inline code)
  //    - GFM (tables, strikethrough, task lists)
  //    - Roleplay patterns (*narration*, "dialogue", ((ooc)), {monologue}, [actions])
  //    - Dialogue detection (paragraph-level quote wrapping)
  //    - escapeMarkdownInBrackets (preserve brackets with nested markdown)
  //    - XSS prevention (<script>, onerror, javascript:, etc.)
  //    - Custom patterns and dialogue detection
  //    - Error handling (empty content, long content, unicode)
});
