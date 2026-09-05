'use client'

/**
 * A Lexical Markdown editor wired to a document-store-backed endpoint.
 *
 * Used by the three "default aesthetic" / depiction-guidelines surfaces:
 *   - Images settings tab  → /api/v1/system/image-aesthetics?kind=…
 *   - Project image settings → /api/v1/projects/[id]?action=aesthetic&kind=…
 *   - Character edit page   → /api/v1/characters/[id]?action=depiction-guidelines
 *
 * The endpoint's GET returns `{ content }` and its PUT accepts `{ content }`
 * (an empty body deletes the underlying file — restoring any fallback). The
 * file on disk is the source of truth; this field is just a convenience view.
 */

import { useCallback, useEffect, useState } from 'react'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'

interface AestheticEditorFieldProps {
  label: string
  description?: string
  /** GET returns `{ content }`. */
  loadUrl: string
  /** PUT accepts `{ content }`. Defaults to `loadUrl`. */
  saveUrl?: string
  /** Unique Lexical namespace (avoids cross-editor state bleed). */
  namespace: string
  /** When set, the editor is suppressed and this hint is shown instead. */
  disabledHint?: string
}

export function AestheticEditorField({
  label,
  description,
  loadUrl,
  saveUrl,
  namespace,
  disabledHint,
}: AestheticEditorFieldProps) {
  const url = saveUrl ?? loadUrl
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  // Bumped after a load so the Lexical composer remounts and re-parses the
  // freshly fetched content (MarkdownBridge only reads initialMarkdown once).
  const [remountKey, setRemountKey] = useState(0)

  useEffect(() => {
    // When disabled, the hint renders regardless of `loading`, so there's no
    // need to touch state here (and doing so synchronously trips a lint rule).
    if (disabledHint) {
      return
    }
    let cancelled = false
    fetch(loadUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`)
        const data = await res.json()
        if (cancelled) return
        setContent(typeof data?.content === 'string' ? data.content : '')
        setRemountKey((k) => k + 1)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadUrl, disabledHint])

  const handleChange = useCallback((value: string) => {
    setContent(value)
    setDirty(true)
    setSaved(false)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Failed to save (${res.status})`)
      }
      setDirty(false)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [url, content])

  return (
    <div className="space-y-2">
      <div>
        <label className="qt-label">{label}</label>
        {description && <p className="qt-text-small qt-text-muted">{description}</p>}
      </div>

      {disabledHint ? (
        <p className="qt-text-small qt-text-warning">{disabledHint}</p>
      ) : loading ? (
        <div className="qt-text-secondary qt-text-small py-4">Loading…</div>
      ) : (
        <>
          <MarkdownLexicalEditor
            value={content}
            onChange={handleChange}
            remountKey={remountKey}
            namespace={namespace}
            ariaLabel={label}
            minHeight="8rem"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="qt-button qt-button-primary qt-button-sm"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && !dirty && <span className="qt-text-small qt-text-success">Saved</span>}
            {error && <span className="qt-text-small qt-text-destructive">{error}</span>}
          </div>
        </>
      )}
    </div>
  )
}

export default AestheticEditorField
