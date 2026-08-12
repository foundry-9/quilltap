'use client'

/**
 * HelpGuideTab
 *
 * Main orchestrator for the browseable Guide tab in the Help dialog.
 * Three layers: category list, expanded topics, and document reader.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { useHelpChat } from '@/components/providers/help-chat-provider'
import { HELP_CATEGORIES, EXCLUDED_DOCUMENTS, getCategoryForUrl } from '@/lib/help-guide/categories'
import { HelpGuideSearch } from './HelpGuideSearch'
import { HelpWelcomeCard } from './HelpWelcomeCard'
import { HelpCategorySection } from './HelpCategorySection'
import { HelpTopicReader } from './HelpTopicReader'

interface DocumentInfo {
  /** Slug, not the database ID — categories and doc links are keyed by slug */
  id: string
  title: string
  url: string
}

interface NavHistoryEntry {
  docId: string
  categoryLabel: string
  scrollTop: number
}

export function HelpGuideTab() {
  const { currentPageUrl } = useHelpChat()
  // Keep-alive-safe page navigation (opens tab-equivalent routes in place).
  const navigate = useWorkspaceNavigate()

  // Document index from API
  const [documents, setDocuments] = useState<Map<string, DocumentInfo>>(new Map())
  const [chatCount, setChatCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // Navigation state
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [activeCategoryLabel, setActiveCategoryLabel] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  // Navigation history for scroll position restoration
  const navHistoryRef = useRef<NavHistoryEntry[]>([])
  const readerScrollRef = useRef<HTMLDivElement>(null)
  const [restoreScrollTop, setRestoreScrollTop] = useState<number | undefined>(undefined)

  // Determine which category to auto-expand
  const contextCategoryId = useMemo(
    () => getCategoryForUrl(currentPageUrl),
    [currentPageUrl]
  )

  // Fetch document index and chat count on mount
  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      try {
        const [docsRes, countRes] = await Promise.all([
          fetch('/api/v1/help-docs'),
          fetch('/api/v1/help-docs?action=chat-count'),
        ])

        if (!cancelled) {
          if (docsRes.ok) {
            const docsData = await docsRes.json()
            const docMap = new Map<string, DocumentInfo>()
            for (const doc of docsData.documents || []) {
              if (!EXCLUDED_DOCUMENTS.includes(doc.slug)) {
                docMap.set(doc.slug, { id: doc.slug, title: doc.title, url: doc.url })
              }
            }
            setDocuments(docMap)
          }

          if (countRes.ok) {
            const countData = await countRes.json()
            setChatCount(countData.count ?? null)
          }

          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [])

  // Build category data with resolved document info
  const categories = useMemo(() => {
    return HELP_CATEGORIES.map((cat) => ({
      ...cat,
      resolvedDocs: cat.documents
        .map((docId) => documents.get(docId))
        .filter((d): d is DocumentInfo => d !== undefined),
    }))
  }, [documents])

  // Filter categories by search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories
    const query = searchQuery.toLowerCase()
    return categories
      .map((cat) => ({
        ...cat,
        resolvedDocs: cat.resolvedDocs.filter((doc) =>
          doc.title.toLowerCase().includes(query)
        ),
      }))
      .filter((cat) => cat.resolvedDocs.length > 0)
  }, [categories, searchQuery])

  const handleSelectTopic = useCallback((docId: string, categoryLabel: string) => {
    navHistoryRef.current = []
    setRestoreScrollTop(undefined)
    setActiveDocId(docId)
    setActiveCategoryLabel(categoryLabel)
  }, [])

  const handleBack = useCallback(() => {
    const entry = navHistoryRef.current.pop()
    if (entry) {
      // Go back to previous document and restore its scroll position
      setRestoreScrollTop(entry.scrollTop)
      setActiveDocId(entry.docId)
      setActiveCategoryLabel(entry.categoryLabel)
    } else {
      // No history — go back to category list
      setRestoreScrollTop(undefined)
      setActiveDocId(null)
      setActiveCategoryLabel('')
    }
  }, [])

  const handleNavigateDoc = useCallback((docId: string) => {
    // Push current document onto history stack before navigating
    if (activeDocId) {
      navHistoryRef.current.push({
        docId: activeDocId,
        categoryLabel: activeCategoryLabel,
        scrollTop: readerScrollRef.current?.scrollTop ?? 0,
      })
    }
    const cat = HELP_CATEGORIES.find((c) => c.documents.includes(docId))
    setRestoreScrollTop(undefined)
    setActiveDocId(docId)
    setActiveCategoryLabel(cat?.label || '')
  }, [activeDocId, activeCategoryLabel])

  const handleNavigatePage = useCallback((url: string) => {
    navigate(url)
  }, [navigate])

  const handleOpenWelcomeDoc = useCallback((docId: string) => {
    const cat = HELP_CATEGORIES.find((c) => c.documents.includes(docId))
    setActiveDocId(docId)
    setActiveCategoryLabel(cat?.label || '')
  }, [])

  // Both views wrapped in Art Deco scoping class
  return (
    <div className="qt-help-guide-deco flex flex-col h-full">
      {activeDocId ? (
        <HelpTopicReader
          documentId={activeDocId}
          categoryLabel={activeCategoryLabel}
          scrollContainerRef={readerScrollRef}
          restoreScrollTop={restoreScrollTop}
          onBack={handleBack}
          onNavigateDoc={handleNavigateDoc}
          onNavigatePage={handleNavigatePage}
        />
      ) : (
        <>
          <div className="flex-shrink-0 p-3 pb-0">
            <HelpGuideSearch value={searchQuery} onChange={setSearchQuery} />
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="flex items-center justify-center py-8" style={{ color: 'var(--deco-fg-muted)' }}>
                Loading guide...
              </div>
            ) : (
              <>
                {chatCount !== null && chatCount < 3 && !searchQuery && (
                  <HelpWelcomeCard onOpenDocument={handleOpenWelcomeDoc} />
                )}

                {filteredCategories.map((cat) => (
                  <HelpCategorySection
                    key={cat.id}
                    label={cat.label}
                    documents={cat.resolvedDocs}
                    currentPageUrl={currentPageUrl}
                    defaultExpanded={cat.id === contextCategoryId && !searchQuery}
                    forceExpanded={!!searchQuery}
                    onSelectTopic={(docId) => handleSelectTopic(docId, cat.label)}
                  />
                ))}

                {filteredCategories.length === 0 && searchQuery && (
                  <div className="text-center py-6" style={{ color: 'var(--deco-fg-muted)' }}>
                    No topics match &ldquo;{searchQuery}&rdquo;
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
