'use client'

import { useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import RngDropdown, { type RngPendingResult } from './RngDropdown'
import CustomToolsButton from './CustomToolsButton'

interface ComposerGutterToolsProps {
  /** Callback to trigger file attachment dialog */
  onAttachFileClick: () => void
  /** Whether file upload is in progress */
  uploadingFile?: boolean
  /** Callback to open library file picker modal */
  onLibraryFileClick: () => void
  /** Callback to open standalone image generation dialog */
  onStandaloneGenerateImageClick: () => void
  /** Callback to open the Insert Announcement dialog */
  onInsertAnnouncementClick: () => void
  /** Callback to open the Compose Mail dialog (The Post Office) */
  onComposeMailClick: () => void
  /** Chat ID for RNG API calls */
  chatId: string
  /** Callback when RNG result is ready */
  onPendingToolResult?: (result: RngPendingResult) => void
  /** Whether this chat resolves a non-empty custom-tool roster. The custom
   *  tools button is rendered only when it does — an empty roster means the
   *  user has no definitions in scope and the button would open onto nothing. */
  customToolsAvailable?: boolean
  /** Callback after a custom tool runs, so the Salon can refetch the chat */
  onCustomToolRan?: () => void
  /** Whether the tools are disabled */
  disabled?: boolean
}

/**
 * Gutter tools for the chat composer.
 *
 * Displays small icon buttons for frequently-used message-level tools in a
 * two-column grid, filling left-to-right:
 * - Row 1: Insert Announcement (megaphone), Compose Mail (envelope)
 * - Row 2: Library file (document), Generate image (camera)
 * - Row 3: Attach file (paperclip), RNG (dice)
 * - Row 4: Custom tools (wand) — present only when `customToolsAvailable`, so
 *   the grid is 3×2 without it and 4×2 (last row half-full) with it.
 *
 * These are positioned in the left gutter of the composer for quick access.
 */
export function ComposerGutterTools({
  onAttachFileClick,
  uploadingFile = false,
  onLibraryFileClick,
  onStandaloneGenerateImageClick,
  onInsertAnnouncementClick,
  onComposeMailClick,
  chatId,
  onPendingToolResult,
  customToolsAvailable = false,
  onCustomToolRan,
  disabled = false,
}: Readonly<ComposerGutterToolsProps>) {
  const rngDropdownRef = useRef<HTMLDivElement>(null)

  return (
    <div className="qt-composer-gutter-tools">
      {/* Row 1, Col 1: Insert Announcement */}
      <button
        type="button"
        onClick={onInsertAnnouncementClick}
        disabled={disabled}
        className="qt-composer-gutter-button"
        title="Insert announcement"
        aria-label="Insert announcement"
      >
        <Icon name="megaphone" className="w-5 h-5" />
      </button>

      {/* Row 1, Col 2: Compose Mail — pairs with the megaphone as another
          "insert a special message" action (The Post Office) */}
      <button
        type="button"
        onClick={onComposeMailClick}
        disabled={disabled}
        className="qt-composer-gutter-button"
        title="Post a letter"
        aria-label="Post a letter"
      >
        <Icon name="mail" className="w-5 h-5" />
      </button>

      {/* Row 2, Col 1: Library File */}
      <button
        type="button"
        onClick={onLibraryFileClick}
        disabled={disabled}
        className="qt-composer-gutter-button"
        title="Attach file from library"
        aria-label="Attach file from library"
      >
        <Icon name="file-plus" className="w-5 h-5" />
      </button>

      {/* Row 2, Col 2: Generate Image */}
      <button
        type="button"
        onClick={onStandaloneGenerateImageClick}
        disabled={disabled}
        className="qt-composer-gutter-button"
        title="Generate image"
        aria-label="Generate image"
      >
        <Icon name="camera" className="w-5 h-5" />
      </button>

      {/* Row 3, Col 1: Attach File */}
      <button
        type="button"
        onClick={onAttachFileClick}
        disabled={disabled || uploadingFile}
        className="qt-composer-gutter-button"
        title="Attach file"
        aria-label="Attach file"
      >
        {uploadingFile ? (
          <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        ) : (
          <Icon name="paperclip" className="w-5 h-5" />
        )}
      </button>

      {/* Row 3, Col 2: RNG with dropdown */}
      <div ref={rngDropdownRef} className="qt-composer-gutter-rng">
        <RngDropdown
          chatId={chatId}
          disabled={disabled}
          onPendingResult={onPendingToolResult}
          variant="gutter"
        />
      </div>

      {/* Row 4, Col 1: Custom tools (Pascal) — opens a dialog; only when the
          chat actually resolves a roster */}
      {customToolsAvailable && (
        <CustomToolsButton
          chatId={chatId}
          disabled={disabled}
          onRan={onCustomToolRan}
          variant="gutter"
        />
      )}
    </div>
  )
}

export default ComposerGutterTools
