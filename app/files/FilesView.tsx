'use client'

/**
 * Files Page
 *
 * Browse and manage general (non-project) files.
 * Uses the FileBrowser component for navigation.
 */

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import FileBrowser from '@/components/files/FileBrowser'
import { useSubsystemBackgroundStyle } from '@/components/providers/theme-provider'

function FilesPageContent() {
  const searchParams = useSearchParams()
  const selectedFileId = searchParams.get('fileId')
  const bgStyle = useSubsystemBackgroundStyle('commonplace-book')

  return (
    <div className="qt-page-container text-foreground" style={bgStyle}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b qt-border-default/60 pb-6">
        <div>
          <h1 className="qt-heading-1 leading-tight">Files</h1>
          <p className="qt-text-small qt-text-secondary mt-1">
            Browse and manage your general files (not in any project)
          </p>
        </div>
      </div>

      <div className="mt-6">
        <FileBrowser
          projectId={null}
          title="General Files"
          className="min-h-[400px]"
        />
      </div>

      <div className="mt-8 p-4 border qt-border-default rounded-lg qt-bg-muted/50">
        <h3 className="font-medium mb-2">About General Files</h3>
        <ul className="qt-text-small qt-text-secondary space-y-1 list-disc list-inside">
          <li>General files are not associated with any project</li>
          <li>The LLM can access these files during conversations using the file management tool</li>
          <li>Files in projects are accessible only within that project&apos;s chats</li>
          <li>You can promote message attachments to general files for persistent storage</li>
        </ul>
      </div>
    </div>
  )
}

export function FilesView() {
  const bgStyle = useSubsystemBackgroundStyle('commonplace-book')
  return (
    <Suspense fallback={
      <div className="qt-page-container text-foreground" style={bgStyle}>
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-lg text-foreground">Loading files...</p>
        </div>
      </div>
    }>
      <FilesPageContent />
    </Suspense>
  )
}
