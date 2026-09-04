'use client';

/**
 * useCharacterOptimizer Hook
 *
 * State management for the Character Optimizer "Refine from Memories" feature.
 * Handles SSE streaming from the optimize-stream endpoint, suggestion review,
 * and applying accepted changes back to the character.
 */

import { useState, useCallback, useRef } from 'react';
import { applyCharacterFieldUpdates } from '../../apply-character-field-updates';
import { wardrobeCollectionUrl, wardrobeItemUrl } from '@/lib/wardrobe/wardrobe-container';
import type {
  OptimizerPhase,
  SuggestionDecision,
  OptimizerAnalysis,
  OptimizerSuggestion,
  OptimizerFilterOptions,
  OptimizerOutputMode,
  OptimizerSubStep,
} from '../types';

interface UseCharacterOptimizerReturn {
  // Phase state
  phase: OptimizerPhase;
  analysis: OptimizerAnalysis | null;
  suggestions: OptimizerSuggestion[];
  currentIndex: number;
  decisions: Map<string, SuggestionDecision>;
  editedValues: Map<string, string>;
  error: string | null;
  memoryCount: number;
  filteredCount: number;
  loading: boolean;
  progressStep: string | null;
  progressSubStep: OptimizerSubStep | null;
  noSuggestionsMessage: string | null;
  applying: boolean;
  startedAt: number | null;
  suggestionsFilePath: string | null;

  // Actions
  startOptimization: (
    characterId: string,
    connectionProfileId: string,
    filterOptions?: OptimizerFilterOptions,
    outputMode?: OptimizerOutputMode,
  ) => Promise<void>;
  decideSuggestion: (id: string, decision: SuggestionDecision) => void;
  editSuggestion: (id: string, newValue: string) => void;
  goToSuggestion: (index: number) => void;
  nextSuggestion: () => void;
  prevSuggestion: () => void;
  getAcceptedChanges: () => Array<{ suggestion: OptimizerSuggestion; finalValue: string }>;
  applyChanges: (characterId: string) => Promise<void>;
  reset: () => void;
  setPhase: (phase: OptimizerPhase) => void;
}

