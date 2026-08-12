/**
 * HTML post-processing for server-rendered markdown.
 *
 * These functions run over the HTML string produced by the unified pipeline in
 * `markdown-renderer.service.ts`, applying roleplay pattern spans, dialogue
 * detection, and line-scoped classes. They live in their own module — separate
 * from the service — because they are pure string transforms with no ESM-only
 * dependencies, which keeps them importable from Jest (the unified/remark
 * imports in the service module are ESM-only and cannot load under Jest's
 * CommonJS environment).
 *
 * @module services/markdown-postprocess
 */

import type { DialogueDetection } from '@/lib/schemas/template.types';
import {
  type CompiledRule,
  tokenizeInline,
  lineMatchFor,
  wrapBlockMatchFor,
  isDialogueParagraph,
  segmentsToHtml,
} from '@/lib/chat/roleplay-rendering';

/**
 * Process roleplay syntax in HTML content and wrap inline matches with styled
 * spans. Applied AFTER markdown conversion to handle the text nodes.
 *
 * Splits HTML by tags and only applies patterns to text content (avoiding
 * corruption of HTML attributes that contain quotes), and skips content inside
 * <code>/<pre> blocks and KaTeX-rendered math. The actual match-walk is the
 * shared `tokenizeInline` core, so client and server can't diverge.
 */
export function applyRoleplayPatterns(html: string, compiledRules: CompiledRule[]): string {
  // Split by HTML tags to avoid matching inside them
  // This regex captures HTML tags as separate array elements
  const tagRegex = /(<[^>]*>)/g;
  const parts = html.split(tagRegex);

  // Track whether we're inside a code block
  let inCodeBlock = 0;

  // Track nesting depth while inside a KaTeX-rendered subtree. Roleplay
  // patterns must never rewrite math markup: KaTeX output is dense with text
  // runs (HTML glyph spans, MathML, the raw-LaTeX <annotation>) that patterns
  // like *emphasis* or "quotes" could match and corrupt. KaTeX markup contains
  // no void or self-closing tags (verified against katex 0.18 output), so a
  // generic open/close counter is sound here.
  let katexDepth = 0;

  // Process only non-tag parts (text content between tags)
  const processedParts = parts.map((part, index) => {
    // Parts at odd indices are HTML tags (captured groups from split)
    if (index % 2 === 1) {
      // Track code block depth - check for opening/closing tags
      const lowerPart = part.toLowerCase();
      if (katexDepth > 0) {
        if (lowerPart.startsWith('</')) {
          katexDepth--;
        } else if (!lowerPart.endsWith('/>')) {
          katexDepth++;
        }
      } else if (lowerPart.startsWith('<span class="katex')) {
        // Root of a KaTeX subtree: .katex, .katex-display, or .katex-error.
        katexDepth = 1;
      } else if (lowerPart.startsWith('<code') || lowerPart.startsWith('<pre')) {
        inCodeBlock++;
      } else if (lowerPart === '</code>' || lowerPart === '</pre>') {
        inCodeBlock = Math.max(0, inCodeBlock - 1);
      }
      return part; // Return HTML tags unchanged
    }

    // Skip pattern application inside code blocks and rendered math
    if (inCodeBlock > 0 || katexDepth > 0) {
      return part;
    }

    // Tokenize the text run with the shared core and emit HTML spans.
    return segmentsToHtml(tokenizeInline(part, compiledRules));
  });

  return processedParts.join('');
}

/**
 * Apply dialogue detection to paragraphs in HTML.
 * Adds dialogue class to <p> tags whose content starts and ends with quotes.
 */
export function applyDialogueDetection(html: string, detection: DialogueDetection): string {
  // Match paragraph tags and their content
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (match, attrs, content) => {
    // Strip HTML tags to get plain text for detection
    const plainText = content.replace(/<[^>]+>/g, '');

    if (isDialogueParagraph(plainText, detection)) {
      // Add dialogue class to existing class attribute or create new one
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
 * Apply whole-line (line-scoped) classes to block elements in HTML.
 *
 * Mirrors `applyDialogueDetection`, but for line-scoped rendering rules
 * (`linePrefix`/`tagPrefix`): if a block element's plain text is a single line
 * matching a line rule, the rule's class lands on the block element itself
 * rather than an inline span. No-op when there are no line-scoped rules.
 */
export function applyLineScopedClasses(html: string, compiledRules: CompiledRule[]): string {
  const lineRules = compiledRules.filter((r) => r.scope === 'line');
  if (lineRules.length === 0) return html;

  return html.replace(
    /<(p|li|blockquote|h[1-6])([^>]*)>([\s\S]*?)<\/\1>/g,
    (match, tag, attrs, content) => {
      // Strip HTML tags to get plain text for the line-match check
      const plainText = content.replace(/<[^>]+>/g, '');
      const lm = lineMatchFor(plainText, lineRules);
      if (!lm) return match;

      // When the rule hides its delimiter, drop the leading marker/tag from the
      // block's content. The prefix is literal text before any inline tag, so a
      // leading slice is safe and preserves inline formatting in the body.
      let body = content as string;
      if (lm.hideDelimiters && lm.prefix && body.startsWith(lm.prefix)) {
        body = body.slice(lm.prefix.length);
      }

      if (attrs.includes('class="')) {
        const newAttrs = attrs.replace(/class="([^"]*)"/, `class="$1 ${lm.className}"`);
        return `<${tag}${newAttrs}>${body}</${tag}>`;
      }
      return `<${tag}${attrs} class="${lm.className}">${body}</${tag}>`;
    },
  );
}

/**
 * Wrap whole-block hidden WRAP delimiters in a styled inline span.
 *
 * The server counterpart of the client's wrap-block path in
 * `MessageContent.renderLineBlock`: if a block element's plain text is entirely a
 * single hidden-delimiter wrap (e.g. a `<p>` that is wholly `+narration+`), strip
 * the opening/closing delimiters from the block's inner HTML and wrap what's left
 * in `<span class="…">`. The markdown inside the wrap is already real HTML by now
 * (`+a <em>b</em> c+`), so wrapping preserves it — the inline tokenizer can't,
 * since it walks text runs between tags. The class lands on an inline span, never
 * the block, because the chat classes are `display: inline`. No-op when no
 * hidden-delimiter wrap rules exist.
 */
export function applyWrapBlockClasses(html: string, compiledRules: CompiledRule[]): string {
  const wrapRules = compiledRules.filter((r) => r.scope === 'inline' && r.hideDelimiters);
  if (wrapRules.length === 0) return html;

  return html.replace(
    /<(p|li|blockquote|h[1-6])([^>]*)>([\s\S]*?)<\/\1>/g,
    (match, tag, attrs, content) => {
      // Strip HTML tags to get plain text for the whole-block wrap check.
      const plainText = (content as string).replace(/<[^>]+>/g, '');
      const wrap = wrapBlockMatchFor(plainText, wrapRules);
      if (!wrap) return match;

      // The delimiters are literal text at the very start/end of the inner HTML
      // (they were left un-escaped and aren't markdown), so slicing them off
      // preserves the inline tags between them.
      let inner = content as string;
      if (wrap.prefix && inner.startsWith(wrap.prefix)) {
        inner = inner.slice(wrap.prefix.length);
      }
      if (wrap.suffix && inner.endsWith(wrap.suffix)) {
        inner = inner.slice(0, inner.length - wrap.suffix.length);
      }

      return `<${tag}${attrs}><span class="${wrap.className}">${inner}</span></${tag}>`;
    },
  );
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
