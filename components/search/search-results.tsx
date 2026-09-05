'use client'

import Link from 'next/link'
import { useOpenDocumentFromSearch } from '@/lib/hooks/use-open-document-from-search'
import type {
  SearchResult,
  SearchType,
  CharacterSearchResult,
  ChatSearchResult,
  TagSearchResult,
  MemorySearchResult,
  MessageSearchResult,
  DocumentSearchResultItem,
} from './types'
import { TYPE_ICONS, TYPE_LABELS, TYPE_LABELS_PLURAL } from './types'

interface SearchResultsProps {
  results: SearchResult[]
  query: string
  isLoading?: boolean
  onResultClick?: () => void
  /** Total counts per type (from API, before pagination) */
  countsByType?: Partial<Record<SearchType, number>>
  /** Callback when clicking on a type's count to filter by that type */
  onTypeCountClick?: (type: SearchType) => void
}

// Individual result card components
function CharacterResultCard({ result, query, onResultClick }: { result: CharacterSearchResult; query: string; onResultClick?: () => void }) {
  return (
    <Link
      href={result.url}
      onClick={() => {
        onResultClick?.()
      }}
      className="block p-3 qt-hover-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        {result.avatarUrl ? (

          <img
            src={result.avatarUrl}
            alt={result.name}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full qt-bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-lg">{TYPE_ICONS.characters}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="qt-text-primary truncate">
              {result.name}
            </span>
            {result.isFavorite && <span className="qt-text-warning">★</span>}
            <span className="text-xs px-1.5 py-0.5 rounded qt-badge-character">
              {TYPE_LABELS.characters}
            </span>
          </div>
          {result.title && (
            <p className="qt-text-xs truncate">{result.title}</p>
          )}
          <p className="qt-text-small mt-1 line-clamp-2">
            {result.matchedTag ? (
              <span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs mr-1 qt-badge-tag">
                  🏷️ {result.matchedTag.name}
                </span>
                {result.snippet.replace(`Tagged with "${result.matchedTag.name}"`, '').replace(/^[:\s-]+/, '')}
              </span>
            ) : (
              <HighlightedText text={result.snippet} query={query} />
            )}
          </p>
        </div>
      </div>
    </Link>
  )
}

