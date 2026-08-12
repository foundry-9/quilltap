'use client'

/**
 * FilePreviewText Component
 *
 * Renders a text file in the preview modal with syntax highlighting.
 * Markdown files (.md) are rendered with full markdown formatting.
 * Code files are syntax highlighted using react-syntax-highlighter.
 * Supports wikilinks [[File]] and [[File#Header]] with navigation.
 */

import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { Components } from 'react-markdown'
import { REMARK_MATH_OPTIONS, normalizeMathDelimiters } from '@/lib/markdown/math'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { QtapLink } from '@/components/qtap/QtapLink'
import { FileInfo } from '../types'

function isQtapHref(href: string): boolean {
  return href.toLowerCase().startsWith('qtap://')
}

interface FilePreviewTextProps {
  /** The file being previewed */
  file: FileInfo
  /** The text content to display */
  content: string | null
  /** Whether content is loading */
  isLoading: boolean
  /** Error message if loading failed */
  error: string | null
  /** All files in the current view (for wikilink navigation) */
  files?: FileInfo[]
  /** Called when navigating to a different file via wikilink */
  onNavigate?: (file: FileInfo, heading?: string) => void
  /** Optional heading to scroll to after content loads */
  targetHeading?: string
}

interface ParsedFrontmatter {
  data: Record<string, unknown>
  content: string
}

/**
 * Check if a file is a markdown file
 */
function isMarkdownFile(file: FileInfo): boolean {
  // Check MIME type
  if (file.mimeType.includes('markdown')) return true
  // Check file extension
  const filename = file.originalFilename.toLowerCase()
  return filename.endsWith('.md') || filename.endsWith('.markdown')
}

/**
 * Parse YAML frontmatter from markdown content
 * Returns the frontmatter data and the content without frontmatter
 */
function parseFrontmatter(content: string): ParsedFrontmatter {
  // Check if content starts with ---
  if (!content.startsWith('---')) {
    return { data: {}, content }
  }

  // Find the closing ---
  const endIndex = content.indexOf('\n---', 3)
  if (endIndex === -1) {
    return { data: {}, content }
  }

  const yamlContent = content.slice(4, endIndex).trim()
  const markdownContent = content.slice(endIndex + 4).trim()

  // Parse simple YAML (key: value pairs)
  const data: Record<string, unknown> = {}
  const lines = yamlContent.split('\n')

  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    let value: unknown = line.slice(colonIndex + 1).trim()

    // Handle quoted strings
    if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
      value = (value as string).slice(1, -1)
    } else if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
      value = (value as string).slice(1, -1)
    }
    // Handle arrays (simple inline format: [a, b, c])
    else if ((value as string).startsWith('[') && (value as string).endsWith(']')) {
      const arrayContent = (value as string).slice(1, -1)
      value = arrayContent.split(',').map(item => item.trim().replace(/^['"]|['"]$/g, ''))
    }
    // Handle booleans
    else if (value === 'true') {
      value = true
    } else if (value === 'false') {
      value = false
    }
    // Handle numbers
    else if (!isNaN(Number(value)) && value !== '') {
      value = Number(value)
    }

    if (key) {
      data[key] = value
    }
  }

  return { data, content: markdownContent }
}

/**
 * Format a frontmatter value for display
 */
function formatFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ')
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (value === null || value === undefined) {
    return '—'
  }
  return String(value)
}

/**
 * Get language for syntax highlighting from MIME type
 * Returns Prism-compatible language names
 */
