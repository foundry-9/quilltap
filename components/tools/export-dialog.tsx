'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { useExportData } from './import-export/hooks/useExportData'
import { ENTITY_TYPE_LABELS } from './import-export/types'
import {
  LoadingSpinner,
  WizardLoadingStep,
  WizardCompleteStep,
  WizardErrorStep,
} from './import-export/components'
import {
  ExportTypeStep,
  ExportSelectStep,
  ExportOptionsStep,
} from './import-export/steps'
import type { ExportEntityType } from '@/lib/export/types'

export function ExportDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const { state, actions } = useExportData({
    isOpen,
    onSuccess: onClose,
  })
  const [searchQuery, setSearchQuery] = useState('')

  if (!isOpen) return null

  const getStepNumber = (): number => {
    switch (state.step) {
      case 'type':
        return 1
      case 'select':
        return 2
      case 'options':
        return 3
      case 'exporting':
        return 4
      case 'complete':
        return 5
      default:
        return 1
    }
  }

  const getTotalSteps = (): number => {
    if (
      state.step === 'exporting' ||
      state.step === 'complete' ||
      state.step === 'error'
    ) {
      return 5
    }

    if (
      state.entityType === 'characters' ||
      state.entityType === 'chats'
    ) {
      return state.step === 'type' || state.step === 'select' ? 5 : 4
    }

    return 4
  }

  const filteredEntities = state.availableEntities.filter((entity) =>
    entity.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const handleClose = () => {
    if (!state.exporting) {
      setSearchQuery('')
      actions.reset()
      onClose()
    }
  }

  return (
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={handleClose}
        disabled={state.exporting}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto w-[90vw] max-w-2xl">
        <div className="qt-dialog w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="qt-dialog-header flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="qt-dialog-title">Export Data</h2>
                <p className="qt-dialog-description mt-0.5">
                  Step {getStepNumber()} of {getTotalSteps()}
                </p>
              </div>
              <button
                onClick={handleClose}
                disabled={state.exporting}
                className="qt-text-secondary hover:text-foreground disabled:opacity-50"
                aria-label="Close dialog"
              >
                <Icon name="close" className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="qt-dialog-body overflow-y-auto flex-1">
            {/* Step 1: Type Selection */}
            {state.step === 'type' && (
              <ExportTypeStep
                entityType={state.entityType}
                onEntityTypeChange={actions.setEntityType}
              />
            )}

            {/* Step 2: Entity Selection */}
            {state.step === 'select' && (
              <ExportSelectStep
                scope={state.scope}
                onScopeChange={actions.setScope}
                selectedIds={state.selectedIds}
                onToggleSelection={actions.toggleEntitySelection}
                availableEntities={state.availableEntities}
                filteredEntities={filteredEntities}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                loadingEntities={state.loadingEntities}
              />
            )}

            {/* Step 3: Export Options */}
            {state.step === 'options' && (
              <ExportOptionsStep
                includeMemories={state.includeMemories}
                onIncludeMemoriesChange={actions.setIncludeMemories}
                memoryCount={state.memoryCount}
                vaultPreview={state.vaultPreview}
              />
            )}

            {/* Step 4: Exporting */}
            {state.step === 'exporting' && (
              <WizardLoadingStep message="Creating export..." />
            )}

            {/* Step 5: Complete */}
            {state.step === 'complete' && (
              <WizardCompleteStep
                title="Export Complete"
                description="Your data has been successfully exported and downloaded."
              />
            )}

            {/* Error State */}
            {state.step === 'error' && (
              <WizardErrorStep
                title="Export Failed"
                error={state.error}
              />
            )}
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer flex gap-3 justify-between flex-shrink-0">
            {state.step === 'complete' ? (
              <button onClick={handleClose} className="flex-1 qt-button qt-button-primary">
                Close
              </button>
            ) : (
              <>
                <button
                  onClick={actions.handleBack}
                  disabled={state.step === 'type' || state.exporting}
                  className="qt-button qt-button-secondary"
                >
                  Back
                </button>

                {state.step === 'exporting' ? null : (
                  <>
                    <button
                      onClick={handleClose}
                      disabled={state.exporting}
                      className="qt-button qt-button-secondary"
                    >
                      Cancel
                    </button>

                    {state.step === 'options' || (state.step === 'select' && state.entityType && !['characters', 'chats'].includes(state.entityType)) ? (
                      <button
                        onClick={actions.handleExport}
                        disabled={
                          state.exporting ||
                          (state.step === 'select' &&
                            state.scope === 'selected' &&
                            state.selectedIds.length === 0)
                        }
                        className="qt-button qt-button-primary"
                      >
                        {state.exporting ? (
                          <>
                            <LoadingSpinner />
                            Exporting...
                          </>
                        ) : (
                          'Export'
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={actions.handleNext}
                        disabled={
                          state.step === 'type' && !state.entityType ||
                          (state.step === 'select' &&
                            state.scope === 'selected' &&
                            state.selectedIds.length === 0)
                        }
                        className="qt-button qt-button-primary"
                      >
                        Next
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
