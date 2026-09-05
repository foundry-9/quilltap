'use client'

/**
 * useDocumentStores Hook
 *
 * Manages document stores data and CRUD operations.
 *
 * @module app/document-stores/hooks/useDocumentStores
 */

import { useCallback, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type {
  DocumentStore,
  CreateDocumentStoreData,
  UpdateDocumentStoreData,
  ScanResult,
  ConvertResult,
  DeconvertResult,
  UseDocumentStoresReturn,
} from '../types'

export function useDocumentStores(): UseDocumentStoresReturn {
  const [stores, setStores] = useState<DocumentStore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStores = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      // A silent refresh (workspace tab re-activation) keeps the current list
      // on screen instead of flipping the whole view back to its loading state.
      if (!opts?.silent) setLoading(true)
      setError(null)

      const res = await fetch('/api/v1/mount-points')
      if (!res.ok) throw new Error('Failed to fetch document stores')

      const data = await res.json()
      setStores(data.mountPoints)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      console.error('useDocumentStores: fetch error', { error: errorMsg })
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [])

  const createStore = useCallback(async (data: CreateDocumentStoreData): Promise<DocumentStore | null> => {
    try {
      const res = await fetch('/api/v1/mount-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) throw new Error('Failed to create document store')

      const result = await res.json()
      setStores(prev => [result.mountPoint, ...prev])

      if (result.warning) {
        showErrorToast(result.warning)
      } else {
        showSuccessToast('Document store created successfully!')
      }

      return result.mountPoint
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create document store'
      console.error('useDocumentStores: create error', { error: errorMsg })
      showErrorToast(errorMsg)
      return null
    }
  }, [])

  const updateStore = useCallback(async (id: string, data: UpdateDocumentStoreData): Promise<DocumentStore | null> => {
    try {
      const res = await fetch(`/api/v1/mount-points/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) throw new Error('Failed to update document store')

      const result = await res.json()
      setStores(prev => prev.map(s => s.id === id ? result.mountPoint : s))
      showSuccessToast('Document store updated successfully!')

      return result.mountPoint
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update document store'
      console.error('useDocumentStores: update error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)
      return null
    }
  }, [])

  const deleteStore = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/mount-points/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete document store')

      setStores(prev => prev.filter(s => s.id !== id))
      showSuccessToast('Document store deleted successfully!')

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete document store'
      console.error('useDocumentStores: delete error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)
      return false
    }
  }, [])

  const scanStore = useCallback(async (id: string): Promise<{ scanResult: ScanResult; embeddingJobsEnqueued: number } | null> => {
    try {
      // Optimistically update scan status
      setStores(prev => prev.map(s => s.id === id ? { ...s, scanStatus: 'scanning' as const } : s))

      const res = await fetch(`/api/v1/mount-points/${id}?action=scan`, {
        method: 'POST',
      })

      if (!res.ok) throw new Error('Failed to scan document store')

      const result = await res.json()

      // Refresh the store data after scan to get updated counts
      const storeRes = await fetch(`/api/v1/mount-points/${id}`)
      if (storeRes.ok) {
        const storeData = await storeRes.json()
        setStores(prev => prev.map(s => s.id === id ? storeData.mountPoint : s))
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
      console.error('useDocumentStores: scan error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)

      // Reset scan status on error
      setStores(prev => prev.map(s => s.id === id ? { ...s, scanStatus: 'error' as const } : s))

      return null
    }
  }, [])

  const convertStore = useCallback(async (id: string): Promise<ConvertResult | null> => {
    try {
      // Optimistically mark the store as converting so the card disables
      // its other action buttons while the request is in flight.
      setStores(prev => prev.map(s => s.id === id
        ? { ...s, conversionStatus: 'converting' as const, conversionError: null }
        : s
      ))

      const res = await fetch(`/api/v1/mount-points/${id}?action=convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || errBody.message || 'Failed to convert document store')
      }

      const result = await res.json()

      const storeRes = await fetch(`/api/v1/mount-points/${id}`)
      if (storeRes.ok) {
        const storeData = await storeRes.json()
        setStores(prev => prev.map(s => s.id === id ? storeData.mountPoint : s))
      }

      const cr = result.convertResult as ConvertResult
      const previousBasePath = result.previousBasePath as string | undefined
      const partsA = [
        `${cr.filesMigrated} file${cr.filesMigrated === 1 ? '' : 's'} migrated`,
      ]
      if (cr.blobsWritten > 0) partsA.push(`${cr.blobsWritten} binary blob${cr.blobsWritten === 1 ? '' : 's'}`)
      if (cr.filesSkipped > 0) partsA.push(`${cr.filesSkipped} skipped`)
      if (cr.errors.length > 0) partsA.push(`${cr.errors.length} error${cr.errors.length === 1 ? '' : 's'}`)
      const suffix = previousBasePath
        ? `. Your original files at ${previousBasePath} remain on disk and are yours to keep or delete.`
        : '. Your original files remain on disk.'
      showSuccessToast(`Converted to database: ${partsA.join(', ')}${suffix}`)

      return cr
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to convert document store'
      console.error('useDocumentStores: convert error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)
      setStores(prev => prev.map(s => s.id === id
        ? { ...s, conversionStatus: 'error' as const, conversionError: errorMsg }
        : s
      ))
      return null
    }
  }, [])

  const deconvertStore = useCallback(async (id: string, targetPath: string): Promise<DeconvertResult | null> => {
    try {
      setStores(prev => prev.map(s => s.id === id
        ? { ...s, conversionStatus: 'deconverting' as const, conversionError: null }
        : s
      ))

      const res = await fetch(`/api/v1/mount-points/${id}?action=deconvert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || errBody.message || 'Failed to deconvert document store')
      }

      const result = await res.json()

      const storeRes = await fetch(`/api/v1/mount-points/${id}`)
      if (storeRes.ok) {
        const storeData = await storeRes.json()
        setStores(prev => prev.map(s => s.id === id ? storeData.mountPoint : s))
      }

      const dr = result.deconvertResult as DeconvertResult
      const parts = [`${dr.filesWritten} document${dr.filesWritten === 1 ? '' : 's'}`]
      if (dr.blobsWritten > 0) parts.push(`${dr.blobsWritten} blob${dr.blobsWritten === 1 ? '' : 's'}`)
      if (dr.errors.length > 0) parts.push(`${dr.errors.length} error${dr.errors.length === 1 ? '' : 's'}`)
      showSuccessToast(`Deconverted to filesystem: ${parts.join(', ')} written to ${targetPath}`)

      return dr
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to deconvert document store'
      console.error('useDocumentStores: deconvert error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)
      setStores(prev => prev.map(s => s.id === id
        ? { ...s, conversionStatus: 'error' as const, conversionError: errorMsg }
        : s
      ))
      return null
    }
  }, [])

  return {
    stores,
    loading,
    error,
    fetchStores,
    createStore,
    updateStore,
    deleteStore,
    scanStore,
    convertStore,
    deconvertStore,
  }
}
