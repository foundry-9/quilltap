'use client'

import { useMemo, useState, useCallback, ReactNode } from 'react'
import Link from 'next/link'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { REMARK_MATH_OPTIONS, normalizeMathDelimiters } from '@/lib/markdown/math'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import type { Components } from 'react-markdown'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'
import {
  type Segment,
  type CompiledRule,
  DEFAULT_RENDERING_PATTERNS,
  DEFAULT_DIALOGUE_DETECTION,
  compileRenderingPatterns,
  tokenizeInline,
  lineMatchFor,
  wrapBlockMatchFor,
  isDialogueParagraph,
  escapeMarkdownInBrackets,
} from '@/lib/chat/roleplay-rendering'
import { linkifyBareQtapUris } from '@/lib/chat/qtap-linkify'
import { isQtapUri } from '@/lib/doc-edit/qtap-uri'
import { QtapLink } from '@/components/qtap/QtapLink'

// Internal links — same-origin, app-route paths starting with a single "/" —
// must navigate via the Next.js router so they work inside the Electron shell
// (which has no concept of "open in a new tab" and would either reject or
// shell-open `target="_blank"` links). Protocol-relative `//host/...` URLs
// are external and excluded.
function isInternalHref(href: string | undefined): href is string {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')
}

/**
 * Code block with copy button component
 */
function CodeBlockWithCopy({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy code block', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [code])

  return (
    <div
      className="qt-code-block-container"
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        borderRadius: '0.375rem',
        marginTop: '0.5rem',
        marginBottom: '0.5rem',
      }}
    >
      <button
        onClick={handleCopy}
        className={`qt-copy-button qt-code-block-copy ${copied ? 'qt-copy-button-success' : ''}`}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? '✓' : '📋'}
        <span className="qt-copy-button-text">{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {language === 'text' ? (
        <pre
          style={{
            margin: 0,
            padding: '1rem',
            paddingTop: '2.5rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
            background: 'rgb(40, 44, 52)',
            color: '#abb2bf',
            fontFamily: 'var(--qt-code-font, monospace)',
            fontSize: '0.875rem',
            lineHeight: '1.5',
          }}
        >
          <code>{code.replace(/\n$/, '')}</code>
        </pre>
      ) : (
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          wrapLines={true}
          wrapLongLines={true}
          customStyle={{
            margin: 0,
            padding: '1rem',
            paddingTop: '2.5rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
          codeTagProps={{
            style: {
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            },
          }}
        >
          {code.replace(/\n$/, '')}
        </SyntaxHighlighter>
      )}
    </div>
  )
}

interface MessageContentProps {
  content: string
  className?: string
  /** Patterns for styling roleplay text in message content */
  renderingPatterns?: RenderingPattern[]
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection?: DialogueDetection | null
  /**
   * Mount point ID for resolving relative image paths. When set, an image
   * reference like `![alt](images/avatar.webp)` will resolve to the blob
   * API at `/api/v1/mount-points/<id>/blobs/images/avatar.webp` so
   * database-backed stores' images render inline.
   */
  blobMountPointId?: string
}

/**
 * Map neutral segments (from the shared tokenizer) to React nodes: plain runs
 * stay strings, styled runs become keyed <span>s.
 */
function segmentsToReactNodes(segments: Segment[]): ReactNode[] {
  return segments.map((seg, i) =>
    seg.className
      ? <span key={i} className={seg.className}>{seg.text}</span>
      : seg.text
  )
}

/**
 * Recursively process children to apply inline roleplay styling to text nodes.
 * The match-walk itself lives in the shared core (tokenizeInline); this is the
 * thin React adapter over its Segment[] output.
 */
function processChildren(children: ReactNode, compiledRules: CompiledRule[]): ReactNode {
  if (typeof children === 'string') {
    const segments = tokenizeInline(children, compiledRules)
    return segments.length === 1 && !segments[0].className
      ? segments[0].text
      : <>{segmentsToReactNodes(segments)}</>
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        const segments = tokenizeInline(child, compiledRules)
        return segments.length === 1 && !segments[0].className
          ? segments[0].text
          : <span key={i}>{segmentsToReactNodes(segments)}</span>
      }
      return child
    })
  }

  return children
}

