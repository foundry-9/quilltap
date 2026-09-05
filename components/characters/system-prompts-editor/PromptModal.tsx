'use client'

import { BaseModal } from '@/components/ui/BaseModal'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { PromptFieldLabel } from '@/components/prompt-fields/PromptFieldLabel'
import { PROMPT_FIELD_HINTS } from '@/components/prompt-fields/field-hints'
import { CharacterSystemPrompt, PromptFormData } from './types'

interface PromptModalProps {
  isOpen: boolean
  editingPrompt: CharacterSystemPrompt | null
  formData: PromptFormData
  saving: boolean
  onClose: () => void
  onSave: () => void
  onFormChange: (field: keyof PromptFormData, value: string | boolean) => void
}

export function PromptModal({
  isOpen,
  editingPrompt,
  formData,
  saving,
  onClose,
  onSave,
  onFormChange,
}: PromptModalProps) {
  const isDisabled = !formData.name.trim() || !formData.content.trim()

  const footer = (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={onClose}
        className="qt-button-secondary"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || isDisabled}
        className="qt-button-primary"
      >
        {saving ? 'Saving...' : editingPrompt ? 'Update' : 'Create'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={editingPrompt ? 'Edit Prompt' : 'Create Prompt'}
      maxWidth="2xl"
      showCloseButton={true}
      footer={footer}
    >
      <div className="space-y-4">
        <div>
          <label className="qt-label">
            Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => onFormChange('name', e.target.value)}
            placeholder="e.g., Romantic, Companion, Professional"
            className="qt-input"
          />
        </div>

        <div>
          <PromptFieldLabel
            hint={PROMPT_FIELD_HINTS.systemPrompt}
            label="Content"
            required
            helper={`${PROMPT_FIELD_HINTS.systemPrompt.helper} Markdown is supported, and {{char}} / {{user}} substitute the character and user names.`}
          />
          <MarkdownLexicalEditor
            value={formData.content}
            onChange={(value) => onFormChange('content', value)}
            remountKey={editingPrompt?.id ?? 'new'}
            namespace="CharacterSystemPromptModal.content"
            ariaLabel="System prompt content"
            minHeight="12rem"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isDefault"
            checked={formData.isDefault}
            onChange={(e) => onFormChange('isDefault', e.target.checked)}
            className="qt-checkbox"
          />
          <label htmlFor="isDefault" className="text-sm text-foreground">
            Set as default prompt
          </label>
        </div>
      </div>
    </BaseModal>
  )
}
