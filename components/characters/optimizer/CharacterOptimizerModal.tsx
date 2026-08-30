'use client';

/**
 * CharacterOptimizerModal
 *
 * The grand orchestrator of the "Refine from Memories" feature. Guides
 * the author through four distinct phases: Preflight, Progress, Review,
 * and Apply — transforming accumulated memories into character refinements
 * with all the ceremony the occasion demands.
 */

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { createPortal } from 'react-dom';
import type { CharacterOptimizerModalProps, OptimizerFilterOptions, OptimizerOutputMode } from './types';
import { useCharacterOptimizer } from './hooks/useCharacterOptimizer';
import { AnalysisSummary } from './components/AnalysisSummary';
import { SuggestionCard } from './components/SuggestionCard';
import { ApplyConfirmation } from './components/ApplyConfirmation';
import { ProgressBar } from './components/ProgressBar';

const STEP_LABELS: Record<string, string> = {
  loading: 'Retrieving the Commonplace Book…',
  analyzing: 'Analysing the memoirs for behavioural patterns…',
  generating: 'Composing suggested refinements…',
};

function ProgressStep({
  stepKey,
  label,
  currentStep,
}: {
  stepKey: string;
  label: string;
  currentStep: string | null;
}) {
  const isActive = currentStep === stepKey;
  const isDone =
    (stepKey === 'loading' && currentStep !== null && currentStep !== 'loading') ||
    (stepKey === 'analyzing' && currentStep === 'generating') ||
    (stepKey === 'generating' && currentStep === null);

  return (
    <div className={`flex items-center gap-3 py-2 px-3 rounded-md transition-colors ${isActive ? 'qt-bg-primary/10' : isDone ? 'opacity-60' : 'opacity-40'}`}>
      <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
        {isActive ? (
          <Icon name="refresh" className="w-4 h-4 text-primary animate-spin" />
        ) : isDone ? (
          <Icon name="check" className="w-4 h-4 qt-text-success" />
        ) : (
          <div className="w-2 h-2 rounded-full qt-bg-muted-foreground" />
        )}
      </div>
      <span className={`text-sm ${isActive ? 'text-foreground font-medium' : 'qt-text-secondary'}`}>
        {label}
      </span>
    </div>
  );
}

