/**
 * Server-side Markdown Renderer Service
 *
 * Pre-renders markdown content to HTML on the server for simple messages.
 * Mirrors the client-side MessageContent.tsx logic to ensure visual consistency.
 *
 * Features:
 * - Markdown to HTML conversion with GFM support
 * - Syntax highlighting for code blocks
 * - KaTeX math rendering ($$…$$ and \(...\)/\[...\] — see lib/markdown/math.ts)
 * - Roleplay pattern processing (dialogue, narration, OOC, inner monologue)
 * - Paragraph-level dialogue detection
 *
 * @module services/markdown-renderer.service
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { REMARK_MATH_OPTIONS, normalizeMathDelimiters } from '@/lib/markdown/math';
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types';
import {
  DEFAULT_RENDERING_PATTERNS,
  DEFAULT_DIALOGUE_DETECTION,
  compileRenderingPatterns,
  escapeMarkdownInBrackets,
} from '@/lib/chat/roleplay-rendering';
import {
  applyRoleplayPatterns,
  applyDialogueDetection,
  applyLineScopedClasses,
  applyWrapBlockClasses,
  escapeHtml,
} from '@/lib/services/markdown-postprocess';
import { linkifyBareQtapUris } from '@/lib/chat/qtap-linkify';
import { logger } from '@/lib/logger';

// Re-export the shared helpers so existing importers keep working. The HTML
// post-processing functions live in markdown-postprocess.ts (import-safe under
// Jest — this module's unified/remark imports are ESM-only and are not).
export { escapeMarkdownInBrackets };
export {
  applyRoleplayPatterns,
  applyDialogueDetection,
  applyLineScopedClasses,
  applyWrapBlockClasses,
} from '@/lib/services/markdown-postprocess';

// ============================================================================
// TYPES
// ============================================================================

export interface MarkdownRenderOptions {
  /** Patterns for styling roleplay text in message content */
  renderingPatterns?: RenderingPattern[];
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection?: DialogueDetection | null;
}

// ============================================================================
// MARKDOWN PROCESSOR
// ============================================================================

/**
 * Create a unified markdown processor for server-side rendering.
 * This is cached to avoid recreating the processor for each message.
 */
function createMarkdownProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    // remark-math parses $$…$$ math (single-dollar math is off — see
    // lib/markdown/math.ts); rehype-katex below renders it. Must stay in sync
    // with the client list.
    .use(remarkMath, REMARK_MATH_OPTIONS)
    // remark-breaks renders single newlines as hard <br> breaks, matching the
    // client-side MessageContent.tsx pipeline. In chat an author who hits Enter
    // means a line break, so soft breaks are preserved rather than collapsed to
    // a space (CommonMark's default). Must stay in sync with the client list.
    .use(remarkBreaks)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(rehypeHighlight, {
      // Don't auto-detect language for unlabeled code blocks - causes incorrect
      // highlighting (e.g., detecting VB.NET for plain text prompts).
      // Code blocks with explicit language tags will still be highlighted.
      ignoreMissing: true,
      detect: false,
    })
    .use(rehypeStringify);
}

// Cached processor instance — reset to null when the pipeline changes
let cachedProcessor: ReturnType<typeof createMarkdownProcessor> | null = null;

function getProcessor() {
  if (!cachedProcessor) {
    cachedProcessor = createMarkdownProcessor();
  }
  return cachedProcessor;
}

// ============================================================================
// MAIN RENDER FUNCTION
// ============================================================================

/**
 * Render markdown content to HTML with roleplay pattern support.
 * This mirrors the client-side MessageContent.tsx behavior.
 *
 * @param content - Raw markdown content
 * @param options - Rendering options including patterns and dialogue detection
 * @returns HTML string ready for dangerouslySetInnerHTML
 */
export async function renderMarkdownToHtml(
  content: string,
  options: MarkdownRenderOptions = {}
): Promise<string> {
  const {
    renderingPatterns = DEFAULT_RENDERING_PATTERNS,
    dialogueDetection = DEFAULT_DIALOGUE_DETECTION,
  } = options;

  try {
    // Step 1: Compile patterns
    const patterns = renderingPatterns.length > 0 ? renderingPatterns : DEFAULT_RENDERING_PATTERNS;
    const compiledRules = compileRenderingPatterns(patterns);

    // Step 2: Trim leading/trailing whitespace — a leading tab triggers markdown's
    // indented code block rule, rendering the whole message as preformatted text
    const trimmedContent = content.trim();

    // Step 2.5: Normalize `\(...\)`/`\[...\]` math delimiters to `$$` form.
    // Must run before bracket escaping (which would otherwise claim `\[...\]`)
    // and mirrors the client's preprocessing chain in MessageContent.tsx.
    const mathNormalizedContent = normalizeMathDelimiters(trimmedContent);

    // Step 3: Escape markdown inside roleplay brackets
    const escapedContent = escapeMarkdownInBrackets(mathNormalizedContent, patterns);

    // Step 3.5: Upgrade any surfaced bare qtap:// URI to markdown-link form.
    // This keeps server pre-rendered HTML aligned with the client renderer,
    // so Librarian/Lantern/Aurora announcement bodies stay clickable.
    const linkifiedContent = linkifyBareQtapUris(escapedContent);

    // Step 4: Convert markdown to HTML
    const processor = getProcessor();
    const file = await processor.process(linkifiedContent);
    let html = String(file);

    // Step 5: Wrap whole-block hidden-delimiter wraps in a styled span. Runs
    // before inline patterns so the stripped delimiters can't be re-matched, and
    // so the wrap's inner markdown (already real HTML) is preserved.
    html = applyWrapBlockClasses(html, compiledRules);

    // Step 6: Apply inline roleplay patterns
    html = applyRoleplayPatterns(html, compiledRules);

    // Step 7: Apply whole-line (line-scoped) classes to block elements
    html = applyLineScopedClasses(html, compiledRules);

    // Step 8: Apply dialogue detection
    const dialogueConfig = dialogueDetection || DEFAULT_DIALOGUE_DETECTION;
    html = applyDialogueDetection(html, dialogueConfig);

    // Step 9: Wrap in container div with appropriate classes
    // Note: We don't add the outer container class here - the client handles that
    return html;
  } catch (error) {
    logger.error('[MarkdownRenderer] Failed to render markdown', { contentLength: content.length }, error instanceof Error ? error : undefined);
    // Fall back to returning escaped content as plain text
    return `<p>${escapeHtml(content)}</p>`;
  }
}

/**
 * Check if a message is suitable for server-side pre-rendering.
 * Simple messages without tools or attachments can be pre-rendered.
 *
 * @param role - Message role (USER, ASSISTANT, TOOL)
 * @param hasAttachments - Whether the message has file attachments
 * @param hasEmbeddedTool - Whether the message has embedded tool calls
 * @returns true if the message can be pre-rendered
 */
export function canPreRenderMessage(
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
