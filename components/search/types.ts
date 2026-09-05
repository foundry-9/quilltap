// Search component types

export type SearchType = 'chats' | 'characters' | 'tags' | 'memories' | 'messages' | 'documents'

/**
 * Every search type, in the order the filter chips and result groups show
 * them. The single source of truth: the search dialog's chips and the route's
 * accepted `types` values both read this, so a new type can't be half-added.
 */
export const ALL_SEARCH_TYPES: SearchType[] = [
  'chats',
  'characters',
  'messages',
  'documents',
  'tags',
  'memories',
]

// Match priority: 0=exact phrase, 1=all terms AND, 2=single term match
export type MatchPriority = 0 | 1 | 2

export interface BaseSearchResult {
  id: string
  type: SearchType
  name: string
  matchedField: string
  matchedValue: string
  snippet: string
  url: string
  matchedTag?: {
    id: string
    name: string
  }
  matchPriority: MatchPriority
  createdAt: string
  updatedAt: string
}

export interface ChatSearchResult extends BaseSearchResult {
  type: 'chats'
  characterNames?: string[]
  messageCount?: number
  matchedViaCharacter?: {
    id: string
    name: string
  }
}

export interface CharacterSearchResult extends BaseSearchResult {
  type: 'characters'
  title?: string | null
  avatarUrl?: string | null
  isFavorite?: boolean
}

export interface TagSearchResult extends BaseSearchResult {
  type: 'tags'
  usageCount: number
  quickHide: boolean
}

export interface MemorySearchResult extends BaseSearchResult {
  type: 'memories'
  characterId: string
  characterName?: string
  importance: number
  source: 'AUTO' | 'MANUAL'
}

export interface MessageSearchResult extends BaseSearchResult {
  type: 'messages'
  chatId: string
  chatTitle: string
  characterNames?: string[]
  role: 'USER' | 'ASSISTANT'
  messageId: string
}

/**
 * A document inside any enabled document store (character vaults included,
 * archived ones excluded). `id` is the document's link row id; `url` is the
 * standalone deep link — the safe default that notifies no chat. The in-chat
 * open is an upgrade applied by the click handler, which addresses the
 * document by `(mountPointRef, relativePath)`.
 */
export interface DocumentSearchResultItem extends BaseSearchResult {
  type: 'documents'
  mountPointId: string
  /** Display name of the store the document lives in. */
  mountPointName: string
  /** Addressable store reference — name, or UUID when the name is ambiguous. */
  mountPointRef: string
  storeType: 'documents' | 'character'
  relativePath: string
}

export type SearchResult = ChatSearchResult | CharacterSearchResult | TagSearchResult | MemorySearchResult | MessageSearchResult | DocumentSearchResultItem

export interface SearchResponse {
  results: SearchResult[]
  totalCount: number
  query: string
  types: SearchType[]
  hasMore: boolean
  /** Total count of results per type (before pagination) */
  countsByType?: Partial<Record<SearchType, number>>
}

// Type icons for display
export const TYPE_ICONS: Record<SearchType, string> = {
  chats: '💬',
  characters: '🎭',
  tags: '🏷️',
  memories: '🧠',
  messages: '📝',
  documents: '📄',
}

export const TYPE_LABELS: Record<SearchType, string> = {
  chats: 'Chat',
  characters: 'Character',
  tags: 'Tag',
  memories: 'Memory',
  messages: 'Message',
  documents: 'Document',
}

export const TYPE_LABELS_PLURAL: Record<SearchType, string> = {
  chats: 'Chats',
  characters: 'Characters',
  tags: 'Tags',
  memories: 'Memories',
  messages: 'Messages',
  documents: 'Documents',
}
