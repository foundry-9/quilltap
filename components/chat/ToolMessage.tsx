'use client'

import { useState, useCallback, useMemo } from 'react'
import { formatMessageTime } from '@/lib/format-time'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import DeletedImagePlaceholder from '@/components/images/DeletedImagePlaceholder'
import { copyImageToClipboard } from '@/lib/clipboard-utils'
import { getAvatarSrc } from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/icon'

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
    /** Whisper targets — present on user-initiated runs flagged Private. */
    targetParticipantIds?: string[] | null
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
  /** Author for the standalone bubble. Either Prospero (for user-initiated
   *  runs, where the operator name lives in `toolData.operatorName`) or the
   *  calling character. Resolved upstream by `getMessageAvatar`. When omitted
   *  the avatar slot falls back to the tool's emoji. */
  readonly headerAvatar?: {
    name: string
    avatarUrl?: string | null
    defaultImage?: { id: string; filepath: string; url?: string } | null
  } | null
  /** When true, render as a block nested inside a character's message bubble:
   *  no standalone row/avatar column, a compact tool-name header, wrapped in
   *  `qt-chat-tool-embedded`. Used by MessageRow for character-initiated tool
   *  calls so they read as separate paragraphs under the character's prose. */
  readonly embedded?: boolean
}

interface ToolResult {
  tool?: string
  toolName?: string
  initiatedBy?: 'user' | 'character'
  /** Display name for the operator on user-initiated runs (e.g., "Charles"). */
  operatorName?: string
  /** Whether this run was launched as a private whisper from Prospero. */
  private?: boolean
  /** When true, another message is the run's single visible artifact (e.g. the
   *  Pascal bubble for `run_custom`) and this TOOL row renders nothing. The
   *  message still persists for tool-call threading. */
  delegatedDisplay?: boolean
  success?: boolean
  /** Result can be a string or object (for backwards compatibility with older RNG results) */
  result?: string | Record<string, unknown>
  arguments?: Record<string, unknown>
  provider?: string
  model?: string
  prompt?: string
  images?: Array<{ id: string; filename: string }>
}

/** Wardrobe tool names that should show an action notice */
const WARDROBE_ACTION_TOOLS = new Set([
  'wardrobe_wear',
  'wardrobe_take_off',
  'wardrobe_create',
  'wardrobe_update',
  'wardrobe_archive',
])

/**
 * Build a human-readable wardrobe action summary from tool result data.
 * Returns null if the tool is not a wardrobe action tool or wasn't successful.
 */
