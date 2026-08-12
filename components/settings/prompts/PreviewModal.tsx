'use client'

import { PromptTemplate } from './types'
import ReactMarkdown from 'react-markdown'
import { QtapLink } from '@/components/qtap/QtapLink'
import { isQtapUri } from '@/lib/doc-edit/qtap-uri'
import { BaseModal } from '@/components/ui/BaseModal'

interface PreviewModalProps {
  template: PromptTemplate | null
  copiedId: string | null
  onClose: () => void
  onCopy: (template: PromptTemplate) => void
  onCopyAsNew: (template: PromptTemplate) => void
}

/**
 * Modal component for previewing a prompt template
 */
export function PreviewModal({
  template,
  copiedId,
  onClose,
  onCopy,
  onCopyAsNew,
}: PreviewModalProps) {
  if (!template) return null

  const footer = (
    <div className="flex justify-end gap-3 flex-wrap">
      <button
        type="button"
        onClick={() => onCopy(template)}
        className="px-4 py-2 text-sm rounded-md border qt-border-default qt-hover-accent"
      >
        {copiedId === template.id ? 'Copied!' : 'Copy to Clipboard'}
      </button>
      {template.isBuiltIn && (
        <button
          type="button"
          onClick={() => {
            onCopyAsNew(template)
            onClose()
          }}
          className="px-4 py-2 text-sm rounded-md border qt-border-default qt-hover-accent"
        >
          Copy as New
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:qt-bg-primary/90"
      >
        Close
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      title={template.name}
      maxWidth="4xl"
      footer={footer}
    >
      <div className="mb-4">
        {template.description && (
          <p className="qt-text-small">{template.description}</p>
        )}
        {(template.category || template.modelHint) && (
          <div className="flex gap-2 mt-2">
            {template.category && (
              <span className="px-2 py-0.5 qt-text-xs qt-bg-muted rounded">
                {template.category}
              </span>
            )}
            {template.modelHint && (
              <span className="px-2 py-0.5 qt-text-xs qt-bg-muted rounded">
                {template.modelHint}
              </span>
            )}
          </div>
        )}
        {template.isBuiltIn && (
          <span className="inline-block px-2 py-0.5 text-xs font-medium qt-bg-primary/10 text-primary rounded mt-2">
            Sample
          </span>
        )}
      </div>

      <div className="border qt-border-default rounded-lg p-4 qt-bg-muted/30 prose prose-sm qt-prose-auto max-w-none">
        <ReactMarkdown
          components={{
            a({ href, children }) {
              if (isQtapUri(href)) {
                return <QtapLink href={href}>{children}</QtapLink>
              }
              return <a href={href}>{children}</a>
            },
          }}
        >
          {template.content}
        </ReactMarkdown>
      </div>
    </BaseModal>
  )
}
