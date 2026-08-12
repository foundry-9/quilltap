/**
 * Home dashboard data service.
 *
 * Single source of truth for the home dashboard payload (recent chats,
 * projects, characters, plus the greeting name and "continue last" chat id).
 * Extracted from `app/page.tsx` so it can feed both the server-rendered `/`
 * route and the client-fetched workspace home tab
 * (`/api/v1/system/home` → `HomeViewContainer`). See
 * `docs/developer/features/tabbed-workspace.md`.
 *
 * @module lib/services/home-data.service
 */

import { getRepositories } from '@/lib/repositories/factory'
import { enrichWithDefaultImage } from '@/lib/api/middleware'
import { enrichChatsForList, cleanEnrichedChats } from '@/lib/services/chat-enrichment.service'
import type {
  RecentChat,
  HomepageProject,
  HomepageCharacter,
} from '@/components/homepage'

export interface HomeData {
  displayName: string
  lastChatId: string | null
  recentChats: RecentChat[]
  projects: HomepageProject[]
  characters: HomepageCharacter[]
}

type Repos = ReturnType<typeof getRepositories>

/**
 * Compute the home dashboard payload. Mirrors the original `app/page.tsx`
 * server logic exactly; the route and the API endpoint both delegate here.
 */
export async function getHomeData(
  repos: Repos,
  opts: { userId: string | undefined; fallbackName?: string | null }
): Promise<HomeData> {
  const { userId, fallbackName } = opts

  const user = userId ? await repos.users.findById(userId) : null

  // Fetch data in parallel for the homepage sections
  const [allChatsRaw, allProjects, allCharacters, allFiles] = await Promise.all([
    userId ? repos.chats.findByUserId(userId) : [],
    userId ? repos.projects.findAll() : [],
    userId ? repos.characters.findByUserId(userId) : [],
    userId ? repos.files.findAll() : [],
  ])

  // Filter out help chats — only show salon (regular) chats on the homepage
  const salonChats = allChatsRaw.filter((c: any) => !c.chatType || c.chatType === 'salon')

  // Enrich chats with participant data using the enrichment service
  const enrichedChats = await enrichChatsForList(salonChats, repos)
  const cleanedChats = cleanEnrichedChats(enrichedChats)

  // Get more chats than we'll display to account for quick-hide filtering
  const recentEnrichedChats = cleanedChats.slice(0, 12)

  // Get the last chat ID for "Continue Last" button
  const lastChatId = recentEnrichedChats.length > 0 ? recentEnrichedChats[0].id : null

  // Transform enriched chats to the homepage format
  const recentChats: RecentChat[] = recentEnrichedChats.map((chat) => ({
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    lastMessageAt: chat.lastMessageAt,
    isDangerousChat: chat.isDangerousChat,
    storyBackgroundUrl: chat.storyBackground?.filepath || null,
    participants: chat.participants.map((p) => ({
      id: p.id,
      type: p.type,
      isActive: p.isActive,
      displayOrder: p.displayOrder,
      character: p.character
        ? {
            id: p.character.id,
            name: p.character.name,
            defaultImageId: p.character.defaultImageId || undefined,
            defaultImage: p.character.defaultImage
              ? {
                  id: p.character.defaultImage.id,
                  filepath: p.character.defaultImage.filepath,
                  url: p.character.defaultImage.url || undefined,
                }
              : null,
            tags: p.character.tags || [],
          }
        : null,
    })),
    _count: {
      messages: chat._count.messages,
    },
  }))

  // Compute chat counts and most recent chat activity per project (using lastMessageAt)
  const projectChatStats = new Map<string, { count: number; lastMessageAt: Date | null }>()
  for (const chat of allChatsRaw) {
    if (chat.projectId) {
      const existing = projectChatStats.get(chat.projectId)
      const chatLastMessage = chat.lastMessageAt ? new Date(chat.lastMessageAt) : null
      if (existing) {
        existing.count++
        if (chatLastMessage && (!existing.lastMessageAt || chatLastMessage > existing.lastMessageAt)) {
          existing.lastMessageAt = chatLastMessage
        }
      } else {
        projectChatStats.set(chat.projectId, { count: 1, lastMessageAt: chatLastMessage })
      }
    }
  }

  // Compute most recent file activity per project
  const projectFileStats = new Map<string, { lastFileActivity: Date }>()
  for (const file of allFiles) {
    if (file.projectId) {
      const existing = projectFileStats.get(file.projectId)
      const fileUpdated = new Date(file.updatedAt)
      if (existing) {
        if (fileUpdated > existing.lastFileActivity) {
          existing.lastFileActivity = fileUpdated
        }
      } else {
        projectFileStats.set(file.projectId, { lastFileActivity: fileUpdated })
      }
    }
  }

  // Transform projects to the homepage format, sorted by most recent activity
  const sortedProjects = [...allProjects]
    .sort((a, b) => {
      const aChatStats = projectChatStats.get(a.id)
      const aFileStats = projectFileStats.get(a.id)
      const bChatStats = projectChatStats.get(b.id)
      const bFileStats = projectFileStats.get(b.id)

      const aProjectTime = new Date(a.updatedAt).getTime()
      const aChatTime = aChatStats?.lastMessageAt?.getTime() ?? 0
      const aFileTime = aFileStats?.lastFileActivity?.getTime() ?? 0
      const aTime = Math.max(aProjectTime, aChatTime, aFileTime)

      const bProjectTime = new Date(b.updatedAt).getTime()
      const bChatTime = bChatStats?.lastMessageAt?.getTime() ?? 0
      const bFileTime = bFileStats?.lastFileActivity?.getTime() ?? 0
      const bTime = Math.max(bProjectTime, bChatTime, bFileTime)

      return bTime - aTime
    })
    .slice(0, 12)

  const projects: HomepageProject[] = sortedProjects.map((project) => {
    const chatStats = projectChatStats.get(project.id)
    const fileStats = projectFileStats.get(project.id)
    const projectTime = new Date(project.updatedAt).getTime()
    const chatTime = chatStats?.lastMessageAt?.getTime() ?? 0
    const fileTime = fileStats?.lastFileActivity?.getTime() ?? 0
    const lastActivityTime = Math.max(projectTime, chatTime, fileTime)

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      icon: project.icon,
      chatCount: chatStats?.count ?? 0,
      lastActivity: new Date(lastActivityTime).toISOString(),
    }
  })

  // Compute chat counts per character from existing chat data
  const characterChatCounts = new Map<string, number>()
  for (const chat of allChatsRaw) {
    for (const participant of chat.participants) {
      if (participant.characterId) {
        const current = characterChatCounts.get(participant.characterId) ?? 0
        characterChatCounts.set(participant.characterId, current + 1)
      }
    }
  }

  // Get AI-controlled characters only (exclude NPCs and user-controlled characters)
  const sortedCharacters = allCharacters
    .filter((c) => !c.npc && c.controlledBy !== 'user')
    .sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1
      }
      const aChats = characterChatCounts.get(a.id) ?? 0
      const bChats = characterChatCounts.get(b.id) ?? 0
      if (aChats !== bChats) {
        return bChats - aChats
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    .slice(0, 24)

  // Add default images to sorted characters
  const characters: HomepageCharacter[] = await Promise.all(
    sortedCharacters.map(async (char) => {
      const defaultImage = await enrichWithDefaultImage(char.defaultImageId, repos)

      return {
        id: char.id,
        name: char.name,
        title: char.title || null,
        defaultImageId: defaultImage?.id ?? null,
        defaultImage,
        tags: char.tags || [],
        isFavorite: char.isFavorite ?? false,
        npc: char.npc ?? false,
        chatCount: characterChatCounts.get(char.id) ?? 0,
        defaultConnectionProfileId: char.defaultConnectionProfileId || null,
      }
    })
  )

  const displayName = user?.name || fallbackName || 'there'

  return { displayName, lastChatId, recentChats, projects, characters }
}