function buildWardrobeActionSummary(toolData: ToolResult): { label: string; lines: string[] } | null {
  if (!toolData.success || !toolData.toolName || !WARDROBE_ACTION_TOOLS.has(toolData.toolName)) {
    return null
  }

  const result = toolData.result as Record<string, unknown> | undefined
  if (!result || typeof result !== 'object') return null

  const lines: string[] = []

  if (toolData.toolName === 'wardrobe_wear' || toolData.toolName === 'wardrobe_take_off') {
    const operations = (result.operations as Array<{ effect_summary?: string; error?: string }> | undefined) ?? []
    const coverageSummary = result.coverage_summary as string | undefined

    for (const op of operations) {
      if (op.effect_summary) lines.push(op.effect_summary)
    }
    if (coverageSummary) lines.push(coverageSummary)

    return lines.length > 0 ? { label: 'Wardrobe', lines } : null
  }

  if (toolData.toolName === 'wardrobe_create') {
    const title = result.title as string | undefined
    const equipped = result.equipped as boolean | undefined
    const recipientName = result.recipient_name as string | undefined

    if (recipientName) {
      lines.push(`Gifted "${title}" to ${recipientName}.`)
      if (equipped) {
        lines.push(`${recipientName} put it on immediately.`)
      }
    } else if (title) {
      if (equipped) {
        lines.push(`Created and equipped "${title}".`)
      } else {
        lines.push(`Created "${title}" and added it to the wardrobe.`)
      }
    }

    return lines.length > 0 ? { label: 'Wardrobe', lines } : null
  }

  if (toolData.toolName === 'wardrobe_update') {
    const title = result.title as string | undefined
    if (title) lines.push(`Updated "${title}".`)
    return lines.length > 0 ? { label: 'Wardrobe', lines } : null
  }

  if (toolData.toolName === 'wardrobe_archive') {
    const title = result.title as string | undefined
    if (title) lines.push(`Archived "${title}" (a human can restore it).`)
    return lines.length > 0 ? { label: 'Wardrobe', lines } : null
  }

  return null
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Copy image to clipboard from URL (wrapper for local use with boolean return)
 */
async function copyImageToClipboardLocal(imageUrl: string): Promise<boolean> {
  try {
    return await copyImageToClipboard(imageUrl)
  } catch {
    return false
  }
}

/**
 * Get preview text from content (first line, truncated)
 */
function getPreviewText(content: string, maxLength: number = 80): string {
  const firstLine = content.split('\n')[0] || ''
  if (firstLine.length <= maxLength) return firstLine
  return firstLine.slice(0, maxLength) + '...'
}

/**
 * Format tool arguments/prompt for display
 */
function formatRequestContent(toolData: ToolResult): string {
  if (toolData.prompt) {
    return toolData.prompt
  }
  return JSON.stringify(toolData.arguments || {}, null, 2)
}

/**
 * Format tool result for display
 */
function formatResultContent(toolData: ToolResult): string {
  if (!toolData.result) return ''

  // Handle result as string or object (backwards compatibility)
  const resultString = typeof toolData.result === 'object'
    ? (toolData.result as Record<string, unknown>).formattedText as string
      || JSON.stringify(toolData.result, null, 2)
    : toolData.result

  // Try to pretty-print as JSON
  try {
    const parsed = JSON.parse(resultString)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return resultString
  }
}

export default function ToolMessage({ message, character, onImageClick, onAttachmentDeleted, headerAvatar, embedded = false }: ToolMessageProps) {
  const [showRequest, setShowRequest] = useState(false)
  const [showResponse, setShowResponse] = useState(false)
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())

  const toolData: ToolResult = useMemo(() => {
    try {
      const parsed = JSON.parse(message.content)
      // Handle both old format (toolName) and new format (tool)
      return {
        ...parsed,
        toolName: parsed.toolName || parsed.tool || 'unknown',
      }
    } catch {
      // If parsing fails, use defaults
      return {
        toolName: 'unknown',
        success: false,
        result: 'Unable to parse tool result',
      }
    }
  }, [message.content])

  // Build wardrobe action summary (if applicable)
  const wardrobeSummary = useMemo(() => buildWardrobeActionSummary(toolData), [toolData])

  // Get image attachments
  const imageAttachments = (message.attachments || []).filter((a) =>
    a.mimeType.startsWith('image/')
  )

  // Map tool names to display names and icons
  const toolInfo: Record<string, { displayName: string; icon: string; bgColor: string }> = {
    generate_image: {
      displayName: 'Image Generation',
      icon: '🎨',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    search: {
      displayName: 'Search',
      icon: '🧠',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    search_web: {
      displayName: 'Web Search',
      icon: '🔍',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    project_info: {
      displayName: 'Project Info',
      icon: '📋',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    rng: {
      displayName: 'Random Number Generator',
      icon: '🎲',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    state: {
      displayName: 'State Manager',
      icon: '🗃️',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    help_search: {
      displayName: 'Help Search',
      icon: '📖',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    help_settings: {
      displayName: 'Settings Reader',
      icon: '⚙️',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    help_navigate: {
      displayName: 'Navigation',
      icon: '🧭',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    wardrobe_list: {
      displayName: 'Wardrobe',
      icon: '👗',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    wardrobe_read: {
      displayName: 'Wardrobe Item',
      icon: '👗',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    wardrobe_wear: {
      displayName: 'Put On',
      icon: '👗',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    wardrobe_take_off: {
      displayName: 'Take Off',
      icon: '👗',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    wardrobe_create: {
      displayName: 'New Wardrobe Item',
      icon: '🧵',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    wardrobe_update: {
      displayName: 'Edit Wardrobe Item',
      icon: '🧵',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
    wardrobe_archive: {
      displayName: 'Archive Wardrobe Item',
      icon: '🧵',
      bgColor: 'qt-bg-muted border qt-border-default',
    },
  }

  const info = toolInfo[toolData.toolName!] || {
    displayName: toolData.toolName,
    icon: '⚙️',
    bgColor: 'qt-bg-muted border qt-border-default',
  }

  // Copy handlers
  const handleCopyRequest = useCallback(async () => {
    const content = formatRequestContent(toolData)
    const success = await copyToClipboard(content)
    if (success) {
      showSuccessToast('Request copied to clipboard')
    } else {
      showErrorToast('Failed to copy to clipboard')
    }
  }, [toolData])

  const handleCopyResponse = useCallback(async () => {
    const content = formatResultContent(toolData)
    const success = await copyToClipboard(content)
    if (success) {
      showSuccessToast('Response copied to clipboard')
    } else {
      showErrorToast('Failed to copy to clipboard')
    }
  }, [toolData])

  const handleCopyImage = useCallback(async (filepath: string) => {
    const imageUrl = filepath.startsWith('/') ? filepath : `/${filepath}`
    const success = await copyImageToClipboardLocal(imageUrl)
    if (success) {
      showSuccessToast('Image copied to clipboard')
    } else {
      showErrorToast('Failed to copy image')
    }
  }, [])

  // Display is delegated to another message (the Pascal bubble for run_custom):
  // this TOOL row exists only for tool-call threading, so it renders nothing.
  // Placed below every hook — an early return above them would break the rules
  // of hooks for the messages that DO render.
  if (toolData.delegatedDisplay) return null

  // Get preview text for collapsed sections
  const requestPreview = getPreviewText(formatRequestContent(toolData))
  const responsePreview = getPreviewText(formatResultContent(toolData))

  const isWhisper = !!(message.targetParticipantIds && message.targetParticipantIds.length > 0)
  const headerAvatarSrc = headerAvatar ? getAvatarSrc(headerAvatar) : null
  const isUserInitiated = toolData.initiatedBy === 'user'
  const actorName = isUserInitiated
    ? (toolData.operatorName || 'You')
    : (headerAvatar?.name || character?.name || null)

  // Standalone layout uses a full-width row + author avatar. Embedded layout
  // (nested in a character's bubble) drops the row/avatar and renders the card
  // directly, wrapped in qt-chat-tool-embedded.
  return (
    <div className={embedded ? 'qt-chat-tool-embedded' : 'qt-chat-message-row-tool'}>
      {/* Avatar slot — author portrait (Prospero or calling character) when
          known, otherwise the tool's emoji on a muted circle. Omitted when
          embedded, since the character's own avatar already heads the bubble. */}
      {!embedded && (headerAvatarSrc ? (
        <div className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden border qt-border-default">
          <img
            src={headerAvatarSrc}
            alt={headerAvatar?.name || ''}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full qt-bg-muted text-lg relative group cursor-help">
          {info.icon}
          {toolData.provider && toolData.model && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-50">
              <div className="bg-foreground text-background text-xs px-2 py-1 rounded whitespace-nowrap">
                {toolData.provider} {toolData.model}
              </div>
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground"></div>
            </div>
          )}
        </div>
      ))}

      <div className={embedded ? 'min-w-0 group relative' : 'flex-1 min-w-0 group relative'}>
        {/* Wardrobe action notice — prominent summary above tool details */}
        {wardrobeSummary && (
          <div className="qt-chat-wardrobe-notice mb-2">
            <div className="qt-chat-wardrobe-label">{wardrobeSummary.label}</div>
            <div className="qt-chat-wardrobe-summary">
              {wardrobeSummary.lines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        )}
        <div className={`px-4 py-3 rounded-lg ${info.bgColor}`}>
          {/* Tool header */}
          <div className="flex items-center gap-2 mb-2">
            <div className="flex flex-col gap-1">
              {headerAvatar ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">
                      {headerAvatar.name}
                    </span>
                    {isWhisper && (
                      <span className="qt-text-label-xs italic qt-text-secondary">
                        whisper
                      </span>
                    )}
                  </div>
                  <div className="qt-text-label-xs">
                    {actorName && actorName !== headerAvatar.name
                      ? `${actorName} ran `
                      : 'ran '}
                    <span className="font-mono">{toolData.toolName}</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  {embedded ? (
                    // Inside the character's bubble: lead with the tool emoji,
                    // skip the redundant "<character> ran" attribution.
                    <span className="text-base leading-none" aria-hidden>{info.icon}</span>
                  ) : (
                    actorName && (
                      <span className="qt-text-label-xs">
                        {actorName} ran
                      </span>
                    )
                  )}
                  <span className="font-semibold text-sm text-foreground">
                    {info.displayName}
                  </span>
                </div>
              )}
            </div>
            <span
              className={`inline-block px-2 py-0.5 qt-text-label-xs rounded ml-auto ${
                toolData.success
                  ? 'qt-badge-success'
                  : 'qt-badge-destructive'
              }`}
            >
              {toolData.success ? 'Success' : 'Failed'}
            </span>
          </div>

          {/* Tool Request collapsible - shows arguments/prompt sent to the tool */}
          {(toolData.arguments || toolData.prompt) && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowRequest(!showRequest)}
                  className="qt-text-label-xs hover:text-foreground transition-colors flex items-center gap-1"
                  type="button"
                >
                  <span className="w-3 inline-block">{showRequest ? '▼' : '▶'}</span>
                  <span>Tool Request</span>
                </button>
                {!showRequest && (
                  <span className="qt-text-xs qt-text-secondary truncate flex-1">
                    {requestPreview}
                  </span>
                )}
                <button
                  onClick={handleCopyRequest}
                  className="p-1 qt-text-secondary hover:text-foreground transition-colors"
                  title="Copy request"
                  type="button"
                >
                  <Icon name="copy" className="w-4 h-4" />
                </button>
              </div>
              {showRequest && (
                <div className="mt-2 bg-background rounded p-3 border qt-border-default">
                  <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-words">
                    {formatRequestContent(toolData)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Tool Response collapsible - shows the result with pretty-printed JSON */}
          {/* For image generation, also include the image attachments inside this collapsible */}
          {(toolData.result || (toolData.toolName === 'generate_image' && imageAttachments.length > 0)) && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowResponse(!showResponse)}
                  className="qt-text-label-xs hover:text-foreground transition-colors flex items-center gap-1"
                  type="button"
                >
                  <span className="w-3 inline-block">{showResponse ? '▼' : '▶'}</span>
                  <span>Tool Response</span>
                </button>
                {!showResponse && toolData.result && (
                  <span className="qt-text-xs qt-text-secondary truncate flex-1">
                    {responsePreview}
                  </span>
                )}
                {!showResponse && toolData.toolName === 'generate_image' && imageAttachments.length > 0 && !toolData.result && (
                  <span className="qt-text-xs qt-text-secondary">
                    {imageAttachments.length} image{imageAttachments.length > 1 ? 's' : ''}
                  </span>
                )}
                {toolData.result && (
                  <button
                    onClick={handleCopyResponse}
                    className="p-1 qt-text-secondary hover:text-foreground transition-colors"
                    title="Copy response"
                    type="button"
                  >
                    <Icon name="copy" className="w-4 h-4" />
                  </button>
                )}
              </div>
              {showResponse && (
                <div className="mt-2 bg-background rounded p-3 border qt-border-default tool-response-content">
                  {/* For image generation, show image thumbnails */}
                  {toolData.toolName === 'generate_image' && imageAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {imageAttachments.map((attachment) => (
                        <div key={attachment.id} className="relative group/thumb overflow-hidden rounded border qt-border-default hover:qt-border-primary/50 transition-colors">
                          {missingImages.has(attachment.id) ? (
                            <div className="w-20 h-20 flex items-center justify-center qt-bg-muted">
                              <Icon name="image" className="w-8 h-8 qt-text-secondary" />
                            </div>
                          ) : (
                            <div className="relative">
                              <button
                                onClick={() => {
                                  const normalizedPath = attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`
                                  onImageClick?.(normalizedPath, attachment.filename, attachment.id)
                                }}
                                className="relative group/thumb overflow-hidden rounded cursor-pointer block"
                                type="button"
                              >
                                <div className="relative w-20 h-20 qt-bg-muted">
                                  <img
                                    src={attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`}
                                    alt={attachment.filename}
                                    className="w-full h-full object-cover"
                                    onError={() => setMissingImages((prev) => new Set(prev).add(attachment.id))}
                                  />
                                </div>
                                <div className="absolute inset-0 qt-bg-overlay-none group-hover/thumb:qt-bg-overlay-light transition-colors flex items-center justify-center">
                                  <Icon name="zoom-in" className="w-6 h-6 qt-text-overlay opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow-lg" />
                                </div>
                              </button>
                              <button
                                onClick={() => handleCopyImage(attachment.filepath)}
                                className="absolute -top-1 -right-1 p-1 bg-background border qt-border-default rounded qt-shadow-sm opacity-0 group-hover/thumb:opacity-100 transition-opacity z-10"
                                title="Copy image"
                                type="button"
                              >
                                <Icon name="copy" className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Show JSON/text result if present */}
                  {toolData.result && (
                    <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-words">
                      {formatResultContent(toolData)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Image attachments for non-image-generation tools */}
          {toolData.toolName !== 'generate_image' && imageAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {imageAttachments.map((attachment) => {
                const handleDeletedAttachmentCleanup = async () => {
                  try {
                    const response = await fetch(`/api/v1/chat-files/${attachment.id}`, {
                      method: 'DELETE',
                    })

                    if (!response.ok) {
                      const data = await response.json()
                      throw new Error(data.error || 'Failed to delete attachment')
                    }

                    setMissingImages((prev) => {
                      const next = new Set(prev)
                      next.delete(attachment.id)
                      return next
                    })

                    onAttachmentDeleted?.(attachment.id)
                  } catch (error) {
                    showErrorToast(
                      error instanceof Error ? error.message : 'Failed to delete attachment'
                    )
                  }
                }

                return (
                  <div key={attachment.id} className="relative group/thumb overflow-hidden rounded border qt-border-default hover:qt-border-primary/50 transition-colors">
                    {missingImages.has(attachment.id) ? (
                      <DeletedImagePlaceholder
                        imageId={attachment.id}
                        filename={attachment.filename}
                        onCleanup={handleDeletedAttachmentCleanup}
                        className="w-20 h-20 !p-2"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          const normalizedPath = attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`
                          onImageClick?.(normalizedPath, attachment.filename, attachment.id)
                        }}
                        className="relative group/thumb overflow-hidden rounded cursor-pointer block"
                        type="button"
                      >
                        <div className="relative w-20 h-20 qt-bg-muted">
                          <img
                            src={attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`}
                            alt={attachment.filename}
                            className="w-full h-full object-cover"
                            onError={() => setMissingImages((prev) => new Set(prev).add(attachment.id))}
                          />
                        </div>
                        <div className="absolute inset-0 qt-bg-overlay-none group-hover/thumb:qt-bg-overlay-light transition-colors flex items-center justify-center">
                          <Icon name="zoom-in" className="w-6 h-6 qt-text-overlay opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow-lg" />
                        </div>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Timestamp */}
          <div className="qt-text-xs mt-2">
            {formatMessageTime(message.createdAt)}
          </div>
        </div>
      </div>
    </div>
  )
}
