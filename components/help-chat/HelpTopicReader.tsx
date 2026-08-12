'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Icon } from '@/components/ui/icon'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { Components } from 'react-markdown'
import { REMARK_MATH_OPTIONS, normalizeMathDelimiters } from '@/lib/markdown/math'
import { QtapLink } from '@/components/qtap/QtapLink'

function isQtapHref(href: string): boolean {
  return href.toLowerCase().startsWith('qtap://')
}

interface HelpTopicReaderProps {
  documentId: string
  categoryLabel: string
  /** Ref attached to the scrollable reader container so the parent can read/write scrollTop */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  /** When set, scroll to this position after content loads instead of top */
  restoreScrollTop?: number
  onBack: () => void
  onNavigateDoc: (docId: string) => void
  onNavigatePage: (url: string) => void
}

/**
 * Strip YAML frontmatter from markdown content
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return match ? content.slice(match[0].length) : content
}

/**
 * Remove LLM-only sections that should not be shown to human readers:
 * - "## In-Chat Navigation"
 * - "## In-Chat Settings Access"
 */
function removeLlmSections(content: string): string {
  const sectionsToRemove = ['## In-Chat Navigation', '## In-Chat Settings Access']
  let result = content
  for (const header of sectionsToRemove) {
    const headerIndex = result.indexOf(header)
    if (headerIndex === -1) continue
    // Find the next H2 after this section, or end of content
    const afterHeader = result.indexOf('\n## ', headerIndex + header.length)
    if (afterHeader === -1) {
      // Remove from header to end
      result = result.slice(0, headerIndex).trimEnd()
    } else {
      // Remove from header to next H2
      result = result.slice(0, headerIndex) + result.slice(afterHeader)
    }
  }
  return result
}

/**
 * Process "Related Pages" section links to use document IDs instead of filenames.
 * Transforms [Title](filename.md) links within the Related Pages section.
 */
function processContent(content: string): string {
  let result = stripFrontmatter(content)
  result = removeLlmSections(result)
  return result.trim()
}

export function HelpTopicReader({
  documentId,
  categoryLabel,
  scrollContainerRef,
  restoreScrollTop,
  onBack,
  onNavigateDoc,
  onNavigatePage,
}: HelpTopicReaderProps) {
  const internalRef = useRef<HTMLDivElement>(null)
  const readerRef = scrollContainerRef || internalRef
  const [content, setContent] = useState<string | null>(null)
  const [title, setTitle] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchDocument() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/v1/help-docs/${encodeURIComponent(documentId)}`)
        if (!res.ok) {
          throw new Error(res.status === 404 ? 'Document not found' : 'Failed to load document')
        }
        const data = await res.json()
        if (!cancelled) {
          setContent(data.document.content)
          setTitle(data.document.title)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load document')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchDocument()
    return () => { cancelled = true }
  }, [documentId])

  // Scroll reader to restored position or top when document changes
  useEffect(() => {
    if (!loading && content) {
      readerRef.current?.scrollTo(0, restoreScrollTop ?? 0)
    }
  }, [documentId, loading, content, readerRef, restoreScrollTop])

  const processedContent = useMemo(() => {
    if (!content) return ''
    return normalizeMathDelimiters(processContent(content))
  }, [content])

  const markdownComponents = useMemo<Components>(() => ({
    // Transform blockquotes: detect "Open this page in Quilltap" pattern
    blockquote({ children }) {
      // Check if this blockquote contains the navigation callout pattern
      const textContent = extractTextContent(children)
      const navMatch = textContent.match(/Open this page in Quilltap\]\(([^)]+)\)/)
      if (navMatch) {
        const url = navMatch[1]
        return (
          <div className="qt-help-guide-nav-callout">
            <button
              type="button"
              onClick={() => onNavigatePage(url)}
              className="qt-help-nav-button"
            >
              Open this page in Quilltap
            </button>
          </div>
        )
      }
      return <blockquote>{children}</blockquote>
    },
    // Transform links: .md file links navigate within Guide, /path links navigate to page
    a({ href, children }) {
      if (typeof href !== 'string') return <span>{children}</span>

      if (isQtapHref(href)) {
        return <QtapLink href={href}>{children}</QtapLink>
      }

      // Links to other help docs (e.g., "character-creation.md")
      if (href.endsWith('.md')) {
        const docId = href.replace(/\.md$/, '')
        return (
          <button
            type="button"
            onClick={() => onNavigateDoc(docId)}
            className="qt-help-guide-doc-link"
          >
            {children}
          </button>
        )
      }

      // Internal navigation links (start with /)
      if (href.startsWith('/')) {
        return (
          <button
            type="button"
            onClick={() => onNavigatePage(href)}
            className="qt-help-guide-page-link"
          >
            {children}
          </button>
        )
      }

      // External links open in new tab
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    },
    // Fenced code blocks get wrapped in <pre> by ReactMarkdown.
    // We style the <pre> for wrapping.
    pre({ children, ...props }) {
      return (
        <pre className="qt-help-guide-code-block" {...props}>
          {children}
        </pre>
      )
    },
    // Inline code only (single backticks, no block context)
    code({ className, children, ...props }) {
      return <code className={className || 'qt-help-guide-inline-code'} {...props}>{children}</code>
    },
  }), [onNavigateDoc, onNavigatePage])

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <button type="button" onClick={onBack} className="qt-help-guide-back">
          <Icon name="arrow-left" className="w-4 h-4" />
          {categoryLabel}
        </button>
        <div className="flex-1 flex items-center justify-center qt-text-secondary text-sm">
          Loading...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <button type="button" onClick={onBack} className="qt-help-guide-back">
          <Icon name="arrow-left" className="w-4 h-4" />
          {categoryLabel}
        </button>
        <div className="flex-1 flex items-center justify-center qt-text-destructive text-sm">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <button type="button" onClick={onBack} className="qt-help-guide-back">
        <Icon name="arrow-left" className="w-4 h-4" />
        {categoryLabel}
      </button>
      <div ref={readerRef} className="qt-help-guide-reader">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, [remarkMath, REMARK_MATH_OPTIONS]]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {processedContent}
        </ReactMarkdown>
      </div>
    </div>
  )
}

/**
 * Extract plain text content from React children for pattern matching
 */
function extractTextContent(children: any): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractTextContent).join('')
  if (children?.props?.children) return extractTextContent(children.props.children)
  return ''
}
