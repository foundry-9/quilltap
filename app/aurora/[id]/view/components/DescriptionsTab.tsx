'use client'

import { useEffect, useState } from 'react'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { PromptFieldLabel } from '@/components/prompt-fields/PromptFieldLabel'
import { PROMPT_FIELD_HINTS } from '@/components/prompt-fields/field-hints'
import { charCountClass } from '@/lib/utils/char-count'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { CharacterPhysicalDescription } from '../types'

interface DescriptionsTabProps {
  characterId: string
}

interface FormState {
  name: string
  usageContext: string
  headAndShouldersPrompt: string
  shortPrompt: string
  mediumPrompt: string
  longPrompt: string
  completePrompt: string
  fullDescription: string
}

const EMPTY_FORM: FormState = {
  name: '',
  usageContext: '',
  headAndShouldersPrompt: '',
  shortPrompt: '',
  mediumPrompt: '',
  longPrompt: '',
  completePrompt: '',
  fullDescription: '',
}

function toForm(pd: CharacterPhysicalDescription | null | undefined): FormState {
  if (!pd) return EMPTY_FORM
  return {
    name: pd.name || '',
    usageContext: pd.usageContext || '',
    headAndShouldersPrompt: pd.headAndShouldersPrompt || '',
    shortPrompt: pd.shortPrompt || '',
    mediumPrompt: pd.mediumPrompt || '',
    longPrompt: pd.longPrompt || '',
    completePrompt: pd.completePrompt || '',
    fullDescription: pd.fullDescription || '',
  }
}

