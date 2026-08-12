'use client'

/**
 * Generation Step
 *
 * Step 4: Show generation progress, results, and apply option.
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import ReactMarkdown from 'react-markdown'
import { QtapLink } from '@/components/qtap/QtapLink'
import { isQtapUri } from '@/lib/doc-edit/qtap-uri'
import type { GeneratableField, GenerationProgress, GeneratedCharacterData } from '../types'
import { FIELD_LABELS, normalizeGeneratedScenarios } from '../types'

interface GenerationStepProps {
  generating: boolean
  progress: GenerationProgress
  generatedData: GeneratedCharacterData | null
  selectedFields: Set<GeneratableField>
  onGenerate: () => void
  onApply: () => void
  error: string | null
}

export function GenerationStep({
  generating,
  progress,
  generatedData,
  selectedFields,
  onGenerate,
  onApply,
  error,
}: GenerationStepProps) {
  const [expandedField, setExpandedField] = useState<GeneratableField | null>(null)

  // Check if generation is complete
  const isComplete = generatedData !== null && !generating

  // Get content for a field (returns string for simple fields, null if empty)
  const getFieldContent = (field: GeneratableField): string | null => {
    if (!generatedData) return null

    if (field === 'physicalDescription') {
      if (generatedData.physicalDescription) {
        return generatedData.physicalDescription.fullDescription || 'Physical description generated'
      }
      return null
    }

    if (field === 'scenarios') {
      const scenarios = normalizeGeneratedScenarios(generatedData.scenarios)
      if (scenarios.length > 0) {
        return scenarios.map((s) => `**${s.title}**\n${s.content}`).join('\n\n')
      }
      return null
    }

    const value = generatedData[field as keyof Omit<GeneratedCharacterData, 'scenarios' | 'physicalDescription'>]
    return typeof value === 'string' ? value || null : null
  }

  // Render field preview
  const renderFieldPreview = (field: GeneratableField) => {
    const content = getFieldContent(field)
    if (!content) return null

    const isExpanded = expandedField === field
    const isLong = content.length > 200

    if (field === 'physicalDescription' && generatedData?.physicalDescription) {
      const pd = generatedData.physicalDescription
      return (
        <div className="mt-2 space-y-3">
          <div className="text-xs qt-text-secondary">
            <strong>Short prompt:</strong> {pd.shortPrompt.substring(0, 100)}...
          </div>
          {isExpanded && (
            <div className="space-y-2 text-sm">
              <div>
                <strong className="text-foreground">Short ({pd.shortPrompt.length} chars):</strong>
                <p className="qt-text-secondary">{pd.shortPrompt}</p>
              </div>
              <div>
                <strong className="text-foreground">Medium ({pd.mediumPrompt.length} chars):</strong>
                <p className="qt-text-secondary">{pd.mediumPrompt}</p>
              </div>
              <div>
                <strong className="text-foreground">Long ({pd.longPrompt.length} chars):</strong>
                <p className="qt-text-secondary">{pd.longPrompt}</p>
              </div>
              <div>
                <strong className="text-foreground">Complete ({pd.completePrompt.length} chars):</strong>
                <p className="qt-text-secondary">{pd.completePrompt}</p>
              </div>
              <div>
                <strong className="text-foreground">Full Description:</strong>
                <div className="prose prose-sm qt-prose-auto max-w-none mt-1">
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
                    {pd.fullDescription}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      )
    }

    if (field === 'scenarios' && generatedData?.scenarios) {
      const scenarios = normalizeGeneratedScenarios(generatedData.scenarios)
      return (
        <div className="mt-2 space-y-2">
          {scenarios.map((s, idx) => (
            <div key={idx} className="text-sm">
              <strong className="text-foreground">{s.title}</strong>
              <p className="qt-text-secondary mt-0.5 whitespace-pre-wrap">{s.content}</p>
            </div>
          ))}
        </div>
      )
    }

    return (
      <div className="mt-2">
        <div className="text-sm qt-text-secondary whitespace-pre-wrap">
          {isExpanded || !isLong ? content : `${content.substring(0, 200)}...`}
        </div>
      </div>
    )
  }

  // Not yet started
  if (!generating && !generatedData) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="qt-heading-4 text-foreground mb-2">
            Ready to Generate
          </h3>
          <p className="text-sm qt-text-secondary">
            Click the button below to start generating content for your character.
          </p>
        </div>

        {/* Selected fields summary */}
        <div className="p-4 rounded-lg border qt-border-default qt-bg-muted/20">
          <h4 className="font-medium text-foreground mb-2">Fields to Generate</h4>
          <ul className="space-y-1">
            {Array.from(selectedFields).map((field) => (
              <li key={field} className="flex items-center gap-2 text-sm qt-text-secondary">
                <svg className="w-4 h-4 qt-text-secondary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" strokeWidth={2} />
                </svg>
                <span>{FIELD_LABELS[field]}</span>
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <div className="qt-alert-error">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={onGenerate}
          className="w-full qt-button-primary py-3"
        >
          <span className="flex items-center justify-center gap-2">
            <Icon name="zap" className="w-5 h-5" />
            Generate Character Content
          </span>
        </button>
      </div>
    )
  }

  // Generating
  if (generating) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="qt-heading-4 text-foreground mb-2">
            Generating Content...
          </h3>
          <p className="text-sm qt-text-secondary">
            Please wait while the AI generates your character content.
          </p>
        </div>

        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-4">
            <svg className="w-12 h-12 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="qt-text-secondary">
              {progress.currentField
                ? `Generating ${FIELD_LABELS[progress.currentField]}...`
                : 'Starting generation...'}
            </p>
          </div>
        </div>

        {/* Progress indicator */}
        <div className="space-y-2">
          {Array.from(selectedFields).map((field) => {
            const isCompleted = progress.completedFields.includes(field)
            const isCurrent = progress.currentField === field
            const hasError = !!progress.errors[field]
            const snippet = progress.snippets?.[field]

            return (
              <div
                key={field}
                className={`rounded-lg border transition-all ${
                  isCompleted
                    ? 'qt-border-success/50 qt-bg-success/10'
                    : hasError
                    ? 'qt-border-destructive/50 qt-bg-destructive/10'
                    : isCurrent
                    ? 'qt-border-primary qt-bg-primary/5'
                    : 'qt-border-default qt-bg-muted/20'
                }`}
              >
                <div className="flex items-center gap-3 p-3">
                  {isCompleted ? (
                    <Icon name="check" className="w-5 h-5 qt-text-success flex-shrink-0" />
                  ) : hasError ? (
                    <Icon name="close" className="w-5 h-5 qt-text-destructive flex-shrink-0" />
                  ) : isCurrent ? (
                    <svg className="w-5 h-5 text-primary animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 qt-text-secondary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" strokeWidth={2} />
                    </svg>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className={`font-medium ${isCompleted ? 'text-foreground' : 'qt-text-secondary'}`}>
                      {FIELD_LABELS[field]}
                    </span>
                    {/* Show snippet for completed fields */}
                    {isCompleted && snippet && (
                      <p className="text-xs qt-text-secondary mt-1 truncate">
                        {snippet}
                      </p>
                    )}
                    {/* Show error message */}
                    {hasError && (
                      <p className="text-xs qt-text-destructive mt-1">
                        {progress.errors[field]}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Complete
  return (
    <div className="space-y-6">
      <div>
        <h3 className="qt-heading-4 text-foreground mb-2 flex items-center gap-2">
          <Icon name="check-circle" className="w-6 h-6 qt-text-success" />
          Generation Complete
        </h3>
        <p className="text-sm qt-text-secondary">
          Review the generated content below. Click on a field to expand it.
        </p>
      </div>

      {error && (
        <div className="qt-alert-error">
          {error}
        </div>
      )}

      {/* Generated content */}
      <div className="space-y-2">
        {Array.from(selectedFields).map((field) => {
          const content = getFieldContent(field)
          const hasError = !!progress.errors[field]
          const isExpanded = expandedField === field

          return (
            <div
              key={field}
              className={`rounded-lg border transition-colors ${
                hasError
                  ? 'qt-border-destructive/50 qt-bg-destructive/10'
                  : content
                  ? 'qt-border-success/50 qt-bg-success/10'
                  : 'qt-border-default qt-bg-muted/20'
              }`}
            >
              <button
                type="button"
                onClick={() => setExpandedField(isExpanded ? null : field)}
                className="w-full flex items-center justify-between p-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {content ? (
                    <Icon name="check" className="w-5 h-5 qt-text-success" />
                  ) : hasError ? (
                    <Icon name="close" className="w-5 h-5 qt-text-destructive" />
                  ) : (
                    <svg className="w-5 h-5 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" strokeWidth={2} />
                    </svg>
                  )}
                  <span className="font-medium text-foreground">{FIELD_LABELS[field]}</span>
                </div>
                <Icon name="chevron-down" className={`w-5 h-5 qt-text-secondary transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 border-t qt-border-default/50 pt-3">
                  {hasError ? (
                    <p className="text-sm qt-text-destructive">{progress.errors[field]}</p>
                  ) : content ? (
                    renderFieldPreview(field)
                  ) : (
                    <p className="text-sm qt-text-secondary">No content generated</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Apply button */}
      <button
        type="button"
        onClick={onApply}
        className="w-full qt-button-primary py-3"
      >
        <span className="flex items-center justify-center gap-2">
          <Icon name="check" className="w-5 h-5" />
          Apply to Character
        </span>
      </button>
    </div>
  )
}
