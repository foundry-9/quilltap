'use client'

/**
 * useDocumentStoreDetail Hook
 *
 * Manages a single document store's data, files, and operations.
 *
 * @module app/document-stores/[id]/hooks/useDocumentStoreDetail
 */

import { useCallback, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { DocumentStore, DocumentStoreFile, UpdateDocumentStoreData, ScanResult } from '../../types'

interface UseDocumentStoreDetailReturn {
  store: DocumentStore | null
  files: DocumentStoreFile[]
  loading: boolean
  filesLoading: boolean
  error: string | null
  scanning: boolean
  /** `silent` refreshes in place without flipping `loading` (tab re-activation). */
  fetchStore: (opts?: { silent?: boolean }) => Promise<void>
  fetchFiles: () => Promise<void>
  updateStore: (data: UpdateDocumentStoreData) => Promise<DocumentStore | null>
  scanStore: () => Promise<{ scanResult: ScanResult; embeddingJobsEnqueued: number } | null>
}

export function useDocumentStoreDetail(storeId: string): UseDocumentStoreDetailReturn {
  const [store, setStore] = useState<DocumentStore | null>(null)
  const [files, setFiles] = useState<DocumentStoreFile[]>([])
  const [loading, setLoading] = useState(true)
  const [filesLoading, setFilesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const fetchStore = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      // A silent refresh (workspace tab re-activation) keeps the page on
      // screen instead of flipping the whole view back to its loading state.
      if (!opts?.silent) setLoading(true)
      setError(null)

      const res = await fetch(`/api/v1/mount-points/${storeId}`)
      if (!res.ok) throw new Error('Failed to fetch document store')

      const data = await res.json()
      setStore(data.mountPoint)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      console.error('useDocumentStoreDetail: fetch error', { error: errorMsg })
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [storeId])

  const fetchFiles = useCallback(async () => {
    try {
      setFilesLoading(true)

      const res = await fetch(`/api/v1/mount-points/${storeId}/files`)
      if (!res.ok) throw new Error('Failed to fetch files')

      const data = await res.json()
      setFiles(data.files)
    } catch (err) {
      console.error('useDocumentStoreDetail: fetch files error', { error: err })
    } finally {
      setFilesLoading(false)
    }
  }, [storeId])

  const updateStore = useCallback(async (data: UpdateDocumentStoreData): Promise<DocumentStore | null> => {
    try {
      const res = await fetch(`/api/v1/mount-points/${storeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) throw new Error('Failed to update document store')

      const result = await res.json()
      setStore(result.mountPoint)
      showSuccessToast('Document store updated successfully!')
      return result.mountPoint
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update document store'
      showErrorToast(errorMsg)
      return null
    }
  }, [storeId])

  const scanStore = useCallback(async (): Promise<{ scanResult: ScanResult; embeddingJobsEnqueued: number } | null> => {
    try {
      setScanning(true)
      setStore(prev => prev ? { ...prev, scanStatus: 'scanning' as const } : prev)

      const res = await fetch(`/api/v1/mount-points/${storeId}?action=scan`, {
        method: 'POST',
      })

      if (!res.ok) throw new Error('Failed to scan document store')

      const result = await res.json()

      // Refresh store and files after scan
      const [storeRes, filesRes] = await Promise.all([
        fetch(`/api/v1/mount-points/${storeId}`),
        fetch(`/api/v1/mount-points/${storeId}/files`),
      ])

      if (storeRes.ok) {
        const storeData = await storeRes.json()
        setStore(storeData.mountPoint)
      }
      if (filesRes.ok) {
        const filesData = await filesRes.json()
        setFiles(filesData.files)
      }

      showSuccessToast(
        `Scan complete: ${result.scanResult.filesScanned} files scanned, ${result.embeddingJobsEnqueued} embedding jobs queued`
      )

      if (result.embeddingJobsEnqueued > 0) {
        notifyQueueChange()
      }

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to scan document store'
      showErrorToast(errorMsg)
      setStore(prev => prev ? { ...prev, scanStatus: 'error' as const } : prev)
      return null
    } finally {
      setScanning(false)
    }
  }, [storeId])

  return {
    store,
    files,
    loading,
    filesLoading,
    error,
    scanning,
    fetchStore,
    fetchFiles,
    updateStore,
    scanStore,
  }
}
