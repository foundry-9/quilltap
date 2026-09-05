'use client'

/**
 * Dressing-instructions editor for the wardrobe dialog.
 *
 * A collapsible section under the container selector that edits the browsed
 * container's optional `Wardrobe/instructions.md` — the second-person
 * guidance consulted when a character chooses their own opening outfit
 * ("Let character choose"). Every container tier gets one: a character's
 * vault, Quilltap General, a project's store, or a group's store; at outfit
 * time the nearest tier's copy wins and the search stops there.
 *
 * Collapsed by default so the item grid keeps the stage; the summary row
 * notes whether the browsed container has instructions on file.
 *
 * @module components/wardrobe/WardrobeInstructionsSection
 */

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { PromptFieldLabel } from '@/components/prompt-fields/PromptFieldLabel'
import { PROMPT_FIELD_HINTS } from '@/components/prompt-fields/field-hints'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useWardrobeInstructions } from '@/lib/hooks/use-wardrobe-instructions'
import {
  encodeWardrobeContainer,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'

export interface WardrobeInstructionsSectionProps {
  container: WardrobeContainer | null
}

export function WardrobeInstructionsSection({ container }: WardrobeInstructionsSectionProps) {
  const { instructions, loading, fetched, saving, save } = useWardrobeInstructions(container)

  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('')
  // The Lexical editor reads `value` only at mount, so every async load (and
  // every container switch) must force a remount for the fetched text to show.
  const [remountKey, setRemountKey] = useState(0)

  const containerKey = container ? encodeWardrobeContainer(container) : ''

  useEffect(() => {
    if (!fetched) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing editor state to an async fetch result; see remountKey note above
    setDraft(instructions ?? '')
    setRemountKey((k) => k + 1)
  }, [fetched, instructions, containerKey])

  if (!container) return null

  const hasInstructions = fetched && instructions !== null
  const dirty = fetched && (draft.trim() || '') !== (instructions ?? '')

  const handleSave = async () => {
    const ok = await save(draft.trim().length > 0 ? draft : null)
    if (ok) {
      showSuccessToast(
        draft.trim().length > 0 ? 'Dressing instructions saved' : 'Dressing instructions cleared',
      )
    } else {
      showErrorToast('Failed to save dressing instructions')
    }
  }

  return (
    <div className="border qt-border-default rounded-lg mb-3">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-sm qt-text-secondary hover:text-foreground"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <Icon
          name="chevron-down"
          className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
        />
        <span className="font-medium">Dressing Instructions</span>
        <span className="ml-auto text-xs">
          {loading ? 'Consulting…' : hasInstructions ? 'On file' : 'None on file'}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <PromptFieldLabel hint={PROMPT_FIELD_HINTS.wardrobeInstructions} optional />
          <MarkdownLexicalEditor
            value={draft}
            onChange={setDraft}
            disabled={loading || saving}
            remountKey={`${containerKey}:${remountKey}`}
            namespace="WardrobeInstructionsSection"
            ariaLabel="Dressing instructions"
            minHeight="8rem"
          />
          <div className="flex justify-end mt-2">
            <button
              type="button"
              className="qt-button qt-button-primary qt-button-sm"
              onClick={handleSave}
              disabled={!dirty || saving || loading}
            >
              {saving ? 'Saving…' : 'Save Instructions'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
