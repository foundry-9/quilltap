'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { Character, TemplateCounts, UserControlledCharacter } from '../types'
import { TemplateDisplay } from '@/components/characters/TemplateHighlighter'
import { ReverseUserDialog } from './ReverseUserDialog'

interface CharacterDetailsProps {
  characterId: string
  character: Character | null
  templateCounts: TemplateCounts
  literalCounts: { charCount: number; userCount: number }
  replacingTemplate: 'char' | 'user' | null
  reversingTemplate: 'char' | 'user' | null
  defaultPartnerName: string | null
  userControlledCharacters: UserControlledCharacter[]
  onTemplateReplace: (type: 'char' | 'user') => void
  onReverseTemplate: (type: 'char' | 'user', chosenName: string) => void
}

export function CharacterDetails({
  characterId,
  character,
  templateCounts,
  literalCounts,
  replacingTemplate,
  reversingTemplate,
  defaultPartnerName,
  userControlledCharacters,
  onTemplateReplace,
  onReverseTemplate,
}: CharacterDetailsProps) {
  const [showReverseUserDialog, setShowReverseUserDialog] = useState(false)

  if (!character) return null

  // Any template operation in flight disables all four buttons.
  const templateBusy = replacingTemplate !== null || reversingTemplate !== null
  // The reverse {{user}} picker can only offer *other* user-controlled characters.
  const otherUserControlled = userControlledCharacters.filter((c) => c.id !== characterId)

  return (
    <div className="space-y-6">
      {/* Edit Button Header with Template Replacement Buttons */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Character Name → {{char}} button */}
        {templateCounts.charCount > 0 && (
          <button
            onClick={() => onTemplateReplace('char')}
            disabled={templateBusy}
            className="flex items-center gap-1.5 rounded-lg border qt-border-primary/40 qt-bg-primary/10 px-3 py-2 qt-label text-primary qt-shadow-sm transition hover:qt-bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            title={`Replace ${templateCounts.charCount} occurrences of "${character?.name}" with {{char}}`}
          >
            {replacingTemplate === 'char' ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 qt-border-primary border-r-transparent"></div>
            ) : (
              <Icon name="refresh" className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">{character?.name}</span>
            <span className="text-primary">→</span>
            <code className="rounded qt-bg-primary/20 px-1 text-xs text-primary">{`{{char}}`}</code>
            <span className="text-xs text-primary/80">({templateCounts.charCount})</span>
          </button>
        )}

        {/* Persona Name → {{user}} button */}
        {defaultPartnerName && templateCounts.userCount > 0 && (
          <button
            onClick={() => onTemplateReplace('user')}
            disabled={templateBusy}
            className="flex items-center gap-1.5 rounded-lg border qt-border-success/40 qt-bg-success/10 px-3 py-2 qt-label qt-text-success qt-shadow-sm transition hover:qt-bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
            title={`Replace ${templateCounts.userCount} occurrences of "${defaultPartnerName}" with {{user}}`}
          >
            {replacingTemplate === 'user' ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 qt-border-success border-r-transparent"></div>
            ) : (
              <Icon name="refresh" className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">{defaultPartnerName}</span>
            <span className="qt-text-success">→</span>
            <code className="rounded qt-bg-success/20 px-1 text-xs qt-text-success">{`{{user}}`}</code>
            <span className="text-xs qt-text-success/80">({templateCounts.userCount})</span>
          </button>
        )}

        {/* {{char}} → Character Name button (reverse) */}
        {literalCounts.charCount > 0 && (
          <button
            onClick={() => onReverseTemplate('char', character.name)}
            disabled={templateBusy}
            className="flex items-center gap-1.5 rounded-lg border qt-border-primary/40 qt-bg-primary/10 px-3 py-2 qt-label text-primary qt-shadow-sm transition hover:qt-bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            title={`Replace ${literalCounts.charCount} occurrences of {{char}} with "${character?.name}"`}
          >
            {reversingTemplate === 'char' ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 qt-border-primary border-r-transparent"></div>
            ) : (
              <Icon name="refresh" className="w-4 h-4" />
            )}
            <code className="rounded qt-bg-primary/20 px-1 text-xs text-primary">{`{{char}}`}</code>
            <span className="text-primary">→</span>
            <span className="hidden sm:inline">{character?.name}</span>
            <span className="text-xs text-primary/80">({literalCounts.charCount})</span>
          </button>
        )}

        {/* {{user}} → chosen name button (reverse, opens picker) */}
        {literalCounts.userCount > 0 && otherUserControlled.length > 0 && (
          <button
            onClick={() => setShowReverseUserDialog(true)}
            disabled={templateBusy}
            className="flex items-center gap-1.5 rounded-lg border qt-border-success/40 qt-bg-success/10 px-3 py-2 qt-label qt-text-success qt-shadow-sm transition hover:qt-bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
            title={`Replace ${literalCounts.userCount} occurrences of {{user}} with a user-controlled character's name`}
          >
            {reversingTemplate === 'user' ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 qt-border-success border-r-transparent"></div>
            ) : (
              <Icon name="refresh" className="w-4 h-4" />
            )}
            <code className="rounded qt-bg-success/20 px-1 text-xs qt-text-success">{`{{user}}`}</code>
            <span className="qt-text-success">→</span>
            <span className="hidden sm:inline">name…</span>
            <span className="text-xs qt-text-success/80">({literalCounts.userCount})</span>
          </button>
        )}

        {/* A disabled fieldset can't inert a Link, so the edit door hides
            itself for an archived character (the write guard is the lock). */}
        {!character?.archivedAt && (
          <Link
            href={`/characters/${characterId}/edit`}
            className="character-edit-link flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition hover:qt-bg-primary/90"
          >
            <Icon name="pencil" className="w-4 h-4" />
            Edit Character
          </Link>
        )}
      </div>

      {/* Main Content with Template Highlighting */}
      <div className="space-y-6">
        {character?.identity && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              Identity
              {(templateCounts.fieldCounts.identity?.char > 0 || templateCounts.fieldCounts.identity?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.identity}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {character?.description && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              Description
              {(templateCounts.fieldCounts.description?.char > 0 || templateCounts.fieldCounts.description?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.description}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {character?.manifesto && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              Manifesto
              {(templateCounts.fieldCounts.manifesto?.char > 0 || templateCounts.fieldCounts.manifesto?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.manifesto}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {character?.personality && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              Personality
              {(templateCounts.fieldCounts.personality?.char > 0 || templateCounts.fieldCounts.personality?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.personality}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {character?.scenarios && character.scenarios.length > 0 && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              {character.scenarios.length === 1 ? 'Scenario' : 'Scenarios'}
            </h2>
            {character.scenarios.map((scenario) => (
              <div key={scenario.id} className="mb-4">
                {character.scenarios!.length > 1 && (
                  <h3 className="qt-label qt-text-secondary mb-1">{scenario.title}</h3>
                )}
                <div className="qt-text-small">
                  <TemplateDisplay
                    content={scenario.content}
                    characterName={character.name}
                    userCharacterName={defaultPartnerName}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {character?.firstMessage && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              First Message
              {(templateCounts.fieldCounts.firstMessage?.char > 0 || templateCounts.fieldCounts.firstMessage?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.firstMessage}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {character?.exampleDialogues && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              Example Dialogues
              {(templateCounts.fieldCounts.exampleDialogues?.char > 0 || templateCounts.fieldCounts.exampleDialogues?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.exampleDialogues}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {/* Active System Prompt Indicator */}
        {character?.systemPrompts && character.systemPrompts.length > 0 && (
          <div className="rounded-lg border qt-border-default qt-bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="code" className="w-5 h-5 text-primary" />
                <span className="text-sm qt-text-primary">Active System Prompt:</span>
                <span className="qt-text-small">
                  {character.systemPrompts.find(p => p.isDefault)?.name || character.systemPrompts[0]?.name || 'None'}
                </span>
                {character.systemPrompts.length > 1 && (
                  <span className="qt-text-xs">
                    (+{character.systemPrompts.length - 1} more)
                  </span>
                )}
              </div>
              <Link
                href={`/characters/${characterId}/view?tab=system-prompts`}
                className="text-sm text-primary hover:text-primary/80"
              >
                View all →
              </Link>
            </div>
          </div>
        )}
      </div>

      {showReverseUserDialog && (
        <ReverseUserDialog
          characters={otherUserControlled}
          onClose={() => setShowReverseUserDialog(false)}
          onConfirm={(name) => {
            setShowReverseUserDialog(false)
            onReverseTemplate('user', name)
          }}
        />
      )}
    </div>
  )
}
