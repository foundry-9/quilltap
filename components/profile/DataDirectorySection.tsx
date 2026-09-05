'use client'

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { Icon } from '@/components/ui/icon'

/**
 * Data directory info from the API
 */
interface DataDirInfo {
  path: string
  source: 'environment' | 'platform-default'
  sourceDescription: string
  platform: 'docker' | 'linux' | 'darwin' | 'win32'
  isDocker: boolean
  canOpen: boolean
}

/**
 * Platform display names
 */
const platformNames: Record<string, string> = {
  docker: 'Docker',
  linux: 'Linux',
  darwin: 'macOS',
  win32: 'Windows',
}

/**
 * DataDirectorySection Component
 *
 * Displays data directory information and provides a button to open it
 * in the system file browser (on non-Docker environments).
 */
export function DataDirectorySection() {
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: queryKeys.system.dataDir,
    queryFn: ({ signal }) => apiFetch<DataDirInfo>('/api/v1/system/data-dir', { signal }),
  })
  const dirInfo = data || null
  const [opening, setOpening] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(loadError ? (loadError instanceof Error ? loadError.message : 'Failed to load data directory info') : null)

  const handleOpenFolder = async () => {
    if (!dirInfo?.canOpen) return

    setOpening(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/system/data-dir?action=open', {
        method: 'POST',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to open folder')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open folder'
      setError(message)
      console.error('Failed to open data directory', { error: message })
    } finally {
      setOpening(false)
    }
  }

  const handleCopyPath = async () => {
    if (!dirInfo?.path) return

    try {
      await navigator.clipboard.writeText(dirInfo.path)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard', { error: err })
    }
  }

  if (isLoading) {
    return (
      <div className="qt-card">
        <div className="qt-card-header">
          <h2 className="text-xl font-semibold">Data Directory</h2>
        </div>
        <div className="qt-card-content">
          <div className="qt-text-muted text-sm">Loading...</div>
        </div>
      </div>
    )
  }

  if (!dirInfo) {
    return (
      <div className="qt-card">
        <div className="qt-card-header">
          <h2 className="text-xl font-semibold">Data Directory</h2>
        </div>
        <div className="qt-card-content">
          <div className="qt-text-destructive text-sm">
            {error || 'Unable to load data directory information'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="qt-card">
      <div className="qt-card-header">
        <h2 className="text-xl font-semibold">Data Directory</h2>
        <p className="qt-text-muted text-sm mt-1">
          Where Quilltap stores your data, files, and logs
        </p>
      </div>
      <div className="qt-card-content space-y-4">
        {/* Path display */}
        <div>
          <div className="qt-text-label text-sm mb-1">Location</div>
          <div className="flex items-center gap-2">
            <code className="qt-text-primary font-mono text-sm qt-bg-muted/50 px-2 py-1 rounded flex-1 overflow-x-auto">
              {dirInfo.path}
            </code>
            <button
              onClick={handleCopyPath}
              className={`qt-copy-button qt-copy-button-icon shrink-0 ${copied ? 'qt-copy-button-success' : ''}`}
              title="Copy path to clipboard"
              aria-label="Copy path"
            >
              {copied ? (
                <Icon name="check" className="w-4 h-4" />
              ) : (
                <Icon name="copy" className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Source info */}
        <div>
          <div className="qt-text-label text-sm mb-1">Configuration</div>
          <div className="qt-text-secondary text-sm">
            {dirInfo.sourceDescription}
          </div>
        </div>

        {/* Platform info */}
        <div>
          <div className="qt-text-label text-sm mb-1">Platform</div>
          <div className="qt-text-secondary text-sm">
            {platformNames[dirInfo.platform] || dirInfo.platform}
          </div>
        </div>

        {/* Action buttons and messages */}
        {error && (
          <div className="qt-text-destructive text-sm">{error}</div>
        )}

        {dirInfo.canOpen ? (
          <button
            onClick={handleOpenFolder}
            disabled={opening}
            className="qt-button qt-button-secondary inline-flex items-center gap-2"
          >
            <Icon name="folder" className="w-4 h-4" />
            {opening ? 'Opening...' : 'Open in File Browser'}
          </button>
        ) : (
          <div className="qt-text-muted text-sm qt-bg-muted/30 p-3 rounded">
            <div className="flex items-start gap-2">
              <Icon name="external-link" className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Docker Environment</p>
                <p className="mt-1">
                  The data directory is mounted from your host system. Access it through your
                  host&apos;s file browser at the path you mounted with{' '}
                  <code className="text-xs qt-bg-muted px-1 rounded">docker run -v /path:/app/quilltap</code>.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