function getLanguageFromMimeType(mimeType: string): string {
  // Check for specific MIME types first
  const mimeToLanguage: Record<string, string> = {
    'application/json': 'json',
    'application/xml': 'xml',
    'application/javascript': 'javascript',
    'application/typescript': 'typescript',
    'text/javascript': 'javascript',
    'text/typescript': 'typescript',
    'text/html': 'html',
    'text/css': 'css',
    'text/markdown': 'markdown',
    'text/yaml': 'yaml',
    'text/csv': 'csv',
    'text/x-python': 'python',
    'text/x-ruby': 'ruby',
    'text/x-rust': 'rust',
    'text/x-go': 'go',
    'text/x-java': 'java',
    'text/x-kotlin': 'kotlin',
    'text/x-scala': 'scala',
    'text/x-swift': 'swift',
    'text/x-c': 'c',
    'text/x-c++': 'cpp',
    'text/x-csharp': 'csharp',
    'text/x-php': 'php',
    'text/x-perl': 'perl',
    'text/x-r': 'r',
    'text/x-lua': 'lua',
    'text/x-dart': 'dart',
    'text/x-elixir': 'elixir',
    'text/x-erlang': 'erlang',
    'text/x-clojure': 'clojure',
    'text/x-haskell': 'haskell',
    'text/x-ocaml': 'ocaml',
    'text/x-fsharp': 'fsharp',
    'text/x-shellscript': 'bash',
    'text/x-powershell': 'powershell',
    'text/x-batch': 'batch',
    'text/x-sql': 'sql',
    'text/toml': 'toml',
    'text/x-vue': 'markup',
    'text/x-svelte': 'markup',
    'text/x-scss': 'scss',
    'text/x-sass': 'sass',
    'text/x-less': 'less',
    'text/x-graphql': 'graphql',
    'text/x-dockerfile': 'docker',
    'text/x-makefile': 'makefile',
  }

  if (mimeToLanguage[mimeType]) {
    return mimeToLanguage[mimeType]
  }

  // Fallback to checking substrings for partial matches
  if (mimeType.includes('json')) return 'json'
  if (mimeType.includes('javascript')) return 'javascript'
  if (mimeType.includes('typescript')) return 'typescript'
  if (mimeType.includes('html')) return 'html'
  if (mimeType.includes('css')) return 'css'
  if (mimeType.includes('xml')) return 'xml'
  if (mimeType.includes('markdown')) return 'markdown'
  if (mimeType.includes('yaml')) return 'yaml'
  if (mimeType.includes('python')) return 'python'
  if (mimeType.includes('ruby')) return 'ruby'
  if (mimeType.includes('rust')) return 'rust'
  if (mimeType.includes('java')) return 'java'
  if (mimeType.includes('shell')) return 'bash'

  return 'text'
}

/**
 * Check if syntax highlighting should be used for this file
 * (i.e., it's a code file, not plain text or markdown)
 */
function shouldUseSyntaxHighlighting(mimeType: string, filename: string): boolean {
  // Skip for plain text without code extension
  if (mimeType === 'text/plain') {
    // Check if file has a code-like extension
    const codeExtensions = [
      '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
      '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
      '.sql', '.graphql', '.gql',
    ]
    const lowerFilename = filename.toLowerCase()
    return codeExtensions.some(ext => lowerFilename.endsWith(ext))
  }

  // Use highlighting for all code MIME types
  const lang = getLanguageFromMimeType(mimeType)
  return lang !== 'text' && lang !== 'markdown'
}

/**
 * Copy button component for text preview
 */
interface CopyButtonProps {
  content: string
  className?: string
}

function CopyButton({ content, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      // Reset after 2 seconds
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('[CopyButton] Failed to copy to clipboard', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [content])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`qt-copy-button ${copied ? 'qt-copy-button-success' : ''} ${className}`}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
    >
      <span className="qt-copy-button-icon">{copied ? '✓' : '📋'}</span>
      <span className="qt-copy-button-text">{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  )
}

/**
 * Process wikilinks in markdown content
 * Converts [[File]], [[File#Header]], [[File|Text]], [[File#Header|Text]]
 * to standard markdown links with special data attributes for navigation
 */
function processWikilinks(content: string): string {
  // Match wikilinks: [[target]] or [[target|display]] or [[target#header]] or [[target#header|display]]
  const wikilinkRegex = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g

  return content.replace(wikilinkRegex, (match, target, header, displayText) => {
    const filename = target.trim()
    const heading = header?.trim()
    const customText = displayText?.trim()

    // Build the display text
    let display: string
    if (customText) {
      display = customText
    } else if (heading) {
      display = `${filename} → ${heading}`
    } else {
      display = filename
    }

    // Build the href - use #wikilink/ prefix which is a valid anchor format
    // URL-encode the parts to handle spaces and special characters
    const encodedFilename = encodeURIComponent(filename)
    const encodedHeading = heading ? encodeURIComponent(heading) : null
    const href = encodedHeading
      ? `#wikilink/${encodedFilename}/${encodedHeading}`
      : `#wikilink/${encodedFilename}`

    return `[${display}](${href})`
  })
}

/**
 * Find a file by name (case-insensitive, with or without extension)
 */
