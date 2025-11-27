'use client'

import { useCallback, useEffect, useState } from 'react'
import { MemoryCard } from './memory-card'
import { MemoryEditor } from './memory-editor'
import { HousekeepingDialog } from './housekeeping-dialog'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'

interface Tag {
  id: string
  name: string
}

interface Memory {
  id: string
  characterId: string
  content: string
  summary: string
  keywords: string[]
  tags: string[]
  tagDetails?: Tag[]
  importance: number
  source: 'AUTO' | 'MANUAL'
  createdAt: string
  updatedAt: string
}

interface MemoryListProps {
  characterId: string
}

type SortBy = 'createdAt' | 'updatedAt' | 'importance'
type SortOrder = 'asc' | 'desc'

export function MemoryList({ characterId }: MemoryListProps) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('createdAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'AUTO' | 'MANUAL'>('ALL')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [showHousekeeping, setShowHousekeeping] = useState(false)

  const fetchMemories = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('sortBy', sortBy)
      params.set('sortOrder', sortOrder)
      if (sourceFilter !== 'ALL') params.set('source', sourceFilter)

      const res = await fetch(`/api/characters/${characterId}/memories?${params}`)
      if (!res.ok) throw new Error('Failed to fetch memories')
      const data = await res.json()
      setMemories(data.memories)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [characterId, search, sortBy, sortOrder, sourceFilter])

  useEffect(() => {
    fetchMemories()
  }, [fetchMemories])

  const handleDelete = async (memoryId: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this memory?')
    if (!confirmed) return

    setDeletingId(memoryId)
    try {
      const res = await fetch(`/api/characters/${characterId}/memories/${memoryId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete memory')
      setMemories(memories.filter(m => m.id !== memoryId))
      showSuccessToast('Memory deleted')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  const handleEdit = (memory: Memory) => {
    setEditingMemory(memory)
    setShowEditor(true)
  }

  const handleCreate = () => {
    setEditingMemory(null)
    setShowEditor(true)
  }

  const handleEditorClose = () => {
    setShowEditor(false)
    setEditingMemory(null)
  }

  const handleEditorSave = () => {
    setShowEditor(false)
    setEditingMemory(null)
    fetchMemories()
  }

  const handleHousekeepingComplete = () => {
    setShowHousekeeping(false)
    fetchMemories()
  }

  if (loading && memories.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-gray-500 dark:text-gray-400">Loading memories...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Memories ({memories.length})
        </h3>
        <div className="flex gap-2">
          {memories.length > 0 && (
            <button
              onClick={() => setShowHousekeeping(true)}
              className="px-3 py-1.5 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-white text-sm rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600"
              title="Clean up old and low-importance memories"
            >
              Cleanup
            </button>
          )}
          <button
            onClick={handleCreate}
            className="px-3 py-1.5 bg-blue-600 dark:bg-blue-700 text-white text-sm rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800"
          >
            Add Memory
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search memories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="createdAt">Created Date</option>
          <option value="updatedAt">Updated Date</option>
          <option value="importance">Importance</option>
        </select>
        <button
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700"
          title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
        >
          {sortOrder === 'asc' ? '↑' : '↓'}
        </button>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as 'ALL' | 'AUTO' | 'MANUAL')}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="ALL">All Sources</option>
          <option value="AUTO">Auto-generated</option>
          <option value="MANUAL">Manual</option>
        </select>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!loading && memories.length === 0 && (
        <div className="text-center py-8 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
          <p className="text-gray-500 dark:text-gray-400 mb-2">
            {search ? 'No memories match your search' : 'No memories yet'}
          </p>
          {!search && (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Memories will be created automatically during conversations, or you can add them manually.
            </p>
          )}
        </div>
      )}

      {/* Memory Grid */}
      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
        {memories.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            onEdit={handleEdit}
            onDelete={handleDelete}
            isDeleting={deletingId === memory.id}
          />
        ))}
      </div>

      {/* Memory Editor Modal */}
      {showEditor && (
        <MemoryEditor
          characterId={characterId}
          memory={editingMemory}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}

      {/* Housekeeping Dialog */}
      {showHousekeeping && (
        <HousekeepingDialog
          characterId={characterId}
          onClose={() => setShowHousekeeping(false)}
          onComplete={handleHousekeepingComplete}
        />
      )}
    </div>
  )
}
