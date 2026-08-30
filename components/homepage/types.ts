/**
 * Homepage Types
 *
 * Shared types for the homepage components.
 */

import type { FileEntry } from '@/lib/schemas/types'

/** Lightweight chat data for homepage display */
export interface RecentChat {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
  /** Whether this chat has been classified as dangerous */
  isDangerousChat?: boolean
  /** Story background image URL - displayed instead of avatars when present */
  storyBackgroundUrl?: string | null
  participants: Array<{
    id: string
    type: 'CHARACTER'
    isActive: boolean
    displayOrder: number
    character?: {
      id: string
      name: string
      defaultImageId?: string
      defaultImage?: {
        id: string
        filepath: string
        url?: string
      } | null
      tags?: string[]
    } | null
  }>
  _count: {
    messages: number
  }
}

/** Lightweight project data for homepage display */
export interface HomepageProject {
  id: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  chatCount: number
  lastActivity: string // Most recent activity (file, chat message, or metadata change)
}

/** Character data for homepage grid */
export interface HomepageCharacter {
  id: string
  name: string
  title?: string | null
  defaultImageId: string | null
  defaultImage: {
    id: string
    filepath: string
    url?: string | null
  } | null
  tags?: string[]
  // Sorting fields (same as /characters page)
  isFavorite: boolean
  npc: boolean
  chatCount: number
  /** Default connection profile ID for showing provider badge */
  defaultConnectionProfileId?: string | null
}

/** Props for WelcomeSection */
export interface WelcomeSectionProps {
  displayName: string
}

/** Props for QuickActionsRow */
export interface QuickActionsRowProps {
  lastChatId: string | null
}

/** Props for RecentChatsSection */
export interface RecentChatsSectionProps {
  chats: RecentChat[]
}

/** Props for ProjectsSection */
export interface ProjectsSectionProps {
  projects: HomepageProject[]
}

/** Props for CharactersSection */
export interface CharactersSectionProps {
  characters: HomepageCharacter[]
}
