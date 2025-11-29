'use client'

import { useEffect, useRef } from 'react'

interface ToolPaletteProps {
  isOpen: boolean
  onClose: () => void
  onGalleryClick: () => void
  onGenerateImageClick: () => void
  onSettingsClick: () => void
  chatPhotoCount: number
  hasImageProfile: boolean
}

export default function ToolPalette({
  isOpen,
  onClose,
  onGalleryClick,
  onGenerateImageClick,
  onSettingsClick,
  chatPhotoCount,
  hasImageProfile,
}: ToolPaletteProps) {
  const paletteRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!paletteRef.current) return

      const target = event.target as Node

      // Check if click is inside the palette
      if (paletteRef.current.contains(target)) {
        return
      }

      // Check if click is on the parent div (which contains the button)
      if (paletteRef.current.parentElement?.contains(target)) {
        return
      }

      // Click is outside both palette and parent container
      onClose()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  const handleGalleryClick = () => {
    onGalleryClick()
    onClose()
  }

  const handleGenerateImageClick = () => {
    onGenerateImageClick()
    onClose()
  }

  const handleSettingsClick = () => {
    onSettingsClick()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      ref={paletteRef}
      className="absolute bottom-20 right-0 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg shadow-lg p-2 w-48 z-50"
    >
      {/* Gallery Button */}
      {chatPhotoCount > 0 && (
        <button
          type="button"
          onClick={handleGalleryClick}
          className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <div>
            <div className="font-medium">View Gallery</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{chatPhotoCount} photos</div>
          </div>
        </button>
      )}

      {/* Generate Image Button */}
      {hasImageProfile && (
        <button
          type="button"
          onClick={handleGenerateImageClick}
          className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <div>
            <div className="font-medium">Generate Image</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">With {'{{placeholders}}'} support</div>
          </div>
        </button>
      )}

      {/* Chat Settings Button */}
      <button
        type="button"
        onClick={handleSettingsClick}
        className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
      >
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <div>
          <div className="font-medium">Chat Settings</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Provider & Images</div>
        </div>
      </button>
    </div>
  )
}
