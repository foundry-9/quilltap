/**
 * AI Character Import - Frontend Types
 *
 * Types for the AI character import wizard UI state and progress tracking.
 */

import type { QuilltapExport } from '@/lib/export/types';

// ============================================================================
// Wizard Steps
// ============================================================================

/** UI wizard steps (1-indexed) */
export type WizardUIStep = 1 | 2 | 3 | 4;

// ============================================================================
// Step Progress
// ============================================================================

export type AIImportStepName =
  | 'analyzing'
  | 'character_basics'
  | 'first_message'
  | 'system_prompts'
  | 'physical_descriptions'
  | 'wardrobe_items'
  | 'pronouns'
  | 'memories'
  | 'chats'
  | 'assembly'
  | 'validation'
  | 'repair';

export type StepStatus = 'pending' | 'in_progress' | 'complete' | 'error' | 'skipped';

export interface StepProgress {
  status: StepStatus;
  snippet?: string;
  error?: string;
}

// ============================================================================
// Generation Options
// ============================================================================

export interface AIImportOptions {
  profileId: string;
  includeMemories: boolean;
  includeChats: boolean;
}

// ============================================================================
// Uploaded File
// ============================================================================

export interface UploadedSourceFile {
  id: string;
  name: string;
  size: number;
}

// ============================================================================
// Generation State
// ============================================================================

export interface AIImportGenerationState {
  generating: boolean;
  steps: Record<AIImportStepName, StepProgress>;
  result: QuilltapExport | null;
  stepResults: Record<string, unknown> | null;
  errors: Record<string, string>;
}

// ============================================================================
// Step Display Info
// ============================================================================

export const STEP_DISPLAY_NAMES: Record<AIImportStepName, string> = {
  analyzing: 'Analyzing Source Material',
  character_basics: 'Extracting Character Basics',
  first_message: 'Generating Dialogue',
  system_prompts: 'Creating System Prompts',
  physical_descriptions: 'Describing Appearance',
  wardrobe_items: 'Generating Wardrobe',
  pronouns: 'Determining Pronouns & Aliases',
  memories: 'Generating Memories',
  chats: 'Creating Example Chat',
  assembly: 'Assembling Export',
  validation: 'Validating Data',
  repair: 'Repairing Issues',
};

/** Steps that are always shown in progress */
export const CORE_STEPS: AIImportStepName[] = [
  'character_basics',
  'first_message',
  'system_prompts',
  'physical_descriptions',
  'wardrobe_items',
  'pronouns',
  'assembly',
  'validation',
];