function ChatResultCard({ result, query, onResultClick }: { result: ChatSearchResult; query: string; onResultClick?: () => void }) {
  const isRelatedResult = result.matchedViaCharacter

  return (
    <Link
      href={result.url}
      onClick={() => {
        onResultClick?.()
      }}
      className="block p-3 qt-hover-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full qt-bg-info/10 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">{TYPE_ICONS.chats}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="qt-text-primary truncate">
              {result.name}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded qt-badge-chat">
              {TYPE_LABELS.chats}
            </span>
            {isRelatedResult && (
              <span className="text-xs px-1.5 py-0.5 rounded qt-badge-related">
                Related
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 qt-text-xs">
            {result.characterNames && result.characterNames.length > 0 && (
              <span>with {result.characterNames.join(', ')}</span>
            )}
            {result.messageCount !== undefined && (
              <span>• {result.messageCount} messages</span>
            )}
          </div>
          <p className="qt-text-small mt-1 line-clamp-2">
            {result.matchedTag ? (
              <span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs mr-1 qt-badge-tag">
                  🏷️ {result.matchedTag.name}
                </span>
                {result.snippet.replace(`Tagged with "${result.matchedTag.name}"`, '').replace(/^[:\s-]+/, '')}
              </span>
            ) : result.matchedViaCharacter ? (
              <span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs mr-1 qt-badge-character">
                  🎭 {result.matchedViaCharacter.name}
                </span>
                Chat includes matching character
              </span>
            ) : (
              <HighlightedText text={result.snippet} query={query} />
            )}
          </p>
        </div>
      </div>
    </Link>
  )
}

function TagResultCard({ result, query, onResultClick }: { result: TagSearchResult; query: string; onResultClick?: () => void }) {
  return (
    <Link
      href={result.url}
      onClick={(e) => {
        // For tags, we want to show items with this tag
        // This will be handled by the SearchDialog to show expanded results
        onResultClick?.()
      }}
      className="block p-3 qt-hover-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full qt-bg-warning/10 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">{TYPE_ICONS.tags}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="qt-text-primary">
              <HighlightedText text={result.name} query={query} />
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded qt-badge-tag">
              {TYPE_LABELS.tags}
            </span>
            {result.quickHide && (
              <span className="qt-text-xs px-1.5 py-0.5 qt-bg-muted rounded">
                Quick Hide
              </span>
            )}
          </div>
          <p className="qt-text-small mt-1">
            Used {result.usageCount} time{result.usageCount !== 1 ? 's' : ''} across characters and chats
          </p>
        </div>
      </div>
    </Link>
  )
}

function MemoryResultCard({ result, query, onResultClick }: { result: MemorySearchResult; query: string; onResultClick?: () => void }) {
  return (
    <Link
      href={result.url}
      onClick={() => {
        onResultClick?.()
      }}
      className="block p-3 qt-hover-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full qt-bg-destructive/10 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">{TYPE_ICONS.memories}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="qt-text-primary truncate">
              {result.name}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded qt-badge-memory">
              {TYPE_LABELS.memories}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              result.source === 'MANUAL'
                ? 'qt-badge-manual'
                : 'qt-badge-auto'
            }`}>
              {result.source === 'MANUAL' ? 'Manual' : 'Auto'}
            </span>
          </div>
          {result.characterName && (
            <p className="qt-text-xs">
              Memory for {result.characterName}
            </p>
          )}
          <p className="qt-text-small mt-1 line-clamp-2">
            {result.matchedTag ? (
              <span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs mr-1 qt-badge-tag">
                  🏷️ {result.matchedTag.name}
                </span>
                {result.snippet.replace(`Tagged with "${result.matchedTag.name}"`, '').replace(/^[:\s-]+/, '')}
              </span>
            ) : (
              <HighlightedText text={result.snippet} query={query} />
            )}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1">
              <span className="qt-text-xs">Importance:</span>
              <div className="qt-progress qt-progress-sm w-16">
                <div
                  className="qt-progress-fill qt-progress-fill-danger"
                  style={{ width: `${result.importance * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function MessageResultCard({ result, query, onResultClick }: { result: MessageSearchResult; query: string; onResultClick?: () => void }) {
  return (
    <Link
      href={result.url}
      onClick={() => {
        onResultClick?.()
      }}
      className="block p-3 qt-hover-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full qt-bg-warning/10 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">{TYPE_ICONS.messages}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="qt-text-primary truncate">
              {result.chatTitle}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded qt-badge-message">
              {TYPE_LABELS.messages}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              result.role === 'USER' ? 'qt-badge-info' : 'qt-badge-character'
            }`}>
              {result.role === 'USER' ? 'You' : 'Character'}
            </span>
          </div>
          {result.characterNames && result.characterNames.length > 0 && (
            <p className="qt-text-xs">
              with {result.characterNames.join(', ')}
            </p>
          )}
          <p className="qt-text-small mt-1 line-clamp-2">
            <HighlightedText text={result.snippet} query={query} />
          </p>
        </div>
      </div>
    </Link>
  )
}

/**
 * A document in one of the document stores.
 *
 * Deliberately a plain `<a>`, not a `<Link>`: the href is the *standalone*
 * deep link, so a middle-click or a copied link opens the document with no
 * chat attached and no Librarian announcement. A plain left click is
 * intercepted by {@link useOpenDocumentFromSearch}, which upgrades to an
 * in-chat open when a Salon is focused.
 */
function DocumentResultCard({ result, query, onResultClick }: { result: DocumentSearchResultItem; query: string; onResultClick?: () => void }) {
  const openDocument = useOpenDocumentFromSearch()

  return (
    <a
      href={result.url}
      onClick={(e) => {
        openDocument(result, e)
        if (!e.defaultPrevented) return
        onResultClick?.()
      }}
      className="block p-3 qt-hover-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full qt-bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">{TYPE_ICONS.documents}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="qt-text-primary truncate">
              <HighlightedText text={result.name} query={query} />
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded qt-badge-info">
              {TYPE_LABELS.documents}
            </span>
            {result.storeType === 'character' && (
              <span className="text-xs px-1.5 py-0.5 rounded qt-badge-character">
                Vault
              </span>
            )}
          </div>
          <p className="qt-text-xs truncate">
            {result.mountPointName} · {result.relativePath}
          </p>
          <p className="qt-text-small mt-1 line-clamp-2">
            <HighlightedText text={result.snippet} query={query} />
          </p>
        </div>
      </div>
    </a>
  )
}

// Highlight matching text
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>

  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="qt-highlight">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

export function SearchResults({ results, query, isLoading, onResultClick, countsByType, onTypeCountClick }: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="p-6 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 qt-spinner" />
        <p className="mt-2 qt-text-small">Searching...</p>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="qt-text-small">
          No results found for &quot;{query}&quot;
        </p>
        <p className="qt-text-xs mt-1">
          Try searching for characters, chats, messages, documents, tags, or memories
        </p>
      </div>
    )
  }

  // Group results by type for better organization
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.type]) {
      acc[result.type] = []
    }
    acc[result.type].push(result)
    return acc
  }, {} as Record<SearchType, SearchResult[]>)

  return (
    <div className="divide-y divide-border">
      {Object.entries(groupedResults).map(([type, typeResults]) => {
        const searchType = type as SearchType
        // Use total count from API if available, otherwise fall back to displayed count
        const totalForType = countsByType?.[searchType] ?? typeResults.length
        const displayedCount = typeResults.length
        const hasMore = totalForType > displayedCount

        return (
        <div key={type} className="py-2">
          <div className="px-3 py-1 qt-text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
            <span>{TYPE_ICONS[searchType]} {TYPE_LABELS_PLURAL[searchType]}</span>
            {onTypeCountClick && hasMore ? (
              <button
                onClick={() => onTypeCountClick(searchType)}
                className="text-primary hover:underline cursor-pointer"
                title={`Show all ${totalForType} ${TYPE_LABELS_PLURAL[searchType].toLowerCase()}`}
              >
                ({displayedCount}/{totalForType})
              </button>
            ) : (
              <span>({totalForType})</span>
            )}
          </div>
          <div className="space-y-1">
            {typeResults.map((result) => {
              // Use composite key to ensure uniqueness across types
              const key = `${result.type}-${result.id}`
              switch (result.type) {
                case 'characters':
                  return <CharacterResultCard key={key} result={result as CharacterSearchResult} query={query} onResultClick={onResultClick} />
                case 'chats':
                  return <ChatResultCard key={key} result={result as ChatSearchResult} query={query} onResultClick={onResultClick} />
                case 'tags':
                  return <TagResultCard key={key} result={result as TagSearchResult} query={query} onResultClick={onResultClick} />
                case 'memories':
                  return <MemoryResultCard key={key} result={result as MemorySearchResult} query={query} onResultClick={onResultClick} />
                case 'messages':
                  return <MessageResultCard key={key} result={result as MessageSearchResult} query={query} onResultClick={onResultClick} />
                case 'documents':
                  return <DocumentResultCard key={key} result={result as DocumentSearchResultItem} query={query} onResultClick={onResultClick} />
                default:
                  return null
              }
            })}
          </div>
        </div>
        )
      })}
    </div>
  )
}
