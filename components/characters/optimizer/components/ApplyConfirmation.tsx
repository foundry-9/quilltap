'use client';

/**
 * ApplyConfirmation
 *
 * The final curtain before the refinements are committed to the character's
 * permanent record. Shows a summary of all accepted changes and awaits
 * the author's decisive hand upon the "Apply" button.
 */

import { Icon } from '@/components/ui/icon';
import type { OptimizerSuggestion } from '../types';

interface ApplyConfirmationProps {
  changes: Array<{ suggestion: OptimizerSuggestion; finalValue: string }>;
  applying: boolean;
  onApply: () => void;
  onBack: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  identity: 'Identity',
  description: 'Description',
  manifesto: 'Manifesto',
  personality: 'Personality',
  scenarios: 'Scenario',
  exampleDialogues: 'Example Dialogues',
  firstMessage: 'First Message',
  systemPrompt: 'System Prompt',
  systemPrompts: 'System Prompt',
  physicalDescription: 'Physical Description',
  talkativeness: 'Talkativeness',
  wardrobeItems: 'Wardrobe',
  aliases: 'Alias',
  title: 'Title',
};

const FIELD_BADGE_CLASS: Record<string, string> = {
  identity: 'qt-badge-primary',
  description: 'qt-badge-secondary',
  manifesto: 'qt-badge-primary',
  personality: 'qt-badge-character',
  scenarios: 'qt-badge-project',
  exampleDialogues: 'qt-badge-chat',
  firstMessage: 'qt-badge-message',
  systemPrompt: 'qt-badge-memory',
  systemPrompts: 'qt-badge-memory',
  physicalDescription: 'qt-badge-user-character',
  talkativeness: 'qt-badge-chat',
  wardrobeItems: 'qt-badge-user-character',
  aliases: 'qt-badge-primary',
  title: 'qt-badge-primary',
};

function truncate(text: string | unknown, maxLength: number = 120): string {
  const str = typeof text === 'string' ? text : String(text ?? '');
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength).trimEnd() + '…';
}

export function ApplyConfirmation({
  changes,
  applying,
  onApply,
  onBack,
}: ApplyConfirmationProps) {
  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <Icon name="file" className="w-12 h-12 qt-text-secondary" />
        <div className="flex flex-col gap-1">
          <h3 className="qt-section-title text-base">No Changes Accepted</h3>
          <p className="qt-section-subtitle text-sm">
            It appears you have declined all proposed amendments. Return to the review
            to reconsider, or close the proceedings altogether.
          </p>
        </div>
        <button type="button" onClick={onBack} className="qt-button-secondary">
          Return to Review
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary header */}
      <div className="qt-card p-4 qt-bg-primary/5 qt-border-primary/20">
        <div className="flex items-center gap-2 mb-1">
          <Icon name="check-circle" className="w-4 h-4 text-primary" />
          <h3 className="qt-section-title text-sm">
            {changes.length} {changes.length === 1 ? 'Amendment' : 'Amendments'} Awaiting Commission
          </h3>
        </div>
        <p className="qt-body-sm qt-text-secondary">
          The following refinements shall be inscribed permanently into the character record.
          This act, once performed, admits of no mechanical undoing — though you may of course
          return and amend matters by hand thereafter.
        </p>
      </div>

      {/* Change list */}
      <div className="flex flex-col gap-2">
        {changes.map(({ suggestion, finalValue }) => {
          const fieldLabel = FIELD_LABELS[suggestion.field] ?? suggestion.field;
          const fieldBadge = FIELD_BADGE_CLASS[suggestion.field] ?? 'qt-badge-secondary';
          const newItemName = suggestion.name ?? suggestion.title;
          const displayLabel = suggestion.subName
            ? `${fieldLabel}: ${suggestion.subName}`
            : newItemName
            ? `${fieldLabel}: ${newItemName}`
            : fieldLabel;

          return (
            <div key={suggestion.id} className="qt-card p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`${fieldBadge} text-xs`}>{displayLabel}</span>
                {suggestion.currentValue ? (
                  <span className="qt-caption">Revised</span>
                ) : (
                  <span className="qt-badge-success text-xs">Newly Added</span>
                )}
              </div>
              <p className="qt-body-sm qt-text-secondary leading-relaxed">
                {truncate(finalValue)}
              </p>
            </div>
          );
        })}
      </div>

      {/* Action bar */}
      <div className="flex gap-3 justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={applying}
          className="qt-button-secondary disabled:opacity-50"
        >
          <Icon name="arrow-left" className="w-4 h-4" />
          Back to Review
        </button>

        <button
          type="button"
          onClick={onApply}
          disabled={applying}
          className="qt-button-primary disabled:opacity-50"
        >
          {applying ? (
            <>
              <Icon name="refresh" className="w-4 h-4 animate-spin" />
              Applying Refinements…
            </>
          ) : (
            <>
              <Icon name="check" className="w-4 h-4" />
              Apply {changes.length} {changes.length === 1 ? 'Change' : 'Changes'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
