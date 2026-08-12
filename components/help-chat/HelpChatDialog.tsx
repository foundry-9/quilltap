'use client'

/**
 * HelpChatDialog
 *
 * The main help interface rendered inside a FloatingDialog.
 * Two tabs: "Guide" (browseable documentation) and "Ask" (conversational help chat).
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { FloatingDialog } from '@/components/ui/FloatingDialog'
import { useHelpChat } from '@/components/providers/help-chat-provider'
import { HelpChatComposer } from './HelpChatComposer'
import { HelpChatMessageList } from './HelpChatMessageList'
import { HelpEntityPicker, hasParamSegments } from './HelpEntityPicker'
import { useHelpChatStreaming } from './hooks/useHelpChatStreaming'
import { HelpGuideTab } from './HelpGuideTab'

type HelpTab = 'guide' | 'ask'

function getInitialTab(): HelpTab {
  try {
    const stored = sessionStorage.getItem('quilltap:help-tab')
    if (stored === 'guide' || stored === 'ask') return stored
  } catch { /* SSR or storage unavailable */ }
  return 'guide'
}

interface PastChat {
  id: string
  title: string
  updatedAt: string
  participants: Array<{ id: string; name: string; avatarUrl?: string | null }>
  messageCount: number
}

interface ChatMessage {
  id: string
  role: string
  content: string
  participantId?: string | null
  createdAt: string
  provider?: string | null
  modelName?: string | null
}

interface CharacterInfo {
  id: string
  name: string
  avatarUrl: string | null
}

