'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { CompositionModeDefaultSettings } from '@/components/settings/chat-settings/CompositionModeDefaultSettings'
import { ComposerSpellcheckSettings } from '@/components/settings/chat-settings/ComposerSpellcheckSettings'
import { ComposerEmojiSettings } from '@/components/settings/chat-settings/ComposerEmojiSettings'
import { ComposerUnicodeSettings } from '@/components/settings/chat-settings/ComposerUnicodeSettings'
import { AutoScrollSettings } from '@/components/settings/chat-settings/AutoScrollSettings'
import { TextReplacementSettings } from '@/components/settings/chat-settings/TextReplacementSettings'
import { TokenDisplaySettingsComponent } from '@/components/settings/chat-settings/TokenDisplaySettings'
import { ContextCompressionSettingsComponent } from '@/components/settings/chat-settings/ContextCompressionSettings'
import { MemoryCascadeSettings } from '@/components/settings/chat-settings/MemoryCascadeSettings'
import { ImageDescriptionSettings } from '@/components/settings/chat-settings/ImageDescriptionSettings'
import { AutomationSettings } from '@/components/settings/chat-settings/AutomationSettings'
import { CustomToolsSettings } from '@/components/settings/chat-settings/CustomToolsSettings'
import { GeneralStateSettings } from '@/components/settings/chat-settings/GeneralStateSettings'
import { AgentModeSettings } from '@/components/settings/chat-settings/AgentModeSettings'
import { ThinkingDisplaySettings } from '@/components/settings/chat-settings/ThinkingDisplaySettings'
import { AnswerConfirmationSettings } from '@/components/settings/chat-settings/AnswerConfirmationSettings'
import { SmartTypographySettings } from '@/components/settings/chat-settings/SmartTypographySettings'
import { DangerousContentSettings } from '@/components/settings/chat-settings/DangerousContentSettings'
import { DataRetentionSettings } from '@/components/settings/chat-settings/DataRetentionSettings'
import { BrahmaConsoleSettings } from '@/components/settings/chat-settings/BrahmaConsoleSettings'
import { TabooSettings } from '@/components/settings/chat-settings/TabooSettings'
import { AutonomousRoomSettingsComponent } from '@/components/settings/chat-settings/AutonomousRoomSettings'
import { AutonomousRoomsCard } from '@/components/tools/autonomous-rooms-card'
import { useSettingsSection } from './useSettingsSection'

