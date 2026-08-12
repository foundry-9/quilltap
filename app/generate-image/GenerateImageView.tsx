'use client'

/**
 * Generate Image View
 *
 * Standalone image generation interface outside of chat context.
 * Allows users to generate images using their configured image profiles.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useClickOutside } from '@/hooks/useClickOutside'
import ImageModal from '@/components/chat/ImageModal'

interface EntityOption {
  id: string
  name: string
  type: 'character'
}

interface GeneratedImage {
  id: string
  filename: string
  filepath: string
  mimeType: string
  generationPrompt?: string
  generationRevisedPrompt?: string
}

export function GenerateImageView() {
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [imageCount, setImageCount] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([])
  const [allEntities, setAllEntities] = useState<EntityOption[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState<{ src: string; filename: string } | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: charactersData, isLoading } = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) => apiFetch<{ characters: Array<{ id: string; name: string }> }>('/api/v1/characters', { signal }),
  })

  // Load all characters for placeholder insertion
  useEffect(() => {
    if (charactersData?.characters) {
      const entities: EntityOption[] = charactersData.characters.map((c) => ({
        id: c.id,
        name: c.name,
        type: 'character' as const,
      }))

      // Sort alphabetically
      entities.sort((a, b) => a.name.localeCompare(b.name))

      // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by action handlers (filter/delete/update)
      setAllEntities(entities)
    }
  }, [charactersData])

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

    setSearchTerm('')
    setIsDropdownOpen(false)
  }

  const filteredEntities = allEntities.filter(entity =>
    entity.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  useClickOutside(dropdownRef, () => setIsDropdownOpen(false))

  const handleGenerate = async () => {
    if (!selectedProfileId) {
      showErrorToast('Please select an image profile')
      return
    }

    if (!prompt.trim()) {
      showErrorToast('Please enter a prompt')
      return
    }

    setIsGenerating(true)

    try {
      const requestBody = {
        prompt: prompt.trim(),
        count: imageCount,
      }

      const res = await fetch(`/api/v1/image-profiles/${selectedProfileId}?action=generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const data = await res.json()

      if (!res.ok) {
        const errorMessage = data.error || data.message || 'Failed to generate image'
        throw new Error(errorMessage)
      }

      // API returns images in data.data (matching chat dialog pattern)
      const images: GeneratedImage[] = data.data || []

      if (images.length > 0) {
        setGeneratedImages(prev => [...images, ...prev])
        showSuccessToast(`Generated ${images.length} image${images.length > 1 ? 's' : ''}`)
      } else {
        showErrorToast('No images were generated')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('Error generating image:', message)
      showErrorToast(message || 'Failed to generate image')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownload = useCallback(async (image: GeneratedImage) => {
    try {
      const res = await fetch(image.filepath)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = image.filename || 'generated-image.png'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      showErrorToast('Failed to download image')
    }
  }, [])

  return (
    <div className="qt-page-container max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="qt-heading-2 text-foreground">Generate Image</h1>
        <Link href="/" className="text-sm qt-text-secondary hover:text-foreground">
          &larr; Back to Home
        </Link>
      </div>

      {/* Generation Form */}
      <div className="qt-card p-6 mb-6">
        <div className="space-y-4">
          {/* Image Profile Selection */}
          <div>
            <label className="block qt-label text-foreground mb-2">
              Image Profile
            </label>
            <ImageProfilePicker
              value={selectedProfileId}
              onChange={setSelectedProfileId}
            />
          </div>

          {/* Prompt Input */}
          <div>
            <label className="block qt-label text-foreground mb-2">
              Prompt
            </label>
            <div className="relative">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate... Use {{CharacterName}} to include character descriptions."
                className="w-full h-32 px-3 py-2 border qt-border-default rounded-lg qt-bg-card text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />

              {/* Character Placeholder Dropdown */}
              <div className="relative mt-2" ref={dropdownRef}>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value)
                      setIsDropdownOpen(true)
                    }}
                    onFocus={() => setIsDropdownOpen(true)}
                    placeholder="Search characters to insert..."
                    className="flex-1 px-3 py-2 text-sm border qt-border-default rounded-lg qt-bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => insertPlaceholder('me')}
                    className="qt-button qt-button-secondary qt-button-sm"
                    title="Insert {{me}} placeholder"
                  >
                    me
                  </button>
                  <button
                    type="button"
                    onClick={() => insertPlaceholder('char')}
                    className="qt-button qt-button-secondary qt-button-sm"
                    title="Insert {{char}} placeholder"
                  >
                    char
                  </button>
                </div>

                {/* Dropdown list */}
                {isDropdownOpen && filteredEntities.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 max-h-48 overflow-y-auto qt-bg-card border qt-border-default rounded-lg qt-shadow-lg">
                    {filteredEntities.slice(0, 10).map((entity) => (
                      <button
                        key={entity.id}
                        type="button"
                        onClick={() => insertPlaceholder(entity.name)}
                        className="w-full px-3 py-2 text-left text-sm hover:qt-bg-muted transition-colors flex items-center gap-2"
                      >
                        <span className="text-xs px-1.5 py-0.5 qt-bg-muted rounded">
                          {entity.type}
                        </span>
                        <span>{entity.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Image Count */}
          <div>
            <label className="block qt-label text-foreground mb-2">
              Number of Images
            </label>
            <select
              value={imageCount}
              onChange={(e) => setImageCount(parseInt(e.target.value, 10))}
              className="px-3 py-2 border qt-border-default rounded-lg qt-bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} image{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Generate Button */}
          <div className="pt-2">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !selectedProfileId || !prompt.trim()}
              className="qt-button qt-button-primary w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <Icon name="image" className="w-4 h-4 mr-2" />
                  Generate Image
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Generated Images Gallery */}
      {generatedImages.length > 0 && (
        <div className="qt-card p-6">
          <h2 className="qt-heading-4 text-foreground mb-4">
            Generated Images ({generatedImages.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {generatedImages.map((image) => (
              <div key={image.id} className="relative group">
                <img
                  src={image.filepath}
                  alt={image.generationPrompt || 'Generated image'}
                  className="w-full aspect-square object-cover rounded-lg border qt-border-default"
                />
                {/* Overlay with actions */}
                <div className="absolute inset-0 qt-bg-overlay-medium opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                  <button
                    onClick={() => handleDownload(image)}
                    className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full transition-colors"
                    title="Download"
                  >
                    <Icon name="download" className="w-5 h-5 qt-text-overlay" />
                  </button>
                  <button
                    onClick={() => setPreviewImage({ src: image.filepath, filename: image.filename })}
                    className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full transition-colors"
                    title="View image"
                  >
                    <Icon name="eye" className="w-5 h-5 qt-text-overlay" />
                  </button>
                </div>
                {/* Prompt tooltip */}
                {image.generationPrompt && (
                  <div className="absolute bottom-0 left-0 right-0 p-2 qt-bg-overlay-medium qt-text-overlay text-xs rounded-b-lg opacity-0 group-hover:opacity-100 transition-opacity line-clamp-2">
                    {image.generationRevisedPrompt || image.generationPrompt}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <ImageModal
          isOpen={true}
          onClose={() => setPreviewImage(null)}
          src={previewImage.src}
          filename={previewImage.filename}
        />
      )}

      {/* Empty State */}
      {generatedImages.length === 0 && (
        <div className="qt-card p-8 text-center qt-text-secondary">
          <Icon name="image" className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="qt-text-section">No images generated yet</p>
          <p className="text-sm mt-1">Enter a prompt and click Generate to create your first image</p>
        </div>
      )}
    </div>
  )
}
