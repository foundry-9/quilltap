'use client'

import { useRoleplayTemplates } from './hooks/useRoleplayTemplates'
import { TemplateCard } from './TemplateCard'
import { EMPTY_DELIMITER } from './types'
import type { DelimiterFormEntry } from './types'
import type { DelimiterAddOns } from '@/lib/schemas/template.types'
import { DEFAULT_TAG_TOKEN_PATTERN } from '@/lib/schemas/template.types'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { PromptFieldLabel } from '@/components/prompt-fields/PromptFieldLabel'
import { PROMPT_FIELD_HINTS } from '@/components/prompt-fields/field-hints'

/** Known CSS style options for delimiter entries */
const STYLE_OPTIONS = [
  { value: 'qt-chat-narration', label: 'Narration' },
  { value: 'qt-chat-dialogue', label: 'Dialogue' },
  { value: 'qt-chat-ooc', label: 'Out of Character' },
  { value: 'qt-chat-inner-monologue', label: 'Inner Monologue' },
  { value: 'qt-roleplay-1', label: 'Style 1 (high contrast)' },
  { value: 'qt-roleplay-2', label: 'Style 2 (high contrast)' },
  { value: 'qt-roleplay-3', label: 'Style 3 (high contrast)' },
  { value: 'qt-roleplay-4', label: 'Style 4 (high contrast)' },
  { value: 'qt-roleplay-danger', label: 'Danger' },
  { value: 'qt-roleplay-warning', label: 'Warning' },
  { value: 'qt-roleplay-success', label: 'Success' },
  { value: 'qt-roleplay-info', label: 'Info' },
  { value: 'qt-roleplay-muted', label: 'Muted' },
  { value: 'qt-roleplay-code', label: 'Code' },
]

/** Font choices offered by the per-delimiter add-on dropdown. */
const FONT_OPTIONS: { value: DelimiterAddOns['font']; label: string }[] = [
  { value: '', label: 'Default' },
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
  { value: 'display', label: 'Display' },
  { value: 'script', label: 'Script' },
]