export function HelpChatDialog() {
  const {
    isOpen,
    closeHelpChat,
    currentChatId,
    setCurrentChatId,
    eligibleCharacters,
    selectedCharacterIds,
    toggleCharacter,
    currentPageUrl,
  } = useHelpChat()

  // Keep-alive-safe: a help link to a tab-equivalent route (Settings, a
  // character editor, etc.) opens it as a tab in place instead of navigating
  // and tearing the workspace down; other URLs push normally.
  const navigate = useWorkspaceNavigate()
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const [activeTab, setActiveTab] = useState<HelpTab>(getInitialTab)
  const [pastChats, setPastChats] = useState<PastChat[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [characterMap, setCharacterMap] = useState<Map<string, CharacterInfo>>(new Map())
  const [participantToCharacter, setParticipantToCharacter] = useState<Map<string, string>>(new Map())
  const [loadingMessages, setLoadingMessages] = useState(false)
  /** URL template pending entity selection, e.g. "/aurora/:id/edit" */
  const [pendingParamUrl, setPendingParamUrl] = useState<string | null>(null)

  // Persist tab selection to sessionStorage
  const handleTabChange = useCallback((tab: HelpTab) => {
    setActiveTab(tab)
    try { sessionStorage.setItem('quilltap:help-tab', tab) } catch { /* ignore */ }
  }, [])

  const handleNavigate = useCallback((url: string) => {
    if (hasParamSegments(url)) {
      setPendingParamUrl(url)
    } else {
      navigate(url)
    }
  }, [navigate])

  const buildParticipantMaps = useCallback((participants: any[]) => {
    const newCharMap = new Map<string, CharacterInfo>()
    const newPtcMap = new Map<string, string>()
    for (const p of participants) {
      const charId = p.character?.id || p.characterId
      const charName = p.character?.name || p.name
      const charAvatar = p.character?.avatarUrl ?? p.avatarUrl ?? null
      if (charId && charName) {
        newCharMap.set(charId, { id: charId, name: charName, avatarUrl: charAvatar })
        newPtcMap.set(p.id, charId)
      }
    }
    setCharacterMap(newCharMap)
    setParticipantToCharacter(newPtcMap)
  }, [])

  const loadMessages = useCallback(async (chatId: string) => {
    setLoadingMessages(true)
    try {
      const res = await fetch(`/api/v1/help-chats/${chatId}/messages`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])

        const chatRes = await fetch(`/api/v1/help-chats/${chatId}`)
        if (chatRes.ok) {
          const chatData = await chatRes.json()
          const chat = chatData.chat
          if (chat?.participants) {
            buildParticipantMaps(chat.participants)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load help chat messages:', error)
    } finally {
      setLoadingMessages(false)
    }
  }, [buildParticipantMaps])

  const handleMessageComplete = useCallback(() => {
    if (currentChatId) {
      loadMessages(currentChatId)
    }
  }, [currentChatId, loadMessages])

  const {
    isStreaming,
    streamingContent,
    streamingParticipantId,
    streamingNavigationLinks,
    suggestedLinks,
    isExecutingTools,
    error: streamError,
    sendMessage,
  } = useHelpChatStreaming({
    chatId: currentChatId,
    onMessageComplete: handleMessageComplete,
  })

  const { data: pastChatsData, refetch: mutatePastChats } = useQuery({
    queryKey: queryKeys.helpChat.pastChats,
    queryFn: ({ signal }) => apiFetch<{ chats: PastChat[] }>('/api/v1/help-chats', { signal }),
    enabled: isOpen && !currentChatId && activeTab === 'ask',
  })

  useEffect(() => {
    if (pastChatsData?.chats) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by action handlers (filter/delete/update)
      setPastChats(pastChatsData.chats)
    }
  }, [pastChatsData])

  // Load messages when chat changes
  useEffect(() => {
    if (currentChatId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by action handlers (filter/delete/update)
      loadMessages(currentChatId)
    } else {
      setMessages([])
    }
  }, [currentChatId, loadMessages])

  // Auto-focus the composer when streaming completes
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setTimeout(() => {
        composerInputRef.current?.focus({ preventScroll: true })
      }, 100)
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  const handleCreateChat = useCallback(async (question: string) => {
    const eligible = eligibleCharacters.filter(c => c.hasToolCapableProfile)
    const charIds = selectedCharacterIds.filter(id => eligible.some(c => c.id === id))
    if (charIds.length === 0 && eligible.length > 0) {
      charIds.push(eligible[0].id)
    }
    if (charIds.length === 0) return

    try {
      const res = await fetch('/api/v1/help-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterIds: charIds,
          pageUrl: currentPageUrl,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const chatId = data.chat?.id
        if (chatId) {
          setCurrentChatId(chatId)

          if (data.chat?.participants) {
            buildParticipantMaps(data.chat.participants)
          }

          sendMessage(question, undefined, chatId)
        }
      }
    } catch (error) {
      console.error('Failed to create help chat:', error)
    }
  }, [eligibleCharacters, selectedCharacterIds, currentPageUrl, setCurrentChatId, sendMessage, buildParticipantMaps])

  const handleSend = useCallback((content: string) => {
    const optimisticMessage: ChatMessage = {
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

  const handleSelectPastChat = useCallback((chatId: string) => {
    setCurrentChatId(chatId)
  }, [setCurrentChatId])

  const handleNewChat = useCallback(() => {
    setCurrentChatId(null)
    setMessages([])
  }, [setCurrentChatId])

  const handleDeleteChat = useCallback(async (chatId: string) => {
    try {
      await fetch(`/api/v1/help-chats/${chatId}`, { method: 'DELETE' })
      setPastChats(prev => prev.filter(c => c.id !== chatId))
      await mutatePastChats()
      if (currentChatId === chatId) {
        setCurrentChatId(null)
        setMessages([])
      }
    } catch (error) {
      console.error('Failed to delete help chat:', error)
    }
  }, [currentChatId, setCurrentChatId, mutatePastChats])

  return (
    <FloatingDialog
      isOpen={isOpen}
      onClose={closeHelpChat}
      title="Help"
      minWidth={480}
      minHeight={400}
      initialGeometry={{ width: 560 }}
      headerActions={
        activeTab === 'ask' && currentChatId ? (
          <button
            type="button"
            onClick={handleNewChat}
            className="p-1 rounded qt-hover-accent qt-text-secondary transition-colors"
            title="New help chat"
          >
            <Icon name="plus" className="w-4 h-4" />
          </button>
        ) : undefined
      }
    >
      {/* Entity picker overlay for parameterised URLs */}
      {pendingParamUrl && (
        <HelpEntityPicker
          urlTemplate={pendingParamUrl}
          onSelect={(resolvedUrl) => {
            setPendingParamUrl(null)
            navigate(resolvedUrl)
          }}
          onCancel={() => setPendingParamUrl(null)}
        />
      )}

      {/* Tab bar */}
      <div className="flex-shrink-0 px-3 pt-2" role="tablist" aria-label="Help tabs">
        <div className="qt-tab-group">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'guide'}
            className={`qt-tab ${activeTab === 'guide' ? 'qt-tab-active' : ''}`}
            onClick={() => handleTabChange('guide')}
          >
            Guide
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ask'}
            className={`qt-tab ${activeTab === 'ask' ? 'qt-tab-active' : ''}`}
            onClick={() => handleTabChange('ask')}
          >
            Ask
          </button>
        </div>
        <div className="qt-tab-divider" />
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0" role="tabpanel">
        {activeTab === 'guide' ? (
          <HelpGuideTab />
        ) : (
          /* Ask tab: existing chat interface */
          <>
            {!currentChatId ? (
              /* Launcher view */
              <div className="flex flex-col h-full">
                {/* Character selection */}
                <div className="p-3 border-b qt-border-default">
                  <div className="qt-help-section-label">Help Characters</div>
                  <div className="flex flex-wrap gap-2">
                    {eligibleCharacters.filter(c => c.hasToolCapableProfile).map(char => {
                      const isSelected = selectedCharacterIds.includes(char.id)
                      return (
                        <button
                          key={char.id}
                          type="button"
                          onClick={() => toggleCharacter(char.id)}
                          className="qt-help-char-pill"
                          data-selected={isSelected}
                          title={char.name}
                        >
                          <div className="w-5 h-5 rounded-full qt-bg-muted overflow-hidden flex-shrink-0">
                            {char.avatarUrl ? (
                              <img src={char.avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="flex items-center justify-center w-full h-full text-[10px]">
                                {char.name[0]}
                              </span>
                            )}
                          </div>
                          {char.name}
                        </button>
                      )
                    })}
                    {eligibleCharacters.filter(c => c.hasToolCapableProfile).length === 0 && (
                      <div className="text-xs qt-text-secondary">
                        No eligible help characters. Enable help tools on a character with a tool-capable connection profile.
                      </div>
                    )}
                  </div>
                </div>

                {/* Past chats */}
                <div className="flex-1 overflow-y-auto">
                  {pastChats.length > 0 && (
                    <div className="p-3">
                      <div className="qt-help-section-label">Recent Help Chats</div>
                      <div className="flex flex-col gap-1">
                        {pastChats.map(chat => (
                          <div
                            key={chat.id}
                            className="qt-help-past-chat group"
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectPastChat(chat.id)}
                              className="flex-1 text-left truncate text-sm"
                            >
                              {chat.title || 'Untitled'}
                            </button>
                            <span className="text-xs qt-text-secondary">
                              {chat.messageCount}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id) }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:qt-bg-destructive/20 qt-text-secondary hover:qt-text-destructive transition-all"
                              title="Delete"
                            >
                              <Icon name="close" className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Question input */}
                <HelpChatComposer
                  onSend={handleSend}
                  disabled={eligibleCharacters.filter(c => c.hasToolCapableProfile).length === 0}
                  placeholder="What would you like help with?"
                />
              </div>
            ) : (
              /* Chat view */
              <div className="flex flex-col h-full">
                {streamError && (
                  <div className="qt-help-error">
                    {streamError}
                  </div>
                )}

                <HelpChatMessageList
                  messages={messages}
                  characterMap={characterMap}
                  participantToCharacter={participantToCharacter}
                  streamingContent={streamingContent}
                  streamingParticipantId={streamingParticipantId}
                  isStreaming={isStreaming}
                  isExecutingTools={isExecutingTools}
                  navigationLinks={streamingNavigationLinks}
                  suggestedLinks={suggestedLinks}
                  onNavigate={handleNavigate}
                />

                <HelpChatComposer
                  onSend={handleSend}
                  disabled={isStreaming || loadingMessages}
                  inputRef={composerInputRef}
                />
              </div>
            )}
          </>
        )}
      </div>
    </FloatingDialog>
  )
}