export function CharacterOptimizerModal({
  characterId,
  characterName,
  profiles,
  defaultConnectionProfileId,
  vaultAvailable = false,
  onClose,
  onApplied,
}: CharacterOptimizerModalProps) {
  const optimizer = useCharacterOptimizer();
  const [selectedProfileId, setSelectedProfileId] = useState(
    defaultConnectionProfileId ?? profiles[0]?.id ?? ''
  );
  const [applySuccess, setApplySuccess] = useState(false);
  const [maxMemories, setMaxMemories] = useState(30);
  const [searchQuery, setSearchQuery] = useState('');
  const [useSemanticSearch, setUseSemanticSearch] = useState(true);
  const [sinceDate, setSinceDate] = useState('');
  const [beforeDate, setBeforeDate] = useState('');
  const [saveToVault, setSaveToVault] = useState(false);

  useEscapeKey(onClose, !optimizer.loading && !optimizer.applying);

  const handleClose = () => {
    if (!optimizer.loading && !optimizer.applying) {
      onClose();
    }
  };

  const handleStart = async () => {
    if (!selectedProfileId) return;
    const filterOptions: OptimizerFilterOptions = {
      maxMemories,
      searchQuery,
      useSemanticSearch,
      sinceDate: sinceDate || null,
      beforeDate: beforeDate || null,
    };
    const outputMode: OptimizerOutputMode =
      vaultAvailable && saveToVault ? 'suggestions-file' : 'apply';
    await optimizer.startOptimization(characterId, selectedProfileId, filterOptions, outputMode);
  };

  const handleApply = async () => {
    await optimizer.applyChanges(characterId);
    if (!optimizer.error) {
      setApplySuccess(true);
      setTimeout(() => {
        onApplied();
      }, 1500);
    }
  };

  const acceptedChanges = optimizer.getAcceptedChanges();
  const currentSuggestion = optimizer.suggestions[optimizer.currentIndex];
  const allReviewed = optimizer.suggestions.length > 0 &&
    optimizer.suggestions.every((s) => optimizer.decisions.has(s.id));

  const reviewedCount = optimizer.suggestions.filter((s) => optimizer.decisions.has(s.id)).length;

  return createPortal(
    <div className="qt-dialog-overlay" onClick={handleClose}>
      <div
        className="qt-dialog w-full max-w-2xl h-[92vh] m-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="qt-dialog-header flex items-start justify-between flex-shrink-0">
          <div className="flex flex-col gap-0.5">
            <h2 className="qt-dialog-title flex items-center gap-2">
              <Icon name="book" className="w-5 h-5 text-primary" />
              Refine from Memories
            </h2>
            <p className="qt-dialog-description">
              {characterName} &mdash;{' '}
              {optimizer.phase === 'preflight' && 'Configure & commence the refinement proceedings'}
              {optimizer.phase === 'progress' && 'The automata are consulting the memoirs…'}
              {optimizer.phase === 'review' && `Review ${optimizer.suggestions.length} proposed ${optimizer.suggestions.length === 1 ? 'amendment' : 'amendments'}`}
              {optimizer.phase === 'apply' && 'Confirm amendments for commission'}
              {optimizer.phase === 'suggestions-file-written' && 'Suggestions inscribed in the vault'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={optimizer.loading || optimizer.applying}
            className="qt-button-icon qt-button-ghost disabled:opacity-50 flex-shrink-0"
            aria-label="Close"
          >
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8 flex flex-col gap-5">

          {/* ===== PREFLIGHT PHASE ===== */}
          {optimizer.phase === 'preflight' && (
            <div className="flex flex-col gap-5">
              <div className="qt-card p-4">
                <p className="qt-body text-sm leading-relaxed">
                  This instrument shall consult the character&rsquo;s Commonplace Book — their accumulated
                  memoirs — and propose refinements to their profile based upon the patterns of behaviour
                  and personality therein observed. You shall review each proposal and accept, reject,
                  or amend it as your editorial judgement sees fit.
                </p>
              </div>

              {profiles.length === 0 ? (
                <div className="qt-card p-4 qt-border-destructive/30 qt-bg-destructive/5">
                  <div className="flex items-center gap-2 qt-text-destructive mb-2">
                    <Icon name="alert-triangle" className="w-4 h-4" />
                    <span className="text-sm font-semibold">No Connection Profile Available</span>
                  </div>
                  <p className="qt-body-sm qt-text-secondary">
                    The refinement proceedings require an AI connection profile to be configured.
                    Please visit The Foundry&rsquo;s Connection Profiles section to establish one
                    before proceeding.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="qt-label" htmlFor="optimizer-profile-select">
                    Select AI Model
                  </label>
                  <select
                    id="optimizer-profile-select"
                    className="qt-select"
                    value={selectedProfileId}
                    onChange={(e) => setSelectedProfileId(e.target.value)}
                  >
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <p className="qt-helper">
                    The selected model shall perform the analysis and compose the proposed refinements.
                  </p>
                </div>
              )}

              {/* Memory count slider */}
              {profiles.length > 0 && (
                <div className="flex flex-col gap-2">
                  <label className="qt-label" htmlFor="optimizer-max-memories">
                    Maximum Memories to Analyse: <span className="text-primary font-semibold">{maxMemories}</span>
                  </label>
                  <input
                    id="optimizer-max-memories"
                    type="range"
                    min={5}
                    max={200}
                    step={5}
                    value={maxMemories}
                    onChange={(e) => setMaxMemories(Number(e.target.value))}
                    className="qt-range w-full"
                  />
                  <div className="flex justify-between text-[10px] qt-text-secondary">
                    <span>5</span>
                    <span>200</span>
                  </div>
                </div>
              )}

              {/* Filter section */}
              {profiles.length > 0 && (
                <details className="qt-card">
                  <summary className="px-4 py-3 cursor-pointer qt-label select-none">
                    Filter Memories
                  </summary>
                  <div className="px-4 pb-4 flex flex-col gap-4 border-t qt-border-default pt-3">
                    {/* Text / semantic search */}
                    <div className="flex flex-col gap-2">
                      <label className="qt-label" htmlFor="optimizer-search-query">
                        Search Query
                      </label>
                      <input
                        id="optimizer-search-query"
                        type="text"
                        className="qt-input"
                        placeholder="e.g. &ldquo;betrayal&rdquo; or &ldquo;relationship with the duke&rdquo;"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        maxLength={500}
                      />
                      <label className="flex items-center gap-2 text-sm qt-text-secondary">
                        <input
                          type="checkbox"
                          className="qt-checkbox"
                          checked={useSemanticSearch}
                          onChange={(e) => setUseSemanticSearch(e.target.checked)}
                        />
                        Use semantic search (finds conceptually related memories)
                      </label>
                    </div>

                    {/* Date filters */}
                    <div className="flex gap-4">
                      <div className="flex flex-col gap-1 flex-1">
                        <label className="qt-label" htmlFor="optimizer-since-date">
                          Since
                        </label>
                        <input
                          id="optimizer-since-date"
                          type="date"
                          className="qt-input"
                          value={sinceDate}
                          onChange={(e) => setSinceDate(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1 flex-1">
                        <label className="qt-label" htmlFor="optimizer-before-date">
                          Before
                        </label>
                        <input
                          id="optimizer-before-date"
                          type="date"
                          className="qt-input"
                          value={beforeDate}
                          onChange={(e) => setBeforeDate(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </details>
              )}

              {/* Output mode — save suggestions to vault instead of applying */}
              {profiles.length > 0 && vaultAvailable && (
                <div className="qt-card p-4 flex flex-col gap-2">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="qt-checkbox mt-0.5"
                      checked={saveToVault}
                      onChange={(e) => setSaveToVault(e.target.checked)}
                    />
                    <span className="flex flex-col gap-1">
                      <span className="qt-label text-sm">
                        Save as suggestions in the vault (for later discussion)
                      </span>
                      <span className="qt-helper">
                        In lieu of applying amendments directly, the proceedings shall be inscribed as a
                        markdown dossier in the character&rsquo;s vault &mdash; at
                        <code className="qt-code text-[11px] mx-1">Suggestions/refinement-&lt;timestamp&gt;.md</code>
                        &mdash; so that author and character may review and debate the proposals at leisure before any are commissioned.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* ===== PROGRESS PHASE ===== */}
          {optimizer.phase === 'progress' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="qt-section-title text-sm">Consulting the Memoirs</h3>
                <p className="qt-section-subtitle text-xs">
                  The automata are at their labours. Please stand by.
                </p>
              </div>

              {/* Progress bar */}
              <ProgressBar currentStep={optimizer.progressStep} startedAt={optimizer.startedAt} />

              <div className="flex flex-col gap-1 qt-card p-3">
                {Object.entries(STEP_LABELS).map(([key, label]) => (
                  <ProgressStep
                    key={key}
                    stepKey={key}
                    label={label}
                    currentStep={optimizer.progressStep}
                  />
                ))}
              </div>

              {optimizer.progressStep === 'generating' && optimizer.progressSubStep && (
                <p className="qt-caption text-center">
                  {optimizer.progressSubStep.label}
                  {optimizer.progressSubStep.total > 1 && (
                    <> &mdash; pass {optimizer.progressSubStep.index} of {optimizer.progressSubStep.total}</>
                  )}
                </p>
              )}

              {optimizer.memoryCount > 0 && (
                <p className="qt-caption text-center">
                  {optimizer.filteredCount > optimizer.memoryCount ? (
                    <>{optimizer.filteredCount} {optimizer.filteredCount === 1 ? 'memoir' : 'memoirs'} matched; top {optimizer.memoryCount} selected for analysis</>
                  ) : (
                    <>{optimizer.memoryCount} {optimizer.memoryCount === 1 ? 'memory' : 'memories'} retrieved from the Commonplace Book</>
                  )}
                </p>
              )}

              {/* Show analysis summary once available */}
              {optimizer.analysis && (
                <AnalysisSummary analysis={optimizer.analysis} memoryCount={optimizer.memoryCount} />
              )}

              {optimizer.noSuggestionsMessage && !optimizer.loading && (
                <div className="qt-card p-4 text-center flex flex-col items-center gap-3">
                  <Icon name="check-circle" className="w-10 h-10 qt-text-secondary" />
                  <p className="qt-body-sm qt-text-secondary leading-relaxed max-w-sm">
                    {optimizer.noSuggestionsMessage}
                  </p>
                  <button type="button" onClick={handleClose} className="qt-button-secondary qt-button-sm">
                    Close
                  </button>
                </div>
              )}

              {optimizer.error && (
                <div className="qt-card p-3 qt-border-destructive/30 qt-bg-destructive/5">
                  <p className="text-sm qt-text-destructive">{optimizer.error}</p>
                </div>
              )}
            </div>
          )}

          {/* ===== REVIEW PHASE ===== */}
          {optimizer.phase === 'review' && optimizer.suggestions.length > 0 && (
            <div className="flex flex-col gap-4 flex-1 min-h-0">
              {/* Progress through suggestions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {optimizer.suggestions.map((_, idx) => {
                    const hasDecision = optimizer.decisions.has(optimizer.suggestions[idx].id);
                    const decision = optimizer.decisions.get(optimizer.suggestions[idx].id);
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => optimizer.goToSuggestion(idx)}
                        aria-label={`Go to suggestion ${idx + 1}`}
                        className={`rounded-full transition-all ${
                          idx === optimizer.currentIndex
                            ? 'w-6 h-2.5 qt-bg-primary'
                            : hasDecision
                            ? decision === 'rejected'
                              ? 'w-2.5 h-2.5 qt-bg-destructive/60'
                              : 'w-2.5 h-2.5 qt-bg-success/60'
                            : 'w-2.5 h-2.5 qt-bg-muted-foreground/30 hover:qt-bg-muted-foreground/60'
                        }`}
                      />
                    );
                  })}
                </div>
                <span className="qt-caption">
                  {reviewedCount} of {optimizer.suggestions.length} reviewed
                </span>
              </div>

              {/* Current suggestion card */}
              {currentSuggestion && (
                <SuggestionCard
                  suggestion={currentSuggestion}
                  decision={optimizer.decisions.get(currentSuggestion.id)}
                  editedValue={optimizer.editedValues.get(currentSuggestion.id)}
                  onAccept={() => optimizer.decideSuggestion(currentSuggestion.id, 'accepted')}
                  onReject={() => optimizer.decideSuggestion(currentSuggestion.id, 'rejected')}
                  onEdit={(value) => optimizer.editSuggestion(currentSuggestion.id, value)}
                  index={optimizer.currentIndex}
                  total={optimizer.suggestions.length}
                />
              )}

              {/* Skip to apply */}
              {allReviewed && optimizer.currentIndex < optimizer.suggestions.length - 1 && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => optimizer.setPhase('apply')}
                    className="qt-action text-xs"
                  >
                    All proposals reviewed — proceed to Apply Changes
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ===== SUGGESTIONS-FILE-WRITTEN PHASE ===== */}
          {optimizer.phase === 'suggestions-file-written' && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="w-14 h-14 rounded-full qt-bg-success/10 flex items-center justify-center">
                <Icon name="file" className="w-8 h-8 qt-text-success" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="qt-section-title">Suggestions Inscribed</h3>
                <p className="qt-section-subtitle text-sm max-w-md">
                  A dossier of {optimizer.suggestions.length}{' '}
                  {optimizer.suggestions.length === 1 ? 'proposal has' : 'proposals have'} been deposited in {characterName}&rsquo;s vault. Author
                  and character are invited to peruse, deliberate, and commission refinements in their own good time.
                </p>
                {optimizer.suggestionsFilePath && (
                  <p className="qt-caption mt-2 font-mono text-xs break-all">
                    {optimizer.suggestionsFilePath}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ===== APPLY PHASE ===== */}
          {optimizer.phase === 'apply' && (
            <>
              {applySuccess ? (
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <div className="w-14 h-14 rounded-full qt-bg-success/10 flex items-center justify-center">
                    <Icon name="check" className="w-8 h-8 qt-text-success" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="qt-section-title">Refinements Commissioned</h3>
                    <p className="qt-section-subtitle text-sm">
                      The amendments have been inscribed into {characterName}&rsquo;s permanent record
                      with all due ceremony. The character is now the beneficiary of your editorial wisdom.
                    </p>
                  </div>
                </div>
              ) : (
                <ApplyConfirmation
                  changes={acceptedChanges}
                  applying={optimizer.applying}
                  onApply={handleApply}
                  onBack={() => optimizer.setPhase('review')}
                />
              )}

              {optimizer.error && !applySuccess && (
                <div className="qt-card p-3 qt-border-destructive/30 qt-bg-destructive/5">
                  <p className="text-sm qt-text-destructive">{optimizer.error}</p>
                </div>
              )}
            </>
          )}

        </div>

        {/* Footer */}
        {optimizer.phase === 'preflight' && (
          <div className="qt-dialog-footer flex justify-between flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="qt-button-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={!selectedProfileId || profiles.length === 0}
              className="qt-button-primary disabled:opacity-50"
            >
              <Icon name="book" className="w-4 h-4" />
              Commence Refinement
            </button>
          </div>
        )}

        {optimizer.phase === 'review' && (
          <div className="qt-dialog-footer flex flex-col gap-2 flex-shrink-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={optimizer.prevSuggestion}
                disabled={optimizer.currentIndex === 0}
                className="qt-button-ghost qt-button-sm disabled:opacity-30"
              >
                <Icon name="chevron-left" className="w-4 h-4" />
                Previous
              </button>

              <div className="flex-1" />

              {optimizer.currentIndex < optimizer.suggestions.length - 1 ? (
                <button
                  type="button"
                  onClick={optimizer.nextSuggestion}
                  className="qt-button-secondary qt-button-sm"
                >
                  Next
                  <Icon name="chevron-right" className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => optimizer.setPhase('apply')}
                  className="qt-button-primary qt-button-sm"
                >
                  Review Changes
                  <Icon name="chevron-right" className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="qt-caption">
                {acceptedChanges.length} {acceptedChanges.length === 1 ? 'change' : 'changes'} accepted so far
              </span>
              <button
                type="button"
                onClick={() => optimizer.setPhase('apply')}
                className="qt-button-primary"
              >
                Review &amp; Apply Changes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
