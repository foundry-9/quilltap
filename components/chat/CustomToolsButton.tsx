'use client'

/**
 * CustomToolsButton — the wand in the composer gutter (and, in `palette`
 * variant, on the tool palette) that opens Pascal's table.
 *
 * Nothing but a button and the dialog's open flag. The dialog is rendered
 * unconditionally so it keeps its memory of what you last set while it is
 * closed; see {@link CustomToolRunDialog}.
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import CustomToolRunDialog from './CustomToolRunDialog'

interface CustomToolsButtonProps {
  /** Chat ID for the roster + run API calls */
  chatId: string
  /** Whether the button is disabled */
  disabled?: boolean
  /** Called after a successful run so the Salon can refetch the chat */
  onRan?: () => void
  /** Called to close the parent ToolPalette */
  onClose?: () => void
  /** Button variant: 'palette' (default) for tool palette, 'gutter' for composer gutter */
  variant?: 'palette' | 'gutter'
}

export function CustomToolsButton({
  chatId,
  disabled = false,
  onRan,
  onClose,
  variant = 'palette',
}: Readonly<CustomToolsButtonProps>) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(true)}
        disabled={disabled}
        className={variant === 'gutter' ? 'qt-composer-gutter-button' : 'qt-tool-palette-button'}
        title="Custom tools"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Custom tools"
      >
        <Icon name="wand" className={variant === 'gutter' ? 'w-5 h-5' : 'w-4 h-4'} />
        {variant === 'palette' && <span>Tools</span>}
      </button>

      <CustomToolRunDialog
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false)
          onClose?.()
        }}
        chatId={chatId}
        onRan={onRan}
      />
    </>
  )
}

export default CustomToolsButton
