export interface OptimizerConnectionProfile {
  id: string;
  name: string;
}

export interface BehavioralPattern {
  pattern: string;
  evidence: string;
  frequency: string;
}

export interface OptimizerAnalysis {
  behavioralPatterns: BehavioralPattern[];
  summary: string;
}

export interface OptimizerGeneratedWardrobeItem {
  title: string;
  description: string;
  imagePrompt?: string;
  types: string[];
  appropriateness?: string;
  isDefault?: boolean;
}

export interface OptimizerSuggestion {
  id: string;
  field: string;
  /**
   * For an existing scenario/system prompt/wardrobe item, the item's id. For a
   * `physicalDescription` suggestion, the sub-field key being refined
   * (`fullDescription` | `shortPrompt` | `mediumPrompt` | `longPrompt` | `completePrompt`).
   */
  subId?: string;
  subName?: string;
  title?: string;
  /** Suggested name for a brand-new system prompt or wardrobe item (only when no `subId`). */
  name?: string;
  currentValue: string;
  proposedValue: string;
  rationale: string;
  significance: number;
  memoryExcerpts: string[];
  /** Structured payload for a brand-new wardrobe item (field='wardrobeItems', no subId). */
  wardrobeItem?: OptimizerGeneratedWardrobeItem;
}

export type OptimizerPhase = 'preflight' | 'progress' | 'review' | 'apply' | 'suggestions-file-written';

export type OptimizerOutputMode = 'apply' | 'suggestions-file';

export type OptimizerSubStepKind = 'general' | 'scenario' | 'systemPrompt' | 'physicalDescription' | 'wardrobe' | 'properties' | 'newSystemPrompts';

export interface OptimizerSubStep {
  kind: OptimizerSubStepKind;
  label: string;
  index: number;
  total: number;
}

export type SuggestionDecision = 'accepted' | 'rejected' | 'edited';

export interface OptimizerFilterOptions {
  maxMemories: number;
  searchQuery: string;
  useSemanticSearch: boolean;
  sinceDate: string | null;
  beforeDate: string | null;
}

export interface CharacterOptimizerModalProps {
  characterId: string;
  characterName: string;
  profiles: OptimizerConnectionProfile[];
  defaultConnectionProfileId?: string;
  /**
   * True when the character is linked to a document-store vault and has
   * readPropertiesFromDocumentStore enabled. Gates the "save suggestions to
   * the vault instead of applying" option.
   */
  vaultAvailable?: boolean;
  onClose: () => void;
  onApplied: () => void;
}
