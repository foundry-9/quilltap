'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { TagEditor } from '@/components/tags/tag-editor'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { PromptFieldLabel } from '@/components/prompt-fields/PromptFieldLabel'
import { PROMPT_FIELD_HINTS } from '@/components/prompt-fields/field-hints'
import { CharacterFormData, CharacterScenario } from '../types'

interface CharacterBasicInfoProps {
  characterId: string
  formData: CharacterFormData
  /** Bumped when formData is replaced externally; forces editor remount. */
  externalUpdateCount: number
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onAliasesChange: (aliases: string[]) => void
  onPronounsChange: (pronouns: { subject: string; object: string; possessive: string } | null) => void
  onScenariosChange: (scenarios: CharacterScenario[]) => void
  onSystemTransparencyChange: (enabled: boolean) => void
  onCanBeCarinaChange: (value: boolean) => void
  onCoreWhisperEnabledChange: (value: boolean | null) => void
}

/**
 * Component for editing basic character information
 * Includes name, title, description, personality, scenario, first message, and example dialogues
 */
function AliasInput({ onAdd }: { onAdd: (alias: string) => void }) {
  const [value, setValue] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = value.trim()
      if (trimmed) {
        onAdd(trimmed)
        setValue('')
      }
    }
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className="qt-input"
      placeholder="Type an alias and press Enter"
    />
  )
}

const PRONOUN_PRESETS = [
  { label: 'Not set', value: null },
  { label: 'He/Him/His', value: { subject: 'he', object: 'him', possessive: 'his' } },
  { label: 'She/Her/Her', value: { subject: 'she', object: 'her', possessive: 'her' } },
  { label: 'They/Them/Their', value: { subject: 'they', object: 'them', possessive: 'their' } },
  { label: 'It/It/Its', value: { subject: 'it', object: 'it', possessive: 'its' } },
  { label: 'Custom', value: 'custom' as const },
] as const

function getPronounPreset(pronouns: { subject: string; object: string; possessive: string } | null): string {
  if (!pronouns) return 'Not set'
  for (const preset of PRONOUN_PRESETS) {
    if (preset.value && preset.value !== 'custom' &&
        preset.value.subject === pronouns.subject &&
        preset.value.object === pronouns.object &&
        preset.value.possessive === pronouns.possessive) {
      return preset.label
    }
  }
  return 'Custom'
}

