'use client'

import { useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import MessageContent from '@/components/chat/MessageContent'

export interface PhysicalDescription {
  id: string
  name: string
  shortPrompt?: string | null
  mediumPrompt?: string | null
  longPrompt?: string | null
  completePrompt?: string | null
  fullDescription?: string | null
  createdAt: string
  updatedAt: string
}

interface PhysicalDescriptionEditorProps {
  entityType: 'character' | 'persona'
  entityId: string
  description?: PhysicalDescription | null
  onClose: () => void
  onSave: () => void
}

export function PhysicalDescriptionEditor({
  entityType,
  entityId,
  description,
  onClose,
  onSave,
}: PhysicalDescriptionEditorProps) {
  const isEditing = !!description

  const [formData, setFormData] = useState({
    name: description?.name || '',
    shortPrompt: description?.shortPrompt || '',
    mediumPrompt: description?.mediumPrompt || '',
    longPrompt: description?.longPrompt || '',
    completePrompt: description?.completePrompt || '',
    fullDescription: description?.fullDescription || '',
  })
  const [saving, setSaving] = useState(false)
  const [showFullDescPreview, setShowFullDescPreview] = useState(false)

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: value })
  }

  const handleSave = async () => {
    setSaving(true)

    try {
      const payload = {
        name: formData.name,
        shortPrompt: formData.shortPrompt || null,
        mediumPrompt: formData.mediumPrompt || null,
        longPrompt: formData.longPrompt || null,
        completePrompt: formData.completePrompt || null,
        fullDescription: formData.fullDescription || null,
      }

      const baseUrl = entityType === 'character'
        ? `/api/characters/${entityId}/descriptions`
        : `/api/personas/${entityId}/descriptions`

      const url = isEditing ? `${baseUrl}/${description.id}` : baseUrl

      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save description')
      }

      showSuccessToast(isEditing ? 'Description updated' : 'Description created')
      onSave()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const charCountClass = (current: number, max: number) => {
    if (current > max) return 'text-red-600 dark:text-red-400'
    if (current > max * 0.9) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-gray-500 dark:text-gray-400'
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {isEditing ? 'Edit Description' : 'New Physical Description'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="e.g., Base Appearance, Formal Attire"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Short Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="shortPrompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Short Prompt
              </label>
              <span className={`text-xs ${charCountClass(formData.shortPrompt.length, 350)}`}>
                {formData.shortPrompt.length}/350
              </span>
            </div>
            <textarea
              id="shortPrompt"
              name="shortPrompt"
              value={formData.shortPrompt}
              onChange={handleChange}
              rows={2}
              maxLength={350}
              placeholder="Brief description for small prompts..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Medium Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="mediumPrompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Medium Prompt
              </label>
              <span className={`text-xs ${charCountClass(formData.mediumPrompt.length, 500)}`}>
                {formData.mediumPrompt.length}/500
              </span>
            </div>
            <textarea
              id="mediumPrompt"
              name="mediumPrompt"
              value={formData.mediumPrompt}
              onChange={handleChange}
              rows={3}
              maxLength={500}
              placeholder="More detailed description..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Long Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="longPrompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Long Prompt
              </label>
              <span className={`text-xs ${charCountClass(formData.longPrompt.length, 750)}`}>
                {formData.longPrompt.length}/750
              </span>
            </div>
            <textarea
              id="longPrompt"
              name="longPrompt"
              value={formData.longPrompt}
              onChange={handleChange}
              rows={4}
              maxLength={750}
              placeholder="Extended description with more detail..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Complete Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="completePrompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Complete Prompt
              </label>
              <span className={`text-xs ${charCountClass(formData.completePrompt.length, 1000)}`}>
                {formData.completePrompt.length}/1000
              </span>
            </div>
            <textarea
              id="completePrompt"
              name="completePrompt"
              value={formData.completePrompt}
              onChange={handleChange}
              rows={5}
              maxLength={1000}
              placeholder="Full detailed description for maximum context..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Full Description (Markdown) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="fullDescription" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Full Description (Markdown)
              </label>
              <button
                type="button"
                onClick={() => setShowFullDescPreview(!showFullDescPreview)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                {showFullDescPreview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {showFullDescPreview ? (
              <div className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg min-h-[120px] prose dark:prose-invert prose-sm max-w-none">
                {formData.fullDescription ? (
                  <MessageContent content={formData.fullDescription} />
                ) : (
                  <span className="text-gray-400 italic">No content</span>
                )}
              </div>
            ) : (
              <textarea
                id="fullDescription"
                name="fullDescription"
                value={formData.fullDescription}
                onChange={handleChange}
                rows={6}
                placeholder="Complete freeform description in Markdown format. Use this to generate shorter prompts..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm"
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !formData.name.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
