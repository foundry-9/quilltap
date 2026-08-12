/**
 * Tabbed workspace — shared types.
 *
 * The workspace is a two-pane (left/right) tab host that renders every open
 * tab's view kept-alive (hidden via CSS, never unmounted) so streaming Salon
 * conversations survive tab switches. See
 * `docs/developer/features/tabbed-workspace.md` and
 * `docs/developer/decisions/ADR-0001-tabbed-workspace-routing.md`.
 *
 * @module lib/workspace/types
 */

export type PaneId = 'left' | 'right'

/**
 * The kind of surface a tab renders. `help` is intentionally absent — Help
 * stays a floating modal. `terminal` and `document` are child tabs of a Salon
 * tab (linked via `parentTabId`). `wardrobe` is a tab only when opened from the
 * left rail (the chat-scoped path keeps its dialog).
 */
export type TabKind =
  | 'home'
  | 'salon' // payload: { chatId: string }
  | 'salon-list' // the all-chats list (`/salon` without a conversation)
  | 'terminal' // payload: { chatId: string; sessionId?: string } — child of a salon tab (Ariel)
  | 'document' // payload: { chatId: string; chatDocumentId: string } — child of a salon tab (Librarian)
  | 'aurora'
  | 'prospero'
  | 'scriptorium'
  | 'settings' // payload: { tab?: string; section?: string } (deep-link target)
  | 'files'
  | 'photos'
  | 'scenarios'
  | 'brahma'
  | 'wardrobe' // payload: { characterId?: string } — RAIL-opened only; NO chatId
  | 'profile' // the user's profile page
  | 'about' // the About page
  | 'generate-image' // standalone (chat-less) image generation
  | 'document-standalone' // standalone (chat-less) Document Mode editor — payload: DocumentStandaloneTabPayload
  | 'character-new' // the create-a-character form
  | 'character-edit' // payload: { characterId: string; tab?: string }
  | 'character-view' // payload: { characterId: string; tab?: string } — the read-only character detail page
  | 'settings-wizard' // the provider setup wizard, re-entered from Settings
  | 'custom-tools' // Pascal's Workbench — payload: CustomToolsTabPayload (absent = library view)

/** Kind-specific tab payloads. */
export interface SalonTabPayload {
  chatId: string
}
export interface TerminalTabPayload {
  chatId: string
  sessionId?: string
}
export interface DocumentTabPayload {
  chatId: string
  /** Row id of the open chat_documents record this tab edits. Several document
   * tabs may share a chatId — one per open document. */
  chatDocumentId: string
  /** Cached title for the tab label (the document's display title). */
  displayTitle?: string
}
/**
 * A chat-less Document Mode tab (opened from the left rail). The tab itself is
 * the only record of the open — there is no chat_documents row and no chat to
 * notify of edits.
 */
export interface DocumentStandaloneTabPayload {
  /**
   * Client-minted identity key. For existing files the opener derives it from
   * the file's identity (scope/mount/path) so reopening the same file focuses
   * the existing tab; for new blank documents it's a fresh uuid. Stable across
   * renames (the payload's filePath updates, the key does not).
   */
  docKey: string
  scope: 'document_store' | 'general'
  mountPoint?: string | null
  /**
   * Unset while a brand-new blank document is being created; filled in via a
   * payload refresh once the server names it, so a persisted tab reopens the
   * real file.
   */
  filePath?: string
  /** Folder (relative to scope root) for a new blank document. */
  targetFolder?: string
  /** Cached title for the tab label. */
  displayTitle?: string
}
/**
 * Identity key for a standalone document tab. Existing files key by identity
 * (scope/mount/path) so reopening the same file focuses its existing tab; a
 * new blank document (no filePath yet) gets a fresh uuid so several blanks can
 * coexist.
 */
export function standaloneDocKey(
  scope: DocumentStandaloneTabPayload['scope'],
  mountPoint: string | null | undefined,
  filePath: string | null | undefined,
): string {
  if (filePath) return `${scope}:${mountPoint ?? ''}:${filePath}`
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `doc-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

/**
 * Optional drill-in payloads for the list surfaces. A deep link (e.g.
 * `/prospero/<id>`) opens the singleton tab with the target preselected; the
 * view renders that detail in place. Absent payload = the plain list.
 */
export interface ProsperoTabPayload {
  projectId?: string
}
export interface ScriptoriumTabPayload {
  storeId?: string
}
export interface AuroraTabPayload {
  groupId?: string
}

export interface SettingsTabPayload {
  tab?: string
  section?: string
}
export interface WardrobeTabPayload {
  characterId?: string
}
export interface CharacterEditTabPayload {
  characterId: string
  /** Deep-link target sub-tab (e.g. `system-prompts`). */
  tab?: string
}
export interface CharacterViewTabPayload {
  characterId: string
  /** Deep-link target sub-tab (e.g. `conversations`). */
  tab?: string
}
/**
 * Pascal's Workbench. No payload = the library view. A `mountPointId` + `path`
 * pair opens one definition in the builder (one tab per open definition, like
 * `character-edit`); `create` opens the builder on a fresh draft, with
 * `mountPointId` preselecting the destination.
 */
export interface CustomToolsTabPayload {
  mountPointId?: string
  path?: string
  create?: boolean
}

export interface WorkspaceTab {
  /** Stable uuid. */
  id: string
  kind: TabKind
  /** Kind-specific payload (e.g. `{ chatId }`). */
  payload?: unknown
  /** Shown on the tab. */
  title: string
  icon?: string
  /** For terminal/document: the salon tab they belong to. */
  parentTabId?: string
}

export interface PaneState {
  /** Tab ids in display order. */
  order: string[]
  /** The visible tab in this pane. */
  activeTabId: string | null
}

export interface WorkspaceState {
  tabs: Record<string, WorkspaceTab>
  panes: {
    left: PaneState
    /** `null` = unsplit (single full-width pane). */
    right: PaneState | null
  }
  /** Last-interacted pane; new rail-opened tabs land here. Default `'left'`. */
  focusedPane: PaneId
  /** Left pane fraction of width when split (0..1). Persisted. */
  splitRatio: number
}

/** Default split ratio (panes evenly split). */
export const DEFAULT_SPLIT_RATIO = 0.5

/**
 * Min/max left-pane fraction so neither pane becomes unusably narrow. Mirrors
 * the spirit of the Chat Sidebar's `MIN_CHAT_WIDTH` guard, expressed as a
 * fraction so it is viewport-independent in the reducer (pixel clamping happens
 * in the divider drag handler).
 */
export const MIN_SPLIT_RATIO = 0.2
export const MAX_SPLIT_RATIO = 0.8
