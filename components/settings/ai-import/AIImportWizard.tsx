'use client';

/**
 * AI Character Import Wizard
 *
 * Multi-step wizard that generates characters from source material using AI.
 * Steps: Source Material -> Configuration -> Generation -> Review & Import
 */

import { useCallback, useRef } from 'react';
import { useAIImport } from './hooks/useAIImport';
import {
  STEP_DISPLAY_NAMES,
  CORE_STEPS,
  type AIImportStepName,
  type StepProgress,
} from './types';
import { formatBytes } from '@/lib/utils/format-bytes';
import type { QuilltapExport } from '@/lib/export/types';
import {
  PROMPT_FIELD_HINTS,
  type PromptFieldHint,
  type PromptFieldHintKey,
} from '@/components/prompt-fields/field-hints';

// ============================================================================
// Step Indicator
// ============================================================================

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isComplete = step < current;
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center qt-label ${
                isActive
                  ? 'qt-bg-accent qt-text-on-accent'
                  : isComplete
                    ? 'qt-bg-success qt-text-on-accent'
                    : 'qt-bg-muted qt-text-muted'
              }`}
            >
              {isComplete ? '\u2713' : step}
            </div>
            {i < total - 1 && (
              <div className={`w-8 h-0.5 ${isComplete ? 'qt-bg-success' : 'qt-bg-muted'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Step 1: Source Material
// ============================================================================

function SourceMaterialStep({
  uploadedFiles,
  sourceText,
  uploading,
  uploadError,
  onSourceTextChange,
  onUploadFiles,
  onRemoveFile,
}: {
  uploadedFiles: { id: string; name: string; size: number }[];
  sourceText: string;
  uploading: boolean;
  uploadError: string | null;
  onSourceTextChange: (text: string) => void;
  onUploadFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        ['text/plain', 'text/markdown', 'application/pdf'].includes(f.type) ||
        f.name.endsWith('.txt') || f.name.endsWith('.md') || f.name.endsWith('.pdf')
      );
      if (files.length > 0) {
        onUploadFiles(files);
      }
    },
    [onUploadFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        onUploadFiles(files);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onUploadFiles]
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="qt-heading-3 mb-2">Upload Source Files</h3>
        <p className="qt-text-small qt-text-muted mb-3">
          Upload wiki pages, character sheets, story documents, or any text files describing a character.
          Supports .txt, .md, and .pdf files.
        </p>

        <div
          className="qt-border-default border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:qt-border-accent transition-colors"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".txt,.md,.pdf"
            multiple
            onChange={handleFileSelect}
          />
          <p className="qt-text-muted">
            {uploading ? 'Uploading...' : 'Drop files here or click to browse'}
          </p>
        </div>

        {uploadError && (
          <p className="qt-text-small qt-text-destructive mt-2">{uploadError}</p>
        )}

        {uploadedFiles.length > 0 && (
          <div className="mt-3 space-y-2">
            {uploadedFiles.map((file) => (
              <div key={file.id} className="flex items-center justify-between qt-bg-muted rounded px-3 py-2">
                <span className="qt-text-small truncate mr-2">{file.name} ({formatBytes(file.size)})</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFile(file.id);
                  }}
                  className="qt-button-ghost qt-button-sm qt-text-destructive hover:qt-text-destructive flex-shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="qt-heading-3 mb-2">Freeform Text</h3>
        <p className="qt-text-small qt-text-muted mb-3">
          Paste any additional character information, backstory, or notes here.
        </p>
        <textarea
          className="qt-input w-full"
          rows={8}
          value={sourceText}
          onChange={(e) => onSourceTextChange(e.target.value)}
          placeholder="Paste character descriptions, wiki content, backstory, personality notes..."
        />
      </div>
    </div>
  );
}

// ============================================================================
// Step 2: Configuration
// ============================================================================

function ConfigurationStep({
  profiles,
  loadingProfiles,
  profileId,
  includeMemories,
  includeChats,
  onProfileChange,
  onIncludeMemoriesChange,
  onIncludeChatsChange,
}: {
  profiles: { id: string; name: string; provider: string; modelName: string }[];
  loadingProfiles: boolean;
  profileId: string;
  includeMemories: boolean;
  includeChats: boolean;
  onProfileChange: (id: string) => void;
  onIncludeMemoriesChange: (v: boolean) => void;
  onIncludeChatsChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="qt-heading-3 mb-2">Connection Profile</h3>
        <p className="qt-text-small qt-text-muted mb-3">
          Select the AI provider to use for character generation.
        </p>
        {loadingProfiles ? (
          <p className="qt-text-muted">Loading profiles...</p>
        ) : profiles.length === 0 ? (
          <p className="qt-text-destructive">No connection profiles found. Create one in Settings first.</p>
        ) : (
          <select
            className="qt-input w-full"
            value={profileId}
            onChange={(e) => onProfileChange(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.provider} / {p.modelName})
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="qt-heading-3">Options</h3>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={includeMemories}
            onChange={(e) => onIncludeMemoriesChange(e.target.checked)}
            className="qt-checkbox"
          />
          <div>
            <span className="qt-text-default font-medium">Generate Memories</span>
            <p className="qt-text-small qt-text-muted">
              Extract key facts and experiences as Commonplace Book memories
            </p>
          </div>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={includeChats}
            onChange={(e) => onIncludeChatsChange(e.target.checked)}
            className="qt-checkbox"
          />
          <div>
            <span className="qt-text-default font-medium">Generate Example Chat</span>
            <p className="qt-text-small qt-text-muted">
              Create a sample conversation demonstrating the character&apos;s voice
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}

// ============================================================================
// Step 3: Generation Progress
// ============================================================================

function GenerationProgressStep({
  steps,
  generating,
  includeMemories,
  includeChats,
  error,
}: {
  steps: Record<AIImportStepName, StepProgress>;
  generating: boolean;
  includeMemories: boolean;
  includeChats: boolean;
  error: string | null;
}) {
  const visibleSteps: AIImportStepName[] = [
    ...(steps.analyzing.status !== 'pending' ? ['analyzing' as AIImportStepName] : []),
    ...CORE_STEPS,
    ...(includeMemories ? ['memories' as AIImportStepName] : []),
    ...(includeChats ? ['chats' as AIImportStepName] : []),
    ...(steps.repair.status !== 'pending' ? ['repair' as AIImportStepName] : []),
  ];

  const getStatusIcon = (status: StepProgress['status']): string => {
    switch (status) {
      case 'complete':
        return '\u2713';
      case 'error':
        return '\u26A0';
      case 'in_progress':
        return '\u25CF';
      default:
        return '\u25CB';
    }
  };

  const getStatusColor = (status: StepProgress['status']): string => {
    switch (status) {
      case 'complete':
        return 'qt-text-success';
      case 'error':
        return 'qt-text-warning';
      case 'in_progress':
        return 'qt-text-info animate-pulse';
      default:
        return 'qt-text-muted';
    }
  };

  return (
    <div className="space-y-4">
      {generating && (
        <p className="qt-text-muted text-sm">
          Generating character data... This may take a minute depending on source material length.
        </p>
      )}

      <div className="space-y-2">
        {visibleSteps.map((stepName) => {
          const step = steps[stepName];
          return (
            <div key={stepName} className="flex items-start gap-3 py-2">
              <span className={`text-lg flex-shrink-0 ${getStatusColor(step.status)}`}>
                {getStatusIcon(step.status)}
              </span>
              <div className="flex-1 min-w-0">
                <span className={`qt-text-default ${step.status === 'pending' ? 'qt-text-muted' : ''}`}>
                  {STEP_DISPLAY_NAMES[stepName]}
                </span>
                {step.snippet && (
                  <p className="qt-text-small qt-text-muted truncate">{step.snippet}</p>
                )}
                {step.error && (
                  <p className="qt-text-small qt-text-warning">{step.error}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="qt-bg-destructive/10 qt-border-destructive border rounded-lg p-3 mt-4">
          <p className="qt-text-destructive text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Step 4: Review & Import
// ============================================================================

/**
 * One generated prose passage, collapsed by default, with the shared voice
 * hint (PROMPT_FIELD_HINTS) shown beside it so the reviewer can compare the
 * generated text's form of address against the expected shape.
 */
function ReviewedFieldText({
  label,
  hint,
  text,
}: {
  label: string;
  hint?: PromptFieldHint;
  text: string;
}) {
  return (
    <details className="qt-bg-muted rounded-lg px-3 py-2">
      <summary className="cursor-pointer qt-text-small font-medium">{label}</summary>
      {hint?.example && (
        <p className="text-xs qt-text-muted mt-1">
          Written as: <em>{hint.example}</em>
        </p>
      )}
      <p className="qt-text-small mt-2 whitespace-pre-wrap">{text}</p>
    </details>
  );
}

function ReviewStep({
  result,
  stepResults,
  errors,
  importing,
  importResult,
  onImport,
  onAddMore,
  onStartOver,
  onDone,
}: {
  result: QuilltapExport | null;
  stepResults: Record<string, unknown> | null;
  errors: Record<string, string>;
  importing: boolean;
  importResult: { success: boolean; importedCount: number; warnings: string[] } | null;
  onImport: () => void;
  onAddMore: () => void;
  onStartOver: () => void;
  onDone?: () => void;
}) {
  if (!result || !stepResults) {
    return <p className="qt-text-muted">No generated data available.</p>;
  }

  const basics = stepResults.character_basics as {
    name?: string;
    title?: string;
    identity?: string;
    description?: string;
    manifesto?: string;
    personality?: string;
    scenario?: string;
  } | undefined;

  const memories = stepResults.memories as unknown[] | undefined;
  const chats = stepResults.chats as { title?: string; messages?: unknown[] } | undefined;
  const physDesc = stepResults.physical_descriptions as { shortPrompt?: string } | undefined;
  const pronouns = stepResults.pronouns as { subject?: string; object?: string; possessive?: string } | undefined;
  const aliases = stepResults.aliases as string[] | undefined;
  const systemPrompts = stepResults.system_prompts as { name?: string; content?: string }[] | undefined;
  const wardrobeItems = stepResults.wardrobe_items as { title?: string; components?: string[] }[] | undefined;

  const completedFields: string[] = [];
  const failedFields: string[] = [];

  const fieldNames: Record<string, string> = {
    character_basics: 'Character Basics',
    first_message: 'Dialogue',
    system_prompts: 'System Prompts',
    physical_descriptions: 'Appearance',
    wardrobe_items: 'Wardrobe',
    pronouns: 'Pronouns & Aliases',
    memories: 'Memories',
    chats: 'Example Chat',
  };

  for (const [key, label] of Object.entries(fieldNames)) {
    if (errors[key]) {
      failedFields.push(label);
    } else if (key in stepResults) {
      completedFields.push(label);
    }
  }

  // Prose passages worth a voice check before importing, each paired with its
  // shared hint so a wrong form of address is easy to spot.
  const proseCandidates: { hintKey: PromptFieldHintKey; text?: string }[] = [
    { hintKey: 'identity', text: basics?.identity },
    { hintKey: 'description', text: basics?.description },
    { hintKey: 'manifesto', text: basics?.manifesto },
    { hintKey: 'personality', text: basics?.personality },
    { hintKey: 'scenario', text: basics?.scenario },
  ];
  const reviewedProse = proseCandidates.filter(
    (f): f is { hintKey: PromptFieldHintKey; text: string } => !!f.text
  );
  const reviewedSystemPrompts = (systemPrompts ?? []).filter(
    (p): p is { name?: string; content: string } => !!p.content
  );

  if (importResult?.success) {
    return (
      <div className="space-y-4">
        <div className="qt-bg-success/10 border qt-border-success/30 rounded-lg p-4">
          <h3 className="qt-heading-3 qt-text-success mb-2">Import Successful!</h3>
          <p className="qt-text-default">
            <strong>{basics?.name}</strong> has been imported successfully.
            {importResult.importedCount > 1 && ` (${importResult.importedCount} entities imported)`}
          </p>
          {importResult.warnings.length > 0 && (
            <div className="mt-2">
              <p className="qt-text-small qt-text-muted">Warnings:</p>
              <ul className="list-disc list-inside qt-text-small qt-text-muted">
                {importResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onStartOver} className="qt-button-primary">
            Import Another Character
          </button>
          {onDone && (
            <button onClick={onDone} className="qt-button-secondary">
              Done
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Character Summary */}
      <div>
        <h3 className="qt-heading-3 mb-2">Character Summary</h3>
        <div className="qt-bg-muted rounded-lg p-4 space-y-2">
          <p className="qt-text-default">
            <strong>Name:</strong> {basics?.name || 'Unknown'}
          </p>
          {basics?.title && (
            <p className="qt-text-default">
              <strong>Title:</strong> {basics.title}
            </p>
          )}
          {pronouns && (
            <p className="qt-text-default">
              <strong>Pronouns:</strong> {pronouns.subject}/{pronouns.object}/{pronouns.possessive}
            </p>
          )}
          {aliases && aliases.length > 0 && (
            <p className="qt-text-default">
              <strong>Aliases:</strong> {aliases.join(', ')}
            </p>
          )}
          {basics?.description && (
            <p className="qt-text-small qt-text-muted mt-2">
              {basics.description.length > 200
                ? basics.description.substring(0, 200) + '...'
                : basics.description}
            </p>
          )}
        </div>
      </div>

      {/* Generated wording, with voice hints for review */}
      {(reviewedProse.length > 0 || reviewedSystemPrompts.length > 0) && (
        <div>
          <h3 className="qt-heading-3 mb-2">Generated Wording</h3>
          <p className="qt-text-small qt-text-muted mb-2">
            Cast an eye over each passage before importing — the line beneath each
            title shows the form of address the field expects.
          </p>
          <div className="space-y-2">
            {reviewedProse.map(({ hintKey, text }) => (
              <ReviewedFieldText
                key={hintKey}
                label={PROMPT_FIELD_HINTS[hintKey].label}
                hint={PROMPT_FIELD_HINTS[hintKey]}
                text={text}
              />
            ))}
            {reviewedSystemPrompts.map((p, idx) => (
              <ReviewedFieldText
                key={`system-prompt-${idx}`}
                label={p.name ? `System Prompt: ${p.name}` : 'System Prompt'}
                hint={PROMPT_FIELD_HINTS.systemPrompt}
                text={p.content}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completion Matrix */}
      <div>
        <h3 className="qt-heading-3 mb-2">Generated Content</h3>
        <div className="grid grid-cols-2 gap-2">
          {completedFields.map((field) => (
            <div key={field} className="flex items-center gap-2 qt-text-success qt-text-small">
              <span>{'\u2713'}</span> {field}
            </div>
          ))}
          {failedFields.map((field) => (
            <div key={field} className="flex items-center gap-2 qt-text-warning qt-text-small">
              <span>{'\u26A0'}</span> {field}
            </div>
          ))}
        </div>
      </div>

      {/* Counts */}
      <div className="flex gap-4 qt-text-small">
        {physDesc && <span className="qt-text-muted">Physical descriptions: 5 variants</span>}
        {systemPrompts && <span className="qt-text-muted">System prompts: {systemPrompts.length}</span>}
        {wardrobeItems && wardrobeItems.length > 0 && (
          <span className="qt-text-muted">
            Wardrobe: {wardrobeItems.length} item(s)
            {(() => {
              const outfits = wardrobeItems.filter((i) => i.components && i.components.length > 0).length;
              return outfits > 0 ? `, ${outfits} outfit(s)` : '';
            })()}
          </span>
        )}
        {memories && <span className="qt-text-muted">Memories: {memories.length}</span>}
        {chats?.messages && <span className="qt-text-muted">Chat messages: {chats.messages.length}</span>}
      </div>

      {/* Errors */}
      {Object.keys(errors).length > 0 && (
        <div className="qt-bg-muted rounded-lg p-3">
          <p className="qt-text-small qt-text-warning mb-1">
            Some steps had issues (non-critical):
          </p>
          {Object.entries(errors)
            .filter(([key]) => key !== '_fatal')
            .map(([key, err]) => (
              <p key={key} className="qt-text-small qt-text-muted">
                {fieldNames[key] || key}: {err}
              </p>
            ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={onImport}
          disabled={importing}
          className="qt-button-primary"
        >
          {importing ? 'Importing...' : 'Import Character'}
        </button>
        <button onClick={onAddMore} className="qt-button-secondary">
          Add More & Regenerate
        </button>
        <button onClick={onStartOver} className="qt-button-ghost">
          Start Over
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface AIImportWizardProps {
  onClose?: () => void;
  /**
   * Fired after a successful import with the destination character ids (the
   * Aurora caller ignores the argument; the Salon "Summon from Lore" wrapper
   * uses it to select the summoned character).
   */
  onImportSuccess?: (characterIds?: string[]) => void;
}

export default function AIImportWizard({ onClose, onImportSuccess }: AIImportWizardProps = {}) {
  const {
    currentStep,
    canProceed,
    error,
    // Step 1
    uploadedFiles,
    sourceText,
    uploading,
    uploadError,
    setSourceText,
    uploadFiles,
    removeFile,
    // Step 2
    profiles,
    loadingProfiles,
    profileId,
    includeMemories,
    includeChats,
    setProfileId,
    setIncludeMemories,
    setIncludeChats,
    // Step 3 & 4
    generation,
    startGeneration,
    // Import
    importing,
    importResult,
    importCharacter,
    // Navigation
    nextStep,
    prevStep,
    // Actions
    reset,
    addMoreMaterial,
  } = useAIImport();

  const handleImport = useCallback(async () => {
    const result = await importCharacter();
    // Only signal success when the import actually succeeded; hand the created
    // character ids to the caller (empty array on failure so listeners that
    // merely refetch — e.g. Aurora — still run without selecting anything).
    onImportSuccess?.(result?.success ? result.importedCharacterIds : []);
  }, [importCharacter, onImportSuccess]);

  const stepLabels = ['Source Material', 'Configuration', 'Generation', 'Review'];

  return (
    <div className="space-y-4">
      <StepIndicator current={currentStep} total={4} />

      <div className="mb-2">
        <h3 className="qt-heading-2">{stepLabels[currentStep - 1]}</h3>
      </div>

      {/* Step Content */}
      {currentStep === 1 && (
        <SourceMaterialStep
          uploadedFiles={uploadedFiles}
          sourceText={sourceText}
          uploading={uploading}
          uploadError={uploadError}
          onSourceTextChange={setSourceText}
          onUploadFiles={uploadFiles}
          onRemoveFile={removeFile}
        />
      )}

      {currentStep === 2 && (
        <ConfigurationStep
          profiles={profiles}
          loadingProfiles={loadingProfiles}
          profileId={profileId}
          includeMemories={includeMemories}
          includeChats={includeChats}
          onProfileChange={setProfileId}
          onIncludeMemoriesChange={setIncludeMemories}
          onIncludeChatsChange={setIncludeChats}
        />
      )}

      {currentStep === 3 && (
        <GenerationProgressStep
          steps={generation.steps}
          generating={generation.generating}
          includeMemories={includeMemories}
          includeChats={includeChats}
          error={error}
        />
      )}

      {currentStep === 4 && (
        <ReviewStep
          result={generation.result}
          stepResults={generation.stepResults}
          errors={generation.errors}
          importing={importing}
          importResult={importResult}
          onImport={handleImport}
          onAddMore={addMoreMaterial}
          onStartOver={reset}
          onDone={onClose}
        />
      )}

      {/* Navigation Footer */}
      {currentStep < 3 && (
        <div className="flex justify-between pt-4 qt-border-default border-t">
          <button
            onClick={prevStep}
            disabled={currentStep === 1}
            className="qt-button-secondary"
          >
            Back
          </button>
          {currentStep === 2 ? (
            <button
              onClick={() => startGeneration()}
              disabled={!canProceed || generation.generating}
              className="qt-button-primary"
            >
              Generate Character
            </button>
          ) : (
            <button
              onClick={nextStep}
              disabled={!canProceed}
              className="qt-button-primary"
            >
              Next
            </button>
          )}
        </div>
      )}

      {currentStep === 3 && !generation.generating && generation.result && (
        <div className="flex justify-end pt-4 qt-border-default border-t">
          <button
            onClick={nextStep}
            className="qt-button-primary"
          >
            Review Results
          </button>
        </div>
      )}
    </div>
  );
}
