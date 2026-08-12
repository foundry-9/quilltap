'use client'

/**
 * BrahmaConsoleDialog
 *
 * The Brahma Console interface inside a FloatingDialog. A single conversation
 * pane — no character tabs, no guide tab. The launcher opens to the operator's
 * past Console chats with a "New conversation" affordance; selecting one
 * resumes it. The header carries a model picker so the engine can be switched
 * at any time (the same chat continues).
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { FloatingDialog } from '@/components/ui/FloatingDialog'
import { useBrahmaConsole } from '@/components/providers/brahma-console-provider'
import { HelpChatComposer } from '@/components/help-chat/HelpChatComposer'
import { BrahmaConsoleMessageList } from './BrahmaConsoleMessageList'
import { ModelPicker } from './ModelPicker'
import { useBrahmaConsoleStreaming } from './hooks/useBrahmaConsoleStreaming'

interface PastChat {
  id: string
  title: string
  updatedAt: string
  lastMessageAt: string | null
  messageCount: number
  consoleConnectionProfileId: string | null
}

interface ConsoleMessage {
  id: string
  role: string
  content: string
  createdAt: string
  provider?: string | null
  modelName?: string | null
  reasoningContent?: string | null
}

/**
 * @param asTab When true, renders the console body bare (for a workspace tab)
 *   instead of inside the floating dialog, and stays live regardless of the
 *   provider's `isOpen`. The chrome (model picker / new conversation) moves into
 *   an inline header.
 */
