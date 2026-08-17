/**
 * AI Wizard Types
 *
 * Type definitions for the character AI wizard feature.
 */

import type { ConnectionProfile } from '@/lib/schemas/types'

// ============================================================================
// WIZARD STATE
// ============================================================================

export type WizardStep = 1 | 2 | 3 | 4

export type DescriptionSourceType = 'existing' | 'upload' | 'gallery' | 'document' | 'skip'

export type GeneratableField =
  | 'name'
  | 'title'
  | 'identity'
  | 'description'
  | 'manifesto'
  | 'personality'
  | 'scenarios'
  | 'exampleDialogues'
  | 'firstMessage'
  | 'systemPrompt'
  | 'properties'
  | 'physicalDescription'
  | 'wardrobeItems'

export interface GenerationProgress {
  currentField: GeneratableField | null
  completedFields: GeneratableField[]
  snippets: Record<string, string>
  errors: Record<string, string>
}

export interface GeneratedPhysicalDescription {
  name: string
  headAndShouldersPrompt: string
  shortPrompt: string
  mediumPrompt: string
  longPrompt: string
  completePrompt: string
  fullDescription: string
}

export interface GeneratedWardrobeItem {
  title: string
  description: string
  /** Terse literal visual cue for image generation; never Markdown. */
  imagePrompt?: string
  types: string[]
  appropriateness?: string
  /** Part of the character's default outfit. */
  isDefault?: boolean
  /** Composite outfit: titles of other items in the same batch it bundles. */
  components?: string[]
  /** Composite-only: clear the designated slots on equip instead of layering. */
  replace?: boolean
}

export interface GeneratedProperties {
  pronouns: { subject: string; object: string; possessive: string } | null
  aliases: string[]
}

export interface GeneratedCharacterData {
  name?: string
  title?: string
  identity?: string
  description?: string
  manifesto?: string
  personality?: string
  scenarios?: Array<{ title: string; content: string }> | string  // string when LLM returns unparseable JSON
  exampleDialogues?: string
  firstMessage?: string
  systemPrompt?: string
  properties?: GeneratedProperties
  physicalDescription?: GeneratedPhysicalDescription
  wardrobeItems?: GeneratedWardrobeItem[]
}

/**
 * Normalize scenarios from GeneratedCharacterData — handles both parsed arrays
 * and raw strings (returned when LLM JSON parsing fails in the wizard service).
 */
export function normalizeGeneratedScenarios(
  scenarios: GeneratedCharacterData['scenarios']
): Array<{ title: string; content: string }> {
  if (!scenarios) return []
  if (Array.isArray(scenarios)) return scenarios
  // Try to parse raw string
  try {
    const stripped = scenarios.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(stripped)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // Return as a single "Generated" scenario with the raw text as content
    return [{ title: 'Generated', content: scenarios }]
  }
  return []
}

export interface AIWizardState {
  isOpen: boolean
  currentStep: WizardStep

  // Step 1: Profile Selection
  primaryProfileId: string
  profiles: ConnectionProfile[]
  loadingProfiles: boolean

  // Step 2: Description Source
  descriptionSource: DescriptionSourceType
  uploadedImageId: string | null
  uploadedImageUrl: string | null
  selectedGalleryImageId: string | null
  selectedGalleryImageUrl: string | null
  uploadedDocumentId: string | null
  uploadedDocumentName: string | null
  visionProfileId: string | null
  needsVisionProfile: boolean

  // Step 3: Field Selection + Background
  backgroundText: string
  selectedFields: Set<GeneratableField>
  availableFields: GeneratableField[]

  // Step 4: Generation
  generating: boolean
  generationProgress: GenerationProgress
  generatedData: GeneratedCharacterData | null

  // General
  error: string | null
}

// ============================================================================
// API TYPES
// ============================================================================

export interface AIWizardRequest {
  primaryProfileId: string
  visionProfileId?: string

  sourceType: DescriptionSourceType
  imageId?: string
  documentId?: string

  characterName: string
  existingData?: {
    title?: string
    identity?: string
    description?: string
    manifesto?: string
    personality?: string
    scenarios?: Array<{ id: string; title: string; content: string }>
    exampleDialogues?: string
    systemPrompt?: string
    firstMessage?: string
    pronouns?: { subject: string; object: string; possessive: string } | null
    aliases?: string[]
  }

