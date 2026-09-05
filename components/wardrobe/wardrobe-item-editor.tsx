'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import FormActions from '@/components/ui/FormActions'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { unionTypes } from '@/lib/wardrobe/composite-types'
import { charCountClass } from '@/lib/utils/char-count'
import {
  GENERAL_CONTAINER,
  wardrobeCollectionUrl,
  wardrobeItemUrl,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import { WardrobeComponentPicker } from './wardrobe-item-editor/WardrobeComponentPicker'
import { WardrobeModeChangePrompt } from './wardrobe-item-editor/WardrobeModeChangePrompt'
import type { CandidateItem, CandidateGroup } from './wardrobe-item-editor/types'
import { GROUP_ORDER, getCandidateGroup } from './wardrobe-item-editor/constants'

type EditorMode = 'single' | 'bundle'

/** Where a newly-created wardrobe item is written. */
export type WardrobeCreateScope = 'character' | 'global' | 'project'

interface WardrobeItemEditorProps {
  /** Owning character — null when the editor is opened on a shared container. */
  characterId: string | null
  item?: WardrobeItem | null
  /** Whether this item is being created/edited as a shared item */
  isShared?: boolean
  /**
   * Project context (the chat's project). When present, the create-scope
   * selector offers a "this project" destination for new shared items.
   */
  projectId?: string | null
  /**
   * The container the wardrobe dialog is browsing. When it is a shared
   * container (General / a project / a group), the editor is pinned to it:
   * creates POST into it, edits PUT back to it, and the character-view
   * "Add to" selector is replaced by a destination note. Character scope (or
   * absent) keeps the classic character-view behaviour.
   */
  container?: WardrobeContainer | null
  /** Display name for `container`, e.g. the project or group name. */
  containerLabel?: string
  /** Pre-populated component IDs (used by Save-as-outfit from the Outfit Builder). */
  initialComponentItemIds?: string[]
  /** Force a starting mode (used by Save-as-outfit to open in bundle mode). */
  initialMode?: EditorMode
  /** Focus the title field on mount (used by Save-as-outfit). */
  autoFocusTitle?: boolean
  onClose: () => void
  onSave: () => void
}

export function WardrobeItemEditor({
  characterId,
  item,
  isShared: isSharedProp = false,
  projectId = null,
  container = null,
  containerLabel,
  initialComponentItemIds,
  initialMode,
  autoFocusTitle = false,
  onClose,
  onSave,
}: WardrobeItemEditorProps) {
  const isEditing = !!item
  // A non-character container pins the editor to that container's endpoints.
  const sharedContainer = container && container.scope !== 'character' ? container : null
  // Whether the item lives in a shared tier (Quilltap General or a project
  // store) rather than a character vault. On edit this is fixed by the item's
  // own tier; on create the "Add to" selector (`createScope`) governs routing,
  // and this only seeds the notice / default selector.
  const existingIsShared = isEditing && !item.characterId
  const isShared = isSharedProp || existingIsShared
  // Destination for a NEW item: this character, shared-everywhere (Quilltap
  // General), or this project's store. Only meaningful when creating; editing
  // keeps an item in its existing tier.
  const [createScope, setCreateScope] = useState<WardrobeCreateScope>(
    isSharedProp ? 'global' : 'character',
  )

  // A default garment is put on at the start of every chat by every character
  // that can reach it — so the checkbox's promise depends on where the item is
  // headed. On edit we know only that the item is shared (General vs project
  // isn't recorded on the item itself), so that copy stays deliberately broad.
  const defaultOutfitLabel = isEditing
    ? isShared
      ? 'Worn by default by every character who can reach this item'
      : "Part of this character's default outfit"
    : sharedContainer
      ? sharedContainer.scope === 'general'
        ? 'Worn by default by every character'
        : sharedContainer.scope === 'project'
          ? 'Worn by default by every character in this project'
          : 'Worn by default by every character in this group'
      : createScope === 'global'
        ? 'Worn by default by every character'
        : createScope === 'project'
          ? 'Worn by default by every character in this project'
          : "Part of this character's default outfit"

  const { formData, handleChange } = useFormState({
    title: item?.title || '',
    description: item?.description || '',
    imagePrompt: item?.imagePrompt || '',
    appropriateness: item?.appropriateness || '',
    isDefault: item?.isDefault || false,
  })

  const [selectedTypes, setSelectedTypes] = useState<WardrobeItemType[]>(
    item?.types || []
  )
  const [componentItemIds, setComponentItemIds] = useState<string[]>(
    initialComponentItemIds ?? item?.componentItemIds ?? [],
  )
  // Composite equip behaviour. `replace: false` (default) = additive layering;
  // `true` = clear the designated slots first. `bundleDesignatedTypes` lets a
  // replace-composite designate slots beyond its components' union (e.g. Naked
  // covering every clothing slot but only containing a ring); seeded from the stored
  // types, with the component union always forced in at save time.
  const [replace, setReplace] = useState<boolean>(item?.replace ?? false)
  const [bundleDesignatedTypes, setBundleDesignatedTypes] = useState<WardrobeItemType[]>(
    item?.types ?? [],
  )
  // Editor mode is independent of `componentItemIds` so the user can switch
  // between single garment and outfit bundle without immediately mutating
  // the data. The toggle handler enforces consistency on transitions.
  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    if (initialMode) return initialMode
    const seedComponents = initialComponentItemIds ?? item?.componentItemIds ?? []
    if (seedComponents.length > 0) return 'bundle'
    return 'single'
  })

  const [candidates, setCandidates] = useState<CandidateItem[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [componentSearch, setComponentSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<CandidateGroup>>(
    () => new Set<CandidateGroup>(GROUP_ORDER),
  )

  // Validation timing: errors only after submit attempt or focus-then-blur.
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [touched, setTouched] = useState<{
    title?: boolean
    types?: boolean
    components?: boolean
  }>({})

  // Confirmation modal for bundle → single with components present.
  const [showKeepResetPrompt, setShowKeepResetPrompt] = useState(false)

  const { loading: saving, execute: executeSave, clearError } = useAsyncOperation<void>()

  // Adapter so MarkdownLexicalEditor's (value: string) => void onChange feeds
  // useFormState's event-based handleChange.
  const handleMarkdownDescriptionChange = (value: string) => {
    handleChange({
      target: { name: 'description', value },
    } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
  }

  const titleInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocusTitle) titleInputRef.current?.focus()
  }, [autoFocusTitle])

  // Load candidate items so the user can pick components for a composite. In
  // the character view: this character's wardrobe + project + shared
  // archetypes. Pinned to a shared container: that container's items + the
  // General archetypes (General alone when it *is* the container). We do this
  // once on mount; adding fresh items mid-edit is rare and a re-open will
  // refresh.
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setCandidatesLoading(true)
      try {
        const [personalRes, projectRes, archetypeRes] = await Promise.all([
          sharedContainer
            ? sharedContainer.scope === 'general'
              ? Promise.resolve(null)
              : fetch(wardrobeCollectionUrl(sharedContainer))
            : characterId
              ? fetch(wardrobeCollectionUrl({ scope: 'character', id: characterId }))
              : Promise.resolve(null),
          !sharedContainer && projectId
            ? fetch(wardrobeCollectionUrl({ scope: 'project', id: projectId }))
            : Promise.resolve(null),
          fetch(wardrobeCollectionUrl(GENERAL_CONTAINER)),
        ])

        const collected: CandidateItem[] = []
        const pushCandidates = (list: WardrobeItem[] | undefined, shared: boolean) => {
          for (const w of list ?? []) {
            if (collected.some((c) => c.id === w.id)) continue
            collected.push({
              id: w.id,
              title: w.title,
              types: w.types,
              componentItemIds: Array.isArray(w.componentItemIds) ? w.componentItemIds : [],
              isShared: shared,
            })
          }
        }
        if (personalRes && personalRes.ok) {
          const data = (await personalRes.json()) as { wardrobeItems?: WardrobeItem[] }
          // In a shared container this first fetch IS the container's list;
          // its items are the local (manageable) set, not shared imports.
          pushCandidates(data.wardrobeItems, false)
        }
        if (projectRes && projectRes.ok) {
          const data = (await projectRes.json()) as { wardrobeItems?: WardrobeItem[] }
          pushCandidates(data.wardrobeItems, true)
        }
        if (archetypeRes.ok) {
          const data = (await archetypeRes.json()) as { wardrobeItems?: WardrobeItem[] }
          pushCandidates(data.wardrobeItems, true)
        }
        if (!cancelled) setCandidates(collected)
      } catch (err) {
        if (!cancelled) {
          console.warn('[WardrobeItemEditor] Failed to load candidate items', err)
          setCandidates([])
        }
      } finally {
        if (!cancelled) setCandidatesLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedContainer is derived from container; key on its parts
  }, [characterId, projectId, container?.scope, container?.id])

  /**
   * Items the user can pick as components, excluding:
   *  - this item itself (self-reference is a trivial cycle)
   *  - items that already reference this item as a component (direct parents,
   *    which would make a cycle on save — server enforces this anyway)
   */
  const eligibleCandidates = useMemo<CandidateItem[]>(() => {
    const excluded = new Set<string>()
    if (item) {
      excluded.add(item.id)
      for (const c of candidates) {
        if (c.componentItemIds.includes(item.id)) excluded.add(c.id)
      }
    }
    const search = componentSearch.trim().toLowerCase()
    return candidates
      .filter((c) => !excluded.has(c.id))
      .filter((c) => (search ? c.title.toLowerCase().includes(search) : true))
  }, [candidates, item, componentSearch])

  const groupedCandidates = useMemo(() => {
    const map = new Map<CandidateGroup, CandidateItem[]>()
    for (const g of GROUP_ORDER) map.set(g, [])
    for (const c of eligibleCandidates) {
      const group = getCandidateGroup(c)
      map.get(group)!.push(c)
    }
    return map
  }, [eligibleCandidates])

  const isBundle = editorMode === 'bundle'

  // Auto-compute types from components when in bundle mode with components.
  // The server runs the exact same union; we mirror it here so the UI always
  // shows what's about to be saved.
  const computedTypes = useMemo<WardrobeItemType[]>(() => {
    if (componentItemIds.length === 0) return []
    const components = candidates.filter((c) => componentItemIds.includes(c.id))
    return unionTypes(components)
  }, [candidates, componentItemIds])

  // Bundle coverage = the component union, optionally widened (for a replace
  // composite) by the slots the user designates. Additive composites only ever
  // cover their union. In single mode, types are always user-selected.
  const effectiveTypes = isBundle
    ? replace
      ? WARDROBE_SLOT_TYPES.filter(
          (s) => computedTypes.includes(s) || bundleDesignatedTypes.includes(s),
        )
      : computedTypes
    : selectedTypes

  const handleTypeToggle = (type: WardrobeItemType): void => {
    if (isBundle) {
      // Only a replace composite designates slots, and only beyond the
      // component union — union slots are always covered (locked on).
      if (!replace) return
      if (computedTypes.includes(type)) return
      setBundleDesignatedTypes((prev) =>
        prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
      )
      return
    }
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    )
  }

  const toggleComponent = (id: string): void => {
    setComponentItemIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  const toggleGroup = (group: CandidateGroup): void => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const handleModeChange = (next: EditorMode): void => {
    if (next === editorMode) return
    if (next === 'single' && componentItemIds.length > 0) {
      // Need explicit decision about what to do with the existing components
      // and their derived types.
      setShowKeepResetPrompt(true)
      return
    }
    setEditorMode(next)
  }

  const handleConfirmKeepTypes = (): void => {
    // Drop the components but lock in the types they had been computing.
    setSelectedTypes(computedTypes)
    setComponentItemIds([])
    setEditorMode('single')
    setShowKeepResetPrompt(false)
  }

  const handleConfirmReset = (): void => {
    setSelectedTypes([])
    setComponentItemIds([])
    setEditorMode('single')
    setShowKeepResetPrompt(false)
  }

  // Validation flags — surfaced only after submit attempt or field blur.
  const showTitleError =
    !formData.title.trim() && (submitAttempted || !!touched.title)
  const showTypesError =
    !isBundle &&
    selectedTypes.length === 0 &&
    (submitAttempted || !!touched.types)
  const showComponentsError =
    isBundle &&
    componentItemIds.length === 0 &&
    (submitAttempted || !!touched.components)

  const isSaveDisabled =
    !formData.title.trim() ||
    (!isBundle && selectedTypes.length === 0) ||
    (isBundle && componentItemIds.length === 0)

  const handleSave = async (): Promise<void> => {
    setSubmitAttempted(true)
    if (!formData.title.trim()) {
      showErrorToast('Enter a title')
      return
    }
    if (!isBundle && selectedTypes.length === 0) {
      showErrorToast('Select at least one type')
      return
    }
    if (isBundle && componentItemIds.length === 0) {
      showErrorToast('Add at least one component')
      return
    }
    if (isBundle && computedTypes.length === 0) {
      showErrorToast('Selected components do not cover any slots')
      return
    }

    clearError()

    await executeSave(async () => {
      const typesToSave = isBundle ? effectiveTypes : selectedTypes
      const componentsToSave = isBundle ? componentItemIds : []

      const payload: Record<string, unknown> = {
        title: formData.title,
        description: formData.description || null,
        imagePrompt: formData.imagePrompt || null,
        types: typesToSave,
        appropriateness: formData.appropriateness || null,
        isDefault: formData.isDefault,
        componentItemIds: componentsToSave,
        // `replace` is composite-only; leaf items always replace their slots.
        replace: isBundle ? replace : false,
      }

      // Route to the correct API endpoint. Pinned to a shared container, both
      // edits and creates target that container's own routes — an edit must
      // never leak a project or group item into Quilltap General. Otherwise
      // (character view): editing keeps the item in its existing tier and
      // creating honours the chosen destination scope.
      let url: string
      if (sharedContainer) {
        url = isEditing
          ? wardrobeItemUrl(sharedContainer, item.id)
          : wardrobeCollectionUrl(sharedContainer)
      } else if (isEditing) {
        url = wardrobeItemUrl(
          isShared ? GENERAL_CONTAINER : { scope: 'character', id: characterId },
          item.id,
        )
      } else if (createScope === 'project' && projectId) {
        url = wardrobeCollectionUrl({ scope: 'project', id: projectId })
      } else if (createScope === 'global') {
        url = wardrobeCollectionUrl(GENERAL_CONTAINER)
      } else {
        url = wardrobeCollectionUrl({ scope: 'character', id: characterId })
      }
      const method = isEditing ? 'PUT' : 'POST'

      const result = await fetchJson<{ id: string }>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        const errorMessage = result.error || 'Failed to save wardrobe item'
        showErrorToast(errorMessage)
        throw new Error(errorMessage)
      }

      showSuccessToast(isEditing ? 'Wardrobe item updated' : 'Wardrobe item created')
      onSave()
    })
  }

  const selectedComponents = useMemo(() => {
    return componentItemIds
      .map((id) => candidates.find((c) => c.id === id))
      .filter((c): c is CandidateItem => Boolean(c))
  }, [candidates, componentItemIds])

  return (
    <>
      {/* Overlay — z values sit above the qt-dialog-overlay (z-[60]) so this
          editor always stacks on top when summoned from another dialog. */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-[70]"
        onClick={onClose}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog */}
      <div
        className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[80] pointer-events-auto"
        style={{ width: 'min(var(--qt-page-max-width), calc(100vw - 2rem))' }}
      >
        <div className="qt-dialog qt-dialog-wide max-h-[90vh] overflow-y-auto flex flex-col">
          <div className="qt-dialog-header sticky top-0 flex-shrink-0 qt-bg-default border-b qt-border-default">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">
                {isEditing ? 'Edit Wardrobe Item' : 'New Wardrobe Item'}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="qt-text-secondary hover:text-foreground"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="qt-dialog-body space-y-4 flex-1">
            {/* Pinned destination — creating inside a shared container always
                saves into that container; no scope to choose. */}
            {!isEditing && sharedContainer && (
              <div>
                <span className="qt-label mb-1 block">Add to</span>
                <p className="text-sm text-foreground">
                  {containerLabel ??
                    (sharedContainer.scope === 'general'
                      ? 'Quilltap General'
                      : sharedContainer.scope === 'project'
                        ? 'This project'
                        : 'This group')}
                </p>
                <p className="qt-text-xs qt-text-secondary mt-1">
                  {sharedContainer.scope === 'general'
                    ? 'Every character, in every chat, can wear it.'
                    : sharedContainer.scope === 'project'
                      ? "Every character in this project's chats can wear it."
                      : 'Every character in this group can wear it.'}
                </p>
              </div>
            )}

            {/* Destination scope — only when creating. Editing keeps an item in
                its existing tier. */}
            {!isEditing && !sharedContainer && (
              <div>
                <span className="qt-label mb-2 block">Add to</span>
                <div
                  role="radiogroup"
                  aria-label="Where to save this item"
                  className="inline-flex flex-wrap gap-1 qt-bg-muted/50 rounded-lg p-1"
                >
                  {([
                    { scope: 'character' as const, label: 'This character' },
                    { scope: 'global' as const, label: 'Shared — everywhere' },
                    ...(projectId
                      ? [{ scope: 'project' as const, label: 'Shared — this project' }]
                      : []),
                  ]).map(({ scope, label }) => (
                    <button
                      key={scope}
                      type="button"
                      role="radio"
                      aria-checked={createScope === scope}
                      onClick={() => setCreateScope(scope)}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                        createScope === scope
                          ? 'qt-bg-default text-foreground shadow-sm'
                          : 'qt-text-secondary hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="qt-text-xs qt-text-secondary mt-1">
                  {createScope === 'character'
                    ? 'Only this character can wear it.'
                    : createScope === 'project'
                      ? "Every character in this project's chats can wear it."
                      : 'Every character, in every chat, can wear it.'}
                </p>
              </div>
            )}

            {/* Mode toggle — Single garment vs. Outfit bundle */}
            <div
              role="tablist"
              aria-label="Wardrobe item kind"
              className="inline-flex gap-1 qt-bg-muted/50 rounded-lg p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={editorMode === 'single'}
                onClick={() => handleModeChange('single')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  editorMode === 'single'
                    ? 'qt-bg-default text-foreground shadow-sm'
                    : 'qt-text-secondary hover:text-foreground'
                }`}
              >
                Single garment
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editorMode === 'bundle'}
                onClick={() => handleModeChange('bundle')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  editorMode === 'bundle'
                    ? 'qt-bg-default text-foreground shadow-sm'
                    : 'qt-text-secondary hover:text-foreground'
                }`}
              >
                Outfit bundle
              </button>
            </div>

            {/* Shared item notice */}
            {isShared && isEditing && (
              <div className="rounded border qt-border-warning/50 qt-bg-warning/10 px-3 py-2 qt-text-small qt-text-warning">
                Changes to shared items affect all characters
              </div>
            )}

            {/* Title */}
            <div>
              <label htmlFor="wardrobe-title" className="qt-label mb-1">
                Title *
              </label>
              <input
                ref={titleInputRef}
                type="text"
                id="wardrobe-title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                required
                placeholder={
                  isBundle
                    ? 'e.g., Working Outfit, Sunday Best'
                    : 'e.g., Charcoal Sweater'
                }
                className="qt-input"
              />
              {showTitleError && (
                <p className="mt-1 text-xs qt-text-destructive">Enter a title</p>
              )}
            </div>

            {/* Single mode: Types checkboxes */}
            {!isBundle && (
              <div>
                <span className="qt-label mb-2 block">Type(s) *</span>
                <div
                  className="flex flex-wrap gap-3"
                  onBlur={() => setTouched((t) => ({ ...t, types: true }))}
                >
                  {WARDROBE_SLOT_TYPES.map((type) => {
                    const checked = selectedTypes.includes(type)
                    return (
                      <label
                        key={type}
                        className="inline-flex items-center gap-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleTypeToggle(type)}
                          className="qt-checkbox"
                        />
                        <span className="text-sm capitalize text-foreground">{type}</span>
                      </label>
                    )
                  })}
                </div>
                {showTypesError && (
                  <p className="mt-1 text-xs qt-text-destructive">
                    Select at least one type
                  </p>
                )}
              </div>
            )}

            {/* Bundle mode: Components section */}
            {isBundle && (
              <WardrobeComponentPicker
                effectiveTypes={effectiveTypes}
                selectedComponents={selectedComponents}
                componentSearch={componentSearch}
                candidatesLoading={candidatesLoading}
                candidates={candidates}
                eligibleCandidates={eligibleCandidates}
                groupedCandidates={groupedCandidates}
                expandedGroups={expandedGroups}
                componentItemIds={componentItemIds}
                replace={replace}
                computedTypes={computedTypes}
                showComponentsError={showComponentsError}
                onComponentSearchChange={setComponentSearch}
                onComponentsBlur={() => setTouched((t) => ({ ...t, components: true }))}
                onToggleComponent={toggleComponent}
                onToggleGroup={toggleGroup}
                onToggleType={handleTypeToggle}
                onReplaceChange={setReplace}
              />
            )}

            {/* Default-outfit toggle. Whether an item is shared is governed by
                the "Add to" selector at the top (create) or the item's existing
                tier (edit) — there is no separate "shared" checkbox. */}
            <div>
              <label className="inline-flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="isDefault"
                  checked={formData.isDefault}
                  onChange={handleChange}
                  className="qt-checkbox mt-0.5"
                />
                <span className="text-sm text-foreground">{defaultOutfitLabel}</span>
              </label>
            </div>

            {/* Appropriateness */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="wardrobe-appropriateness" className="qt-label">
                  Appropriateness
                </label>
                <span className={`text-xs ${charCountClass(formData.appropriateness.length, 200)}`}>
                  {formData.appropriateness.length}/200
                </span>
              </div>
              <input
                type="text"
                id="wardrobe-appropriateness"
                name="appropriateness"
                value={formData.appropriateness}
                onChange={handleChange}
                maxLength={200}
                placeholder="e.g., formal, casual, intimate, combat"
                className="qt-input"
              />
              <p className="mt-1 text-xs qt-text-small">
                When is this appropriate to wear? e.g., formal, casual, intimate, combat.
              </p>
            </div>

            {/* Portrait cue — plain-text phrase handed to the image-makers. */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="wardrobe-image-prompt" className="qt-label">
                  Portrait Cue
                </label>
                <span className={`text-xs ${charCountClass(formData.imagePrompt.length, 200)}`}>
                  {formData.imagePrompt.length}/200
                </span>
              </div>
              <input
                type="text"
                id="wardrobe-image-prompt"
                name="imagePrompt"
                value={formData.imagePrompt}
                onChange={handleChange}
                maxLength={200}
                placeholder="e.g., intricate burnished-gold circular rank glyph on the shoulder"
                className="qt-input"
              />
              <p className="mt-1 text-xs qt-text-small">
                A short, literal phrase whispered to the portraitist and the Lantern when a likeness
                is drawn --- used <em>in place of</em> the title above, should the bare name fail to
                conjure the right picture. Keep it terse and visual; the flowery Description below is
                for human eyes and never reaches the easel. Leave it empty to let the title speak.
              </p>
            </div>

            {/* Description (Markdown) */}
            <div>
              <label htmlFor="wardrobe-description" className="block text-sm qt-text-primary mb-1">
                Description
              </label>
              <p className="text-xs qt-text-secondary mb-2">
                Describe the item in detail.
              </p>
              <MarkdownLexicalEditor
                value={formData.description}
                onChange={handleMarkdownDescriptionChange}
                namespace="WardrobeItem.description"
                ariaLabel="Wardrobe item description"
                minHeight="10rem"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer flex-shrink-0">
            <FormActions
              onCancel={onClose}
              onSubmit={handleSave}
              submitLabel={isEditing ? 'Update' : 'Create'}
              cancelLabel="Cancel"
              isLoading={saving}
              isDisabled={isSaveDisabled}
            />
          </div>
        </div>
      </div>

      {/* Bundle → Single confirmation prompt */}
      {showKeepResetPrompt && (
        <WardrobeModeChangePrompt
          componentCount={componentItemIds.length}
          onCancel={() => setShowKeepResetPrompt(false)}
          onReset={handleConfirmReset}
          onKeepTypes={handleConfirmKeepTypes}
        />
      )}
    </>
  )
}
