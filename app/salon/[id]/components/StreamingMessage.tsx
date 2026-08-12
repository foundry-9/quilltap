import { Fragment } from 'react'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import MessageContent from '@/components/chat/MessageContent'
import Avatar from '@/components/ui/Avatar'
import { PendingToolCalls } from './PendingToolCalls'
import { ThinkingBlock } from '@/components/chat/ThinkingBlock'
import type { StreamingToolBatch } from '../hooks/useSSEStreaming'
import type { CharacterData } from '../types'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

interface StreamingMessageProps {
  streaming: boolean
  streamingContent: string
  waitingForResponse: boolean
  respondingCharacter: CharacterData | undefined
  /** Patterns for styling roleplay text in message content */
  renderingPatterns?: RenderingPattern[]
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection?: DialogueDetection | null
  shouldShowAvatars: boolean
  /** Whether the Concierge has flagged this chat as dangerous */
  isDangerousChat?: boolean
  /** In-progress tool calls for the turn being streamed, batched by the prose
   *  offset where each fired so they nest at the point of invocation rather than
   *  in one block at the bottom of the bubble. */
  streamingToolBatches?: StreamingToolBatch[]
  /** Live cumulative reasoning ("thinking") for the in-progress turn. Empty when
   *  the chat's thinking-visibility is off. DISPLAY ONLY — rendered as a single
   *  leading block (live reasoning generally precedes the answer). */
  streamingReasoning?: string
  /** Whether the (post-stream) thinking block starts collapsed. The live block
   *  is always shown open while streaming. */
  thinkingCollapsedByDefault?: boolean
}

type StreamingPart =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; batch: StreamingToolBatch }

/**
 * Split the live prose at each batch's offset so tool calls render where the
 * model paused to invoke them. Offsets are clamped to the content streamed so
 * far (it can lag a batch by < 1 frame) and kept monotonic, so a batch whose
 * preceding text hasn't arrived yet renders at the current tail and slides into
 * place as more text streams in.
 */
function buildStreamingParts(content: string, batches: StreamingToolBatch[]): StreamingPart[] {
  if (batches.length === 0) return [{ kind: 'text', text: content }]

  const sorted = [...batches].sort((a, b) => a.offset - b.offset)
  const parts: StreamingPart[] = []
  let cursor = 0
  for (const batch of sorted) {
    const off = Math.max(cursor, Math.min(batch.offset, content.length))
    parts.push({ kind: 'text', text: content.slice(cursor, off) })
    parts.push({ kind: 'tools', batch })
    cursor = off
  }
  parts.push({ kind: 'text', text: content.slice(cursor) })
  return parts
}

export function StreamingMessage({
  streaming,
  streamingContent,
  waitingForResponse,
  respondingCharacter,
  renderingPatterns,
  dialogueDetection,
  shouldShowAvatars,
  isDangerousChat = false,
  streamingToolBatches = [],
  streamingReasoning = '',
  thinkingCollapsedByDefault = true,
}: StreamingMessageProps) {
  if (!waitingForResponse && !streaming) return null

  const parts = buildStreamingParts(streamingContent, streamingToolBatches)
  // The trailing text part hosts the live "still typing" indicator.
  const lastTextIdx = parts.reduce((acc, p, i) => (p.kind === 'text' ? i : acc), -1)

  return (
    <div className="qt-chat-message-row qt-chat-message-row-assistant">
      {shouldShowAvatars && (
        <div className={`flex-shrink-0 qt-chat-desktop-avatar${isDangerousChat ? ' qt-chat-avatar-dangerous' : ''}`}>
          <Avatar
            name={respondingCharacter?.name || 'AI'}
            title={null}
            src={respondingCharacter}
            size="chat"
            showName
            showTitle
            className="flex flex-col items-center w-32 gap-1"
          />
        </div>
      )}
      <div className="qt-chat-message-body">
        {waitingForResponse && !streaming ? (
          <div className="qt-text-secondary">
            <QuillAnimation size="lg" />
          </div>
        ) : (
          <div className="flex-1 min-w-0 px-4 py-3 rounded-lg qt-bg-card border qt-border-default text-foreground">
            {streamingReasoning.trim().length > 0 && (
              <ThinkingBlock
                content={streamingReasoning}
                streaming
                collapsedByDefault={thinkingCollapsedByDefault}
                renderingPatterns={renderingPatterns}
                dialogueDetection={dialogueDetection}
              />
            )}
            {parts.map((part, idx) => {
              if (part.kind === 'text') {
                // Skip empty interior segments, but always render the trailing
                // one so the typing indicator has a home.
                if (part.text.length === 0 && idx !== lastTextIdx) return null
                // With no prose to sit beside, the indicator lands directly
                // under the tool block — and the quill's feather paints a little
                // above its own layout box, so inline placement crowds the two
                // together. Give it a line of its own with the same breathing
                // room the tool block takes above itself.
                const standaloneIndicator = part.text.length === 0 && parts[idx - 1]?.kind === 'tools'
                return (
                  <Fragment key={`seg-${idx}`}>
                    <MessageContent content={part.text} renderingPatterns={renderingPatterns} dialogueDetection={dialogueDetection} />
                    {idx === lastTextIdx && (
                      standaloneIndicator ? (
                        <div className="mt-3">
                          <QuillAnimation size="sm" className="ml-2 qt-text-secondary" />
                        </div>
                      ) : (
                        <QuillAnimation size="sm" className="inline-block ml-2 qt-text-secondary" />
                      )
                    )}
                  </Fragment>
                )
              }
              // Open a paragraph break beneath the block when non-empty prose
              // follows it in the live stream.
              const next = parts[idx + 1]
              const beforeProse = next?.kind === 'text' && next.text.length > 0
              return (
                <PendingToolCalls key={`tools-${idx}`} embedded beforeProse={beforeProse} pendingToolCalls={part.batch.calls} />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