/**
 * Extract plain text content from React children (recursively)
 * Used to detect paragraph-level patterns when content contains formatting
 */
function extractTextContent(children: ReactNode): string {
  if (typeof children === 'string') {
    return children
  }
  if (typeof children === 'number') {
    return String(children)
  }
  if (Array.isArray(children)) {
    return children.map(extractTextContent).join('')
  }
  // Handle React elements - extract text from their children
  if (children && typeof children === 'object' && 'props' in children) {
    const element = children as { props: { children?: ReactNode } }
    return extractTextContent(element.props.children)
  }
  return ''
}

/**
 * Remove the leading `prefix` (a line-prefix marker or `[TAG]`) from the start of
 * the children, consuming it from the leading plain-text node(s) only. Inline
 * formatting in the body survives because we never descend into element nodes —
 * if the prefix doesn't lead the text as a clean string, we stop and leave the
 * rest intact. Used when a line-scoped delimiter opts into hiding.
 */
function stripLeadingPrefix(children: ReactNode, prefix: string): ReactNode {
  let remaining = prefix.length
  if (remaining <= 0) return children

  const consume = (node: ReactNode): ReactNode => {
    if (remaining <= 0) return node
    if (typeof node === 'string') {
      if (remaining >= node.length) {
        remaining -= node.length
        return ''
      }
      const out = node.slice(remaining)
      remaining = 0
      return out
    }
    // Prefix doesn't cleanly lead the text as plain string — stop stripping.
    remaining = 0
    return node
  }

  if (Array.isArray(children)) {
    return children.map((child) => consume(child))
  }
  return consume(children)
}

/**
 * Remove the trailing `suffix` (a wrap delimiter's closing marker) from the end of
 * the children, consuming it from the trailing plain-text node(s) only. Inline
 * formatting in the body survives because we never descend into element nodes —
 * if the suffix doesn't trail the text as a clean string, we stop and leave the
 * rest intact. The leading-prefix counterpart is {@link stripLeadingPrefix}.
 */
function stripTrailingSuffix(children: ReactNode, suffix: string): ReactNode {
  let remaining = suffix.length
  if (remaining <= 0) return children

  const consume = (node: ReactNode): ReactNode => {
    if (remaining <= 0) return node
    if (typeof node === 'string') {
      if (remaining >= node.length) {
        remaining -= node.length
        return ''
      }
      const out = node.slice(0, node.length - remaining)
      remaining = 0
      return out
    }
    // Suffix doesn't cleanly trail the text as plain string — stop stripping.
    remaining = 0
    return node
  }

  if (Array.isArray(children)) {
    const result = [...children]
    for (let i = result.length - 1; i >= 0 && remaining > 0; i--) {
      result[i] = consume(result[i])
    }
    return result
  }
  return consume(children)
}

/**
 * Shared block handling. Two block-level styling paths, checked in order:
 *
 *  1. Whole-block hidden WRAP (e.g. a paragraph that is entirely `+narration+`):
 *     strip both delimiters and wrap the remaining children — markdown nodes and
 *     all — in an inline styled `<span>`. This is what lets markdown *inside* a
 *     hidden-delimiter wrap (`+a *b* c+`) render: the markdown parser already
 *     produced the `<em>` node, and styling the wrapper keeps it, where the inline
 *     string tokenizer could not span across the node. The class goes on a span,
 *     never the block — the chat classes are `display: inline`.
 *  2. Whole-line LINE rule (`// ooc`, `[TAG] …`): the class lands on the block
 *     element; the leading marker is stripped when the rule hides delimiters.
 *
 * Otherwise the children are passed through unchanged for inline styling.
 */
