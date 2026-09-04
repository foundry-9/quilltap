'use client'

/**
 * CanChooseOutfitToggle
 *
 * The "let this character choose their opening outfit" card shared by the
 * character detail and edit views' Wardrobe tabs. Presentational: the owning
 * view persists the flag (vault `properties.json`) and passes back `saving`.
 */

export interface CanChooseOutfitToggleProps {
  checked: boolean
  saving: boolean
  disabled: boolean
  onChange: (enabled: boolean) => void | Promise<void>
}

export function CanChooseOutfitToggle({ checked, saving, disabled, onChange }: CanChooseOutfitToggleProps) {
  return (
    <div className="rounded-lg border qt-border-default qt-bg-card p-4">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={saving || disabled}
          className="mt-1 accent-[var(--primary)]"
        />
        <span className="flex-1 min-w-0">
          <span className="qt-text-label block">Let this character choose their opening outfit</span>
          <span className="qt-text-small qt-text-secondary block mt-0.5">
            When enabled, a new chat with this character defaults its
            Starting Outfit to “Let character choose” instead of their
            default wardrobe. You can still overrule it per chat.
          </span>
        </span>
        {saving && (
          <span className="h-4 w-4 mt-1 animate-spin rounded-full qt-spinner shrink-0" />
        )}
      </label>
    </div>
  )
}
