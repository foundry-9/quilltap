'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui/icon'
import { useRouter } from 'next/navigation'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { SearchResults } from './search-results'
import type { SearchResult, SearchResponse, SearchType } from './types'

type CountsByType = Partial<Record<SearchType, number>>

interface SearchDialogProps {
  isOpen: boolean
  onClose: () => void
  initialQuery?: string
  /** Pre-select specific types when opening the dialog */
  initialTypes?: SearchType[]
}

const ALL_TYPES: SearchType[] = ['chats', 'characters', 'messages', 'tags', 'memories']
const PAGE_SIZE = 20

export function SearchDialog({ isOpen, onClose, initialQuery = '', initialTypes }: SearchDialogProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<SearchType[]>(ALL_TYPES)
  const [hasSearched, setHasSearched] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [countsByType, setCountsByType] = useState<CountsByType>({})
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hasInitializedRef = useRef(false)
  const currentQueryRef = useRef('')

  // Search function with pagination support
  const performSearch = useCallback(async (
    searchQuery: string,
    types: SearchType[],
    offset: number,
    isNewSearch: boolean
  ) => {
    if (searchQuery.length < 2) {
      setResults([])
      setHasSearched(false)
      setHasMore(false)
      setTotalCount(0)
      setCountsByType({})
      return
    }

    if (isNewSearch) {
      setIsLoading(true)
      currentQueryRef.current = searchQuery
    } else {
      setIsLoadingMore(true)
    }
    setHasSearched(true)

    try {
      const typesParam = types.join(',')
      const response = await fetch(
        `/api/v1/ui/search?q=${encodeURIComponent(searchQuery)}&types=${typesParam}&limit=${PAGE_SIZE}&offset=${offset}`
      )

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`)
      }

      const data: SearchResponse = await response.json()

      // Only update if this is still the current query
      if (currentQueryRef.current === searchQuery) {
        if (isNewSearch) {
          setResults(data.results ?? [])
          // Only update countsByType on new search, not load more
          setCountsByType(data.countsByType ?? {})
        } else {
          // Deduplicate when appending - use type+id as unique key
          const newResults = data.results ?? []
          setResults(prev => {
            const existingKeys = new Set(prev.map(r => `${r.type}-${r.id}`))
            const uniqueNew = newResults.filter(r => !existingKeys.has(`${r.type}-${r.id}`))
            return [...prev, ...uniqueNew]
          })
        }
        setHasMore(data.hasMore ?? false)
        setTotalCount(data.totalCount ?? 0)
      }
    } catch (error) {
      console.error('Search error', { error: error instanceof Error ? error.message : String(error) })
      if (isNewSearch) {
        setResults([])
      }
      setHasMore(false)
    } finally {
      if (isNewSearch) {
        setIsLoading(false)
      } else {
        setIsLoadingMore(false)
      }
    }
  }, [])

  // Focus input when dialog opens and handle initial query/types
  useEffect(() => {
    if (isOpen) {
      // Set initial query if provided and this is a fresh open
      if (!hasInitializedRef.current) {
        if (initialQuery) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch triggered on mount; return signature contract predates useSWR migration
          setQuery(initialQuery)
        }
        // Set initial types if provided, otherwise reset to all types
        if (initialTypes && initialTypes.length > 0) {
          setSelectedTypes(initialTypes)
        } else {
          setSelectedTypes(ALL_TYPES)
        }
        hasInitializedRef.current = true
      }
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      // Reset state when closing
      setQuery('')
      setResults([])
      setHasSearched(false)
      setHasMore(false)
      setTotalCount(0)
      setCountsByType({})
      setSelectedTypes(ALL_TYPES)
      hasInitializedRef.current = false
      currentQueryRef.current = ''
    }
  }, [isOpen, initialQuery, initialTypes])

  // Trigger search when dialog opens with initial query
  useEffect(() => {
    if (isOpen && initialQuery && initialQuery.length >= 2 && hasInitializedRef.current && !hasSearched) {
      // Use initialTypes if provided, otherwise use current selectedTypes
      const typesToSearch = (initialTypes && initialTypes.length > 0) ? initialTypes : selectedTypes
      performSearch(initialQuery, typesToSearch, 0, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialQuery, initialTypes, hasSearched])

  useEscapeKey(onClose, isOpen)

  // Handle input change with debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value
    setQuery(newQuery)

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Debounce search by 300ms
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(newQuery, selectedTypes, 0, true)
    }, 300)
  }

  // Handle type filter toggle
  const toggleType = (type: SearchType) => {
    const newTypes = selectedTypes.includes(type)
      ? selectedTypes.filter(t => t !== type)
      : [...selectedTypes, type]

    // Don't allow all types to be deselected
    if (newTypes.length === 0) {
      return
    }

    setSelectedTypes(newTypes)

    // Re-search if we have a query
    if (query.length >= 2) {
      performSearch(query, newTypes, 0, true)
    }
  }

  // Load more results
  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore && query.length >= 2) {
      performSearch(query, selectedTypes, results.length, false)
    }
  }, [isLoadingMore, hasMore, query, selectedTypes, results.length, performSearch])

  // Infinite scroll handler
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      // Load more when within 100px of the bottom
      if (scrollHeight - scrollTop - clientHeight < 100) {
        loadMore()
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [loadMore])

  // Handle result click
  const handleResultClick = () => {
    onClose()
  }

  // Handle keyboard navigation for search input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.length >= 2) {
      // Perform immediate search
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
      performSearch(query, selectedTypes, 0, true)
    }
  }

  if (!isOpen || typeof document === 'undefined') return null

  // Portal to document.body so the fixed-position backdrop/dialog resolve
  // against the viewport, not against .qt-page-toolbar — whose backdrop-filter
  // makes it a containing block for fixed descendants, trapping the overlay
  // inside the toolbar and leaving nothing outside to click (bug 40).
  return createPortal(
    <>
      {/* Backdrop */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default z-[100]"
        onClick={onClose}
        aria-label="Close search"
        type="button"
      />

      {/* Dialog */}
      <div className="fixed inset-x-4 top-16 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-2xl z-[101]">
        <div className="bg-background rounded-lg shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="p-4 border-b qt-border-default">
            <div className="relative">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 qt-text-secondary" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Search chats, characters, messages, tags, memories..."
                className="w-full pl-10 pr-4 py-3 text-lg border-0 bg-transparent text-foreground placeholder-muted-foreground focus:outline-none focus:ring-0"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery('')
                    setResults([])
                    setHasSearched(false)
                    setHasMore(false)
                    setTotalCount(0)
                    setCountsByType({})
                    inputRef.current?.focus()
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 qt-text-secondary hover:text-foreground"
                  aria-label="Clear search"
                >
                  <Icon name="close" className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Type filters */}
            <div className="flex flex-wrap gap-2 mt-3">
              {ALL_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={selectedTypes.includes(type)
                    ? 'qt-filter-chip-active'
                    : 'qt-filter-chip'
                  }
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          <div ref={scrollContainerRef} className="max-h-[60vh] overflow-y-auto">
            {hasSearched ? (
              <>
                <SearchResults
                  results={results}
                  query={query}
                  isLoading={isLoading}
                  onResultClick={handleResultClick}
                  countsByType={countsByType}
                />
                {/* Loading more indicator */}
                {isLoadingMore && (
                  <div className="p-4 text-center">
                    <div className="inline-block w-5 h-5 border-2 qt-border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {/* End of results indicator */}
                {!isLoading && !isLoadingMore && results.length > 0 && !hasMore && (
                  <div className="p-3 text-center qt-text-xs qt-text-secondary border-t qt-border-default">
                    Showing all {totalCount} results
                  </div>
                )}
              </>
            ) : (
              <div className="p-6 text-center qt-text-small">
                <p>Type at least 2 characters to search</p>
                <p className="qt-text-xs mt-1">
                  Search across your chats, characters, messages, tags, and memories
                </p>
              </div>
            )}
          </div>

          {/* Footer with keyboard shortcuts */}
          <div className="px-4 py-2 border-t qt-border-default qt-bg-muted qt-text-xs flex justify-between">
            <span>
              <kbd className="px-1.5 py-0.5 qt-bg-accent qt-text-on-accent rounded">↵</kbd> to search
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 qt-bg-accent qt-text-on-accent rounded">Esc</kbd> to close
            </span>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
