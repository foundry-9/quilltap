'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { AIWizardModal, type GeneratedCharacterData, type GeneratedPhysicalDescription, type GeneratedWardrobeItem, normalizeGeneratedScenarios } from '@/components/characters/ai-wizard'
import { ImportModal } from '@/components/characters/system-prompts-editor/ImportModal'
import type { PromptTemplate } from '@/components/characters/system-prompts-editor/types'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import { buildWizardCurrentData, getGeneratedCharacterTextEntries } from '../shared/wizard-text-fields'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { useCloseSelfTab } from '@/components/workspace/useCloseSelfTab'

export function NewCharacterView() {
  const router = useRouter()
  // Keep-alive-safe: inside the workspace, finishing creation returns to the
  // (kept-alive) Aurora tab — where the new character now appears — and closes
  // this create tab; outside it pushes to the new character's page as before.
  const navigate = useWorkspaceNavigate()
  const closeSelf = useCloseSelfTab()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { profiles } = useConnectionProfiles()
  const [showWizard, setShowWizard] = useState(false)
  const [showTemplateImport, setShowTemplateImport] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  // Bumped whenever formData fields are replaced externally (AI wizard apply,
  // template import) so the markdown editors remount and re-parse the new
  // values. Without this, MarkdownBridgePlugin's one-shot init keeps the
  // editor showing whatever was on screen before the external write.
  const [externalUpdateCount, setExternalUpdateCount] = useState(0)
  // Store pending physical description from wizard to save after character creation
  const pendingPhysicalDescription = useRef<GeneratedPhysicalDescription | null>(null)
  // Store pending scenarios from wizard to save after character creation
  const pendingScenarios = useRef<Array<{ title: string; content: string }> | null>(null)
  // Store pending wardrobe items from wizard to save after character creation
  const pendingWardrobeItems = useRef<GeneratedWardrobeItem[] | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    title: '',
    identity: '',
    description: '',
    manifesto: '',
    personality: '',
    scenario: '',
    firstMessage: '',
    exampleDialogues: '',
    systemPrompt: '',
    avatarUrl: '',
    defaultConnectionProfileId: '',
  })

  // Handle applying wizard-generated data
  const handleWizardApply = (data: GeneratedCharacterData) => {
    setFormData((prev) => {
      const next = { ...prev }
      for (const entry of getGeneratedCharacterTextEntries(data)) {
        next[entry.field] = entry.value
      }
      return next
    })
    // Store physical description to save after character creation
    if (data.physicalDescription) {
      pendingPhysicalDescription.current = data.physicalDescription
    }
    // Store scenarios to save after character creation
    const normalizedScenarios = normalizeGeneratedScenarios(data.scenarios)
    if (normalizedScenarios.length > 0) {
      pendingScenarios.current = normalizedScenarios
    }
    // Store wardrobe items to save after character creation
    if (data.wardrobeItems && data.wardrobeItems.length > 0) {
      pendingWardrobeItems.current = data.wardrobeItems
    }
    setExternalUpdateCount((n) => n + 1)
  }

  const openTemplateImport = async () => {
    setShowTemplateImport(true)
    if (templates.length === 0) {
      try {
        setLoadingTemplates(true)
        const res = await fetch('/api/v1/prompt-templates')
        if (res.ok) {
          const data = await res.json()
          setTemplates(data.templates || [])
        }
      } catch (err) {
        console.error('Error fetching templates', err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingTemplates(false)
      }
    }
  }

  const handleTemplateImport = (content: string, _suggestedName: string) => {
    setFormData(prev => ({ ...prev, systemPrompt: content }))
    setExternalUpdateCount((n) => n + 1)
    setShowTemplateImport(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Filter out empty strings for optional UUID fields
      const submitData = {
        ...formData,
        defaultConnectionProfileId: formData.defaultConnectionProfileId || undefined,
        avatarUrl: formData.avatarUrl || undefined,
      }

      const res = await fetch('/api/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create character')
      }

      const data = await res.json()
      const characterId = data.character.id

      // Save pending scenarios if any (from wizard)
      if (pendingScenarios.current && pendingScenarios.current.length > 0) {
        for (const scenario of pendingScenarios.current) {
          try {
            await fetch(`/api/v1/characters/${characterId}/scenarios`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: scenario.title, content: scenario.content }),
            })
          } catch (scenErr) {
            console.error('Error saving scenario', scenErr instanceof Error ? scenErr.message : String(scenErr))
          }
        }
        pendingScenarios.current = null
      }

      // Save pending physical description if any. The cutover collapsed the
      // multi-record array to a single record on the character row; PATCH the
      // character directly and the repository routes it into the vault.
      if (pendingPhysicalDescription.current) {
        try {
          const descResponse = await fetch(`/api/v1/characters/${characterId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              physicalDescription: {
                name: pendingPhysicalDescription.current.name,
                headAndShouldersPrompt: pendingPhysicalDescription.current.headAndShouldersPrompt,
                shortPrompt: pendingPhysicalDescription.current.shortPrompt,
                mediumPrompt: pendingPhysicalDescription.current.mediumPrompt,
                longPrompt: pendingPhysicalDescription.current.longPrompt,
                completePrompt: pendingPhysicalDescription.current.completePrompt,
                fullDescription: pendingPhysicalDescription.current.fullDescription,
              },
            }),
          })

          if (descResponse.ok) {
            showSuccessToast('Physical description saved')
          } else {
            const errorData = await descResponse.json().catch(() => ({}))
            console.error('Failed to save physical description', errorData.error || 'Unknown error')
            showErrorToast('Character created, but physical description failed to save')
          }
        } catch (descErr) {
          console.error('Error saving physical description', descErr instanceof Error ? descErr.message : String(descErr))
          showErrorToast('Character created, but physical description failed to save')
        }
      }

      // Save pending wardrobe items if any (from wizard)
      if (pendingWardrobeItems.current && pendingWardrobeItems.current.length > 0) {
        let wardrobeItemsSaved = 0
        for (const item of pendingWardrobeItems.current) {
          try {
            const wardrobeRes = await fetch(`/api/v1/characters/${characterId}/wardrobe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: item.title,
                description: item.description || null,
                types: item.types,
                appropriateness: item.appropriateness || null,
              }),
            })
            if (wardrobeRes.ok) {
              wardrobeItemsSaved++
            }
          } catch (wardrobeErr) {
            console.error('Error saving wardrobe item', wardrobeErr instanceof Error ? wardrobeErr.message : String(wardrobeErr))
          }
        }
        if (wardrobeItemsSaved > 0) {
          showSuccessToast(`${wardrobeItemsSaved} wardrobe item${wardrobeItemsSaved > 1 ? 's' : ''} created`)
        }
        pendingWardrobeItems.current = null
      }

      if (closeSelf()) {
        navigate('/aurora')
      } else {
        router.push(`/aurora/${characterId}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  // Adapter so MarkdownLexicalEditor's (value: string) => void onChange feeds
  // handleChange's event-based shape (same pattern as the edit page).
  const handleMarkdownFieldChange = (name: string) => (value: string) => {
    handleChange({
      target: { name, value },
    } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
  }

  return (
    <div className="qt-page-container">
      <div className="mb-8">
        <Link
          href="/aurora"
          className="qt-link mb-4 inline-block"
        >
          ← Back to Characters
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="qt-heading-1">Create Character</h1>
          <button
            type="button"
            onClick={() => setShowWizard(true)}
            className="qt-button-secondary flex items-center gap-2"
            title="Use AI to generate character details"
          >
            <Icon name="wand" className="w-4 h-4" />
            AI Wizard
          </button>
        </div>
      </div>

      {error && (
        <div className="qt-alert-error mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="name" className="block qt-label mb-2 text-foreground">
            Name *
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            className="qt-input"
          />
        </div>

        <div>
          <label htmlFor="title" className="block qt-label mb-2 text-foreground">
            Title (Optional)
          </label>
          <input
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            className="qt-input"
            placeholder="Your private label for this character — e.g., the protagonist, the rival, the love interest. Not how strangers refer to them."
          />
        </div>

        <div>
          <label htmlFor="identity" className="block qt-label mb-2 text-foreground">
            Identity (Optional)
          </label>
          <p className="text-xs qt-text-secondary mb-2">
            What strangers know about the character on sight or by reputation &mdash; name, station, occupation, public reputation. The shallow first impression.
          </p>
          <MarkdownLexicalEditor
            value={formData.identity}
            onChange={handleMarkdownFieldChange('identity')}
            remountKey={externalUpdateCount}
            namespace="NewCharacter.identity"
            ariaLabel="Identity"
            minHeight="6rem"
          />
        </div>

        <div>
          <label htmlFor="description" className="block qt-label mb-2 text-foreground">
            Description (Optional)
          </label>
          <p className="text-xs qt-text-secondary mb-2">
            How acquaintances perceive the character &mdash; behaviour, mannerisms, frequent verbal patterns. Not physical appearance (that lives in physical descriptions).
          </p>
          <MarkdownLexicalEditor
            value={formData.description}
            onChange={handleMarkdownFieldChange('description')}
            remountKey={externalUpdateCount}
            namespace="NewCharacter.description"
            ariaLabel="Description"
            minHeight="8rem"
          />
        </div>

        <div>
          <label htmlFor="manifesto" className="block qt-label mb-2 text-foreground">
            Manifesto (Optional)
          </label>
          <p className="text-xs qt-text-secondary mb-2">
            The foundational tenets of this character &mdash; the basic truths that anchor everything else. What this character is, at root.
          </p>
          <MarkdownLexicalEditor
            value={formData.manifesto}
            onChange={handleMarkdownFieldChange('manifesto')}
            remountKey={externalUpdateCount}
            namespace="NewCharacter.manifesto"
            ariaLabel="Manifesto"
            minHeight="8rem"
          />
        </div>

        <div>
          <label htmlFor="personality" className="block qt-label mb-2 text-foreground">
            Personality (Optional)
          </label>
          <p className="text-xs qt-text-secondary mb-2">
            What the character knows about themselves &mdash; inner drivers of speech and behaviour, motivations, beliefs.
          </p>
          <MarkdownLexicalEditor
            value={formData.personality}
            onChange={handleMarkdownFieldChange('personality')}
            remountKey={externalUpdateCount}
            namespace="NewCharacter.personality"
            ariaLabel="Personality"
            minHeight="8rem"
          />
        </div>

        <div>
          <label htmlFor="scenario" className="block qt-label mb-2 text-foreground">
            Scenario (Optional)
          </label>
          <p className="text-xs qt-text-secondary mb-2">
            Describe the setting and context for conversations.
          </p>
          <MarkdownLexicalEditor
            value={formData.scenario}
            onChange={handleMarkdownFieldChange('scenario')}
            remountKey={externalUpdateCount}
            namespace="NewCharacter.scenario"
            ariaLabel="Scenario"
            minHeight="8rem"
          />
        </div>

        <div>
          <label htmlFor="firstMessage" className="block qt-label mb-2 text-foreground">
            First Message (Optional)
          </label>
          <p className="text-xs qt-text-secondary mb-2">
            The character&rsquo;s opening message to start conversations.
          </p>
          <MarkdownLexicalEditor
            value={formData.firstMessage}
            onChange={handleMarkdownFieldChange('firstMessage')}
            remountKey={externalUpdateCount}
            namespace="NewCharacter.firstMessage"
            ariaLabel="First message"
            minHeight="6rem"
          />
        </div>

        <div>
          <label htmlFor="exampleDialogues" className="block qt-label mb-2 text-foreground">
            Example Dialogues (Optional)
          </label>
          <p className="text-xs qt-text-secondary mb-2">
            Example conversations to guide the AI&rsquo;s responses.
          </p>
          <MarkdownLexicalEditor
            value={formData.exampleDialogues}
            onChange={handleMarkdownFieldChange('exampleDialogues')}
            remountKey={externalUpdateCount}
            namespace="NewCharacter.exampleDialogues"
            ariaLabel="Example dialogues"
            minHeight="12rem"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="systemPrompt" className="block qt-label text-foreground">
              System Prompt (Optional)
            </label>
            <button
              type="button"
              onClick={openTemplateImport}
              className="qt-button-secondary text-xs px-2 py-1"
            >
              Import Template
            </button>
          </div>
          <p className="text-xs qt-text-secondary mb-2">
            Custom system instructions (will be combined with auto-generated prompt).
          </p>
          <MarkdownLexicalEditor
            value={formData.systemPrompt}
            onChange={handleMarkdownFieldChange('systemPrompt')}
            remountKey={externalUpdateCount}
            namespace="NewCharacter.systemPrompt"
            ariaLabel="System prompt"
            minHeight="8rem"
          />
        </div>

        <div>
          <label htmlFor="avatarUrl" className="block qt-label mb-2 text-foreground">
            Avatar URL (Optional)
          </label>
          <input
            type="url"
            id="avatarUrl"
            name="avatarUrl"
            value={formData.avatarUrl}
            onChange={handleChange}
            className="qt-input"
            placeholder="https://example.com/avatar.png"
          />
        </div>

        <div>
          <label htmlFor="defaultConnectionProfileId" className="block qt-label mb-2 text-foreground">
            Default Connection Profile (Optional)
          </label>
          <select
            id="defaultConnectionProfileId"
            name="defaultConnectionProfileId"
            value={formData.defaultConnectionProfileId}
            onChange={handleChange}
            className="qt-select"
          >
            <option value="">No default profile</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <p className="mt-1 qt-text-xs">
            Can be overridden for individual chats
          </p>
        </div>

        <div className="flex gap-4">
          <button
            type="submit"
            disabled={loading}
            className="qt-button flex-1 qt-button-primary"
          >
            {loading ? 'Creating...' : 'Create Character'}
          </button>
          <Link
            href="/aurora"
            className="qt-button px-6 py-3 qt-button-secondary text-center"
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Import Template Modal */}
      <ImportModal
        isOpen={showTemplateImport}
        loading={loadingTemplates}
        templates={templates}
        onClose={() => setShowTemplateImport(false)}
        onImport={handleTemplateImport}
      />

      {/* AI Wizard Modal */}
      <AIWizardModal
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        characterName={formData.name}
        currentData={buildWizardCurrentData(formData)}
        onApply={handleWizardApply}
      />
    </div>
  )
}
