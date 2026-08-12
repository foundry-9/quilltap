'use client'

/**
 * ProjectWardrobeManager — CRUD body for a project's `Wardrobe/` folder.
 *
 * Rendered by the Prospero project page's WardrobeCard, fed by the
 * `useProjectWardrobe` hook. Items created here are the project tier of the
 * tri-tier wardrobe model — wearable by every character in this project's
 * chats. Supports leaf garments and composites (bundling existing project
 * items); cycle rejection is enforced server-side.
 *
 * @module components/wardrobe/ProjectWardrobeManager
 */

import { useCallback, useMemo, useState } from 'react'
import { showConfirmation } from '@/lib/alert'
import { WARDROBE_SLOT_TYPES, type WardrobeItem, type WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import type {
  CreateProjectWardrobeInput,
  UseProjectWardrobeReturn,
} from '@/app/prospero/[id]/hooks/useProjectWardrobe'

interface ProjectWardrobeManagerProps {
  mutator: UseProjectWardrobeReturn
  emptyMessage?: string
}

interface DraftState {
  title: string
  description: string
  imagePrompt: string
  types: WardrobeItemType[]
  appropriateness: string
  isDefault: boolean
  replace: boolean
  componentItemIds: string[]
}

const EMPTY_DRAFT: DraftState = {
  title: '',
  description: '',
  imagePrompt: '',
  types: ['top'],
  appropriateness: '',
  isDefault: false,
  replace: false,
  componentItemIds: [],
}

function draftFromItem(item: WardrobeItem): DraftState {
  return {
    title: item.title,
    description: item.description ?? '',
    imagePrompt: item.imagePrompt ?? '',
    types: item.types.slice(),
    appropriateness: item.appropriateness ?? '',
    isDefault: item.isDefault ?? false,
    replace: item.replace ?? false,
    componentItemIds: item.componentItemIds?.slice() ?? [],
  }
}

export function ProjectWardrobeManager({
  mutator,
  emptyMessage = "No project wardrobe yet. Add a garment and every character in this project's chats can wear it.",
}: ProjectWardrobeManagerProps) {
  const { items, loading, error, createItem, updateItem, deleteItem } = mutator

  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const formOpen = creating || editingId !== null

  const componentChoices = useMemo(
    () => items.filter((i) => i.id !== editingId),
    [items, editingId],
  )

  const openCreate = useCallback(() => {
    setEditingId(null)
    setCreating(true)
    setDraft(EMPTY_DRAFT)
    setActionError(null)
  }, [])

  const openEdit = useCallback((item: WardrobeItem) => {
    setCreating(false)
    setEditingId(item.id)
    setDraft(draftFromItem(item))
    setActionError(null)
  }, [])

  const closeForm = useCallback(() => {
    setCreating(false)
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setActionError(null)
  }, [])

  const toggleType = useCallback((type: WardrobeItemType) => {
    setDraft((prev) => {
      const has = prev.types.includes(type)
      const next = has ? prev.types.filter((t) => t !== type) : [...prev.types, type]
      // Always keep at least one type selected.
      return { ...prev, types: next.length > 0 ? next : prev.types }
    })
  }, [])

  const toggleComponent = useCallback((id: string) => {
    setDraft((prev) => {
      const has = prev.componentItemIds.includes(id)
      return {
        ...prev,
        componentItemIds: has
          ? prev.componentItemIds.filter((c) => c !== id)
          : [...prev.componentItemIds, id],
      }
    })
  }, [])

  const handleSave = useCallback(async () => {
    const title = draft.title.trim()
    if (!title) {
      setActionError('Title is required.')
      return
    }
    if (draft.types.length === 0) {
      setActionError('Choose at least one slot.')
      return
    }
    setSaving(true)
    setActionError(null)
    const payload: CreateProjectWardrobeInput = {
      title,
      description: draft.description.trim() || null,
      imagePrompt: draft.imagePrompt.trim() || null,
      types: draft.types,
      appropriateness: draft.appropriateness.trim() || null,
      isDefault: draft.isDefault,
      replace: draft.replace,
      componentItemIds: draft.componentItemIds,
    }
    const result = editingId
      ? await updateItem(editingId, payload)
      : await createItem(payload)
    setSaving(false)
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    closeForm()
  }, [draft, editingId, createItem, updateItem, closeForm])

  const handleDelete = useCallback(
    async (item: WardrobeItem) => {
      const confirmed = await showConfirmation(
        `Delete project wardrobe item "${item.title}"? This cannot be undone.`,
      )
      if (!confirmed) return
      setActionError(null)
      const result = await deleteItem(item.id)
      if (!result.ok) setActionError(result.error)
    },
    [deleteItem],
  )

  return (
    <div className="space-y-3">
      {actionError && (
        <div className="qt-alert-error" role="alert">
          {actionError}
        </div>
      )}
      {error && (
        <div className="qt-alert-error" role="alert">
          {error}
        </div>
      )}

      {!formOpen && (
        <div className="flex justify-end">
          <button onClick={openCreate} className="qt-button qt-button-primary qt-button-sm">
            + New wardrobe item
          </button>
        </div>
      )}

      {formOpen && (
        <div className="qt-bg-muted qt-border qt-border-default rounded p-4 space-y-3">
          <div>
            <label className="qt-label block mb-1">Title</label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
              className="qt-input w-full"
              placeholder="e.g. House livery jacket"
            />
          </div>

          <div>
            <label className="qt-label block mb-1">Description</label>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
              className="qt-input w-full"
              rows={2}
              placeholder="What it looks like / how it's worn"
            />
          </div>

          <div>
            <label className="qt-label block mb-1">Portrait Cue (optional)</label>
            <input
              type="text"
              value={draft.imagePrompt}
              onChange={(e) => setDraft((p) => ({ ...p, imagePrompt: e.target.value }))}
              className="qt-input w-full"
              maxLength={200}
              placeholder="e.g. intricate burnished-gold circular rank glyph on the shoulder"
            />
            <p className="mt-1 qt-text-xs qt-text-secondary">
              A short, literal phrase whispered to the portraitist and the Lantern in place of the
              title, should the bare name fail to conjure the right picture. The Description above is
              for human eyes and never reaches the easel. Leave it empty to let the title speak.
            </p>
          </div>

          <div>
            <label className="qt-label block mb-1">Slots covered</label>
            <div className="flex flex-wrap gap-3">
              {WARDROBE_SLOT_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-1.5 qt-text-small">
                  <input
                    type="checkbox"
                    checked={draft.types.includes(type)}
                    onChange={() => toggleType(type)}
                    className="qt-checkbox"
                  />
                  {type}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="qt-label block mb-1">Appropriateness (optional)</label>
            <input
              type="text"
              value={draft.appropriateness}
              onChange={(e) => setDraft((p) => ({ ...p, appropriateness: e.target.value }))}
              className="qt-input w-full"
              placeholder="e.g. formal, on-duty"
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 qt-text-small">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(e) => setDraft((p) => ({ ...p, isDefault: e.target.checked }))}
                className="qt-checkbox"
              />
              Worn by default by every character in this project
            </label>
            <label className="flex items-center gap-1.5 qt-text-small">
              <input
                type="checkbox"
                checked={draft.replace}
                onChange={(e) => setDraft((p) => ({ ...p, replace: e.target.checked }))}
                className="qt-checkbox"
              />
              Replace slots on wear (composite)
            </label>
          </div>

          {componentChoices.length > 0 && (
            <div>
              <label className="qt-label block mb-1">
                Bundle other project items (composite — optional)
              </label>
              <div className="max-h-40 overflow-y-auto qt-border qt-border-default rounded p-2 space-y-1">
                {componentChoices.map((choice) => (
                  <label key={choice.id} className="flex items-center gap-1.5 qt-text-small">
                    <input
                      type="checkbox"
                      checked={draft.componentItemIds.includes(choice.id)}
                      onChange={() => toggleComponent(choice.id)}
                      className="qt-checkbox"
                    />
                    <span className="truncate">{choice.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={closeForm} className="qt-button qt-button-ghost qt-button-sm" disabled={saving}>
              Cancel
            </button>
            <button onClick={handleSave} className="qt-button qt-button-primary qt-button-sm" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create item'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="qt-text-secondary text-sm">Loading project wardrobe…</p>
      ) : items.length === 0 ? (
        <p className="qt-text-secondary text-sm">{emptyMessage}</p>
      ) : (
        <ul className="divide-y qt-border-default">
          {items.map((item) => (
            <li key={item.id} className="py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h4 className="qt-label truncate">{item.title}</h4>
                  <span className="qt-text-xs qt-text-secondary truncate">{item.types.join(', ')}</span>
                  {item.componentItemIds && item.componentItemIds.length > 0 && (
                    <span className="qt-badge qt-text-secondary">Composite</span>
                  )}
                  {item.isDefault && <span className="qt-badge qt-badge-primary">Default</span>}
                  {item.archivedAt && <span className="qt-badge qt-text-secondary">Archived</span>}
                </div>
                {/* Prefer the Portrait Cue (the image-maker's view); fall back to the prose description. */}
                {(item.imagePrompt || item.description) && (
                  <p className="qt-text-small qt-text-secondary mt-1">
                    {item.imagePrompt || item.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openEdit(item)}
                  className="qt-button qt-button-ghost qt-button-sm"
                  title="Edit item"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(item)}
                  className="qt-button qt-button-ghost qt-button-sm qt-text-destructive"
                  title="Delete item"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