export function DescriptionsTab({ characterId }: DescriptionsTabProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pd, setPd] = useState<CharacterPhysicalDescription | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [remountKey, setRemountKey] = useState(0)

  const fetchCharacter = async () => {
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (!res.ok) throw new Error('Failed to fetch character')
      const data = await res.json()
      const current: CharacterPhysicalDescription | null = data.character?.physicalDescription ?? null
      setPd(current)
      setForm(toForm(current))
      setRemountKey((k) => k + 1)
    } catch (err) {
      console.error('Failed to load physical description', {
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState lands inside async fetchCharacter()
    fetchCharacter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId])

  const setField = (name: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleInputChange = (name: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [name]: e.target.value }))
    }

  const handleSave = async () => {
    if (!form.name.trim()) {
      showErrorToast('Name is required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        physicalDescription: {
          id: pd?.id,
          name: form.name,
          usageContext: form.usageContext || null,
          headAndShouldersPrompt: form.headAndShouldersPrompt || null,
          shortPrompt: form.shortPrompt || null,
          mediumPrompt: form.mediumPrompt || null,
          longPrompt: form.longPrompt || null,
          completePrompt: form.completePrompt || null,
          fullDescription: form.fullDescription || null,
        },
      }
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save physical description')
      }
      showSuccessToast(pd ? 'Physical description updated' : 'Physical description created')
      await fetchCharacter()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save physical description'
      console.error('Failed to save physical description', { error: msg })
      showErrorToast(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (!pd) return
    if (!confirm('Remove the physical description for this character?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physicalDescription: null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to clear physical description')
      }
      showSuccessToast('Physical description cleared')
      await fetchCharacter()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to clear physical description'
      console.error('Failed to clear physical description', { error: msg })
      showErrorToast(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="qt-card py-6 text-center qt-text-secondary">
        Loading physical description...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-secondary">
        One physical description per character, with a head-and-shoulders avatar
        prompt, short/medium/long/complete prompt variants, and a full freeform
        description. Stored in the character vault as <code>physical-description.md</code>{' '}
        + <code>physical-prompts.json</code>.
      </p>

      <div className="qt-card space-y-4">
        {/* Name */}
        <div>
          <label htmlFor="physical-name" className="qt-label mb-1">
            Name *
          </label>
          <input
            type="text"
            id="physical-name"
            value={form.name}
            onChange={handleInputChange('name')}
            required
            placeholder="e.g., Base Appearance, Formal Attire"
            className="qt-input"
          />
        </div>

        {/* Usage Context */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="physical-usage" className="qt-label">
              Usage Context
            </label>
            <span className={`text-xs ${charCountClass(form.usageContext.length, 200)}`}>
              {form.usageContext.length}/200
            </span>
          </div>
          <input
            type="text"
            id="physical-usage"
            value={form.usageContext}
            onChange={handleInputChange('usageContext')}
            maxLength={200}
            placeholder="e.g., at work in a professional capacity, relaxing at the pool"
            className="qt-input"
          />
          <p className="mt-1 text-xs qt-text-small">
            Describes when this appearance is most appropriate.
          </p>
        </div>

        {/* Shared form-of-address note for every prompt variant below —
            attached once here rather than repeated per field. */}
        <PromptFieldLabel hint={PROMPT_FIELD_HINTS.physicalDescription} />

        {/* Head & Shoulders Prompt — used for avatar generation */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="physical-headshoulders" className="block text-sm qt-text-primary">
              Head &amp; Shoulders
            </label>
            <span className={`text-xs ${charCountClass(form.headAndShouldersPrompt.length, 500)}`}>
              {form.headAndShouldersPrompt.length}/500
            </span>
          </div>
          <p className="text-xs qt-text-secondary mb-2">
            Used for avatar generation — describe only the head, face, hair, expression
            and neckline; nothing below the shoulders.
          </p>
          <MarkdownLexicalEditor
            value={form.headAndShouldersPrompt}
            onChange={setField('headAndShouldersPrompt')}
            remountKey={remountKey}
            namespace="DescriptionsTab.headAndShouldersPrompt"
            ariaLabel="Head and shoulders prompt"
            minHeight="4rem"
          />
        </div>

        {/* Short Prompt */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="physical-short" className="block text-sm qt-text-primary">
              Short Prompt
            </label>
            <span className={`text-xs ${charCountClass(form.shortPrompt.length, 350)}`}>
              {form.shortPrompt.length}/350
            </span>
          </div>
          <p className="text-xs qt-text-secondary mb-2">Brief description for small prompts.</p>
          <MarkdownLexicalEditor
            value={form.shortPrompt}
            onChange={setField('shortPrompt')}
            remountKey={remountKey}
            namespace="DescriptionsTab.shortPrompt"
            ariaLabel="Short prompt"
            minHeight="4rem"
          />
        </div>

        {/* Medium Prompt */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="physical-medium" className="block text-sm qt-text-primary">
              Medium Prompt
            </label>
            <span className={`text-xs ${charCountClass(form.mediumPrompt.length, 500)}`}>
              {form.mediumPrompt.length}/500
            </span>
          </div>
          <p className="text-xs qt-text-secondary mb-2">More detailed description.</p>
          <MarkdownLexicalEditor
            value={form.mediumPrompt}
            onChange={setField('mediumPrompt')}
            remountKey={remountKey}
            namespace="DescriptionsTab.mediumPrompt"
            ariaLabel="Medium prompt"
            minHeight="6rem"
          />
        </div>

        {/* Long Prompt */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="physical-long" className="block text-sm qt-text-primary">
              Long Prompt
            </label>
            <span className={`text-xs ${charCountClass(form.longPrompt.length, 750)}`}>
              {form.longPrompt.length}/750
            </span>
          </div>
          <p className="text-xs qt-text-secondary mb-2">Extended description with more detail.</p>
          <MarkdownLexicalEditor
            value={form.longPrompt}
            onChange={setField('longPrompt')}
            remountKey={remountKey}
            namespace="DescriptionsTab.longPrompt"
            ariaLabel="Long prompt"
            minHeight="8rem"
          />
        </div>

        {/* Complete Prompt */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="physical-complete" className="block text-sm qt-text-primary">
              Complete Prompt
            </label>
            <span className={`text-xs ${charCountClass(form.completePrompt.length, 1000)}`}>
              {form.completePrompt.length}/1000
            </span>
          </div>
          <p className="text-xs qt-text-secondary mb-2">Full detailed description for maximum context.</p>
          <MarkdownLexicalEditor
            value={form.completePrompt}
            onChange={setField('completePrompt')}
            remountKey={remountKey}
            namespace="DescriptionsTab.completePrompt"
            ariaLabel="Complete prompt"
            minHeight="10rem"
          />
        </div>

        {/* Full Description */}
        <div>
          <label htmlFor="physical-full" className="block text-sm qt-text-primary mb-1">
            Full Description (Markdown)
          </label>
          <p className="text-xs qt-text-secondary mb-2">
            Complete freeform description. Use this to generate the shorter prompts above.
          </p>
          <MarkdownLexicalEditor
            value={form.fullDescription}
            onChange={setField('fullDescription')}
            remountKey={remountKey}
            namespace="DescriptionsTab.fullDescription"
            ariaLabel="Full description"
            minHeight="10rem"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          {pd && (
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="qt-button-secondary"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="qt-button-primary"
          >
            {saving ? 'Saving...' : pd ? 'Save changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
