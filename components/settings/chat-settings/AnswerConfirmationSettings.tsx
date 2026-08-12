'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import {
  ChatSettings,
  AnswerConfirmationSettings as AnswerConfirmationSettingsType,
  DEFAULT_ANSWER_CONFIRMATION_SETTINGS,
} from './types'

export interface AnswerConfirmationSettingsProps {
  settings: ChatSettings
  saving: boolean
  onUpdate: (updates: Partial<AnswerConfirmationSettingsType>) => Promise<void>
}

/**
 * Global default for the Salon's answer-confirmation check. When a character
 * leans on their recollections or a lookup this turn, a quiet second reader
 * checks the reply against that material before it lands — and, if something
 * looks off, the character is given the chance to stand by it or set it right.
 * Off by default; a whole project or a single chat may overrule this.
 */
export function AnswerConfirmationSettings({ settings, saving, onUpdate }: AnswerConfirmationSettingsProps) {
  const enabled = settings.answerConfirmationSettings?.enabled ?? DEFAULT_ANSWER_CONFIRMATION_SETTINGS.enabled ?? false

  return (
    <SettingsCard
      title="Answer Confirmation"
      subtitle="Vet a character's looked-up answers against what they actually knew this turn"
    >
      <div className="space-y-3">
        <label className="flex items-start gap-3 p-4 border qt-border-default rounded qt-hover-accent cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            disabled={saving}
            className="qt-checkbox mt-1"
          />
          <div className="flex-1">
            <div className="font-medium">Confirm looked-up answers by default</div>
            <div className="qt-text-small">
              When a character&apos;s reply rests on their recollections or a lookup (a web search, a peek back
              through the conversation, or a document read), a swift second reader checks the reply for
              contradictions before it lands. Should something ring false, the character is asked to stand by their
              words or amend them — and every checked reply wears a small mark you can hover for the particulars.
              This adds a round-trip or two per qualifying turn, so it arrives switched off; enable it here, or for a
              particular project or chat.
            </div>
          </div>
        </label>
      </div>
    </SettingsCard>
  )
}