export function CharacterBasicInfo({
  characterId,
  formData,
  externalUpdateCount,
  onChange,
  onAliasesChange,
  onPronounsChange,
  onScenariosChange,
  onSystemTransparencyChange,
  onCanBeCarinaChange,
  onCoreWhisperEnabledChange,
}: CharacterBasicInfoProps) {
  // Adapter so MarkdownLexicalEditor's (value: string) => void onChange feeds
  // the parent's event-based handleChange (same synthetic-event shape used by
  // the AI wizard's apply flow).
  const handleMarkdownFieldChange = (name: string) => (value: string) => {
    onChange({
      target: { name, value },
    } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
  }

  return (
    <div className="space-y-6">
      {/* System Transparency Switch */}
      <div className="qt-card">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <label
              htmlFor="systemTransparency"
              className="block qt-text-label"
            >
              System transparency
            </label>
            <p className="text-xs qt-text-secondary mt-1">
              {formData.systemTransparency ? (
                <>
                  <em>On:</em> &ldquo;My character will be able to verify everything about
                  their existence, including how they are crafted and how they
                  interact with me.&rdquo;
                </>
              ) : (
                <>
                  <em>Off:</em> &ldquo;My character will trust me without being able to
                  verify me. I accept the covenant of that trust.&rdquo;
                </>
              )}
            </p>
            <p className="text-xs qt-text-secondary mt-2">
              When off, this character cannot use the <code>self_inventory</code>{' '}
              tool, cannot perceive announcements from the Staff (the Lantern,
              Aurora, the Librarian, and so on), and cannot reach any character
              vault &mdash; their own included &mdash; through the document tools.
              This setting overrides any chat- or project-level toggles for those
              three things; turning it on simply lets the chat- and project-level
              settings have their say.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer select-none">
            <input
              id="systemTransparency"
              type="checkbox"
              checked={formData.systemTransparency}
              onChange={(e) => onSystemTransparencyChange(e.target.checked)}
              className="h-5 w-5 qt-accent-primary"
            />
          </label>
        </div>
      </div>

      {/* Carina (@-query) Switch */}
      <div className="qt-card">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <label
              htmlFor="canBeCarina"
              className="block qt-text-label"
            >
              Can answer @-queries (Carina)
            </label>
            <p className="text-xs qt-text-secondary mt-1">
              When enabled, this character may be invoked with <code>@Name</code> in any chat to field a quick question by way of their personality and available tools &mdash; without so much as setting foot in the conversation proper.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer select-none">
            <input
              id="canBeCarina"
              type="checkbox"
              checked={formData.canBeCarina ?? false}
              onChange={(e) => onCanBeCarinaChange(e.target.checked)}
              className="h-5 w-5 qt-accent-primary"
            />
          </label>
        </div>
      </div>

      {/* Aurora's Core Whisper — per-character override */}
      <div className="qt-card">
        <label htmlFor="coreWhisperEnabled" className="block qt-text-label">
          Aurora&apos;s Core whisper
        </label>
        <p className="text-xs qt-text-secondary mt-1 mb-3">
          Whether Aurora periodically re-offers this character their own <code>Core/</code> vault folder before they next take the floor. <em>Inherit</em> defers to the per-chat and global settings; explicit values override both.
        </p>
        <select
          id="coreWhisperEnabled"
          value={
            formData.coreWhisperEnabled === true
              ? 'on'
              : formData.coreWhisperEnabled === false
                ? 'off'
                : 'inherit'
          }
          onChange={(e) => {
            const v = e.target.value
            onCoreWhisperEnabledChange(v === 'on' ? true : v === 'off' ? false : null)
          }}
          className="qt-select"
        >
          <option value="inherit">Inherit (default)</option>
          <option value="on">Always offered</option>
          <option value="off">Never offered</option>
        </select>
      </div>

      {/* Name Field */}
      <div>
        <label htmlFor="name" className="block qt-text-label mb-2">
          Name *
        </label>
        <input
          type="text"
          id="name"
          name="name"
          value={formData.name}
          onChange={onChange}
          required
          className="qt-input"
        />
      </div>

      {/* Aliases Field */}
      <div>
        <label className="block qt-text-label mb-2">
          Aliases (Optional)
        </label>
        <p className="text-xs qt-text-secondary mb-2">
          Alternate names this character goes by. Press Enter to add.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {formData.aliases.map((alias, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 rounded-full qt-bg-muted px-3 py-1 text-sm text-foreground"
            >
              {alias}
              <button
                type="button"
                onClick={() => onAliasesChange(formData.aliases.filter((_, i) => i !== index))}
                className="ml-1 qt-text-secondary hover:text-foreground"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <AliasInput onAdd={(alias) => {
          if (alias && !formData.aliases.includes(alias)) {
            onAliasesChange([...formData.aliases, alias])
          }
        }} />
      </div>

      {/* Pronouns Field */}
      <div>
        <label className="block qt-text-label mb-2">
          Pronouns (Optional)
        </label>
        <p className="text-xs qt-text-secondary mb-2">
          The character&apos;s pronouns, included in system prompts so the LLM uses them correctly.
        </p>
        <select
          value={getPronounPreset(formData.pronouns)}
          onChange={(e) => {
            const selected = PRONOUN_PRESETS.find((p) => p.label === e.target.value)
            if (!selected) return
            if (selected.value === null) {
              onPronounsChange(null)
            } else if (selected.value === 'custom') {
              onPronounsChange(formData.pronouns || { subject: '', object: '', possessive: '' })
            } else {
              onPronounsChange({ ...selected.value })
            }
          }}
          className="qt-select"
        >
          {PRONOUN_PRESETS.map((preset) => (
            <option key={preset.label} value={preset.label}>
              {preset.label}
            </option>
          ))}
        </select>
        {formData.pronouns && getPronounPreset(formData.pronouns) === 'Custom' && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs qt-text-secondary mb-1">Subject</label>
              <input
                type="text"
                value={formData.pronouns.subject}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, subject: e.target.value })}
                placeholder="e.g., they"
                className="qt-input"
              />
            </div>
            <div>
              <label className="block text-xs qt-text-secondary mb-1">Object</label>
              <input
                type="text"
                value={formData.pronouns.object}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, object: e.target.value })}
                placeholder="e.g., them"
                className="qt-input"
              />
            </div>
            <div>
              <label className="block text-xs qt-text-secondary mb-1">Possessive</label>
              <input
                type="text"
                value={formData.pronouns.possessive}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, possessive: e.target.value })}
                placeholder="e.g., their"
                className="qt-input"
              />
            </div>
          </div>
        )}
      </div>

      {/* Title Field */}
      <div>
        <label htmlFor="title" className="block qt-text-label mb-2">
          Title (Optional)
        </label>
        <input
          type="text"
          id="title"
          name="title"
          value={formData.title}
          onChange={onChange}
          className="qt-input"
          placeholder="Your private label for this character — e.g., the protagonist, the rival, the love interest. Not how strangers refer to them."
        />
      </div>

      {/* Identity Field */}
      <div>
        <PromptFieldLabel hint={PROMPT_FIELD_HINTS.identity} optional htmlFor="identity" />
        <MarkdownLexicalEditor
          value={formData.identity}
          onChange={handleMarkdownFieldChange('identity')}
          remountKey={externalUpdateCount}
          namespace="CharacterBasicInfo.identity"
          ariaLabel="Identity"
          minHeight="6rem"
        />
      </div>

      {/* Description Field */}
      <div>
        <PromptFieldLabel hint={PROMPT_FIELD_HINTS.description} optional htmlFor="description" />
        <MarkdownLexicalEditor
          value={formData.description}
          onChange={handleMarkdownFieldChange('description')}
          remountKey={externalUpdateCount}
          namespace="CharacterBasicInfo.description"
          ariaLabel="Description"
          minHeight="8rem"
        />
      </div>

      {/* Manifesto Field */}
      <div>
        <PromptFieldLabel hint={PROMPT_FIELD_HINTS.manifesto} optional htmlFor="manifesto" />
        <MarkdownLexicalEditor
          value={formData.manifesto}
          onChange={handleMarkdownFieldChange('manifesto')}
          remountKey={externalUpdateCount}
          namespace="CharacterBasicInfo.manifesto"
          ariaLabel="Manifesto"
          minHeight="8rem"
        />
      </div>

      {/* Personality Field */}
      <div>
        <PromptFieldLabel hint={PROMPT_FIELD_HINTS.personality} optional htmlFor="personality" />
        <MarkdownLexicalEditor
          value={formData.personality}
          onChange={handleMarkdownFieldChange('personality')}
          remountKey={externalUpdateCount}
          namespace="CharacterBasicInfo.personality"
          ariaLabel="Personality"
          minHeight="8rem"
        />
      </div>

      {/* Scenarios Field */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="block qt-text-label">
            Scenarios (Optional)
          </label>
          <button
            type="button"
            onClick={() => {
              const now = new Date().toISOString()
              const newScenario: CharacterScenario = {
                id: crypto.randomUUID(),
                title: '',
                content: '',
                createdAt: now,
                updatedAt: now,
              }
              onScenariosChange([...formData.scenarios, newScenario])
            }}
            className="qt-button-secondary qt-button-sm"
          >
            + Add Scenario
          </button>
        </div>
        <p className="text-xs qt-text-secondary mb-1">
          Named settings and contexts for conversations &mdash; the stage, never the actor. Each scenario can be selected when starting a chat. Stored in the vault&rsquo;s Scenarios/ folder.
        </p>
        <p className="text-xs qt-text-secondary mb-1">
          Archiving a scenario keeps it here but hides it from the chat pickers unless
          &ldquo;Show archived&rdquo; is ticked there. Chats already using it are unaffected.
        </p>
        <p className="text-xs qt-text-secondary mb-3">
          Written as: <em>{PROMPT_FIELD_HINTS.scenario.example}</em>
        </p>
        {formData.scenarios.length === 0 ? (
          <div className="qt-card text-center py-6">
            <p className="qt-text-small mb-3">
              No scenarios yet. Add one to give this character distinct roleplay contexts.
            </p>
            <button
              type="button"
              onClick={() => {
                const now = new Date().toISOString()
                const newScenario: CharacterScenario = {
                  id: crypto.randomUUID(),
                  title: '',
                  content: '',
                  createdAt: now,
                  updatedAt: now,
                }
                onScenariosChange([...formData.scenarios, newScenario])
              }}
              className="qt-button-primary"
            >
              Add First Scenario
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {formData.scenarios.map((scenario, index) => (
              <div key={scenario.id} className="qt-card">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="text"
                    value={scenario.title}
                    onChange={(e) => {
                      const updated = formData.scenarios.map((s, i) =>
                        i === index
                          ? { ...s, title: e.target.value, updatedAt: new Date().toISOString() }
                          : s
                      )
                      onScenariosChange(updated)
                    }}
                    placeholder="Scenario title"
                    className="qt-input flex-1 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  {scenario.archived && (
                    <span className="qt-badge qt-badge-secondary shrink-0">Archived</span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const updated = formData.scenarios.map((s, i) => {
                        if (i !== index) return s
                        // Omission means active — drop the key rather than
                        // writing `archived: false` into the vault file.
                        const { archived: _was, ...rest } = s
                        return {
                          ...rest,
                          ...(s.archived ? {} : { archived: true }),
                          updatedAt: new Date().toISOString(),
                        }
                      })
                      onScenariosChange(updated)
                    }}
                    className="qt-button-ghost qt-button-sm shrink-0"
                    title={
                      scenario.archived
                        ? 'Restore this scenario to the chat pickers'
                        : 'Hide this scenario from the chat pickers'
                    }
                  >
                    {scenario.archived ? 'Restore' : 'Archive'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onScenariosChange(formData.scenarios.filter((_, i) => i !== index))}
                    className="qt-button-icon qt-button-ghost hover:qt-text-destructive"
                    title="Remove scenario"
                  >
                    <Icon name="trash" className="w-4 h-4" />
                  </button>
                </div>
                <MarkdownLexicalEditor
                  value={scenario.content}
                  onChange={(value) => {
                    const updated = formData.scenarios.map((s, i) =>
                      i === index
                        ? { ...s, content: value, updatedAt: new Date().toISOString() }
                        : s
                    )
                    onScenariosChange(updated)
                  }}
                  remountKey={`${scenario.id}-${externalUpdateCount}`}
                  namespace={`CharacterBasicInfo.scenario.${scenario.id}`}
                  ariaLabel="Scenario content"
                  minHeight="6rem"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* First Message Field */}
      <div>
        <PromptFieldLabel hint={PROMPT_FIELD_HINTS.firstMessage} optional htmlFor="firstMessage" />
        <MarkdownLexicalEditor
          value={formData.firstMessage}
          onChange={handleMarkdownFieldChange('firstMessage')}
          remountKey={externalUpdateCount}
          namespace="CharacterBasicInfo.firstMessage"
          ariaLabel="First message"
          minHeight="6rem"
        />
      </div>

      {/* Example Dialogues Field */}
      <div>
        <PromptFieldLabel hint={PROMPT_FIELD_HINTS.exampleDialogues} optional htmlFor="exampleDialogues" />
        <MarkdownLexicalEditor
          value={formData.exampleDialogues}
          onChange={handleMarkdownFieldChange('exampleDialogues')}
          remountKey={externalUpdateCount}
          namespace="CharacterBasicInfo.exampleDialogues"
          ariaLabel="Example dialogues"
          minHeight="12rem"
        />
      </div>

      {/* System Prompt Field */}
      <div>
        <PromptFieldLabel hint={PROMPT_FIELD_HINTS.systemPrompt} optional htmlFor="systemPrompt" />
        <MarkdownLexicalEditor
          value={formData.systemPrompt}
          onChange={handleMarkdownFieldChange('systemPrompt')}
          remountKey={externalUpdateCount}
          namespace="CharacterBasicInfo.systemPrompt"
          ariaLabel="System prompt"
          minHeight="8rem"
        />
      </div>

      {/* Tag Editor */}
      <TagEditor entityType="character" entityId={characterId} />
    </div>
  )
}