export function useCharacterOptimizer(): UseCharacterOptimizerReturn {
  const [phase, setPhase] = useState<OptimizerPhase>('preflight');
  const [analysis, setAnalysis] = useState<OptimizerAnalysis | null>(null);
  const [suggestions, setSuggestions] = useState<OptimizerSuggestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Map<string, SuggestionDecision>>(new Map());
  const [editedValues, setEditedValues] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [memoryCount, setMemoryCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [progressSubStep, setProgressSubStep] = useState<OptimizerSubStep | null>(null);
  const [noSuggestionsMessage, setNoSuggestionsMessage] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [filteredCount, setFilteredCount] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [suggestionsFilePath, setSuggestionsFilePath] = useState<string | null>(null);
  const outputModeRef = useRef<OptimizerOutputMode>('apply');

  // Ref to track current suggestions count during async streaming
  const suggestionsRef = useRef<OptimizerSuggestion[]>([]);

  const startOptimization = useCallback(
    async (
      characterId: string,
      connectionProfileId: string,
      filterOptions?: OptimizerFilterOptions,
      outputMode: OptimizerOutputMode = 'apply',
    ) => {
    outputModeRef.current = outputMode;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setSuggestions([]);
    suggestionsRef.current = [];
    setCurrentIndex(0);
    setDecisions(new Map());
    setEditedValues(new Map());
    setProgressStep(null);
    setProgressSubStep(null);
    setNoSuggestionsMessage(null);
    setFilteredCount(0);
    setStartedAt(Date.now());
    setSuggestionsFilePath(null);
    setPhase('progress');

    try {
      const requestBody: Record<string, unknown> = { connectionProfileId, outputMode };
      if (filterOptions) {
        requestBody.maxMemories = filterOptions.maxMemories;
        requestBody.searchQuery = filterOptions.searchQuery;
        requestBody.useSemanticSearch = filterOptions.useSemanticSearch;
        requestBody.sinceDate = filterOptions.sinceDate;
        requestBody.beforeDate = filterOptions.beforeDate;
      }

      const response = await fetch(`/api/v1/characters/${characterId}?action=optimize-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'The refinement endeavour encountered an unexpected impediment.');
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'start':
                  setLoading(true);
                  setPhase('progress');
                  break;

                case 'step_start':
                  setProgressStep(event.step as string);
                  if (event.step !== 'generating') {
                    setProgressSubStep(null);
                  }
                  break;

                case 'substep_start':
                  if (event.subStep) {
                    setProgressSubStep(event.subStep as OptimizerSubStep);
                  }
                  break;

                case 'substep_complete':
                  // Accumulate suggestions incrementally so the user sees the
                  // count climb as per-item passes finish.
                  if (Array.isArray(event.partialSuggestions)) {
                    const partial = event.partialSuggestions as OptimizerSuggestion[];
                    if (partial.length > 0) {
                      const next = [...suggestionsRef.current, ...partial];
                      suggestionsRef.current = next;
                      setSuggestions(next);
                    }
                  }
                  break;

                case 'step_complete':
                  if (event.step === 'loading') {
                    setMemoryCount((event.memoryCount as number) ?? 0);
                    if (event.filteredCount !== undefined) {
                      setFilteredCount(event.filteredCount as number);
                    }
                  } else if (event.step === 'analyzing') {
                    setAnalysis(event.analysis as OptimizerAnalysis);
                  } else if (event.step === 'generating') {
                    const newSuggestions = event.suggestions as OptimizerSuggestion[];
                    suggestionsRef.current = newSuggestions;
                    setSuggestions(newSuggestions);
                    setProgressSubStep(null);
                  }
                  break;

                case 'suggestions_file_written':
                  setSuggestionsFilePath((event.suggestionsFilePath as string) ?? null);
                  break;

                case 'done': {
                  const doneSuggestions = event.suggestions as OptimizerSuggestion[] | undefined;
                  if (doneSuggestions?.length) {
                    suggestionsRef.current = doneSuggestions;
                    setSuggestions(doneSuggestions);
                  }
                  const filePath = (event.suggestionsFilePath as string | undefined) ?? null;
                  if (filePath) setSuggestionsFilePath(filePath);
                  setLoading(false);
                  setProgressStep(null);
                  setProgressSubStep(null);
                  if (outputModeRef.current === 'suggestions-file' && filePath) {
                    setPhase('suggestions-file-written');
                  } else if (suggestionsRef.current.length > 0) {
                    setPhase('review');
                  } else {
                    setNoSuggestionsMessage(
                      'The memoirs have been consulted most thoroughly, yet your character appears already quite splendidly rendered. No refinements were deemed necessary by our panel of discerning automata.'
                    );
                  }
                  break;
                }

                case 'error':
                  setError(
                    (event.error as string) ??
                      'An unforeseen calamity has befallen the refinement process.'
                  );
                  setLoading(false);
                  break;
              }
            } catch {
              // Ignore parse errors for incomplete JSON fragments
            }
          }
        }
      }

      // Stream ended without a 'done' event — handle gracefully
      setLoading(false);
      if (suggestionsRef.current.length > 0) {
        setPhase('review');
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'The refinement endeavour encountered an unexpected impediment.';
      setError(errorMessage);
      setLoading(false);
    }
  }, []);

  const decideSuggestion = useCallback((id: string, decision: SuggestionDecision) => {
    setDecisions((prev) => {
      const next = new Map(prev);
      next.set(id, decision);
      return next;
    });
  }, []);

  const editSuggestion = useCallback((id: string, newValue: string) => {
    setEditedValues((prev) => {
      const next = new Map(prev);
      next.set(id, newValue);
      return next;
    });
    setDecisions((prev) => {
      const next = new Map(prev);
      next.set(id, 'edited');
      return next;
    });
  }, []);

  const goToSuggestion = useCallback((index: number) => {
    if (index >= 0 && index < suggestionsRef.current.length) {
      setCurrentIndex(index);
    }
  }, []);

  const nextSuggestion = useCallback(() => {
    setCurrentIndex((prev) => Math.min(prev + 1, suggestionsRef.current.length - 1));
  }, []);

  const prevSuggestion = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const getAcceptedChanges = useCallback(
    (): Array<{ suggestion: OptimizerSuggestion; finalValue: string }> => {
      return suggestions
        .filter((s) => {
          const decision = decisions.get(s.id);
          return decision === 'accepted' || decision === 'edited';
        })
        .map((s) => ({
          suggestion: s,
          finalValue:
            decisions.get(s.id) === 'edited'
              ? (editedValues.get(s.id) ?? s.proposedValue)
              : s.proposedValue,
        }));
    },
    [suggestions, decisions, editedValues]
  );

  const applyChanges = useCallback(
    async (characterId: string) => {
      const accepted = getAcceptedChanges();
      if (accepted.length === 0) return;

      setApplying(true);
      setError(null);

      try {
        // Fetch current character so array/object fields can be merged rather
        // than clobbered (the PUT body replaces scenarios / physicalDescription
        // wholesale, so we must send the full, merged value).
        const fetchResponse = await fetch(`/api/v1/characters/${characterId}`);
        if (!fetchResponse.ok) {
          throw new Error('Could not retrieve the character dossier for amendment.');
        }
        const characterData = await fetchResponse.json();
        const character =
          (characterData.character ?? characterData.data ?? characterData) as Record<
            string,
            unknown
          >;

        // Fields that map 1:1 onto the PUT body.
        const simpleFields = [
          'identity',
          'description',
          'manifesto',
          'personality',
          'exampleDialogues',
        ];
        // Valid physicalDescription sub-field keys (carried on suggestion.subId).
        const PHYSICAL_KEYS = [
          'fullDescription',
          'headAndShouldersPrompt',
          'shortPrompt',
          'mediumPrompt',
          'longPrompt',
          'completePrompt',
        ];

        // PUT-body payload (simple fields, talkativeness, scenarios, physicalDescription).
        const updatePayload: Record<string, unknown> = {};
        // System prompts persist through their own dedicated endpoints — the
        // PUT body strips `systemPrompts`, so collect them separately.
        const scenarioUpdates: Array<{ subId: string; finalValue: string }> = [];
        const physicalUpdates: Array<{ key: string; finalValue: string }> = [];
        const promptUpdates: Array<{ subId: string; finalValue: string }> = [];
        const promptCreates: Array<{ name: string; finalValue: string }> = [];
        const wardrobeUpdates: Array<{ subId: string; finalValue: string }> = [];
        const wardrobeCreates: Array<{ suggestion: OptimizerSuggestion; finalValue: string }> = [];
        const aliasAdditions: string[] = [];

        for (const { suggestion, finalValue } of accepted) {
          const field = suggestion.field;
          if (simpleFields.includes(field)) {
            updatePayload[field] = finalValue;
          } else if (field === 'talkativeness') {
            const n = parseFloat(finalValue);
            if (!Number.isNaN(n)) {
              updatePayload.talkativeness = Math.min(1, Math.max(0.1, n));
            }
          } else if (field === 'scenarios') {
            // New scenarios are no longer proposed; only refinements (with a subId) apply.
            if (suggestion.subId) {
              scenarioUpdates.push({ subId: suggestion.subId, finalValue });
            }
          } else if (field === 'physicalDescription') {
            const key = suggestion.subId;
            if (key && PHYSICAL_KEYS.includes(key)) {
              physicalUpdates.push({ key, finalValue });
            }
          } else if (field === 'systemPrompt') {
            if (suggestion.subId) {
              promptUpdates.push({ subId: suggestion.subId, finalValue });
            } else {
              const name =
                suggestion.name?.trim() || suggestion.title?.trim() || 'Refined Prompt';
              promptCreates.push({ name, finalValue });
            }
          } else if (field === 'wardrobeItems') {
            if (suggestion.subId) {
              wardrobeUpdates.push({ subId: suggestion.subId, finalValue });
            } else if (suggestion.wardrobeItem) {
              wardrobeCreates.push({ suggestion, finalValue });
            }
          } else if (field === 'aliases') {
            const alias = finalValue.trim();
            if (alias) aliasAdditions.push(alias);
          }
        }

        // Merge alias additions into the full aliases array (PUT replaces it
        // wholesale), skipping duplicates case-insensitively.
        if (aliasAdditions.length > 0) {
          const existingAliases = ((character['aliases'] as string[] | undefined) ?? []).slice();
          const seen = new Set(existingAliases.map((a) => a.toLowerCase()));
          for (const alias of aliasAdditions) {
            if (!seen.has(alias.toLowerCase())) {
              existingAliases.push(alias);
              seen.add(alias.toLowerCase());
            }
          }
          updatePayload.aliases = existingAliases;
        }

        // Merge scenario refinements into the full scenarios array (PUT replaces it wholesale).
        if (scenarioUpdates.length > 0) {
          const existingScenarios =
            (character['scenarios'] as Array<Record<string, unknown>> | undefined) ?? [];
          const now = new Date().toISOString();
          updatePayload.scenarios = existingScenarios.map((s) => {
            const update = scenarioUpdates.find((u) => u.subId === s.id);
            return update ? { ...s, content: update.finalValue, updatedAt: now } : s;
          });
        }

        // Merge physical-description sub-field refinements into the single
        // physicalDescription object (PUT replaces the whole object).
        if (physicalUpdates.length > 0) {
          const existingPhysical =
            (character['physicalDescription'] as Record<string, unknown> | null | undefined) ??
            null;
          const merged: Record<string, unknown> = existingPhysical
            ? { ...existingPhysical }
            : { name: 'Appearance' };
          for (const { key, finalValue } of physicalUpdates) {
            merged[key] = finalValue;
          }
          if (typeof merged.name !== 'string' || merged.name.trim() === '') {
            merged.name = 'Appearance';
          }
          updatePayload.physicalDescription = merged;
        }

        // Fan the updates out across the main PUT and the dedicated system-prompt
        // endpoints (system prompts are stripped by the PUT schema). Keep the
        // optimizer's voiced fallback strings for partial failures.
        const { errors } = await applyCharacterFieldUpdates(characterId, {
          mainUpdates: updatePayload,
          promptUpdates: promptUpdates.map(({ subId, finalValue }) => ({
            id: subId,
            content: finalValue,
          })),
          promptCreates: promptCreates.map(({ name, finalValue }) => ({
            name,
            content: finalValue,
          })),
          messages: {
            promptUpdateFailed: 'A system prompt refinement could not be saved.',
            promptCreateFailed: (name) => `The new system prompt "${name}" could not be saved.`,
            mainPutFailed: 'The amendments could not be inscribed into the character record.',
          },
        });

        // Wardrobe changes go through the dedicated wardrobe endpoints.
        const wardrobeErrors: string[] = [];
        for (const { subId, finalValue } of wardrobeUpdates) {
          try {
            const res = await fetch(wardrobeItemUrl({ scope: 'character', id: characterId }, subId), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ description: finalValue }),
            });
            if (!res.ok) {
              wardrobeErrors.push('A wardrobe item refinement could not be saved.');
            }
          } catch {
            wardrobeErrors.push('A wardrobe item refinement could not be saved.');
          }
        }
        for (const { suggestion, finalValue } of wardrobeCreates) {
          const item = suggestion.wardrobeItem;
          if (!item) continue;
          // If the operator amended the suggestion, their text becomes the
          // item's description; the structured payload supplies the rest.
          const description =
            decisions.get(suggestion.id) === 'edited' ? finalValue : item.description;
          try {
            const res = await fetch(wardrobeCollectionUrl({ scope: 'character', id: characterId }), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: item.title,
                description: description || null,
                imagePrompt: item.imagePrompt || null,
                types: item.types,
                appropriateness: item.appropriateness || null,
                isDefault: item.isDefault === true,
              }),
            });
            if (!res.ok) {
              wardrobeErrors.push(`The new wardrobe item "${item.title}" could not be saved.`);
            }
          } catch {
            wardrobeErrors.push(`The new wardrobe item "${item.title}" could not be saved.`);
          }
        }

        const allErrors = [...errors, ...wardrobeErrors];
        if (allErrors.length > 0) {
          throw new Error(allErrors.join(' '));
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : 'The application of refinements met with an unforeseen impediment.';
        setError(errorMessage);
      } finally {
        setApplying(false);
      }
    },
    [getAcceptedChanges, decisions]
  );

  const reset = useCallback(() => {
    setPhase('preflight');
    setAnalysis(null);
    setSuggestions([]);
    suggestionsRef.current = [];
    setCurrentIndex(0);
    setDecisions(new Map());
    setEditedValues(new Map());
    setError(null);
    setMemoryCount(0);
    setLoading(false);
    setProgressStep(null);
    setProgressSubStep(null);
    setNoSuggestionsMessage(null);
    setApplying(false);
    setFilteredCount(0);
    setStartedAt(null);
    setSuggestionsFilePath(null);
    outputModeRef.current = 'apply';
  }, []);

  return {
    phase,
    analysis,
    suggestions,
    currentIndex,
    decisions,
    editedValues,
    error,
    memoryCount,
    filteredCount,
    loading,
    progressStep,
    progressSubStep,
    noSuggestionsMessage,
    applying,
    startedAt,
    suggestionsFilePath,
    startOptimization,
    decideSuggestion,
    editSuggestion,
    goToSuggestion,
    nextSuggestion,
    prevSuggestion,
    getAcceptedChanges,
    applyChanges,
    reset,
    setPhase,
  };
}
