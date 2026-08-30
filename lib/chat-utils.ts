/**
 * Shared shaping + helpers for the ChatCard data flow on both the Salon
 * list (`app/salon/page.tsx`) and the Character "Conversations" tab
 * (`components/character/character-conversations-tab.tsx`). The two pages
 * receive different chat shapes from the API and need different fields in
 * the resulting card — keep them as two named transforms so each call site
 * keeps its static guarantees.
 */

import { showConfirmation } from '@/lib/alert'
import { showErrorToast } from '@/lib/toast'
import type { ChatCardData } from '@/components/chat/ChatCard'

// ----------------------------------------------------------------------------
// Salon list — chats with full participant + project metadata
// ----------------------------------------------------------------------------

interface SalonChatParticipantShape {
  id: string
  type: 'CHARACTER'
  characterId?: string | null
  isActive: boolean
  displayOrder: number
  character?: {
    id: string
    name: string
    avatarUrl?: string
    defaultImageId?: string
    defaultImage?: { id: string; filepath: string; url?: string }
    tags?: string[]
  }
}

export interface SalonChatShape {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  participants: SalonChatParticipantShape[]
  tags: Array<{ tag: { id: string; name: string } }>
  project: { id: string; name: string; color: string | null } | null
  storyBackground: { id: string; filepath: string } | null
  isDangerousChat?: boolean
  chatType?: 'salon' | 'help' | 'autonomous' | 'brahma'
  scriptoriumStatus?: 'none' | 'rendered' | 'embedded'
  _count: { messages: number; memories?: number }
}

export function transformSalonChatToCardData(chat: SalonChatShape): ChatCardData {
  const characters = chat.participants
    .filter(p => p.type === 'CHARACTER' && p.isActive && p.character)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(p => ({
      id: p.character!.id,
      name: p.character!.name,
      avatarUrl: p.character!.avatarUrl,
      defaultImageId: p.character!.defaultImageId,
      defaultImage: p.character!.defaultImage,
      tags: p.character!.tags,
    }))

  return {
    id: chat.id,
    title: chat.title,
    messageCount: chat._count.messages,
    memoryCount: chat._count.memories ?? 0,
    participants: characters,
    tags: chat.tags,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    project: chat.project,
    storyBackgroundUrl: chat.storyBackground?.filepath || null,
    isDangerousChat: chat.isDangerousChat === true,
    isAutonomous: chat.chatType === 'autonomous',
    scriptoriumStatus: chat.scriptoriumStatus ?? 'none',
  }
}

// ----------------------------------------------------------------------------
// Character Conversations tab — chats scoped to a single character
// ----------------------------------------------------------------------------

interface CharacterChatMessageShape {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  createdAt: string
}

export interface CharacterChatShape {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  lastMessageAt?: string
  userCharacter?: { id: string; name: string; title?: string | null } | null
  project?: { id: string; name: string } | null
  storyBackground?: { id: string; filepath: string } | null
  messages: CharacterChatMessageShape[]
  tags?: Array<{ tag: { id: string; name: string } }>
  isDangerousChat?: boolean
  scriptoriumStatus?: 'none' | 'rendered' | 'embedded'
  _count?: { messages: number; memories?: number }
}

function getCharacterChatPreview(messages: CharacterChatMessageShape[]): string | null {
  const lastMessage = messages[messages.length - 1]
  if (!lastMessage) return null
  const content = lastMessage.content.replace(/\n/g, ' ').trim()
  return content.length > 100 ? content.slice(0, 100) + '...' : content
}

export function transformCharacterChatToCardData(chat: CharacterChatShape): ChatCardData {
  return {
    id: chat.id,
    title: chat.title,
    messageCount: chat._count?.messages ?? chat.messages.length,
    memoryCount: chat._count?.memories ?? 0,
    // No participants for character view — avatars not shown
    participants: [],
    tags: chat.tags,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    lastMessageAt: chat.lastMessageAt,
    project: chat.project || null,
    userCharacter: chat.userCharacter || null,
    previewText: getCharacterChatPreview(chat.messages),
    storyBackgroundUrl: chat.storyBackground?.filepath || null,
    isDangerousChat: chat.isDangerousChat === true,
    scriptoriumStatus: chat.scriptoriumStatus || 'none',
  }
}

// ----------------------------------------------------------------------------
// Delete confirmation + DELETE request
// ----------------------------------------------------------------------------

/**
 * Confirm deletion with the user, DELETE the chat, and return whether the
 * delete succeeded. Surfaces failures via toast. Callers own their list
 * refresh (SWR mutate, local state update, etc.).
 */
export async function confirmAndDeleteChat(chatId: string): Promise<boolean> {
  const confirmed = await showConfirmation('Are you sure you want to delete this chat?')
  if (!confirmed) return false
  try {
    const res = await fetch(`/api/v1/chats/${chatId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete chat')
    return true
  } catch (err) {
    showErrorToast(err instanceof Error ? err.message : 'Failed to delete chat')
    return false
  }
}
