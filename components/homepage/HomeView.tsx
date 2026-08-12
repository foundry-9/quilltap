'use client'

/**
 * HomeView
 *
 * Presentational home dashboard, extracted from `app/page.tsx` so the same
 * dashboard can render both at `/` (fed by the server route's data fetch) and
 * as the workspace's home tab (fed by a client fetch). Purely props-driven —
 * no data fetching of its own. See `docs/developer/features/tabbed-workspace.md`.
 *
 * @module components/homepage/HomeView
 */

import {
  WelcomeSection,
  QuickActionsRow,
  RecentChatsSection,
  ProjectsSection,
  CharactersSection,
} from '@/components/homepage'
import type { RecentChat, HomepageProject, HomepageCharacter } from '@/components/homepage'

export interface HomeViewProps {
  displayName: string
  lastChatId: string | null
  recentChats: RecentChat[]
  projects: HomepageProject[]
  characters: HomepageCharacter[]
}

export function HomeView({
  displayName,
  lastChatId,
  recentChats,
  projects,
  characters,
}: HomeViewProps) {
  return (
    <div className="qt-homepage-container">
      {/* Welcome section */}
      <WelcomeSection displayName={displayName} />

      {/* Quick action buttons */}
      <QuickActionsRow lastChatId={lastChatId} />

      {/* Three-column grid - fills remaining space */}
      <div className="qt-homepage-grid">
        <RecentChatsSection chats={recentChats} />
        <ProjectsSection projects={projects} />
        <CharactersSection characters={characters} />
      </div>
    </div>
  )
}