  background: string

  fieldsToGenerate: GeneratableField[]

  characterId?: string
}

export interface AIWizardResponse {
  success: boolean
  generated: GeneratedCharacterData
  errors?: Record<string, string>
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

export interface AIWizardModalProps {
  isOpen: boolean
  onClose: () => void
  characterId?: string
  characterName: string
  currentData: {
    title?: string
    identity?: string
    description?: string
    manifesto?: string
    personality?: string
    scenarios?: Array<{ id: string; title: string; content: string }>
    exampleDialogues?: string
    systemPrompt?: string
    firstMessage?: string
    pronouns?: { subject: string; object: string; possessive: string } | null
    aliases?: string[]
  }
  onApply: (data: GeneratedCharacterData) => void
}

export interface ProfileSelectionStepProps {
  profiles: ConnectionProfile[]
  loading: boolean
  selectedProfileId: string
  onSelectProfile: (profileId: string) => void
  error: string | null
}

export interface DescriptionSourceStepProps {
  source: DescriptionSourceType
  onSourceChange: (source: DescriptionSourceType) => void
  uploadedImageId: string | null
  uploadedImageUrl: string | null
  onImageUpload: (imageId: string, imageUrl: string) => void
  selectedGalleryImageId: string | null
  selectedGalleryImageUrl: string | null
  onGallerySelect: (imageId: string, imageUrl: string) => void
  uploadedDocumentId: string | null
  uploadedDocumentName: string | null
  onDocumentUpload: (documentId: string, documentName: string) => void
  needsVisionProfile: boolean
  visionProfileId: string | null
  visionProfiles: ConnectionProfile[]
  onVisionProfileSelect: (profileId: string) => void
  characterId?: string
}

export interface FieldSelectionStepProps {
  backgroundText: string
  onBackgroundChange: (text: string) => void
  availableFields: GeneratableField[]
  selectedFields: Set<GeneratableField>
  onFieldToggle: (field: GeneratableField) => void
  currentData: Record<string, unknown>
  canGeneratePhysicalDescription: boolean
}

export interface GenerationStepProps {
  generating: boolean
  progress: GenerationProgress
  generatedData: GeneratedCharacterData | null
  onRetry: (field: GeneratableField) => void
  onApply: () => void
  onClose: () => void
}

// ============================================================================
// FIELD METADATA
// ============================================================================

export const FIELD_LABELS: Record<GeneratableField, string> = {
  name: 'Name',
  title: 'Title',
  identity: 'Identity',
  description: 'Description',
  manifesto: 'Manifesto',
  personality: 'Personality',
  scenarios: 'Scenarios',
  exampleDialogues: 'Example Dialogues',
  firstMessage: 'First Message',
  systemPrompt: 'System Prompt',
  properties: 'Properties (Pronouns & Aliases)',
  physicalDescription: 'Physical Description',
  wardrobeItems: 'Wardrobe',
}

export const FIELD_DESCRIPTIONS: Record<GeneratableField, string> = {
  name: 'The character\'s name',
  title: 'A short epithet or title (e.g., "The Wanderer")',
  identity: 'Outside-view facts a stranger could know on sight: station, occupation, public reputation',
  description: 'How acquaintances perceive the character: behaviour, mannerisms, verbal patterns (not appearance)',
  manifesto: 'The foundational tenets—the basic truths that anchor the character',
  personality: 'The character\'s own self-knowledge: inner drivers, motivations, beliefs',
  scenarios: 'Generate 2-3 named scenarios with distinct settings and contexts for interactions',
  exampleDialogues: 'Example conversations to guide AI responses',
  firstMessage: 'The character\'s opening message when a new chat begins',
  systemPrompt: 'Custom system instructions for AI roleplay',
  properties: 'Structured facts: pronouns and aliases (nicknames others use)',
  physicalDescription: 'Detailed physical description for image generation (the person only — clothing lives in the wardrobe)',
  wardrobeItems: 'Clothing, accessories, and composite outfits (top, bottom, footwear, accessories)',
}
