'use client'

import { useEffect, useState } from 'react'

interface ExclusiveChat {
  id: string
  title: string
  messageCount: number
  lastMessageAt: string | null
}

interface CascadePreview {
  characterId: string
  characterName: string
  exclusiveChats: ExclusiveChat[]
  exclusiveCharacterImageCount: number
  exclusiveChatImageCount: number
  totalExclusiveImageCount: number
  memoryCount: number
}

interface CharacterDeleteDialogProps {
  characterId: string
  characterName: string
  onClose: () => void
  onConfirm: (options: { cascadeChats: boolean; cascadeImages: boolean }) => void
}

export function CharacterDeleteDialog({
  characterId,
  characterName,
  onClose,
  onConfirm,
}: CharacterDeleteDialogProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<CascadePreview | null>(null)
  const [deleteChats, setDeleteChats] = useState(true)
  const [deleteImages, setDeleteImages] = useState(true)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  useEffect(() => {
    const fetchPreview = async () => {
      try {
        const res = await fetch(`/api/characters/${characterId}/cascade-preview`)
        if (!res.ok) throw new Error('Failed to load preview')
        const data = await res.json()
        setPreview(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load preview')
      } finally {
        setLoading(false)
      }
    }

    fetchPreview()
  }, [characterId])

  const hasExclusiveData = preview &&
    (preview.exclusiveChats.length > 0 || preview.totalExclusiveImageCount > 0 || preview.memoryCount > 0)

  const handleConfirm = () => {
    onConfirm({
      cascadeChats: deleteChats,
      cascadeImages: deleteImages,
    })
  }

  return (
    <>
      <button
        className="fixed inset-0 bg-black bg-opacity-50 pointer-events-auto z-[100] cursor-default border-none p-0"
        onClick={onClose}
        aria-label="Close dialog"
        type="button"
      />
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[101] pointer-events-auto">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-lg w-full shadow-xl">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Delete Character
          </h2>

          {loading ? (
            <div className="py-8 text-center text-gray-600 dark:text-gray-400">
              Loading...
            </div>
          ) : error ? (
            <div className="py-4 text-red-600 dark:text-red-400">
              {error}
            </div>
          ) : (
            <>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Are you sure you want to delete <strong>{characterName}</strong>?
              </p>

              {hasExclusiveData && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
                  <p className="text-amber-800 dark:text-amber-200 font-medium mb-3">
                    This character has associated data:
                  </p>

                  {preview!.exclusiveChats.length > 0 && (
                    <div className="mb-3">
                      <p className="text-amber-700 dark:text-amber-300 text-sm mb-2">
                        <strong>{preview!.exclusiveChats.length}</strong> exclusive chat{preview!.exclusiveChats.length !== 1 ? 's' : ''} (only with this character):
                      </p>
                      <ul className="text-sm text-amber-600 dark:text-amber-400 ml-4 list-disc max-h-32 overflow-y-auto">
                        {preview!.exclusiveChats.map(chat => (
                          <li key={chat.id}>
                            {chat.title} ({chat.messageCount} message{chat.messageCount !== 1 ? 's' : ''})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {preview!.totalExclusiveImageCount > 0 && (
                    <p className="text-amber-700 dark:text-amber-300 text-sm">
                      <strong>{preview!.totalExclusiveImageCount}</strong> exclusive image{preview!.totalExclusiveImageCount !== 1 ? 's' : ''} (not used elsewhere)
                    </p>
                  )}

                  {preview!.memoryCount > 0 && (
                    <p className="text-amber-700 dark:text-amber-300 text-sm">
                      <strong>{preview!.memoryCount}</strong> memor{preview!.memoryCount !== 1 ? 'ies' : 'y'} (will always be deleted)
                    </p>
                  )}
                </div>
              )}

              {hasExclusiveData && (
                <div className="space-y-3 mb-6">
                  {preview!.exclusiveChats.length > 0 && (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deleteChats}
                        onChange={(e) => setDeleteChats(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      <span className="text-gray-700 dark:text-gray-300">
                        Delete exclusive chats
                      </span>
                    </label>
                  )}

                  {preview!.totalExclusiveImageCount > 0 && (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deleteImages}
                        onChange={(e) => setDeleteImages(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      <span className="text-gray-700 dark:text-gray-300">
                        Delete exclusive images
                      </span>
                    </label>
                  )}
                </div>
              )}

              {!hasExclusiveData && (
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  This character has no exclusive chats or images that would be deleted.
                </p>
              )}
            </>
          )}

          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete Character
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
