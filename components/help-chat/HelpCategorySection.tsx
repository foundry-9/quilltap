'use client'

import { useEffect, useRef, useCallback, useSyncExternalStore } from 'react'
import { Icon } from '@/components/ui/icon'

interface DocumentInfo {
  id: string
  title: string
  url: string
}

interface HelpCategorySectionProps {
  label: string
  documents: DocumentInfo[]
  currentPageUrl: string
  defaultExpanded?: boolean
  forceExpanded?: boolean
  /**
   * slug → matching excerpt, for documents the current search matched on their
   * text rather than their title. Without it a topic appears in the results
   * with nothing on screen explaining why.
   */
  snippets?: Map<string, string | null> | null
  onSelectTopic: (docId: string) => void
}

/**
 * Ref-based open state to avoid setState-in-effect lint issues.
 * Same pattern as CollapsibleCard.
 */
function useOpenState(defaultOpen: boolean) {
  const stateRef = useRef(defaultOpen)
  const listenersRef = useRef(new Set<() => void>())

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener)
    return () => { listenersRef.current.delete(listener) }
  }, [])

  const getSnapshot = useCallback(() => stateRef.current, [])

  const isOpen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const setOpen = useCallback((value: boolean) => {
    if (stateRef.current !== value) {
      stateRef.current = value
      listenersRef.current.forEach(l => l())
    }
  }, [])

  const toggle = useCallback(() => {
    stateRef.current = !stateRef.current
    listenersRef.current.forEach(l => l())
  }, [])

  return { isOpen, setOpen, toggle }
}

export function HelpCategorySection({
  label,
  documents,
  currentPageUrl,
  defaultExpanded = false,
  forceExpanded = false,
  snippets = null,
  onSelectTopic,
}: HelpCategorySectionProps) {
  const { isOpen: isExpanded, setOpen, toggle } = useOpenState(defaultExpanded || forceExpanded)
  const sectionRef = useRef<HTMLDivElement>(null)
  const hasScrolledRef = useRef(false)

  // Handle forceExpanded changes
  useEffect(() => {
    if (forceExpanded) {
      setOpen(true)
      if (!hasScrolledRef.current) {
        hasScrolledRef.current = true
        requestAnimationFrame(() => {
          sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      }
    } else {
      hasScrolledRef.current = false
    }
  }, [forceExpanded, setOpen])

  // Sort documents: exact URL match first, then curated order
  const sortedDocs = [...documents].sort((a, b) => {
    const aMatch = currentPageUrl === a.url || currentPageUrl.startsWith(a.url) ? -1 : 0
    const bMatch = currentPageUrl === b.url || currentPageUrl.startsWith(b.url) ? -1 : 0
    return aMatch - bMatch
  })

  return (
    <div className="qt-help-guide-category" ref={sectionRef}>
      <button
        type="button"
        className="qt-help-guide-category-header"
        onClick={toggle}
        aria-expanded={isExpanded}
      >
        <Icon name="chevron-right" className={`qt-help-guide-category-chevron ${isExpanded ? 'qt-help-guide-category-chevron-open' : ''}`} />
        <span className="qt-help-guide-category-label">{label}</span>
        <span className="qt-help-guide-category-badge">({documents.length})</span>
      </button>
      {isExpanded && (
        <div className="qt-help-guide-category-topics">
          {sortedDocs.map((doc) => {
            const isActive = currentPageUrl === doc.url || currentPageUrl.startsWith(doc.url + '/')
            const snippet = snippets?.get(doc.id)
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => onSelectTopic(doc.id)}
                className={`qt-help-guide-topic ${isActive ? 'qt-help-guide-topic-active' : ''} ${snippet ? 'whitespace-normal' : ''}`}
              >
                {doc.title}
                {snippet && (
                  <span
                    className="block text-xs mt-0.5 truncate"
                    style={{ color: 'var(--deco-fg-muted)' }}
                  >
                    {snippet}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
