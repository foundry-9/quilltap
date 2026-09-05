/**
 * TypeScript interfaces and types for character editing functionality
 */

/**
 * Re-exported from the schema rather than redeclared: the edit form round-trips
 * whole scenario objects back through `PUT /api/v1/characters/[id]`, so a local
 * shape that omitted a field (`description`, `archived`) would silently strip it
 * from the vault file on every save.
 */
import type { CharacterScenario } from '@/lib/schemas/character.types'

export type { CharacterScenario }

export interface Character {
  id: string
  name: string
  title?: string | null
  identity?: string | null
  description?: string | null
  manifesto?: string | null
  personality?: string | null
  scenarios?: CharacterScenario[]
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompt?: string
  avatarUrl?: string
  defaultImageId?: string
  defaultConnectionProfileId?: string
  npc?: boolean
  aliases?: string[]
  pronouns?: { subject: string; object: string; possessive: string } | null
  characterDocumentMountPointId?: string | null
  systemTransparency?: boolean | null
  coreWhisperEnabled?: boolean | null
  canBeCarina?: boolean | null
  canChooseOutfit?: boolean
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
}

export interface CharacterFormData {
  name: string
  aliases: string[]
  pronouns: { subject: string; object: string; possessive: string } | null
  title: string
  identity: string
  description: string
  manifesto: string
  personality: string
  scenarios: CharacterScenario[]
  firstMessage: string
  exampleDialogues: string
  systemPrompt: string
  avatarUrl: string
  defaultConnectionProfileId: string
  systemTransparency: boolean
  /** Tri-state per-character override for Aurora's Core whisper. null = inherit; true/false = explicit override. */
  coreWhisperEnabled: boolean | null
  canBeCarina: boolean
}

export interface CharacterEditState {
  loading: boolean
  saving: boolean
  error: string | null
  showUploadDialog: boolean
  showAvatarSelector: boolean
  character: Character | null
  formData: CharacterFormData
  originalFormData: CharacterFormData
  avatarRefreshKey: number
  // Bumped whenever formData is replaced from an external source (initial
  // load, vault overlay toggle, sync from/to vault, wizard apply) so the
  // markdown editors remount and re-parse the fresh values. Without this,
  // MarkdownBridgePlugin's one-shot init keeps showing pre-replace content.
  externalUpdateCount: number
}
