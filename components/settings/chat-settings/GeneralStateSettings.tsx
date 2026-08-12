'use client'

import { useState } from 'react'
import StateEditorModal from '@/components/state/StateEditorModal'

/**
 * Instance-wide "General State" editor entry point. General state is the
 * bottom tier of the state cascade (chat → project → group → general) — shared
 * by every chat unless a narrower tier overrides a key. Lives beside Pascal's
 * custom-tools card because persistent state is Pascal the Croupier's
 * subsystem.
 */
export function GeneralStateSettings() {
  const [showModal, setShowModal] = useState(false)

  return (
    <div className="space-y-3">
      <p className="qt-text-sm qt-text-secondary">
        General state is the instance-wide foundation of the state cascade —
        every chat sees it unless a chat, project, or group sets the same key.
      </p>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="qt-button qt-button-secondary"
      >
        Edit General State
      </button>

      <StateEditorModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        entityType="general"
      />
    </div>
  )
}
