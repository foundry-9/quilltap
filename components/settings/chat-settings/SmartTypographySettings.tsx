'use client'

/**
 * SmartTypographySettings
 *
 * Chat-tab settings UI for Layer 1.6. Presents the feature as the two groups it
 * actually is, because the difference between them IS the feature: quotes are a
 * display opinion applied at render time and nothing is written down, while
 * dashes and ellipsis are content and become real characters as you type.
 *
 * Sibling of the Text Replacement card, and reads as one on purpose.
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { smartTypographyStep } from '@/lib/smart-typography/engine'
import type { ChatSettings, SmartTypographySettings as SmartTypographySettingsValue } from './types'
import { DEFAULT_SMART_TYPOGRAPHY_SETTINGS } from './types'

export interface SmartTypographySettingsProps {
  settings: ChatSettings
  saving: boolean
  onUpdate: (updates: Partial<SmartTypographySettingsValue>) => Promise<void>
}

export function SmartTypographySettings({
  settings,
  saving,
  onUpdate,
}: SmartTypographySettingsProps) {
  const current = {
    ...DEFAULT_SMART_TYPOGRAPHY_SETTINGS,
    ...(settings.smartTypographySettings ?? {}),
  }
  const displayQuotes = current.displayQuotes ?? false
  const dashes = current.dashes ?? true
  const ellipsis = current.ellipsis ?? true

  const [tryItText, setTryItText] = useState('')
  const tryItRef = useRef<HTMLTextAreaElement>(null)
  /** Pending cursor position to set after a substitution-triggered re-render. */
  const tryItPendingCursor = useRef<number | null>(null)

  const handleTryItKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // The ENGINE is shared with the live plugin, so the preview cannot disagree
    // about what a keystroke does. The bail conditions are NOT copied from
    // TextReplacementSettings' try-it box: this is a plain <textarea>, so there
    // is no code context to be inside, and the plugin's code-block and inline-
    // code guards have no counterpart here.
    if (!dashes && !ellipsis) return
    if (e.nativeEvent.isComposing) return
    if (e.metaKey || e.ctrlKey || e.altKey) return

    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (start !== end) return // collapsed selection only

    const value = ta.value
    const before = value.slice(Math.max(0, start - 2), start)
    const result = smartTypographyStep({
      before,
      typed: e.key,
      options: { dashes, ellipsis },
    })
    if (result === null) return

    e.preventDefault()
    const deleteFrom = start - result.deleteBefore
    const newValue = value.slice(0, deleteFrom) + result.insert + value.slice(start)
    const cursor = deleteFrom + result.insert.length
    tryItPendingCursor.current = cursor
    setTryItText(newValue)
  }

  // After a substitution-triggered re-render, restore the cursor position.
  // A plain state change otherwise leaves the cursor at end-of-textarea.
  useEffect(() => {
    if (tryItPendingCursor.current === null) return
    const pos = tryItPendingCursor.current
    tryItPendingCursor.current = null
    const ta = tryItRef.current
    if (!ta) return
    ta.selectionStart = pos
    ta.selectionEnd = pos
  }, [tryItText])

  return (
    <div className="space-y-4">
      {/* Part A — render time */}
      <label className="qt-settings-toggle-row">
        <input
          type="checkbox"
          checked={displayQuotes}
          onChange={(e) => onUpdate({ displayQuotes: e.target.checked })}
          disabled={saving}
          className="qt-checkbox mt-1"
        />
        <div className="flex-1">
          <div className="qt-settings-section-heading">
            Curly quotes when displaying messages
          </div>
          <div className="qt-text-small mt-1">
            Shows <span className="qt-code-inline">&ldquo;curly quotes&rdquo;</span> in the
            conversation. What you typed is stored and sent to the model exactly as you typed
            it — this only changes how it looks, and turning it off puts everything back.
            Code, math and link addresses are never touched. A roleplay template that claims
            a quote character as one of its own delimiters keeps its straight quotes.
          </div>
        </div>
      </label>

      {/* Part B — type time */}
      <div className="qt-settings-shell qt-settings-field-group">
        <div className="qt-settings-section-heading">Dashes and ellipsis as you type</div>
        <div className="qt-text-small">
          Turns <span className="qt-code-inline">--</span> into an en dash,{' '}
          <span className="qt-code-inline">---</span> into an em dash, and{' '}
          <span className="qt-code-inline">...</span> into an ellipsis while you type in the
          Salon composer and the Document Mode rich editor. These become real characters in
          your text. One Backspace or Cmd/Ctrl+Z undoes any of them. Nothing fires inside
          code blocks, inline code, or source-mode editors, and pasted text is left alone.
        </div>

        <label className="qt-settings-toggle-row">
          <input
            type="checkbox"
            checked={dashes}
            onChange={(e) => onUpdate({ dashes: e.target.checked })}
            disabled={saving}
            className="qt-checkbox mt-1"
          />
          <div className="flex-1">
            <div className="qt-text-small font-medium">
              Dashes (<span className="qt-code-inline">--</span> →{' '}
              <span className="qt-code-inline">–</span>,{' '}
              <span className="qt-code-inline">---</span> →{' '}
              <span className="qt-code-inline">—</span>)
            </div>
          </div>
        </label>

        <label className="qt-settings-toggle-row">
          <input
            type="checkbox"
            checked={ellipsis}
            onChange={(e) => onUpdate({ ellipsis: e.target.checked })}
            disabled={saving}
            className="qt-checkbox mt-1"
          />
          <div className="flex-1">
            <div className="qt-text-small font-medium">
              Ellipsis (<span className="qt-code-inline">...</span> →{' '}
              <span className="qt-code-inline">…</span>)
            </div>
          </div>
        </label>

        {/* Try it */}
        <div className="qt-settings-section-heading">Try it</div>
        <div className="qt-text-small text-muted-foreground">
          Type a couple of hyphens or three periods here to watch the substitution happen.
          This box does not save anything.
          {!dashes && !ellipsis && ' (Both toggles are off — substitutions are paused.)'}
        </div>
        <textarea
          ref={tryItRef}
          value={tryItText}
          onChange={(e) => setTryItText(e.target.value)}
          onKeyDown={handleTryItKeyDown}
          rows={3}
          className="qt-input w-full"
          placeholder="Type -- or ... here…"
        />
      </div>
    </div>
  )
}

export default SmartTypographySettings
