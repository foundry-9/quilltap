'use client'

/**
 * AI Wizard Modal
 *
 * Main modal component for the character AI wizard.
 * Orchestrates the multi-step wizard flow.
 */

import { useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useAIWizard } from './hooks/useAIWizard'
import { ProfileSelectionStep } from './steps/ProfileSelectionStep'
import { DescriptionSourceStep } from './steps/DescriptionSourceStep'
import { FieldSelectionStep } from './steps/FieldSelectionStep'
import { GenerationStep } from './steps/GenerationStep'
import type { AIWizardModalProps, WizardStep } from './types'

const STEP_TITLES: Record<WizardStep, string> = {
  1: 'Select AI Model',
  2: 'Physical Description Source',
  3: 'Select Fields',
  4: 'Generate',
}

export function AIWizardModal({
  isOpen,
  onClose,
  characterId,
  characterName,
  currentData,
  onApply,
}: AIWizardModalProps) {
  const wizard = useAIWizard({
    characterId,
    characterName,
    currentData,
    onApply,
    onClose,
  })


  useEscapeKey(onClose, isOpen && !wizard.generating)

  // Reset wizard when closed
  useEffect(() => {
    if (!isOpen) {
      wizard.reset()
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null

  const handleClose = () => {
    if (!wizard.generating) {
      onClose()
    }
  }

  const canProceed = wizard.canProceed
  const canGoBack = wizard.currentStep > 1 && !wizard.generating

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center qt-dialog-overlay" onClick={handleClose}>
      <div
        className="qt-dialog w-full max-w-2xl max-h-[90vh] m-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="qt-dialog-header flex justify-between items-center flex-shrink-0">
          <div>
            <h2 className="qt-dialog-title flex items-center gap-2">
              <Icon name="wand" className="w-5 h-5 text-primary" />
              AI Wizard
            </h2>
            <p className="text-sm qt-text-secondary mt-1">
              {STEP_TITLES[wizard.currentStep]}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={wizard.generating}
            className="qt-button-icon qt-button-ghost disabled:opacity-50"
          >
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-6 py-4 border-b qt-border-default flex-shrink-0">
          <div className="flex items-center justify-between">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center qt-label transition-colors ${
                    step < wizard.currentStep
                      ? 'bg-primary text-primary-foreground'
                      : step === wizard.currentStep
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'qt-bg-muted qt-text-secondary'
                  }`}
                >
                  {step < wizard.currentStep ? (
                    <Icon name="check" className="w-4 h-4" />
                  ) : (
                    step
                  )}
                </div>
                {step < 4 && (
                  <div
                    className={`w-16 sm:w-24 h-0.5 mx-2 transition-colors ${
                      step < wizard.currentStep ? 'bg-primary' : 'qt-bg-muted'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Step 1: Profile Selection */}
          {wizard.currentStep === 1 && (
            <ProfileSelectionStep
              profiles={wizard.profiles}
              loading={wizard.loadingProfiles}
              selectedProfileId={wizard.primaryProfileId}
              onSelectProfile={wizard.setPrimaryProfileId}
              error={wizard.error}
            />
          )}

          {/* Step 2: Description Source */}
          {wizard.currentStep === 2 && (
            <DescriptionSourceStep
              source={wizard.descriptionSource}
              onSourceChange={wizard.setDescriptionSource}
              uploadedImageId={wizard.uploadedImageId}
              uploadedImageUrl={wizard.uploadedImageUrl}
              onImageUpload={wizard.handleImageUpload}
              selectedGalleryImageId={wizard.selectedGalleryImageId}
              selectedGalleryImageUrl={wizard.selectedGalleryImageUrl}
              onGallerySelect={wizard.handleGallerySelect}
              uploadedDocumentId={wizard.uploadedDocumentId}
              uploadedDocumentName={wizard.uploadedDocumentName}
              onDocumentUpload={wizard.handleDocumentUpload}
              needsVisionProfile={wizard.needsVisionProfile}
              visionProfileId={wizard.visionProfileId}
              visionProfiles={wizard.visionProfiles}
              onVisionProfileSelect={wizard.setVisionProfileId}
              characterId={characterId}
            />
          )}

          {/* Step 3: Field Selection */}
          {wizard.currentStep === 3 && (
            <FieldSelectionStep
              backgroundText={wizard.backgroundText}
              onBackgroundChange={wizard.setBackgroundText}
              availableFields={wizard.availableFields}
              selectedFields={wizard.selectedFields}
              onFieldToggle={wizard.toggleField}
              onSelectAll={wizard.selectAllFields}
              onClearAll={wizard.clearAllFields}
              currentData={currentData}
              canGeneratePhysicalDescription={wizard.descriptionSource !== 'skip'}
            />
          )}

          {/* Step 4: Generation */}
          {wizard.currentStep === 4 && (
            <GenerationStep
              generating={wizard.generating}
              progress={wizard.generationProgress}
              generatedData={wizard.generatedData}
              selectedFields={wizard.selectedFields}
              onGenerate={wizard.startGeneration}
              onApply={wizard.applyGenerated}
              error={wizard.error}
            />
          )}
        </div>

        {/* Footer */}
        {wizard.currentStep < 4 && (
          <div className="qt-dialog-footer flex justify-between flex-shrink-0">
            <button
              type="button"
              onClick={wizard.prevStep}
              disabled={!canGoBack}
              className="qt-button-secondary disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={wizard.nextStep}
              disabled={!canProceed}
              className="qt-button-primary disabled:opacity-50"
            >
              {wizard.currentStep === 3 ? 'Review & Generate' : 'Next'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