function renderLineBlock(
  children: ReactNode,
  compiledRules: CompiledRule[],
): { className: string | undefined; content: ReactNode } {
  const textContent = extractTextContent(children)

  const wrapBlock = wrapBlockMatchFor(textContent, compiledRules)
  if (wrapBlock) {
    const stripped = stripTrailingSuffix(
      stripLeadingPrefix(children, wrapBlock.prefix),
      wrapBlock.suffix,
    )
    return {
      className: undefined,
      content: (
        <span className={wrapBlock.className}>{processChildren(stripped, compiledRules)}</span>
      ),
    }
  }

  const lineMatch = lineMatchFor(textContent, compiledRules)
  const effective =
    lineMatch?.hideDelimiters && lineMatch.prefix
      ? stripLeadingPrefix(children, lineMatch.prefix)
      : children
  return { className: lineMatch?.className, content: processChildren(effective, compiledRules) }
}

export default function MessageContent({
  content,
  className = '',
  renderingPatterns,
  dialogueDetection,
  blobMountPointId,
}: MessageContentProps) {
  // Use provided patterns or fall back to defaults
  const patterns = renderingPatterns && renderingPatterns.length > 0
    ? renderingPatterns
    : DEFAULT_RENDERING_PATTERNS

  // Use provided dialogue detection or fall back to default
  const dialogueConfig = dialogueDetection || DEFAULT_DIALOGUE_DETECTION

  // Compile patterns once for efficient matching
  const compiledRules = useMemo(
    () => compileRenderingPatterns(patterns),
    [patterns]
  )

  // Pre-process content: trim leading/trailing whitespace (a leading tab triggers
  // markdown's indented code block rule, rendering the whole message as preformatted),
  // then normalize `\(...\)`/`\[...\]` math delimiters to `$$` form (must run
  // before bracket escaping, which would otherwise claim `\[...\]`), then escape
  // markdown inside roleplay brackets and autolink any surfaced bare qtap:// URI
  // so announcement bodies become clickable.
  const processedContent = useMemo(
    () => linkifyBareQtapUris(escapeMarkdownInBrackets(normalizeMathDelimiters(content.trim()), patterns)),
    [content, patterns]
  )

  const components: Components = useMemo(() => ({
    // Fenced code blocks - handled by pre component since they're <pre><code>
    // This ensures ALL fenced code blocks get block styling, regardless of language
    pre({ children }) {
      // Extract the code element's props from children
      const codeElement = children as any
      const className = codeElement?.props?.className || ''
      const codeChildren = codeElement?.props?.children

      const match = /language-(\w+)/.exec(className)
      const language = match ? match[1] : 'text'
      const codeString = typeof codeChildren === 'string' || typeof codeChildren === 'number'
        ? String(codeChildren)
        : ''

      return <CodeBlockWithCopy code={codeString} language={language} />
    },
    // Inline code only (not wrapped in pre)
    code({ className, children, ...props }) {
      return (
        <code className={`${className || ''} qt-code-inline`} {...props}>
          {children}
        </code>
      )
    },
    // Paragraph - CSS handles spacing; custom behavior is dialogue detection,
    // whole-line (line-scoped) styling, and inline roleplay pattern processing.
    p({ children }) {
      const textContent = extractTextContent(children)
      const isDialogue = isDialogueParagraph(textContent, dialogueConfig)
      const { className: lineClass, content } = renderLineBlock(children, compiledRules)
      const cls = [isDialogue ? dialogueConfig.className : undefined, lineClass]
        .filter(Boolean)
        .join(' ') || undefined
      return <p className={cls}>{content}</p>
    },
    // Headings - CSS handles sizing, weight, and spacing; custom behavior is
    // whole-line styling and inline roleplay pattern processing on text nodes.
    h1({ children }) {
      const { className, content } = renderLineBlock(children, compiledRules)
      return <h1 className={className}>{content}</h1>
    },
    h2({ children }) {
      const { className, content } = renderLineBlock(children, compiledRules)
      return <h2 className={className}>{content}</h2>
    },
    h3({ children }) {
      const { className, content } = renderLineBlock(children, compiledRules)
      return <h3 className={className}>{content}</h3>
    },
    h4({ children }) {
      const { className, content } = renderLineBlock(children, compiledRules)
      return <h4 className={className}>{content}</h4>
    },
    h5({ children }) {
      const { className, content } = renderLineBlock(children, compiledRules)
      return <h5 className={className}>{content}</h5>
    },
    h6({ children }) {
      const { className, content } = renderLineBlock(children, compiledRules)
      return <h6 className={className}>{content}</h6>
    },
    // List items - CSS handles spacing; whole-line styling + inline patterns on
    // text nodes. ul/ol have no custom behavior, so they are intentionally
    // omitted here — react-markdown renders plain <ul>/<ol> and CSS styles them.
    li({ children }) {
      const { className, content } = renderLineBlock(children, compiledRules)
      return <li className={className}>{content}</li>
    },
    // Blockquote - CSS handles styling; whole-line styling + inline patterns.
    blockquote({ children }) {
      const { className, content } = renderLineBlock(children, compiledRules)
      return <blockquote className={className}>{content}</blockquote>
    },
    // Links — `qtap://` document URIs become in-app Document-Mode links
    // (never web URLs). Internal app routes use the Next.js router (required
    // for the Electron shell, which can't honour `target="_blank"`). External
    // links still open in a new tab. CSS (qt-link, scoped chat overrides)
    // handles appearance.
    a({ href, children }) {
      if (isQtapUri(href)) {
        return <QtapLink href={href}>{children}</QtapLink>
      }
      if (isInternalHref(href)) {
        return (
          <Link href={href} className="qt-link">
            {children}
          </Link>
        )
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="qt-link"
        >
          {children}
        </a>
      )
    },
    // Tables - the overflow-x-auto wrapper div is intentionally kept here because
    // CSS cannot inject a wrapper element, and overflow protection for wide tables
    // is a layout priority. thead/th/td have no custom behavior so they are omitted
    // — CSS handles all table cell styling.
    table({ children }) {
      return (
        <div className="overflow-x-auto">
          <table>{children}</table>
        </div>
      )
    },
    // Images — when a blob mount-point context is supplied, rewrite relative
    // references so `![alt](images/avatar.webp)` resolves to the mount-point
    // blob API. Absolute URLs, data URIs, and paths under the existing /api
    // tree pass through untouched.
    img({ src, alt, title, ...props }) {
      let resolvedSrc = typeof src === 'string' ? src : ''
      if (
        blobMountPointId &&
        resolvedSrc &&
        !/^([a-z]+:)?\/\//i.test(resolvedSrc) &&
        !resolvedSrc.startsWith('data:') &&
        !resolvedSrc.startsWith('/')
      ) {
        const encoded = resolvedSrc.split('/').map(encodeURIComponent).join('/')
        resolvedSrc = `/api/v1/mount-points/${blobMountPointId}/blobs/${encoded}`
      }
      return <img src={resolvedSrc} alt={alt || ''} title={title} {...props} />
    },
  }), [compiledRules, dialogueConfig, blobMountPointId])

  return (
    <>
      <div className={`qt-chat-message-content qt-prose prose prose-sm qt-prose-auto message-content ${className}`}>
        <ReactMarkdown
          // remark-breaks turns a single newline into a hard <br>. In chat, an
          // author who hits Enter means a line break (the way Slack/Discord/GitHub
          // comments behave), so soft breaks should be preserved rather than
          // collapsed to a space the way CommonMark does by default. Blank-line
          // paragraph separation still works as before.
          // remark-math + rehype-katex render $$…$$ math (single-dollar math is
          // off — see lib/markdown/math.ts). Must stay in sync with the server
          // pipeline in lib/services/markdown-renderer.service.ts.
          remarkPlugins={[remarkGfm, [remarkMath, REMARK_MATH_OPTIONS], remarkBreaks]}
          rehypePlugins={[rehypeKatex]}
          // react-markdown's default URL sanitizer only allows http(s)/mailto/
          // etc., so it would strip `qtap://` hrefs before they reach `a()`.
          // Preserve qtap:// URIs (rendered as in-app Document-Mode links by
          // QtapLink) and defer everything else to the default transform.
          urlTransform={(url) => (isQtapUri(url) ? url : defaultUrlTransform(url))}
          components={components}
        >
          {processedContent}
        </ReactMarkdown>
      </div>
    </>
  )
}
