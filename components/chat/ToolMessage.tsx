'use client'

import { useState } from 'react'
import { formatMessageTime } from '@/lib/format-time'
import { showErrorToast } from '@/lib/toast'
import DeletedImagePlaceholder from '@/components/images/DeletedImagePlaceholder'

interface ToolMessageProps {
  readonly message: {
    id: string
    content: string
    createdAt: string
    attachments?: Array<{
      id: string
      filename: string
      filepath: string
      mimeType: string
    }>
  }
  readonly character?: {
    id: string
    name: string
    title?: string | null
    avatarUrl?: string
    defaultImageId?: string
    defaultImage?: {
      id: string
      filepath: string
      url?: string
    } | null
  }
  readonly onImageClick?: (filepath: string, filename: string, fileId: string) => void
  readonly onAttachmentDeleted?: (attachmentId: string) => void
}

interface ToolResult {
  toolName: string
  success: boolean
  result: string
  arguments?: Record<string, unknown>
  provider?: string
  model?: string
}

export default function ToolMessage({ message, character, onImageClick, onAttachmentDeleted }: ToolMessageProps) {
  const [showSource, setShowSource] = useState(false)
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())

  let toolData: ToolResult = {
    toolName: 'unknown',
    success: false,
    result: 'Unable to parse tool result',
  }

  try {
    toolData = JSON.parse(message.content)
  } catch {
    // If parsing fails, use defaults
  }

  // Get image attachments
  const imageAttachments = (message.attachments || []).filter((a) =>
    a.mimeType.startsWith('image/')
  )

  // Map tool names to display names and icons
  const toolInfo: Record<string, { displayName: string; icon: string; bgColor: string }> = {
    generate_image: {
      displayName: 'Image Generation',
      icon: '🎨',
      bgColor: 'bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800',
    },
  }

  const info = toolInfo[toolData.toolName] || {
    displayName: toolData.toolName,
    icon: '⚙️',
    bgColor: 'bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700',
  }

  return (
    <div className={`flex gap-4 w-[90%] justify-start`}>
      {/* Tool icon avatar with tooltip */}
      <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 text-lg relative group cursor-help">

        {info.icon}
        {toolData.provider && toolData.model && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-50">
            <div className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs px-2 py-1 rounded whitespace-nowrap">
              {toolData.provider} {toolData.model}
            </div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-100"></div>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 group relative">
        <div className={`px-4 py-3 rounded-lg ${info.bgColor}`}>
          {/* Tool header */}
          <div className="flex items-center gap-2 mb-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {character && (
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                    {character.name} requested
                  </span>
                )}
                <span className="font-semibold text-sm text-gray-900 dark:text-white">
                  {info.displayName}
                </span>
              </div>
            </div>
            <span
              className={`inline-block px-2 py-0.5 text-xs font-medium rounded ml-auto ${
                toolData.success
                  ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                  : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
              }`}
            >
              {toolData.success ? 'Success' : 'Failed'}
            </span>
          </div>

          {/* Tool result */}
          <div className="text-sm text-gray-700 dark:text-gray-300">
            {toolData.result}
          </div>

          {/* View source button */}
          {toolData.arguments && Object.keys(toolData.arguments).length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowSource(!showSource)}
                className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors underline"
                type="button"
              >
                {showSource ? '▼ Hide' : '▶ View'} source
              </button>
              {showSource && (
                <div className="mt-2 bg-gray-900 dark:bg-gray-800 rounded p-3 overflow-x-auto">
                  <pre className="text-xs text-gray-100 font-mono whitespace-pre-wrap break-words">
                    {JSON.stringify(toolData.arguments, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Image attachments */}
          {imageAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {imageAttachments.map((attachment) => (
                <div key={attachment.id} className="relative group/thumb overflow-hidden rounded border border-purple-300 dark:border-purple-700 hover:border-purple-500 dark:hover:border-purple-400 transition-colors">
                  {missingImages.has(attachment.id) ? (
                    <div className="w-20 h-20 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                  ) : (
                    <button
                      onClick={() => onImageClick?.(attachment.filepath, attachment.filename, attachment.id)}
                      className="relative group/thumb overflow-hidden rounded cursor-pointer block"
                      type="button"
                    >
                      <div className="relative w-20 h-20 bg-gray-100 dark:bg-gray-800">
                        {missingImages.has(attachment.id) ? (
                          <DeletedImagePlaceholder
                            imageId={attachment.id}
                            filename={attachment.filename}
                            onCleanup={async () => {
                              try {
                                const response = await fetch(`/api/chat-files/${attachment.id}`, {
                                  method: 'DELETE',
                                })

                                if (!response.ok) {
                                  const data = await response.json()
                                  throw new Error(data.error || 'Failed to delete attachment')
                                }

                                // Remove from missing images set
                                setMissingImages((prev) => {
                                  const next = new Set(prev)
                                  next.delete(attachment.id)
                                  return next
                                })

                                // Notify parent component
                                onAttachmentDeleted?.(attachment.id)
                              } catch (error) {
                                showErrorToast(
                                  error instanceof Error ? error.message : 'Failed to delete attachment'
                                )
                              }
                            }}
                            className="w-full h-full absolute inset-0 !p-2"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/${attachment.filepath}`}
                            alt={attachment.filename}
                            className="w-full h-full object-cover"
                            onError={() => setMissingImages((prev) => new Set(prev).add(attachment.id))}
                          />
                        )}
                      </div>
                      <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/20 transition-colors flex items-center justify-center">
                        <svg className="w-6 h-6 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                        </svg>
                      </div>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Timestamp */}
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {formatMessageTime(message.createdAt)}
          </div>
        </div>
      </div>
    </div>
  )
}
