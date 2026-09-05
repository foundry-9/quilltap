'use client'

/**
 * Field Selection Step
 *
 * Step 3: Select which fields to generate and provide background context.
 */

import { Icon } from '@/components/ui/icon'
import type { GeneratableField } from '../types'
import { FIELD_LABELS, FIELD_DESCRIPTIONS } from '../types'

interface FieldSelectionStepProps {
  backgroundText: string
  onBackgroundChange: (text: string) => void
  availableFields: GeneratableField[]
  selectedFields: Set<GeneratableField>
  onFieldToggle: (field: GeneratableField) => void
  onSelectAll: () => void
  onClearAll: () => void
  currentData: Record<string, unknown>
  canGeneratePhysicalDescription: boolean
}

export function FieldSelectionStep({
  backgroundText,
  onBackgroundChange,
  availableFields,
  selectedFields,
  onFieldToggle,
  onSelectAll,
  onClearAll,
  currentData,
  canGeneratePhysicalDescription,
}: FieldSelectionStepProps) {
  // All possible fields, ordered by vantage point (outside → acquaintance → self)
  const allFields: GeneratableField[] = [
    'name',
    'title',
    'properties',
    'identity',
    'description',
    'manifesto',
    'personality',
    'scenarios',
    'exampleDialogues',
    'firstMessage',
    'systemPrompt',
    'physicalDescription',
    'wardrobeItems',
  ]

  const isFieldAvailable = (field: GeneratableField) => availableFields.includes(field)
  const isFieldSelected = (field: GeneratableField) => selectedFields.has(field)

  // Check if physical description is disabled
  const isPhysicalDescriptionDisabled = !canGeneratePhysicalDescription

  return (
    <div className="space-y-6">
      {/* Background Context */}
      <div>
        <h3 className="qt-heading-4 text-foreground mb-2">
          Background Context
        </h3>
        <p className="text-sm qt-text-secondary mb-3">
          Provide context about the character&apos;s world, scenario, backstory, or any details
          that should inform the generation.
        </p>
        <textarea
          value={backgroundText}
          onChange={(e) => onBackgroundChange(e.target.value)}
          placeholder="Describe the world, scenario, backstory, or any context that should inform this character's creation. For example: 'A medieval fantasy world where magic is rare. This character is a blacksmith in a small village who secretly studies forbidden magic.'"
          rows={5}
          className="qt-textarea"
        />
      </div>

      {/* Field Selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="qt-heading-4 text-foreground">
              Fields to Generate
            </h3>
            <p className="text-sm qt-text-secondary">
              Select which fields you want the AI to generate.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSelectAll}
              className="text-sm text-primary hover:underline"
            >
              Select all
            </button>
            <span className="qt-text-secondary">|</span>
            <button
              type="button"
              onClick={onClearAll}
              className="text-sm text-primary hover:underline"
            >
              Clear all
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {allFields.map((field) => {
            const available = isFieldAvailable(field)
            const selected = isFieldSelected(field)
            const fieldValue = currentData[field]
            const hasContent = Array.isArray(fieldValue)
              ? fieldValue.length > 0
              : typeof fieldValue === 'string' && !!fieldValue.trim()

            // Special handling for physical description
            const isDisabled =
              field === 'physicalDescription'
                ? isPhysicalDescriptionDisabled || !available
                : !available

            let statusText = ''
            if (field === 'physicalDescription' && isPhysicalDescriptionDisabled) {
              statusText = '(skipped in previous step)'
            } else if (field === 'scenarios' && Array.isArray(fieldValue) && fieldValue.length > 0) {
              statusText = `(${fieldValue.length} existing — will add more)`
            } else if (hasContent && field !== 'physicalDescription') {
              statusText = '(has content)'
            }

            return (
              <label
                key={field}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                  isDisabled
                    ? 'qt-border-default qt-bg-muted/30 opacity-60 cursor-not-allowed'
                    : selected
                    ? 'qt-border-primary qt-bg-primary/5 cursor-pointer'
                    : 'qt-border-default hover:border-muted-foreground/50 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => !isDisabled && onFieldToggle(field)}
                  disabled={isDisabled}
                  className="mt-1 qt-checkbox"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {FIELD_LABELS[field]}
                    </span>
                    {statusText && (
                      <span className="text-xs qt-text-secondary">{statusText}</span>
                    )}
                  </div>
                  <p className="text-sm qt-text-secondary mt-0.5">
                    {FIELD_DESCRIPTIONS[field]}
                  </p>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* Summary */}
      <div className="p-4 rounded-lg border qt-border-default qt-bg-muted/20">
        <h4 className="font-medium text-foreground mb-2">Generation Summary</h4>
        {selectedFields.size === 0 ? (
          <p className="text-sm qt-text-secondary">
            No fields selected. Please select at least one field to generate.
          </p>
        ) : (
          <div className="text-sm qt-text-secondary">
            <p>
              Will generate <span className="font-medium text-foreground">{selectedFields.size}</span> field{selectedFields.size !== 1 ? 's' : ''}:
            </p>
            <ul className="mt-2 space-y-1">
              {Array.from(selectedFields).map((field) => (
                <li key={field} className="flex items-center gap-2">
                  <Icon name="check" className="w-4 h-4 text-primary flex-shrink-0" />
                  <span>{FIELD_LABELS[field]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