function findFileByName(files: FileInfo[], targetName: string): FileInfo | null {
  const normalizedTarget = targetName.toLowerCase()

  // Try exact match first (with extension)
  let found = files.find(f =>
    f.originalFilename.toLowerCase() === normalizedTarget ||
    f.originalFilename.toLowerCase() === `${normalizedTarget}.md` ||
    f.originalFilename.toLowerCase() === `${normalizedTarget}.markdown`
  )

  if (found) return found

  // Try matching without extension
  found = files.find(f => {
    const nameWithoutExt = f.originalFilename.replace(/\.(md|markdown)$/i, '').toLowerCase()
    return nameWithoutExt === normalizedTarget
  })

  return found || null
}

export default function FilePreviewText({
  file,
  content,
  isLoading,
  error,
  files = [],
  onNavigate,
  targetHeading,
}: Readonly<FilePreviewTextProps>) {
  // Ref for scroll container
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const language = getLanguageFromMimeType(file.mimeType)
  const isMarkdown = isMarkdownFile(file)
  const useHighlighting = shouldUseSyntaxHighlighting(file.mimeType, file.originalFilename)

  // Parse frontmatter and process wikilinks for markdown files (must be before any early returns)
  const parsed = useMemo(() => {
    if (!content || !isMarkdown) {
      return null
    }
    const frontmatter = parseFrontmatter(content)
    // Process wikilinks in the content
    return {
      ...frontmatter,
      content: processWikilinks(frontmatter.content),
    }
  }, [content, isMarkdown])

  const hasFrontmatter = parsed && Object.keys(parsed.data).length > 0

  // Handle link clicks for wikilinks and relative markdown links
  const handleLinkClick = useCallback((href: string, e: React.MouseEvent) => {
    if (isQtapHref(href)) {
      return
    }

    // Check if it's a wikilink (format: #wikilink/filename or #wikilink/filename/heading)
    if (href.startsWith('#wikilink/')) {
      e.preventDefault()
      const target = href.slice(10) // Remove '#wikilink/' prefix
      const parts = target.split('/')
      const encodedFilename = parts[0]
      const encodedHeading = parts[1] // May be undefined
      // Decode the URL-encoded filename and heading
      const filename = decodeURIComponent(encodedFilename)
      const heading = encodedHeading ? decodeURIComponent(encodedHeading) : undefined

      const targetFile = findFileByName(files, filename)
      if (targetFile && onNavigate) {
        onNavigate(targetFile, heading)
      }
      return
    }

    // Check if it's a relative markdown link (not http/https)
    if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:')) {
      e.preventDefault()
      // Extract filename and heading from path and decode
      const urlParts = href.split('#')
      const rawFilename = urlParts[0].split('/').pop() || urlParts[0]
      const filename = decodeURIComponent(rawFilename)
      const heading = urlParts[1] ? decodeURIComponent(urlParts[1]) : undefined
      const targetFile = findFileByName(files, filename)
      if (targetFile && onNavigate) {
        onNavigate(targetFile, heading)
      }
    }
    // External links open normally
  }, [files, onNavigate])

  // Custom link component for ReactMarkdown
  // Note: We destructure and discard node and onClick from props to prevent them
  // from being passed to the DOM element or overriding our click handler
  const markdownComponents: Components = useMemo(() => ({
    a: ({ href, children, node: _node, onClick: _onClick, ...restProps }) => {
      if (typeof href !== 'string') {
        return <span>{children}</span>
      }

      if (isQtapHref(href)) {
        return <QtapLink href={href}>{children}</QtapLink>
      }

      const isWikilink = href?.startsWith('#wikilink/')
      const isRelativeLink = href && !isWikilink && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:') && !href.startsWith('#')
      const isInternalLink = isWikilink || isRelativeLink

      // Check if target file exists for wikilinks/relative links
      let targetExists = false
      if (isWikilink && href) {
        const parts = href.slice(10).split('/') // Remove '#wikilink/' prefix
        const encodedTarget = parts[0]
        const target = decodeURIComponent(encodedTarget)
        targetExists = !!findFileByName(files, target)
      } else if (isRelativeLink && href) {
        const rawFilename = href.split('/').pop()?.split('#')[0] || href
        const filename = decodeURIComponent(rawFilename)
        targetExists = !!findFileByName(files, filename)
      }

      const linkClassName = isInternalLink
        ? targetExists
          ? 'qt-wikilink cursor-pointer'
          : 'qt-wikilink qt-wikilink-broken'
        : undefined

      // For internal links (wikilinks, relative), use a button styled as a link
      // This completely avoids any browser navigation behavior
      if (isInternalLink) {
        const onButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault()
          e.stopPropagation()
          if (href) {
            handleLinkClick(href, e as unknown as React.MouseEvent)
          }
        }

        return (
          <button
            type="button"
            onClick={onButtonClick}
            className={linkClassName}
            title={!targetExists ? 'File not found' : undefined}
          >
            {children}
          </button>
        )
      }

      // External links use normal anchor behavior
      return (
        <a
          {...restProps}
          href={href}
          className={linkClassName}
        >
          {children}
        </a>
      )
    },
  }), [files, handleLinkClick])

  useEffect(() => {
    // Text renderer mounted
  }, [file.id, language, useHighlighting, content?.length, isMarkdown])

  // Scroll to heading or top when file/heading changes
  useEffect(() => {
    if (!scrollContainerRef.current || isLoading) return

    // Small delay to ensure content is rendered
    const timeoutId = setTimeout(() => {
      if (!scrollContainerRef.current) return

      if (targetHeading) {
        // Try to find the heading element
        // Headings in markdown are rendered with id attributes based on their text
        // Convert heading text to slug format (lowercase, spaces to hyphens)
        const headingSlug = targetHeading.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
        const headingElement = scrollContainerRef.current.querySelector(`#${CSS.escape(headingSlug)}`)

        if (headingElement) {
          headingElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } else {
          // Fallback: try to find heading by text content
          const headings = scrollContainerRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
          for (const h of headings) {
            if (h.textContent?.toLowerCase().includes(targetHeading.toLowerCase())) {
              h.scrollIntoView({ behavior: 'smooth', block: 'start' })
              return
            }
          }
          // If still not found, scroll to top
          scrollContainerRef.current.scrollTop = 0
        }
      } else {
        // No heading specified, scroll to top
        scrollContainerRef.current.scrollTop = 0
      }
    }, 50)

    return () => clearTimeout(timeoutId)
  }, [file.id, targetHeading, isLoading])

  if (isLoading) {
    return (
      <div className="qt-file-preview-loading">
        <div className="qt-file-preview-loading-text">Loading file...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="qt-file-preview-empty">
        <div className="qt-file-preview-empty-icon">{'\u{1F4C3}'}</div>
        <p>{error}</p>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="qt-file-preview-empty">
        <div className="qt-file-preview-empty-icon">{'\u{1F4C3}'}</div>
        <p>No content available</p>
      </div>
    )
  }

  // Render markdown files with ReactMarkdown
  if (isMarkdown && parsed) {
    return (
      <div className="qt-file-preview-text-container">
        <CopyButton content={content} />
        <div ref={scrollContainerRef} className="qt-file-preview-scroll">
          <div className="qt-file-preview-panel">
            {/* Frontmatter display */}
            {hasFrontmatter && (
              <div className="qt-frontmatter">
                <div className="qt-frontmatter-title">Document Info</div>
                <table className="qt-frontmatter-table">
                  <tbody>
                    {Object.entries(parsed.data).map(([key, value]) => (
                      <tr key={key}>
                        <th>{key}</th>
                        <td>{formatFrontmatterValue(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Markdown content */}
            <div className="qt-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, [remarkMath, REMARK_MATH_OPTIONS]]}
                rehypePlugins={[rehypeKatex]}
                components={markdownComponents}
              >
                {normalizeMathDelimiters(parsed.content)}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Render code files with syntax highlighting
  if (useHighlighting) {
    return (
      <div className="qt-file-preview-text-container">
        <CopyButton content={content} />
        <div ref={scrollContainerRef} className="qt-file-preview-scroll">
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            showLineNumbers
            wrapLines
            customStyle={{
              margin: 0,
              borderRadius: 0,
              fontSize: '0.875rem',
              lineHeight: '1.5',
            }}
            lineNumberStyle={{
              minWidth: '3em',
              paddingRight: '1em',
              textAlign: 'right',
              userSelect: 'none',
              opacity: 0.5,
            }}
          >
            {content}
          </SyntaxHighlighter>
        </div>
      </div>
    )
  }

  // Render plain text files without syntax highlighting
  return (
    <div className="qt-file-preview-text-container">
      <CopyButton content={content} />
      <div ref={scrollContainerRef} className="qt-file-preview-scroll">
        <pre className="qt-file-preview-code">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  )
}
