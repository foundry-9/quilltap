'use client';

/**
 * SuggestionCard
 *
 * Presents a single proposed refinement to the character for review.
 * The discerning author may accept, reject, or amend each suggestion
 * as they see fit, guided by excerpts from the character's own memoirs.
 */

import { useState } from 'react';
import { Icon } from '@/components/ui/icon';
import type { OptimizerSuggestion, SuggestionDecision } from '../types';

// Belt-and-braces guard: the optimizer service already coerces these fields,
// but render paths shouldn't trust unknown JSON to be string-shaped.
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface SuggestionCardProps {
  suggestion: OptimizerSuggestion;
  decision?: SuggestionDecision;
  editedValue?: string;
  onAccept: () => void;
  onReject: () => void;
  onEdit: (value: string) => void;
  index: number;
  total: number;
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

function SignificanceBar({ significance }: { significance: number }) {
  const level = significance >= 0.6 ? 'high' : significance >= 0.3 ? 'medium' : 'low';
  const label = level === 'high' ? 'High Significance' : level === 'medium' ? 'Moderate Significance' : 'Minor Significance';
  const barClass = level === 'high' ? 'qt-bg-destructive' : level === 'medium' ? 'qt-bg-warning' : 'qt-bg-muted-foreground';
  const barWidth = level === 'high' ? 'w-full' : level === 'medium' ? 'w-2/3' : 'w-1/3';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 qt-bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${barWidth} ${barClass} rounded-full transition-all`} />
      </div>
      <span className="qt-caption">{label}</span>
    </div>
  );
}

function MemoryExcerpts({ excerpts }: { excerpts: string[] }) {
  const [expanded, setExpanded] = useState(false);

  if (excerpts.length === 0) return null;

  return (
    <div className="border-t qt-border-default pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 qt-caption hover:text-foreground transition-colors w-full text-left"
      >
        <Icon name="chevron-right" className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span>
          {expanded ? 'Conceal' : 'Consult'} the memoirs ({excerpts.length}{' '}
          {excerpts.length === 1 ? 'excerpt' : 'excerpts'})
        </span>
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          {excerpts.map((excerpt, idx) => (
            <blockquote
              key={idx}
              className="border-l-2 qt-border-primary/40 pl-3 py-1 qt-body-sm italic qt-text-secondary leading-relaxed"
            >
              &ldquo;{asText(excerpt)}&rdquo;
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}

export function SuggestionCard({
  suggestion,
  decision,
  editedValue,
  onAccept,
  onReject,
  onEdit,
  index,
  total,
}: SuggestionCardProps) {
  const safeProposedValue = asText(suggestion.proposedValue);
  const safeCurrentValue = asText(suggestion.currentValue);
  const safeRationale = asText(suggestion.rationale);

  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(editedValue ?? safeProposedValue);

  const fieldLabel = FIELD_LABELS[suggestion.field] ?? suggestion.field;
  const fieldBadge = FIELD_BADGE_CLASS[suggestion.field] ?? 'qt-badge-secondary';
  // For a refined sub-item show its name; for a brand-new system prompt show
  // the proposed name so the author knows what they're commissioning.
  const newItemName = suggestion.name ?? suggestion.title;
  const displayLabel = suggestion.subName
    ? `${fieldLabel}: ${suggestion.subName}`
    : newItemName
    ? `${fieldLabel}: ${newItemName}`
    : fieldLabel;

  const handleEditAccept = () => {
    onEdit(draftValue);
    setEditing(false);
  };

  const handleStartEdit = () => {
    setDraftValue(editedValue ?? safeProposedValue);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setDraftValue(editedValue ?? safeProposedValue);
  };

  const isAccepted = decision === 'accepted';
  const isRejected = decision === 'rejected';
  const isEdited = decision === 'edited';

  return (
    <div className={`qt-card flex flex-col gap-4 ${editing ? 'flex-1' : ''} ${isAccepted || isEdited ? 'qt-border-success/40' : isRejected ? 'qt-border-destructive/30 opacity-75' : ''}`}>
      {/* Header: field badge + progress */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={`${fieldBadge} text-xs`}>{displayLabel}</span>
        <span className="qt-caption">
          Proposal {index + 1} of {total}
        </span>
      </div>

      {/* Significance bar */}
      <SignificanceBar significance={suggestion.significance} />

      {/* Current vs proposed */}
      {!editing ? (
        <div className="flex flex-col gap-3">
          {safeCurrentValue ? (
            <div className="flex flex-col gap-1">
              <span className="qt-caption uppercase tracking-wider">Present Wording</span>
              <p className="qt-body-sm qt-bg-muted/50 rounded-md p-3 leading-relaxed border qt-border-default/50">
                {safeCurrentValue}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="qt-caption uppercase tracking-wider">Present Wording</span>
              <p className="qt-body-sm italic qt-text-secondary qt-bg-muted/30 rounded-md p-3 border border-dashed qt-border-default">
                (This field is presently unoccupied — the suggestion would furnish it anew)
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="qt-caption uppercase tracking-wider text-primary/70">
              {isEdited ? 'Your Amended Wording' : 'Proposed Refinement'}
            </span>
            <p className={`qt-body-sm rounded-md p-3 leading-relaxed border ${
              isEdited
                ? 'qt-bg-primary/5 qt-border-primary/30'
                : 'qt-bg-success/5 qt-border-success/20'
            }`}>
              {isEdited && editedValue ? editedValue : safeProposedValue}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 flex-1 min-h-0">
          <span className="qt-caption uppercase tracking-wider">Amend the Proposed Wording</span>
          <textarea
            className="qt-textarea text-sm min-h-[200px] flex-1 resize-y"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={handleCancelEdit} className="qt-button-ghost qt-button-sm">
              Abandon Edits
            </button>
            <button type="button" onClick={handleEditAccept} className="qt-button-primary qt-button-sm">
              Accept Amended Version
            </button>
          </div>
        </div>
      )}

      {/* Rationale */}
      {!editing && (
        <div className="flex flex-col gap-1">
          <span className="qt-caption uppercase tracking-wider">Rationale</span>
          <p className="qt-body-sm qt-text-secondary leading-relaxed">{safeRationale}</p>
        </div>
      )}

      {/* Memory excerpts */}
      {!editing && <MemoryExcerpts excerpts={suggestion.memoryExcerpts} />}

      {/* Action buttons */}
      {!editing && (
        <div className="flex gap-2 flex-wrap pt-1 border-t qt-border-default">
          {!isAccepted && !isEdited && (
            <button
              type="button"
              onClick={onAccept}
              className="qt-button-success qt-button-sm flex-1 min-w-[80px]"
            >
              <Icon name="check" className="w-3.5 h-3.5" />
              Accept
            </button>
          )}
          {(isAccepted || isEdited) && (
            <button
              type="button"
              onClick={onAccept}
              className="qt-button-ghost qt-button-sm flex-1 min-w-[80px] qt-text-success"
            >
              <Icon name="check" className="w-3.5 h-3.5" />
              {isEdited ? 'Accepted (Edited)' : 'Accepted'}
            </button>
          )}

          {!isRejected && (
            <button
              type="button"
              onClick={onReject}
              className="qt-button-destructive qt-button-sm flex-1 min-w-[80px]"
            >
              <Icon name="close" className="w-3.5 h-3.5" />
              Reject
            </button>
          )}
          {isRejected && (
            <button
              type="button"
              onClick={onAccept}
              className="qt-button-ghost qt-button-sm flex-1 min-w-[80px] qt-text-destructive"
            >
              <Icon name="close" className="w-3.5 h-3.5" />
              Rejected
            </button>
          )}

          <button
            type="button"
            onClick={handleStartEdit}
            className="qt-button-secondary qt-button-sm flex-1 min-w-[80px]"
          >
            <Icon name="pencil" className="w-3.5 h-3.5" />
            Edit &amp; Accept
          </button>
        </div>
      )}
    </div>
  );
}