export default function RoleplayTemplatesTab() {
  const {
    templates,
    defaultTemplateId,
    loading,
    saving,
    defaultSaving,
    error,
    success,
    isModalOpen,
    editingTemplate,
    formData,
    previewTemplate,
    deleteConfirm,
    openCreateModal,
    openEditModal,
    closeModal,
    setPreviewTemplate,
    setDeleteConfirm,
    setFormData,
    handleDefaultTemplateChange,
    handleSave,
    handleDelete,
    handleCopyAsNew,
    appendFormattingHint,
  } = useRoleplayTemplates()

  const builtInTemplates = templates.filter(t => t.isBuiltIn)
  const userTemplates = templates.filter(t => !t.isBuiltIn)

  // Delimiter form helpers
  const addDelimiter = () => {
    setFormData(prev => ({
      ...prev,
      delimiters: [...prev.delimiters, { ...EMPTY_DELIMITER }],
    }))
  }

  const removeDelimiter = (index: number) => {
    setFormData(prev => ({
      ...prev,
      delimiters: prev.delimiters.filter((_, i) => i !== index),
    }))
  }

  const updateDelimiter = (index: number, field: keyof DelimiterFormEntry, value: string) => {
    setFormData(prev => ({
      ...prev,
      delimiters: prev.delimiters.map((d, i) => {
        if (i !== index) return d
        const updated = { ...d, [field]: value } as DelimiterFormEntry
        // Sync close delimiter in single mode (wrap only)
        if (field === 'delimiterOpen' && d.delimiterMode === 'single') {
          updated.delimiterClose = value
        }
        if (field === 'delimiterMode' && value === 'single') {
          updated.delimiterClose = updated.delimiterOpen
        }
        // Seed the token pattern the first time a rule becomes a tag prefix.
        if (field === 'kind' && value === 'tagPrefix' && !updated.tokenPattern.trim()) {
          updated.tokenPattern = DEFAULT_TAG_TOKEN_PATTERN
        }
        return updated
      }),
    }))
  }

  // Set a non-string delimiter field (e.g. the hideDelimiter checkbox).
  const setDelimiterFields = (index: number, patch: Partial<DelimiterFormEntry>) => {
    setFormData(prev => ({
      ...prev,
      delimiters: prev.delimiters.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    }))
  }

  // Patch a single add-on for a delimiter.
  const updateAddOn = <K extends keyof DelimiterAddOns>(
    index: number,
    key: K,
    value: DelimiterAddOns[K],
  ) => {
    setFormData(prev => ({
      ...prev,
      delimiters: prev.delimiters.map((d, i) =>
        i === index ? { ...d, addOns: { ...d.addOns, [key]: value } } : d,
      ),
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="qt-text-secondary">Loading templates...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="qt-alert-error">
          {error}
        </div>
      )}

      {success && (
        <div className="qt-alert-success">
          {success}
        </div>
      )}

      {/* Default Template Section */}
      <section className="border qt-border-default rounded-lg p-4 qt-bg-card">
        <h2 className="qt-heading-4 mb-2">Default Template</h2>
        <p className="qt-text-small mb-4">
          This template will be applied to all new chats by default. You can override it per-character or per-chat.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px] max-w-md">
            <label className="qt-label mb-1">
              Template for New Chats
            </label>
            <select
              value={defaultTemplateId || ''}
              onChange={(e) => handleDefaultTemplateChange(e.target.value || null)}
              disabled={defaultSaving || loading}
              className="qt-select"
            >
              <option value="">None (no formatting template)</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}{template.isBuiltIn ? ' (Built-in)' : ''}
                </option>
              ))}
            </select>
          </div>
          {defaultSaving && (
            <span className="qt-text-small">Saving...</span>
          )}
        </div>
      </section>

      {/* Built-in Templates Section */}
      <section>
        <h2 className="qt-heading-3 mb-2">Built-in Templates</h2>
        <p className="qt-text-small mb-4">
          These templates are provided by Quilltap and cannot be modified. You can copy them to create your own version.
        </p>

        {builtInTemplates.length === 0 ? (
          <div className="qt-text-small border border-dashed qt-border-default rounded-lg p-4">
            No built-in templates available.
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {builtInTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                isBuiltIn={true}
                onPreview={setPreviewTemplate}
                onCopyAsNew={handleCopyAsNew}
              />
            ))}
          </div>
        )}
      </section>

      {/* User Templates Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="qt-heading-3">My Templates</h2>
            <p className="qt-text-small mt-1">
              Custom templates you&apos;ve created for your roleplay sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="qt-button qt-button-primary px-4 py-2 rounded-md"
          >
            Create Template
          </button>
        </div>

        {userTemplates.length === 0 ? (
          <div className="qt-text-small border border-dashed qt-border-default rounded-lg p-4">
            No custom templates yet. Create one to define your own roleplay formatting style.
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {userTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                isBuiltIn={false}
                onPreview={setPreviewTemplate}
                onEdit={openEditModal}
                onDelete={() => setDeleteConfirm(template.id)}
                deleteConfirm={deleteConfirm}
                onConfirmDelete={handleDelete}
                onCancelDelete={() => setDeleteConfirm(null)}
                saving={saving}
              />
            ))}
          </div>
        )}
      </section>

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="qt-dialog-overlay">
          <div className="bg-background border qt-border-default rounded-lg qt-shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="p-6">
              <h2 className="qt-heading-3 mb-4">
                {editingTemplate ? 'Edit Template' : 'Create Template'}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="qt-label mb-1">
                    Name <span className="qt-text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    maxLength={100}
                    placeholder="My Custom RP Style"
                    className="qt-input w-full"
                  />
                  <p className="qt-text-xs mt-1">
                    {formData.name.length}/100 characters
                  </p>
                </div>

                <div>
                  <label className="qt-label mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    maxLength={500}
                    placeholder="A brief description of what this template does"
                    className="qt-input w-full"
                  />
                  <p className="qt-text-xs mt-1">
                    {formData.description.length}/500 characters
                  </p>
                </div>

                <div>
                  <PromptFieldLabel
                    hint={PROMPT_FIELD_HINTS.roleplayTemplatePrompt}
                    label="LLM Prompt"
                    required
                    helper={`${PROMPT_FIELD_HINTS.roleplayTemplatePrompt.helper} You can use placeholders like {{char}} and {{user}}.`}
                    actions={
                      <button
                        type="button"
                        onClick={appendFormattingHint}
                        disabled={formData.delimiters.length === 0 && !formData.narrationOpen.trim()}
                        className="px-2 py-1 text-xs rounded border qt-border-default qt-hover-accent disabled:opacity-50"
                        title="Append a starter formatting guide drafted from the delimiters above"
                      >
                        Draft formatting instructions
                      </button>
                    }
                  />
                  <MarkdownLexicalEditor
                    value={formData.systemPrompt}
                    onChange={(value) => setFormData(prev => ({ ...prev, systemPrompt: value }))}
                    remountKey={editingTemplate?.id ?? 'new'}
                    namespace="RoleplayTemplate.systemPrompt"
                    ariaLabel="Template LLM prompt"
                    minHeight="14rem"
                  />
                </div>

                <div>
                  <label className="qt-label mb-1">
                    Narration Delimiters <span className="qt-text-destructive">*</span>
                  </label>
                  <p className="qt-text-xs mb-2">
                    How narration and action text is marked in this template&apos;s formatting.
                  </p>
                  <div className="flex items-center gap-3 mb-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="narrationDelimiterMode"
                        checked={formData.narrationDelimiterMode === 'single'}
                        onChange={() => setFormData(prev => ({
                          ...prev,
                          narrationDelimiterMode: 'single',
                          narrationClose: prev.narrationOpen,
                        }))}
                        className="qt-radio"
                      />
                      <span className="text-sm">Same open &amp; close</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="narrationDelimiterMode"
                        checked={formData.narrationDelimiterMode === 'pair'}
                        onChange={() => setFormData(prev => ({
                          ...prev,
                          narrationDelimiterMode: 'pair',
                        }))}
                        className="qt-radio"
                      />
                      <span className="text-sm">Different open &amp; close</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    {formData.narrationDelimiterMode === 'single' ? (
                      <div className="flex items-center gap-2">
                        <label className="qt-text-xs whitespace-nowrap">Delimiter:</label>
                        <input
                          type="text"
                          value={formData.narrationOpen}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            narrationOpen: e.target.value,
                            narrationClose: e.target.value,
                          }))}
                          maxLength={10}
                          placeholder="*"
                          className="qt-input w-20 font-mono text-center"
                        />
                        <span className="qt-text-xs qt-text-secondary">
                          e.g. <code className="font-mono">*narration*</code>
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <label className="qt-text-xs whitespace-nowrap">Open:</label>
                        <input
                          type="text"
                          value={formData.narrationOpen}
                          onChange={(e) => setFormData(prev => ({ ...prev, narrationOpen: e.target.value }))}
                          maxLength={10}
                          placeholder="["
                          className="qt-input w-20 font-mono text-center"
                        />
                        <label className="qt-text-xs whitespace-nowrap">Close:</label>
                        <input
                          type="text"
                          value={formData.narrationClose}
                          onChange={(e) => setFormData(prev => ({ ...prev, narrationClose: e.target.value }))}
                          maxLength={10}
                          placeholder="]"
                          className="qt-input w-20 font-mono text-center"
                        />
                        <span className="qt-text-xs qt-text-secondary">
                          e.g. <code className="font-mono">[narration]</code>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Delimiters Array Editor */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="qt-label">
                      Formatting Delimiters
                    </label>
                    <button
                      type="button"
                      onClick={addDelimiter}
                      className="px-3 py-1 text-xs rounded border qt-border-default qt-hover-accent"
                    >
                      + Add Delimiter
                    </button>
                  </div>
                  <p className="qt-text-xs mb-3">
                    Define formatting types with toolbar buttons and CSS styles. Each entry creates a button in the chat composer toolbar.
                  </p>

                  {formData.delimiters.length === 0 ? (
                    <div className="qt-text-xs border border-dashed qt-border-default rounded-lg p-3 text-center">
                      No delimiters defined. Add one to create toolbar formatting buttons.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {formData.delimiters.map((delimiter, index) => (
                        <div key={index} className="border qt-border-default rounded-lg p-3 qt-bg-muted/20">
                          <div className="flex items-center justify-between mb-2">
                            <span className="qt-text-xs font-medium">Delimiter {index + 1}</span>
                            <button
                              type="button"
                              onClick={() => removeDelimiter(index)}
                              className="text-xs qt-text-destructive hover:underline"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="mb-2">
                            <label className="qt-text-xs">Kind</label>
                            <select
                              value={delimiter.kind}
                              onChange={(e) => updateDelimiter(index, 'kind', e.target.value)}
                              className="qt-select w-full text-sm"
                            >
                              <option value="wrap">Wrap — open…close around a span (e.g. *action*)</option>
                              <option value="linePrefix">Line prefix — marker styles the whole line (e.g. // OOC)</option>
                              <option value="tagPrefix">Tag prefix — [TOKEN] at line start styles the whole line</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <div>
                              <label className="qt-text-xs">Name</label>
                              <input
                                type="text"
                                value={delimiter.name}
                                onChange={(e) => updateDelimiter(index, 'name', e.target.value)}
                                placeholder="Narration"
                                maxLength={50}
                                className="qt-input w-full text-sm"
                              />
                            </div>
                            <div>
                              <label className="qt-text-xs">Button Label</label>
                              <input
                                type="text"
                                value={delimiter.buttonName}
                                onChange={(e) => updateDelimiter(index, 'buttonName', e.target.value)}
                                placeholder="Nar"
                                maxLength={10}
                                className="qt-input w-full text-sm"
                              />
                            </div>
                          </div>
                          <div className="mb-2">
                            <label className="qt-text-xs">Style (CSS class)</label>
                            <input
                              type="text"
                              list={`qt-style-options-${index}`}
                              value={delimiter.style}
                              onChange={(e) => updateDelimiter(index, 'style', e.target.value)}
                              placeholder="qt-chat-narration"
                              maxLength={50}
                              className="qt-input w-full text-sm font-mono"
                            />
                            <datalist id={`qt-style-options-${index}`}>
                              {STYLE_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </datalist>
                            <p className="qt-text-xs qt-text-secondary mt-1">
                              Pick a built-in style or enter your own theme class.
                            </p>
                          </div>

                          {delimiter.kind === 'wrap' && (
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <label className="qt-text-xs">Delimiters:</label>
                                <label className="flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="radio"
                                    checked={delimiter.delimiterMode === 'single'}
                                    onChange={() => updateDelimiter(index, 'delimiterMode', 'single')}
                                    className="qt-radio"
                                  />
                                  <span className="text-xs">Same</span>
                                </label>
                                <label className="flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="radio"
                                    checked={delimiter.delimiterMode === 'pair'}
                                    onChange={() => updateDelimiter(index, 'delimiterMode', 'pair')}
                                    className="qt-radio"
                                  />
                                  <span className="text-xs">Pair</span>
                                </label>
                              </div>
                              <div className="flex items-center gap-2">
                                {delimiter.delimiterMode === 'single' ? (
                                  <input
                                    type="text"
                                    value={delimiter.delimiterOpen}
                                    onChange={(e) => updateDelimiter(index, 'delimiterOpen', e.target.value)}
                                    placeholder="*"
                                    className="qt-input w-20 font-mono text-center text-sm"
                                  />
                                ) : (
                                  <>
                                    <input
                                      type="text"
                                      value={delimiter.delimiterOpen}
                                      onChange={(e) => updateDelimiter(index, 'delimiterOpen', e.target.value)}
                                      placeholder="["
                                      className="qt-input w-20 font-mono text-center text-sm"
                                    />
                                    <span className="qt-text-xs">to</span>
                                    <input
                                      type="text"
                                      value={delimiter.delimiterClose}
                                      onChange={(e) => updateDelimiter(index, 'delimiterClose', e.target.value)}
                                      placeholder="]"
                                      className="qt-input w-20 font-mono text-center text-sm"
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                          )}

                          {delimiter.kind === 'linePrefix' && (
                            <div>
                              <label className="qt-text-xs">Line marker</label>
                              <input
                                type="text"
                                value={delimiter.marker}
                                onChange={(e) => updateDelimiter(index, 'marker', e.target.value)}
                                placeholder="// "
                                className="qt-input w-28 font-mono text-sm"
                              />
                              <p className="qt-text-xs qt-text-secondary mt-1">
                                A line beginning with this marker is styled in full.
                              </p>
                            </div>
                          )}

                          {delimiter.kind === 'tagPrefix' && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <label className="qt-text-xs whitespace-nowrap">Brackets:</label>
                                <input
                                  type="text"
                                  value={delimiter.tagOpen}
                                  onChange={(e) => updateDelimiter(index, 'tagOpen', e.target.value)}
                                  placeholder="["
                                  className="qt-input w-16 font-mono text-center text-sm"
                                />
                                <span className="qt-text-xs">TOKEN</span>
                                <input
                                  type="text"
                                  value={delimiter.tagClose}
                                  onChange={(e) => updateDelimiter(index, 'tagClose', e.target.value)}
                                  placeholder="]"
                                  className="qt-input w-16 font-mono text-center text-sm"
                                />
                              </div>
                              <div>
                                <label className="qt-text-xs">Token pattern (regex, Unicode)</label>
                                <input
                                  type="text"
                                  value={delimiter.tokenPattern}
                                  onChange={(e) => updateDelimiter(index, 'tokenPattern', e.target.value)}
                                  placeholder={DEFAULT_TAG_TOKEN_PATTERN}
                                  className="qt-input w-full font-mono text-sm"
                                />
                                <p className="qt-text-xs qt-text-secondary mt-1">
                                  The token between the brackets must match this. Default = uppercase / non-cased, never lowercase. A line like <code className="font-mono">{delimiter.tagOpen || '['}CAPTAIN{delimiter.tagClose || ']'}</code> at the start of a line is then styled in full.
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Hide-delimiter toggle + layered text flourishes */}
                          <div className="mt-3 pt-3 border-t qt-border-default space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={delimiter.hideDelimiter}
                                onChange={(e) => setDelimiterFields(index, { hideDelimiter: e.target.checked })}
                                className="qt-checkbox"
                              />
                              <span className="qt-text-xs">Conceal the marks when rendered</span>
                            </label>

                            <div>
                              <label className="qt-text-xs qt-text-secondary">Flourishes</label>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                                <label className="flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={delimiter.addOns.bold}
                                    onChange={(e) => updateAddOn(index, 'bold', e.target.checked)}
                                    className="qt-checkbox"
                                  />
                                  <span className="text-xs">Bold</span>
                                </label>
                                <label className="flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={delimiter.addOns.italic}
                                    onChange={(e) => updateAddOn(index, 'italic', e.target.checked)}
                                    className="qt-checkbox"
                                  />
                                  <span className="text-xs">Italic</span>
                                </label>
                                <label className="flex items-center gap-1 cursor-pointer" title="Swap foreground and background">
                                  <input
                                    type="checkbox"
                                    checked={delimiter.addOns.reverse}
                                    onChange={(e) => updateAddOn(index, 'reverse', e.target.checked)}
                                    className="qt-checkbox"
                                  />
                                  <span className="text-xs">Reverse</span>
                                </label>
                              </div>
                              <div className="grid grid-cols-3 gap-2 mt-2">
                                <div>
                                  <label className="qt-text-xs">Underline</label>
                                  <select
                                    value={delimiter.addOns.underline}
                                    onChange={(e) => updateAddOn(index, 'underline', e.target.value as DelimiterAddOns['underline'])}
                                    className="qt-select w-full text-sm"
                                  >
                                    <option value="none">None</option>
                                    <option value="single">Single</option>
                                    <option value="double">Double</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="qt-text-xs">Border</label>
                                  <select
                                    value={delimiter.addOns.border}
                                    onChange={(e) => updateAddOn(index, 'border', e.target.value as DelimiterAddOns['border'])}
                                    className="qt-select w-full text-sm"
                                  >
                                    <option value="none">None</option>
                                    <option value="solid">Solid</option>
                                    <option value="dashed">Dashed</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="qt-text-xs">Font</label>
                                  <select
                                    value={delimiter.addOns.font}
                                    onChange={(e) => updateAddOn(index, 'font', e.target.value as DelimiterAddOns['font'])}
                                    className="qt-select w-full text-sm"
                                  >
                                    {FONT_OPTIONS.map(opt => (
                                      <option key={opt.value || 'default'} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded-md border qt-border-default qt-hover-accent disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !formData.name.trim() || !formData.systemPrompt.trim() || !formData.narrationOpen.trim() || (formData.narrationDelimiterMode === 'pair' && !formData.narrationClose.trim())}
                  className="qt-button qt-button-primary px-4 py-2 rounded-md disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTemplate ? 'Save Changes' : 'Create Template'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="qt-dialog-overlay">
          <div className="bg-background border qt-border-default rounded-lg qt-shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="qt-heading-3">{previewTemplate.name}</h2>
                  {previewTemplate.description && (
                    <p className="qt-text-small mt-1">
                      {previewTemplate.description}
                    </p>
                  )}
                </div>
                {previewTemplate.isBuiltIn && (
                  <span className="px-2 py-0.5 qt-text-label-xs qt-bg-primary/10 text-primary rounded">
                    Built-in
                  </span>
                )}
              </div>

              {/* Delimiters info */}
              {previewTemplate.delimiters && previewTemplate.delimiters.length > 0 && (
                <div className="border qt-border-default rounded-lg p-4 qt-bg-muted/30 mb-4">
                  <h3 className="qt-text-small font-medium mb-2">Formatting Delimiters</h3>
                  <div className="space-y-1">
                    {previewTemplate.delimiters.map((d, i) => {
                      const delimDisplay = d.kind === 'linePrefix'
                        ? `${d.marker}…EOL`
                        : d.kind === 'tagPrefix'
                          ? `${d.open}TOKEN${d.close}`
                          : Array.isArray(d.delimiters)
                            ? `${d.delimiters[0]}...${d.delimiters[1] || 'EOL'}`
                            : `${d.delimiters}...${d.delimiters}`
                      return (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <span className="font-medium">{d.buttonName}</span>
                          <span className="qt-text-secondary">{d.name}</span>
                          <code className="font-mono text-xs qt-bg-muted px-1 rounded">{delimDisplay}</code>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="border qt-border-default rounded-lg p-4 qt-bg-muted/30">
                <h3 className="qt-text-small font-medium mb-2">LLM Prompt</h3>
                <pre className="whitespace-pre-wrap text-sm text-foreground font-mono">
                  {previewTemplate.systemPrompt}
                </pre>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                {previewTemplate.isBuiltIn && (
                  <button
                    type="button"
                    onClick={() => {
                      handleCopyAsNew(previewTemplate)
                      setPreviewTemplate(null)
                    }}
                    className="px-4 py-2 text-sm rounded-md border qt-border-default qt-hover-accent"
                  >
                    Copy as New
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewTemplate(null)}
                  className="qt-button qt-button-primary px-4 py-2 rounded-md"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
