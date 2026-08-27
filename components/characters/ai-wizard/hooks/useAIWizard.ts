'use client'

/**
 * useAIWizard Hook
 *
 * State management for the AI character wizard.
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { filterProfilesBySupportedMimeType, profileSupportsMimeType } from '@/lib/llm/connection-profile-utils'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type {
  WizardStep,
  DescriptionSourceType,
  GeneratableField,
  AIWizardState,
  GeneratedCharacterData,
  AIWizardRequest,
  AIWizardResponse,
  WizardCharacterData,
} from '../types'
import { normalizeGeneratedScenarios } from '../types'

interface UseAIWizardProps {
  characterId?: string
  characterName: string
  currentData: WizardCharacterData
  onApply: (data: GeneratedCharacterData) => void
  onClose: () => void
}

export function useAIWizard({
  characterId,
  characterName,
  currentData,
  onApply,
  onClose,
}: UseAIWizardProps) {
  // State
  const [currentStep, setCurrentStep] = useState<WizardStep>(1)
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [primaryProfileId, setPrimaryProfileId] = useState('')
  const [descriptionSource, setDescriptionSource] = useState<DescriptionSourceType>('existing')
  const [uploadedImageId, setUploadedImageId] = useState<string | null>(null)
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null)
  const [selectedGalleryImageId, setSelectedGalleryImageId] = useState<string | null>(null)
  const [selectedGalleryImageUrl, setSelectedGalleryImageUrl] = useState<string | null>(null)
  const [uploadedDocumentId, setUploadedDocumentId] = useState<string | null>(null)
  const [uploadedDocumentName, setUploadedDocumentName] = useState<string | null>(null)
  const [visionProfileId, setVisionProfileId] = useState<string | null>(null)
  const [backgroundText, setBackgroundText] = useState('')
  const [selectedFields, setSelectedFields] = useState<Set<GeneratableField>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState({
    currentField: null as GeneratableField | null,
    completedFields: [] as GeneratableField[],
    snippets: {} as Record<string, string>,
    errors: {} as Record<string, string>,
  })
  const [generatedData, setGeneratedData] = useState<GeneratedCharacterData | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch connection profiles on mount
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        setLoadingProfiles(true)
        const response = await fetch('/api/v1/connection-profiles')
        if (!response.ok) {
          throw new Error('Failed to fetch connection profiles')
        }
        const data = await response.json()
        const profileList = data.profiles || []
        setProfiles(profileList)

        // Auto-select default profile if available
        const defaultProfile = profileList.find((p: ConnectionProfile) => p.isDefault)
        if (defaultProfile) {
          setPrimaryProfileId(defaultProfile.id)
        } else if (profileList.length > 0) {
          setPrimaryProfileId(profileList[0].id)
        }
      } catch (err) {
        console.error('Failed to fetch profiles for AI wizard', {
          error: err instanceof Error ? err.message : String(err),
        })
        setError('Failed to load connection profiles')
      } finally {
        setLoadingProfiles(false)
      }
    }

    fetchProfiles()
  }, [])


  // Computed: Vision-capable profiles
  const visionProfiles = useMemo(() => {
    return filterProfilesBySupportedMimeType(profiles, 'image/jpeg')
  }, [profiles])

  // Computed: Check if primary profile supports vision
  const primaryProfile = useMemo(() => {
    return profiles.find((p) => p.id === primaryProfileId) || null
  }, [profiles, primaryProfileId])

  const primarySupportsVision = useMemo(() => {
    if (!primaryProfile) return false
    return profileSupportsMimeType(primaryProfile, 'image/jpeg')
  }, [primaryProfile])

  // Computed: Needs secondary vision profile?
  const needsVisionProfile = useMemo(() => {
    const isImageSource = descriptionSource === 'upload' || descriptionSource === 'gallery'
    return isImageSource && !primarySupportsVision
  }, [descriptionSource, primarySupportsVision])

  // Computed: Available fields (empty fields that can be generated)
  const availableFields = useMemo((): GeneratableField[] => {
    const fields: GeneratableField[] = []

    // Name is available if characterName is empty
    if (!characterName.trim()) fields.push('name')
    if (!currentData.title?.trim()) fields.push('title')
    if (!currentData.identity?.trim()) fields.push('identity')
    if (!currentData.description?.trim()) fields.push('description')
    if (!currentData.manifesto?.trim()) fields.push('manifesto')
    if (!currentData.personality?.trim()) fields.push('personality')
    // Scenarios are always available — you can always generate more
    fields.push('scenarios')
    if (!currentData.exampleDialogues?.trim()) fields.push('exampleDialogues')
    if (!currentData.firstMessage?.trim()) fields.push('firstMessage')
    if (!currentData.systemPrompt?.trim()) fields.push('systemPrompt')

    // Properties are available when pronouns are unset (aliases ride along)
    if (!currentData.pronouns) fields.push('properties')

    // Physical description is available if not skipping
    if (descriptionSource !== 'skip') {
      fields.push('physicalDescription')
    }

    // Wardrobe items are always available
    fields.push('wardrobeItems')

    return fields
  }, [characterName, currentData, descriptionSource])

  // Computed: Can proceed to next step?
  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 1:
        return !!primaryProfileId
      case 2:
        if (descriptionSource === 'skip' || descriptionSource === 'existing') {
          return true
        }
        if (descriptionSource === 'upload') {
          const hasImage = !!uploadedImageId
          const hasVisionIfNeeded = !needsVisionProfile || !!visionProfileId
          return hasImage && hasVisionIfNeeded
        }
        if (descriptionSource === 'gallery') {
          const hasImage = !!selectedGalleryImageId
          const hasVisionIfNeeded = !needsVisionProfile || !!visionProfileId
          return hasImage && hasVisionIfNeeded
        }
        if (descriptionSource === 'document') {
          return !!uploadedDocumentId
        }
        return false
      case 3:
        return selectedFields.size > 0
      case 4:
        return true
      default:
        return false
    }
  }, [
    currentStep,
    primaryProfileId,
    descriptionSource,
    uploadedImageId,
    selectedGalleryImageId,
    uploadedDocumentId,
    needsVisionProfile,
    visionProfileId,
    selectedFields,
  ])

  // Actions
  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step)
    setError(null)
  }, [])

  const nextStep = useCallback(() => {
    if (currentStep < 4) {
      setCurrentStep((prev) => (prev + 1) as WizardStep)
      setError(null)
    }
  }, [currentStep])

  const prevStep = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as WizardStep)
      setError(null)
    }
  }, [currentStep])

  const handleImageUpload = useCallback((imageId: string, imageUrl: string) => {
    setUploadedImageId(imageId)
    setUploadedImageUrl(imageUrl)
  }, [])

  const handleGallerySelect = useCallback((imageId: string, imageUrl: string) => {
    setSelectedGalleryImageId(imageId)
    setSelectedGalleryImageUrl(imageUrl)
  }, [])

  const handleDocumentUpload = useCallback((documentId: string, documentName: string) => {
    setUploadedDocumentId(documentId)
    setUploadedDocumentName(documentName)
  }, [])

  const toggleField = useCallback((field: GeneratableField) => {
    setSelectedFields((prev) => {
      const next = new Set(prev)
      if (next.has(field)) {
        next.delete(field)
      } else {
        next.add(field)
      }
      return next
    })
  }, [])

  const selectAllFields = useCallback(() => {
    setSelectedFields(new Set(availableFields))
  }, [availableFields])

  const clearAllFields = useCallback(() => {
    setSelectedFields(new Set())
  }, [])

  // Generate content using streaming API
  const startGeneration = useCallback(async () => {
    if (selectedFields.size === 0) {
      setError('Please select at least one field to generate')
      return
    }

    setGenerating(true)
    setError(null)
    setGenerationProgress({
      currentField: null,
      completedFields: [],
      snippets: {},
      errors: {},
    })

    try {
      // Determine image ID if using image source
      let imageId: string | undefined
      if (descriptionSource === 'upload' && uploadedImageId) {
        imageId = uploadedImageId
      } else if (descriptionSource === 'gallery' && selectedGalleryImageId) {
        imageId = selectedGalleryImageId
      }

      // Determine document ID if using document source
      let documentId: string | undefined
      if (descriptionSource === 'document' && uploadedDocumentId) {
        documentId = uploadedDocumentId
      }

      const request: AIWizardRequest = {
        primaryProfileId,
        visionProfileId: needsVisionProfile ? visionProfileId ?? undefined : undefined,
        sourceType: descriptionSource,
        imageId,
        documentId,
        characterName,
        existingData: currentData,
        background: backgroundText,
        fieldsToGenerate: Array.from(selectedFields),
        characterId,
      }

      // Use streaming endpoint
      const response = await fetch('/api/v1/characters?action=ai-wizard-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Generation failed')
      }

      // Parse SSE stream
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response stream')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))

              switch (event.type) {
                case 'field_start':
                  setGenerationProgress((prev) => ({
                    ...prev,
                    currentField: event.field as GeneratableField,
                  }))
                  break

                case 'field_complete':
                  setGenerationProgress((prev) => ({
                    ...prev,
                    currentField: null,
                    completedFields: [...prev.completedFields, event.field as GeneratableField],
                    snippets: {
                      ...prev.snippets,
                      [event.field]: event.snippet || '',
                    },
                  }))
                  break

                case 'field_error':
                  setGenerationProgress((prev) => ({
                    ...prev,
                    currentField: null,
                    errors: {
                      ...prev.errors,
                      [event.field]: event.error || 'Generation failed',
                    },
                  }))
                  break

                case 'done':
                  setGeneratedData(event.fullContent as GeneratedCharacterData)
                  if (event.error) {
                    setError(event.error)
                  }
                  setGenerationProgress((prev) => ({
                    ...prev,
                    currentField: null,
                    errors: event.errors || prev.errors,
                  }))
                  break
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }
    } catch (err) {
      let errorMessage = 'Generation failed'
      if (err instanceof Error) {
        errorMessage = err.message
      } else if (typeof err === 'string') {
        errorMessage = err
      }
      setError(errorMessage)
      console.error('AI Wizard generation failed', { error: errorMessage, rawError: String(err) })
    } finally {
      setGenerating(false)
    }
  }, [
    selectedFields,
    characterName,
    descriptionSource,
    uploadedImageId,
    selectedGalleryImageId,
    uploadedDocumentId,
    primaryProfileId,
    needsVisionProfile,
    visionProfileId,
    currentData,
    backgroundText,
    characterId,
  ])

  // Apply generated data — merge new scenarios with existing ones rather than replacing
  const applyGenerated = useCallback(() => {
    if (generatedData) {
      let dataToApply = generatedData
      const newScenarios = normalizeGeneratedScenarios(generatedData.scenarios)
      if (newScenarios.length > 0) {
        // Prepend existing scenarios (as title+content) so the caller receives the full merged list
        const existingAsNew = (currentData.scenarios ?? []).map((s) => ({
          title: s.title,
          content: s.content,
        }))
        dataToApply = {
          ...generatedData,
          scenarios: [...existingAsNew, ...newScenarios],
        }
      }
      onApply(dataToApply)
      onClose()
    }
  }, [generatedData, currentData.scenarios, onApply, onClose])

  // Reset wizard
  const reset = useCallback(() => {
    setCurrentStep(1)
    setDescriptionSource('existing')
    setUploadedImageId(null)
    setUploadedImageUrl(null)
    setSelectedGalleryImageId(null)
    setSelectedGalleryImageUrl(null)
    setUploadedDocumentId(null)
    setUploadedDocumentName(null)
    setVisionProfileId(null)
    setBackgroundText('')
    setSelectedFields(new Set())
    setGenerating(false)
    setGenerationProgress({
      currentField: null,
      completedFields: [],
      snippets: {},
      errors: {},
    })
    setGeneratedData(null)
    setError(null)
  }, [])

  return {
    // State
    currentStep,
    profiles,
    loadingProfiles,
    primaryProfileId,
    primaryProfile,
    descriptionSource,
    uploadedImageId,
    uploadedImageUrl,
    selectedGalleryImageId,
    selectedGalleryImageUrl,
    uploadedDocumentId,
    uploadedDocumentName,
    visionProfileId,
    visionProfiles,
    needsVisionProfile,
    primarySupportsVision,
    backgroundText,
    selectedFields,
    availableFields,
    generating,
    generationProgress,
    generatedData,
    error,
    canProceed,

    // Actions
    goToStep,
    nextStep,
    prevStep,
    setPrimaryProfileId,
    setDescriptionSource,
    handleImageUpload,
    handleGallerySelect,
    handleDocumentUpload,
    setVisionProfileId,
    setBackgroundText,
    toggleField,
    selectAllFields,
    clearAllFields,
    startGeneration,
    applyGenerated,
    reset,
  }
}