export function BrahmaConsoleDialog({ asTab = false }: { asTab?: boolean } = {}) {
  const {
    isOpen,
    closeConsole,
    currentChatId,
    setCurrentChatId,
    activeConnectionProfileId,
    setActiveConnectionProfileId,
    setModel,
    profiles,
    isEligible,
  } = useBrahmaConsole()

  const queryClient = useQueryClient()
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const [pastChats, setPastChats] = useState<PastChat[]>([])
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  const loadMessages = useCallback(async (chatId: string) => {
    setLoadingMessages(true)
    try {
      const res = await fetch(`/api/v1/brahma-console/${chatId}/messages`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
      }
      // Sync the active model from the chat record.
      const chatRes = await fetch(`/api/v1/brahma-console/${chatId}`)
      if (chatRes.ok) {
        const chatData = await chatRes.json()
        setActiveConnectionProfileId(chatData.chat?.consoleConnectionProfileId ?? null)
      }
    } catch (error) {
      console.error('Failed to load Brahma Console messages:', error)
    } finally {
      setLoadingMessages(false)
    }
  }, [setActiveConnectionProfileId])

  const handleMessageComplete = useCallback(() => {
    if (currentChatId) {
      loadMessages(currentChatId)
      queryClient.invalidateQueries({ queryKey: queryKeys.brahmaConsole.pastChats })
    }
  }, [currentChatId, loadMessages, queryClient])

  const {
    isStreaming,
    streamingContent,
    streamingReasoning,
    streamingToolCalls,
    isExecutingTools,
    error: streamError,
    sendMessage,
  } = useBrahmaConsoleStreaming({
    chatId: currentChatId,
    onMessageComplete: handleMessageComplete,
  })

  const { data: pastChatsData, refetch: refetchPastChats } = useQuery({
    queryKey: queryKeys.brahmaConsole.pastChats,
    queryFn: ({ signal }) => apiFetch<{ chats: PastChat[] }>('/api/v1/brahma-console', { signal }),
    enabled: (isOpen || asTab) && !currentChatId,
  })

  useEffect(() => {
    if (pastChatsData?.chats) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Query data syncs to local state that delete/select handlers also mutate
      setPastChats(pastChatsData.chats)
    }
  }, [pastChatsData])

  // Load messages when the active chat changes
  useEffect(() => {
    if (currentChatId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror loaded transcript into local state mutated by send handlers
      loadMessages(currentChatId)
    } else {
      setMessages([])
    }
  }, [currentChatId, loadMessages])

  // Re-focus the composer when streaming finishes
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setTimeout(() => composerInputRef.current?.focus({ preventScroll: true }), 100)
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  const handleCreateChat = useCallback(async (question: string) => {
    try {
      const res = await fetch('/api/v1/brahma-console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          activeConnectionProfileId ? { connectionProfileId: activeConnectionProfileId } : {}
        ),
      })
      if (res.ok) {
        const data = await res.json()
        const chatId = data.chat?.id
        if (chatId) {
          setActiveConnectionProfileId(data.chat?.consoleConnectionProfileId ?? null)
          setCurrentChatId(chatId)
          sendMessage(question, undefined, chatId)
          queryClient.invalidateQueries({ queryKey: queryKeys.brahmaConsole.pastChats })
        }
      }
    } catch (error) {
      console.error('Failed to create Brahma Console chat:', error)
    }
  }, [activeConnectionProfileId, setActiveConnectionProfileId, setCurrentChatId, sendMessage, queryClient])

  const handleSend = useCallback((content: string) => {
    const optimisticMessage: ConsoleMessage = {
      id: `optimistic-${Date.now()}`,
      role: 'USER',
      content,
      createdAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimisticMessage])

    if (!currentChatId) {
      handleCreateChat(content)
    } else {
      sendMessage(content)
    }
  }, [currentChatId, sendMessage, handleCreateChat])

  const handleNewChat = useCallback(() => {
    setCurrentChatId(null)
    setMessages([])
    refetchPastChats()
  }, [setCurrentChatId, refetchPastChats])

  const handleDeleteChat = useCallback(async (chatId: string) => {
    try {
      await fetch(`/api/v1/brahma-console/${chatId}`, { method: 'DELETE' })
      setPastChats(prev => prev.filter(c => c.id !== chatId))
      await refetchPastChats()
      if (currentChatId === chatId) {
        setCurrentChatId(null)
        setMessages([])
      }
    } catch (error) {
      console.error('Failed to delete Brahma Console chat:', error)
    }
  }, [currentChatId, setCurrentChatId, refetchPastChats])

  const headerActions = currentChatId ? (
    <div className="flex items-center gap-1">
      <ModelPicker
        profiles={profiles}
        activeId={activeConnectionProfileId}
        onSelect={setModel}
      />
      <button
        type="button"
        onClick={handleNewChat}
        className="p-1 rounded qt-hover-accent qt-text-secondary transition-colors"
        title="New conversation"
      >
        <Icon name="plus" className="w-4 h-4" />
      </button>
    </div>
  ) : undefined

  const body = (
      <div className="flex-1 min-h-0">
        {!currentChatId ? (
          /* Launcher: past chats + opening composer */
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto">
              {!isEligible ? (
                <div className="p-4 text-sm qt-text-secondary">
                  The Console wants for an engine. Establish a connection profile first,
                  then return to confer.
                </div>
              ) : pastChats.length > 0 ? (
                <div className="p-3">
                  <div className="qt-help-section-label">Recent Console Conversations</div>
                  <div className="flex flex-col gap-1">
                    {pastChats.map(chat => (
                      <div key={chat.id} className="qt-help-past-chat group">
                        <button
                          type="button"
                          onClick={() => setCurrentChatId(chat.id)}
                          className="flex-1 text-left truncate text-sm"
                        >
                          {chat.title || 'Untitled'}
                        </button>
                        <span className="text-xs qt-text-secondary">{chat.messageCount}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id) }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded qt-text-secondary hover:qt-text-destructive transition-all"
                          title="Delete"
                        >
                          <Icon name="close" className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-4 text-sm qt-text-secondary">
                  No prior conversations. Pose a question below to open a fresh line to the engine.
                </div>
              )}
            </div>

            <HelpChatComposer
              onSend={handleSend}
              disabled={!isEligible}
              placeholder="What shall we put to the engine?"
            />
          </div>
        ) : (
          /* Conversation view */
          <div className="flex flex-col h-full">
            {streamError && (
              <div className="qt-help-error">{streamError}</div>
            )}

            <BrahmaConsoleMessageList
              messages={messages}
              streamingContent={streamingContent}
              streamingReasoning={streamingReasoning}
              streamingToolCalls={streamingToolCalls}
              isStreaming={isStreaming}
              isExecutingTools={isExecutingTools}
            />

            <HelpChatComposer
              onSend={handleSend}
              disabled={isStreaming || loadingMessages}
              inputRef={composerInputRef}
              placeholder="Speak to the engine…"
            />
          </div>
        )}
      </div>
  )

  // Workspace-tab mode: render bare with an inline header (no floating dialog).
  if (asTab) {
    return (
      <div className="flex flex-col h-full min-h-0">
        {headerActions && (
          <div className="flex items-center justify-end gap-1 px-3 py-2 border-b qt-border-default/60">
            {headerActions}
          </div>
        )}
        {body}
      </div>
    )
  }

  return (
    <FloatingDialog
      isOpen={isOpen}
      onClose={closeConsole}
      title="Brahma Console"
      minWidth={480}
      minHeight={400}
      initialGeometry={{ width: 560 }}
      storageKey="quilltap:brahma-console-geometry"
      headerActions={headerActions}
    >
      {body}
    </FloatingDialog>
  )
}
