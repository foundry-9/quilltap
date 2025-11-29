'use client'

import { useState, useRef, useEffect } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface EntityOption {
  id: string
  name: string
  type: 'character' | 'persona'
}

interface Participant {
  id: string
  type: 'CHARACTER' | 'PERSONA'
  character?: {
    id: string
    name: string
  } | null
  persona?: {
    id: string
    name: string
  } | null
}

interface GenerateImageDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  participants: Participant[]
  imageProfileId?: string
  onImagesGenerated?: (images: Array<{ id: string; filename: string; filepath: string; mimeType: string }>, prompt: string) => void
}

export default function GenerateImageDialog({
  isOpen,
  onClose,
  chatId,
  participants,
  imageProfileId,
  onImagesGenerated,
}: GenerateImageDialogProps) {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [allEntities, setAllEntities] = useState<EntityOption[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load all characters and personas for the dropdown
  useEffect(() => {
    if (isOpen) {
      loadAllEntities()
    }
  }, [isOpen])

  const loadAllEntities = async () => {
    try {
      const [charactersRes, personasRes] = await Promise.all([
        fetch('/api/characters'),
        fetch('/api/personas'),
      ])

      if (!charactersRes.ok || !personasRes.ok) {
        throw new Error('Failed to load entities')
      }

      const charactersData = await charactersRes.json()
      const personasData = await personasRes.json()

      const characters = charactersData.characters || []
      const personas = Array.isArray(personasData) ? personasData : personasData.personas || []

      const entities: EntityOption[] = [
        ...characters.map((c: any) => ({
          id: c.id,
          name: c.name,
          type: 'character' as const,
        })),
        ...personas.map((p: any) => ({
          id: p.id,
          name: p.name,
          type: 'persona' as const,
        })),
      ]

      // Sort alphabetically
      entities.sort((a, b) => a.name.localeCompare(b.name))

      setAllEntities(entities)
    } catch (error) {
      console.error('Error loading entities:', error)
      showErrorToast('Failed to load characters and personas')
    }
  }

  const insertPlaceholder = (text: string) => {
    const textarea = promptRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = prompt.substring(0, start)
    const after = prompt.substring(end)

    const placeholder = `{{${text}}}`
    const newPrompt = before + placeholder + after
    setPrompt(newPrompt)

    // Set cursor position after the inserted placeholder
    setTimeout(() => {
      textarea.focus()
      const newPosition = start + placeholder.length
      textarea.setSelectionRange(newPosition, newPosition)
    }, 0)
  }

  const handleEntitySelect = (entity: EntityOption) => {
    insertPlaceholder(entity.name)
    setIsDropdownOpen(false)
    setSearchTerm('')
  }

  const filteredEntities = allEntities.filter(e =>
    e.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      showErrorToast('Please enter a prompt')
      return
    }

    if (!imageProfileId) {
      showErrorToast('No image profile configured for this chat. Please configure an image profile for one of the chat participants.')
      return
    }

    setIsGenerating(true)

    try {
      const response = await fetch(`/api/image-profiles/${imageProfileId}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          chatId,
          count: 1,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = errorData.message || errorData.error || 'Failed to generate image'
        showErrorToast(errorMessage)
        return
      }

      const data = await response.json()

      if (data.success && data.data && data.data.length > 0) {
        showSuccessToast(`Generated ${data.data.length} image(s) - attached to next message`)
        // Use the expanded prompt from the API response, or fall back to user's prompt
        const finalPrompt = data.expandedPrompt || prompt
        setPrompt('')
        onImagesGenerated?.(data.data.map((img: any) => ({
          id: img.id,
          filename: img.filename,
          filepath: img.filepath,
          mimeType: img.mimeType,
        })), finalPrompt)
        onClose()
      } else {
        showErrorToast('No images generated')
      }
    } catch (error) {
      // Only log unexpected errors, not API errors
      if (error instanceof Error) {
        showErrorToast(error.message)
      } else {
        console.error('Unexpected error during image generation:', error)
        showErrorToast('Failed to generate image')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false)
      }
    }

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isDropdownOpen])

  if (!isOpen) return null

  // Get current chat participants for quick buttons
  const characterParticipants = participants.filter(p => p.type === 'CHARACTER')
  const personaParticipant = participants.find(p => p.type === 'PERSONA')

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Generate Image
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            disabled={isGenerating}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex gap-4">
            {/* Left side - Quick buttons */}
            <div className="w-48 flex-shrink-0 space-y-2">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Quick Insert
              </div>

              {/* Me button */}
              {personaParticipant?.persona && (
                <button
                  onClick={() => insertPlaceholder('me')}
                  className="w-full px-3 py-2 text-left text-sm bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded border border-blue-200 dark:border-blue-700 transition-colors"
                  disabled={isGenerating}
                >
                  <div className="font-medium">{personaParticipant.persona.name}</div>
                  <div className="text-xs opacity-75">{'{{me}}'}</div>
                </button>
              )}

              {/* Character buttons */}
              {characterParticipants.map(p => (
                p.character && (
                  <button
                    key={p.id}
                    onClick={() => insertPlaceholder(p.character!.name)}
                    className="w-full px-3 py-2 text-left text-sm bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded border border-purple-200 dark:border-purple-700 transition-colors"
                    disabled={isGenerating}
                  >
                    <div className="font-medium truncate">{p.character.name}</div>
                    <div className="text-xs opacity-75">{`{{${p.character.name}}}`}</div>
                  </button>
                )
              ))}

              {/* Search dropdown */}
              <div className="relative pt-4" ref={dropdownRef}>
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-slate-700 hover:bg-gray-100 dark:hover:bg-slate-600 rounded border border-gray-300 dark:border-slate-600 transition-colors flex items-center justify-between"
                  disabled={isGenerating}
                >
                  <span>Other Characters...</span>
                  <svg className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg shadow-lg max-h-64 overflow-hidden flex flex-col z-10">
                    <div className="p-2 border-b border-gray-200 dark:border-slate-600">
                      <input
                        type="text"
                        placeholder="Search..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-slate-500 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div className="overflow-y-auto">
                      {filteredEntities.map(entity => (
                        <button
                          key={entity.id}
                          onClick={() => handleEntitySelect(entity)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-slate-600 flex items-center gap-2"
                        >
                          <span className={`px-1.5 py-0.5 text-xs rounded ${
                            entity.type === 'character'
                              ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                              : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                          }`}>
                            {entity.type === 'character' ? 'C' : 'P'}
                          </span>
                          <span className="text-gray-900 dark:text-white">{entity.name}</span>
                        </button>
                      ))}
                      {filteredEntities.length === 0 && (
                        <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
                          No matches found
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right side - Prompt input */}
            <div className="flex-1">
              <label htmlFor="image-prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Image Prompt
              </label>
              <textarea
                id="image-prompt"
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate. Use {{placeholders}} for characters and personas.&#10;&#10;Examples:&#10;- {{me}} in a forest clearing at sunset&#10;- {{Alice}} and {{me}} having coffee together&#10;- A serene mountain landscape"
                className="w-full h-64 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              />
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Click buttons on the left or type {'{{name}}'} to insert placeholders
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-6 border-t border-gray-200 dark:border-slate-700">
          {!imageProfileId && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Configure an image profile in Chat Settings to generate images
            </p>
          )}
          <div className="flex gap-3 ml-auto">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            disabled={isGenerating}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim() || !imageProfileId}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Generating...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Generate Image
              </>
            )}
          </button>
          </div>
        </div>
      </div>
    </div>
  )
}
