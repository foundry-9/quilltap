'use client'

import { useState, useRef, useCallback } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import type {
  RestoreStep,
  RestoreMode,
  RestoreState,
} from '../types'

export function useRestoreData(isOpen: boolean) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<RestoreState>({
    step: 'source',
    selectedFile: null,
    preview: null,
    loadingPreview: false,
    restoreMode: 'import',
    confirmReplace: false,
    keepArchiveBundles: true,
    restoring: false,
    restoreSummary: null,
    error: null,
    uploadId: null,
    uploadProgress: 0,
    uploading: false,
  })

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setState((prev) => ({
      ...prev,
      selectedFile: e.target.files?.[0] || null,
      error: null,
      // Reset upload state when a new file is selected
      uploadId: null,
      uploadProgress: 0,
    }))
  }, [])

  /**
   * Upload the file as raw binary via XMLHttpRequest (for progress events),
   * then fetch the preview using the returned uploadId.
   */
  const uploadAndPreview = useCallback(async () => {
    if (!state.selectedFile) return

    setState((prev) => ({ ...prev, uploading: true, uploadProgress: 0, error: null }))

    try {
      // Phase 1: Upload via XHR for progress tracking
      const uploadId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/v1/system/restore?action=upload')
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100)
            setState((prev) => ({ ...prev, uploadProgress: progress }))
          }
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText)
              if (data.success && data.uploadId) {
                resolve(data.uploadId)
              } else {
                reject(new Error(data.error || 'Upload failed'))
              }
            } catch {
              reject(new Error('Invalid response from server'))
            }
          } else {
            try {
              const data = JSON.parse(xhr.responseText)
              reject(new Error(data.error || `Upload failed (${xhr.status})`))
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`))
            }
          }
        }

        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.onabort = () => reject(new Error('Upload cancelled'))

        xhr.send(state.selectedFile)
      })

      setState((prev) => ({ ...prev, uploading: false, uploadId, loadingPreview: true }))

      // Phase 2: Fetch preview using uploadId
      const previewResponse = await fetch('/api/v1/system/restore?action=preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      })

      if (!previewResponse.ok) {
        const data = await previewResponse.json()
        throw new Error(data.error || 'Failed to preview backup')
      }

      const previewData = await previewResponse.json()
      setState((prev) => ({
        ...prev,
        preview: previewData.preview,
        step: 'preview',
        uploadId,
      }))
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to upload backup')
      setState((prev) => ({ ...prev, error: errorMessage, uploading: false }))
      console.error('Failed to upload/preview backup', { error: errorMessage })
      showErrorToast(errorMessage)
    } finally {
      setState((prev) => ({ ...prev, loadingPreview: false }))
    }
  }, [state.selectedFile])

  const handleNext = useCallback(async () => {
    if (state.step === 'source') {
      if (!state.selectedFile) {
        setState((prev) => ({
          ...prev,
          error: 'Please select a backup file',
        }))
        return
      }
      await uploadAndPreview()
    } else if (state.step === 'preview') {
      setState((prev) => ({ ...prev, step: 'mode' }))
    }
  }, [state.step, state.selectedFile, uploadAndPreview])

  const handleBack = useCallback(() => {
    if (state.step === 'preview') {
      setState((prev) => ({
        ...prev,
        step: 'source',
        preview: null,
      }))
    } else if (state.step === 'mode') {
      setState((prev) => ({ ...prev, step: 'preview' }))
    } else if (state.step === 'progress') {
      setState((prev) => ({
        ...prev,
        step: 'mode',
        restoreSummary: null,
      }))
    }
  }, [state.step])

  const handleStartRestore = useCallback(
    async () => {
      if (!state.uploadId) return

      if (state.restoreMode === 'replace' && !state.confirmReplace) {
        setState((prev) => ({
          ...prev,
          error: 'Please confirm that you want to delete your existing data',
        }))
        return
      }

      setState((prev) => ({
        ...prev,
        restoring: true,
        error: null,
        step: 'progress',
      }))

      try {
        const response = await fetch('/api/v1/system/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId: state.uploadId,
            mode: state.restoreMode === 'replace' ? 'replace' : 'new-account',
            keepArchivedCharacterBundles: state.keepArchiveBundles,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to restore backup')
        }

        const data = await response.json()
        setState((prev) => ({
          ...prev,
          restoreSummary: data.summary,
        }))

        showSuccessToast('Backup restored successfully')
      } catch (err) {
        const errorMessage = getErrorMessage(err, 'Failed to restore backup')
        setState((prev) => ({
          ...prev,
          error: errorMessage,
          step: 'mode',
        }))
        console.error('Restore failed', { error: errorMessage })
        showErrorToast(errorMessage)
      } finally {
        setState((prev) => ({ ...prev, restoring: false }))
      }
    },
    [state.restoreMode, state.confirmReplace, state.keepArchiveBundles, state.uploadId]
  )

  const resetDialog = useCallback(() => {
    setState({
      step: 'source',
      selectedFile: null,
      preview: null,
      loadingPreview: false,
      restoreMode: 'import',
      confirmReplace: false,
      keepArchiveBundles: true,
      restoring: false,
      restoreSummary: null,
      error: null,
      uploadId: null,
      uploadProgress: 0,
      uploading: false,
    })
  }, [])

  return {
    state,
    fileInputRef,
    actions: {
      handleFileSelect,
      handleNext,
      handleBack,
      fetchPreview: uploadAndPreview,
      handleStartRestore,
      resetDialog,
      setStep: (step: RestoreStep) => setState((prev) => ({ ...prev, step })),
      setRestoreMode: (mode: RestoreMode) =>
        setState((prev) => ({ ...prev, restoreMode: mode, confirmReplace: false })),
      setConfirmReplace: (confirm: boolean) =>
        setState((prev) => ({ ...prev, confirmReplace: confirm })),
      setKeepArchiveBundles: (keep: boolean) =>
        setState((prev) => ({ ...prev, keepArchiveBundles: keep })),
    },
  }
}