export function ChatTabContent() {
  const info = useSubsystemInfo('salon')
  const activeSection = useSettingsSection()
  const {
    settings,
    loading,
    saving,
    connectionProfiles,
    imageProfiles,
    loadingProfiles,
    handleTokenDisplayChange,
    handleCompositionModeDefaultChange,
    handleComposerSpellcheckChange,
    handleComposerEmojiChange,
    handleComposerUnicodeChange,
    handleAutoScrollOnResponseCompleteChange,
    handleTextReplacementsEnabledChange,
    handleContextCompressionUpdate,
    handleMemoryCascadeUpdate,
    handleImageDescriptionProfileChange,
    handleUncensoredImageDescriptionProfileChange,
    handleAutoDetectRngChange,
    handleCustomToolsChange,
    handleAgentModeDefaultEnabledChange,
    handleAgentModeMaxTurnsChange,
    handleDangerousContentUpdate,
    handleCheapLLMUpdate,
    handleAutonomousRoomSettingsUpdate,
    handleThinkingDisplayUpdate,
    handleAnswerConfirmationUpdate,
    handleSmartTypographyUpdate,
  } = useChatSettingsContext()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="qt-text-secondary">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return <div className="qt-alert-error">Failed to load chat settings</div>
  }

  return (
    <div>
      <p className="qt-text-small qt-text-muted italic mb-6">{info.description}</p>

      <div className="space-y-4">
        <CollapsibleCard title="Composition Mode" description="Whether new chats start in composition mode" sectionId="composition-mode" forceOpen={activeSection === 'composition-mode'}>
          <CompositionModeDefaultSettings
            settings={settings}
            saving={saving}
            onChange={handleCompositionModeDefaultChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Composer" description="Composer behavior and input aids" sectionId="composer-spellcheck" forceOpen={activeSection === 'composer-spellcheck'}>
          <ComposerSpellcheckSettings
            settings={settings}
            saving={saving}
            onChange={handleComposerSpellcheckChange}
          />
          <ComposerEmojiSettings
            settings={settings}
            saving={saving}
            onChange={handleComposerEmojiChange}
          />
          <ComposerUnicodeSettings
            settings={settings}
            saving={saving}
            onChange={handleComposerUnicodeChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Auto-Scroll" description="Whether the Salon follows new messages to the bottom" sectionId="auto-scroll" forceOpen={activeSection === 'auto-scroll'}>
          <AutoScrollSettings
            settings={settings}
            saving={saving}
            onChange={handleAutoScrollOnResponseCompleteChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Text Replacement" description="Replace literal triggers with replacement text on word boundaries" sectionId="text-replacements" forceOpen={activeSection === 'text-replacements'}>
          <TextReplacementSettings
            settings={settings}
            saving={saving}
            onMasterToggleChange={handleTextReplacementsEnabledChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Smart Typography" description="Curly quotes when displaying messages; real dashes and ellipsis as you type" sectionId="smart-typography" forceOpen={activeSection === 'smart-typography'}>
          <SmartTypographySettings
            settings={settings}
            saving={saving}
            onUpdate={handleSmartTypographyUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Token Display" description="Configure token count and cost display" sectionId="token-display" forceOpen={activeSection === 'token-display'}>
          <TokenDisplaySettingsComponent
            settings={settings}
            saving={saving}
            onTokenDisplayChange={handleTokenDisplayChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Context Compression" description="Configure how older messages are compressed" sectionId="context-compression" forceOpen={activeSection === 'context-compression'}>
          <ContextCompressionSettingsComponent
            settings={settings}
            saving={saving}
            onUpdate={handleContextCompressionUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Memory Cascade" description="Control how memories behave when messages change" sectionId="memory-cascade" forceOpen={activeSection === 'memory-cascade'}>
          <MemoryCascadeSettings
            settings={settings}
            saving={saving}
            onUpdate={handleMemoryCascadeUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Image Description" description="Configure image description generation" sectionId="image-description" forceOpen={activeSection === 'image-description'}>
          <ImageDescriptionSettings
            settings={settings}
            saving={saving}
            loadingProfiles={loadingProfiles}
            connectionProfiles={connectionProfiles}
            onProfileChange={handleImageDescriptionProfileChange}
            onUncensoredProfileChange={handleUncensoredImageDescriptionProfileChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Automation" description="Configure automatic detection features" sectionId="automation" forceOpen={activeSection === 'automation'}>
          <AutomationSettings
            settings={settings}
            saving={saving}
            onAutoDetectRngChange={handleAutoDetectRngChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Custom Tools" description="Whether Pascal's custom tools are offered to models and the composer" sectionId="custom-tools" forceOpen={activeSection === 'custom-tools'}>
          <CustomToolsSettings
            settings={settings}
            saving={saving}
            onChange={handleCustomToolsChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="General State" description="Instance-wide persistent state shared by every chat (bottom tier of the state cascade)" sectionId="general-state" forceOpen={activeSection === 'general-state'}>
          <GeneralStateSettings />
        </CollapsibleCard>

        <CollapsibleCard title="Agent Mode" description="Configure iterative tool use with self-correction" sectionId="agent-mode" forceOpen={activeSection === 'agent-mode'}>
          <AgentModeSettings
            settings={settings}
            saving={saving}
            onDefaultEnabledChange={handleAgentModeDefaultEnabledChange}
            onMaxTurnsChange={handleAgentModeMaxTurnsChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Thinking / Reasoning" description="Show reasoning models' chain-of-thought in chat (display only)" sectionId="thinking-display" forceOpen={activeSection === 'thinking-display'}>
          <ThinkingDisplaySettings
            settings={settings}
            saving={saving}
            onUpdate={handleThinkingDisplayUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Answer Confirmation" description="Vet looked-up answers against what the character actually knew this turn" sectionId="answer-confirmation" forceOpen={activeSection === 'answer-confirmation'}>
          <AnswerConfirmationSettings
            settings={settings}
            saving={saving}
            onUpdate={handleAnswerConfirmationUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Dangerous Content" description="Configure content detection, routing, and display behavior" sectionId="dangerous-content" forceOpen={activeSection === 'dangerous-content'}>
          <DangerousContentSettings
            settings={settings}
            saving={saving}
            connectionProfiles={connectionProfiles}
            imageProfiles={imageProfiles}
            loadingProfiles={loadingProfiles}
            onUpdate={handleDangerousContentUpdate}
            imagePromptProfileId={settings.cheapLLMSettings.imagePromptProfileId}
            onImagePromptProfileChange={(id) => handleCheapLLMUpdate({ imagePromptProfileId: id })}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Taboo" description="Phrases no character may utter, anywhere in the house" sectionId="taboo" forceOpen={activeSection === 'taboo'}>
          <TabooSettings />
        </CollapsibleCard>

        <CollapsibleCard title="Data Retention" description="How long inactive chats keep their regenerable working data" sectionId="data-retention" forceOpen={activeSection === 'data-retention'}>
          <DataRetentionSettings />
        </CollapsibleCard>

        <CollapsibleCard title="Brahma Console" description="How many tool-use turns the Console may take before it must answer" sectionId="brahma-console" forceOpen={activeSection === 'brahma-console'}>
          <BrahmaConsoleSettings />
        </CollapsibleCard>

        <CollapsibleCard title="Autonomous Rooms" description="Defaults for private character-to-character rooms" sectionId="autonomous-rooms" forceOpen={activeSection === 'autonomous-rooms'}>
          <AutonomousRoomSettingsComponent
            settings={settings}
            saving={saving}
            onUpdate={handleAutonomousRoomSettingsUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Scheduled Autonomous Rooms" description="Pause, resume, or stop scheduled rooms (and any ad-hoc room currently running)" sectionId="autonomous-room-schedules" forceOpen={activeSection === 'autonomous-room-schedules'}>
          <AutonomousRoomsCard />
        </CollapsibleCard>
      </div>
    </div>
  )
}
