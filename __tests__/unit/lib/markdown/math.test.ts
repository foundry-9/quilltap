/**
 * Unit tests for the shared math-rendering helpers:
 * - normalizeMathDelimiters (lib/markdown/math.ts) — the `\(...\)`/`\[...\]`
 *   → `$$` rewrite both renderers run before parsing
 * - applyRoleplayPatterns (lib/services/markdown-postprocess.ts) — its
 *   KaTeX-subtree skip, which keeps roleplay patterns from rewriting rendered
 *   math markup
 *
 * The full unified pipeline (remark-math/rehype-katex) is ESM-only and cannot
 * load under Jest — end-to-end output is covered by manual/browser checks, so
 * these tests pin down the import-safe pieces both renderers share.
 */

import { normalizeMathDelimiters } from '@/lib/markdown/math';
import { applyRoleplayPatterns } from '@/lib/services/markdown-postprocess';
import {
  DEFAULT_RENDERING_PATTERNS,
  compileRenderingPatterns,
} from '@/lib/chat/roleplay-rendering';

describe('normalizeMathDelimiters', () => {
  it('returns input unchanged when no backslash delimiters are present', () => {
    const input = 'Plain prose with $50 and even $$x^2$$ math.';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('converts \\(...\\) to inline $$ math', () => {
    expect(normalizeMathDelimiters('Euler said \\(e^{i\\pi} + 1 = 0\\) once.')).toBe(
      'Euler said $$e^{i\\pi} + 1 = 0$$ once.'
    );
  });

  it('converts \\[...\\] to block $$ math on its own lines', () => {
    expect(normalizeMathDelimiters('Behold: \\[x = 2\\] indeed.')).toBe(
      'Behold: \n$$\nx = 2\n$$\n indeed.'
    );
  });

  it('trims interior whitespace from multi-line display math', () => {
    expect(normalizeMathDelimiters('\\[\n\\sum_{n=1}^\\infty n\n\\]')).toBe(
      '\n$$\n\\sum_{n=1}^\\infty n\n$$\n'
    );
  });

  it('leaves delimiters inside inline code spans alone', () => {
    const input = 'Use `\\(escaped\\)` in code.';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('leaves delimiters inside fenced code blocks alone', () => {
    const input = '```\n\\(not math\\)\n```';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('leaves an unterminated fence (streaming) alone', () => {
    const input = 'Look:\n```\n\\(still streaming\\)';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('does not rewrite \\[-lookalikes inside existing $$ math', () => {
    // `\\[3pt]` is LaTeX row spacing; a naive rewrite would mangle the matrix.
    const input = '$$\n\\begin{pmatrix} a \\\\[3pt] b \\end{pmatrix}\n$$ then \\(x\\)';
    expect(normalizeMathDelimiters(input)).toBe(
      '$$\n\\begin{pmatrix} a \\\\[3pt] b \\end{pmatrix}\n$$ then $$x$$'
    );
  });

  it('converts multiple delimiters in one string', () => {
    expect(normalizeMathDelimiters('\\(a\\) and \\(b\\)')).toBe('$$a$$ and $$b$$');
  });
});

describe('normalizeMathDelimiters — single-dollar promotion', () => {
  it('promotes single-$ spans with a backslash-command to $$', () => {
    expect(normalizeMathDelimiters('where $\\mathcal{P}$ is the invariant')).toBe(
      'where $$\\mathcal{P}$$ is the invariant'
    );
  });

  it('promotes single-$ spans with a sub/superscript to $$', () => {
    expect(normalizeMathDelimiters('the term $T_{CMB}$ and $x^2$')).toBe(
      'the term $$T_{CMB}$$ and $$x^2$$'
    );
  });

  it('leaves a plain currency amount untouched', () => {
    const input = 'It cost me $50 today.';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('does not swallow paired dollar amounts in prose as math', () => {
    const input = 'He slid $50 across the table, then another $20.';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('leaves a bare single-letter span ($K$) literal when it stands alone', () => {
    const input = 'where $K$ is the Kretschmann scalar';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('promotes a bare token when a marker span shares its line', () => {
    expect(
      normalizeMathDelimiters('where $K$ is the scalar and $\\mathcal{P}$ the invariant')
    ).toBe('where $$K$$ is the scalar and $$\\mathcal{P}$$ the invariant');
  });

  it('does not promote a bare token whose marker sibling is on another line', () => {
    const input = 'first $K$ alone\nthen $\\pi r^2$ elsewhere';
    expect(normalizeMathDelimiters(input)).toBe('first $K$ alone\nthen $$\\pi r^2$$ elsewhere');
  });

  it('does not treat a lone currency figure ($5$) as a bare token', () => {
    // Even with a marker span present, a digit-led span is not a bare token.
    expect(normalizeMathDelimiters('the $5$ note beside $x_1$')).toBe(
      'the $5$ note beside $$x_1$$'
    );
  });

  it('leaves currency untouched even on a line that also has real math', () => {
    expect(normalizeMathDelimiters('The $50 fee, where $n$ scales as $2^n$')).toBe(
      'The $50 fee, where $$n$$ scales as $$2^n$$'
    );
  });

  it('promotes only the mathy spans, leaving currency in the same sentence alone', () => {
    expect(
      normalizeMathDelimiters('The $50 fee scales as $\\pi r^2$ per unit.')
    ).toBe('The $50 fee scales as $$\\pi r^2$$ per unit.');
  });

  it('does not touch single-$ inside inline code', () => {
    const input = 'Run `echo $\\HOME{}` please.';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('does not touch single-$ inside fenced code blocks', () => {
    const input = '```sh\nx=$\\{FOO}\n```';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('does not reach into existing $$ display math', () => {
    const input = '$$ a_{ij} $$ and then $\\vec{v}$';
    expect(normalizeMathDelimiters(input)).toBe('$$ a_{ij} $$ and then $$\\vec{v}$$');
  });

  it('promotes several inline spans across one message', () => {
    expect(
      normalizeMathDelimiters('$\\mathcal{P}$, $\\mathcal{E}$, and $\\vec{\\ell}_i$')
    ).toBe('$$\\mathcal{P}$$, $$\\mathcal{E}$$, and $$\\vec{\\ell}_i$$');
  });

  it('composes with the backslash-delimiter rewrite', () => {
    expect(normalizeMathDelimiters('inline $x_1$ and \\(y_2\\) here')).toBe(
      'inline $$x_1$$ and $$y_2$$ here'
    );
  });
});

describe('applyRoleplayPatterns KaTeX skip', () => {
  const compiledRules = compileRenderingPatterns(DEFAULT_RENDERING_PATTERNS);

  // Trimmed-down but structurally faithful KaTeX output: MathML with the raw
  // LaTeX in <annotation>, plus HTML glyph spans. The LaTeX contains `{a}` and
  // `*b*` runs that the default inner-monologue/narration patterns would match.
  const katexInline =
    '<span class="katex">' +
    '<span class="katex-mathml"><math><semantics><mrow><mi>a</mi></mrow>' +
    '<annotation encoding="application/x-tex">\\frac{a}{b} + *b* + [c]</annotation>' +
    '</semantics></math></span>' +
    '<span class="katex-html" aria-hidden="true"><span class="base">' +
    '<span class="strut" style="height:0.6833em;"></span>' +
    '<span class="mord">{a} and "b"</span></span></span>' +
    '</span>';

  it('never rewrites text inside a KaTeX subtree', () => {
    const html = `<p>Before ${katexInline} after.</p>`;
    expect(applyRoleplayPatterns(html, compiledRules)).toBe(html);
  });

  it('still applies patterns outside the KaTeX subtree', () => {
    const html = `<p>*waves* ${katexInline} {thinks}</p>`;
    const out = applyRoleplayPatterns(html, compiledRules);
    expect(out).toContain('<span class="qt-chat-narration">*waves*</span>');
    expect(out).toContain('<span class="qt-chat-inner-monologue">{thinks}</span>');
    // The math markup itself is byte-identical.
    expect(out).toContain(katexInline);
  });

  it('skips katex-display and katex-error subtrees too', () => {
    const display =
      '<span class="katex-display"><span class="katex">' +
      '<span class="mord">{x}</span></span></span>';
    const error =
      '<span class="katex-error" title="ParseError" style="color:#cc0000">\\frac{</span>';
    const html = `<p>${display}</p><p>${error}</p>`;
    expect(applyRoleplayPatterns(html, compiledRules)).toBe(html);
  });

  it('still processes code-block skipping independently of math', () => {
    const html = `<pre><code>*not narration*</code></pre><p>*is narration*</p>`;
    const out = applyRoleplayPatterns(html, compiledRules);
    expect(out).toContain('<code>*not narration*</code>');
    expect(out).toContain('<span class="qt-chat-narration">*is narration*</span>');
  });
});
