'use client'

import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '@/components/ui/icon'
import { QtapLink } from '@/components/qtap/QtapLink'
import { isQtapUri } from '@/lib/doc-edit/qtap-uri'
import { ALMANACK_TITLE } from '@/lib/tools/almanack/phases'

interface CapabilitiesReportDialogProps {
  isOpen: boolean
  onClose: () => void
  reportId: string
  filename: string
  content: string
}

export function CapabilitiesReportDialog({
  isOpen,
  onClose,
  reportId,
  filename,
  content,
}: CapabilitiesReportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      // Prevent body scroll when dialog is open
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={onClose}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog Container */}
      <div className="fixed inset-4 md:inset-8 lg:inset-12 z-50 pointer-events-auto flex items-center justify-center">
        <div
          ref={dialogRef}
          className="qt-dialog w-full h-full max-w-6xl flex flex-col"
        >
          {/* Header */}
          <div className="qt-dialog-header flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">
                {filename}
              </h2>
              <button
                onClick={onClose}
                className="p-1 hover:qt-bg-muted rounded transition-colors"
                aria-label="Close"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>
            <p className="qt-dialog-description qt-text-small">
              {ALMANACK_TITLE}
            </p>
          </div>

          {/* Body - Scrollable */}
          <div className="qt-dialog-body flex-1 overflow-y-auto min-h-0">
            <div className="prose prose-sm qt-prose-auto max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => {
                    if (isQtapUri(href)) {
                      return <QtapLink href={href}>{children}</QtapLink>
                    }
                    return <a href={href}>{children}</a>
                  },
                  // Custom table styling
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-4">
                      <table className="min-w-full border-collapse border qt-border-default">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="qt-bg-muted">{children}</thead>
                  ),
                  th: ({ children }) => (
                    <th className="border qt-border-default px-3 py-2 text-left font-semibold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border qt-border-default px-3 py-2">
                      {children}
                    </td>
                  ),
                  // Custom heading styling
                  h1: ({ children }) => (
                    <h1 className="qt-heading-2 mt-6 mb-4 pb-2 border-b qt-border-default">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="qt-heading-3 mt-6 mb-3 pb-1 border-b qt-border-default">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="qt-heading-4 mt-4 mb-2">
                      {children}
                    </h3>
                  ),
                  h4: ({ children }) => (
                    <h4 className="text-base font-semibold mt-3 mb-2">
                      {children}
                    </h4>
                  ),
                  // List styling
                  ul: ({ children }) => (
                    <ul className="list-disc list-inside my-2 space-y-1">
                      {children}
                    </ul>
                  ),
                  li: ({ children }) => (
                    <li className="ml-2">{children}</li>
                  ),
                  // Code styling
                  code: ({ children, className }) => {
                    const isInline = !className
                    if (isInline) {
                      return (
                        <code className="qt-bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                          {children}
                        </code>
                      )
                    }
                    return (
                      <code className={className}>{children}</code>
                    )
                  },
                  // Paragraph styling
                  p: ({ children }) => (
                    <p className="my-2 leading-relaxed">{children}</p>
                  ),
                  // Strong styling
                  strong: ({ children }) => (
                    <strong className="font-semibold">{children}</strong>
                  ),
                  // Emphasis styling
                  em: ({ children }) => (
                    <em className="italic qt-text-small">{children}</em>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer flex-shrink-0 flex justify-end gap-3">
            <a
              href={`/api/v1/system/tools?action=capabilities-report-get&reportId=${reportId}&download=true`}
              download={filename}
              className="qt-button qt-button-secondary"
            >
              <Icon name="download" className="w-4 h-4" />
              Download
            </a>
            <button onClick={onClose} className="qt-button qt-button-primary">
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
