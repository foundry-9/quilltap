/**
 * Aurora Page Types
 *
 * Shared types for Aurora components.
 */

export interface Group {
  id: string
  name: string
  description?: string | null
  /** Standing instructions ("the group prompt") added to every member character's system prompt. */
  instructions?: string | null
  color?: string | null
  icon?: string | null
  officialMountPointId?: string | null
  createdAt: string
  updatedAt: string
  memberCount?: number
}

export interface UseGroupsReturn {
  groups: Group[]
  loading: boolean
  error: string | null
  fetchGroups: () => Promise<void>
  createGroup: (name: string, description?: string | null) => Promise<Group | null>
  deleteGroup: (id: string) => Promise<boolean>
}

export interface GroupMember {
  id: string
  name: string
  /** Set when the member is archived — shown as a badge; membership survives archiving. */
  archivedAt?: string | null
}

export interface DocumentStore {
  id: string
  name: string
  description?: string | null
  mountType: string
  fileCount: number
  totalSizeBytes: number
  enabled: boolean
}

export interface UseGroupMembersReturn {
  members: GroupMember[]
  allCharacters: GroupMember[]
  loading: boolean
  fetchMembers: () => Promise<void>
  fetchAllCharacters: () => Promise<void>
  addMember: (characterId: string) => Promise<boolean>
  removeMember: (characterId: string) => Promise<boolean>
}

export interface UseGroupMountPointsReturn {
  linkedStores: DocumentStore[]
  allStores: DocumentStore[]
  loading: boolean
  fetchLinkedStores: () => Promise<void>
  fetchAllStores: () => Promise<void>
  linkStore: (mountPointId: string) => Promise<boolean>
  unlinkStore: (mountPointId: string) => Promise<boolean>
}
