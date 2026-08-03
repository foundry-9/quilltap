/**
 * Query-key factory — the single source of truth for TanStack Query cache
 * identity.
 *
 * RULE: components and hooks must NEVER pass raw string/array keys to
 * `useQuery`/`invalidateQueries`. Always go through `queryKeys`. This is what
 * makes targeted, prefix-based invalidation reliable instead of brittle
 * URL string-matching — e.g. `invalidateQueries({ queryKey: queryKeys.characters.all })`
 * invalidates every list and detail under `['characters']`.
 *
 * Convention per entity:
 *   all:    the broadest prefix — invalidate this to refetch everything for the entity.
 *   list:   a (optionally filtered) collection read. Filters are folded into the
 *           key so distinct filter sets cache independently.
 *   detail: a single record by id.
 *   <sub>:  nested sub-resources hang under the parent id so they invalidate with it.
 *
 * This factory starts with the central entities and GROWS PER PHASE as each
 * migration batch moves its reads onto TanStack Query. Add a block when you
 * migrate an entity; do not scatter ad-hoc keys at call sites.
 */

type Filters = Readonly<Record<string, unknown>> | undefined

export const queryKeys = {
  characters: {
    all: ['characters'] as const,
    list: (filters?: Filters) => ['characters', 'list', filters ?? {}] as const,
    detail: (id: string) => ['characters', 'detail', id] as const,
    prompts: (id: string) => ['characters', id, 'prompts'] as const,
    photos: (id: string) => ['characters', id, 'photos'] as const,
  },
  chats: {
    all: ['chats'] as const,
    list: (filters?: Filters) => ['chats', 'list', filters ?? {}] as const,
    detail: (id: string) => ['chats', 'detail', id] as const,
    state: (id: string) => ['chats', id, 'state'] as const,
    photoAlbums: (id: string) => ['chats', id, 'photo-albums'] as const,
    groupStores: (id: string) => ['chats', id, 'group-stores'] as const,
    background: (id: string) => ['chats', id, 'background'] as const,
  },
  groups: {
    all: ['groups'] as const,
    state: (id: string) => ['groups', id, 'state'] as const,
  },
  settings: {
    chat: ['settings', 'chat'] as const,
    textReplacements: ['settings', 'text-replacements'] as const,
    generalState: ['settings', 'general-state'] as const,
  },
  connectionProfiles: {
    all: ['connection-profiles'] as const,
  },
  embeddingProfiles: {
    all: ['embedding-profiles'] as const,
  },
  imageProfiles: {
    all: ['image-profiles'] as const,
  },
  providers: {
    all: ['providers'] as const,
  },
  projects: {
    all: ['projects'] as const,
    list: (filters?: Filters) => ['projects', 'list', filters ?? {}] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
    files: (projectId: string) => ['projects', projectId, 'files'] as const,
    background: (id: string) => ['projects', id, 'background'] as const,
    state: (id: string) => ['projects', id, 'state'] as const,
  },
  llmLogs: {
    all: ['llm-logs'] as const,
    byChat: (chatId: string) => ['llm-logs', 'chat', chatId] as const,
    byCharacter: (characterId: string, limit: number) => ['llm-logs', 'character', characterId, limit] as const,
    recent: (limit: number) => ['llm-logs', 'recent', limit] as const,
  },
  system: {
    tasksQueue: ['system', 'tasks-queue'] as const,
    capabilitiesReports: ['system', 'capabilities-reports'] as const,
    autonomousRooms: ['system', 'autonomous-rooms'] as const,
    dataDir: ['system', 'data-dir'] as const,
    unlock: ['system', 'unlock'] as const,
  },
  tools: {
    all: ['tools'] as const,
  },
  customTools: {
    all: ['custom-tools'] as const,
    /**
     * Pascal's roster for one chat, merged across every character participant's
     * perspective. Resolved fresh server-side on every request — a `.tool.json`
     * edit must show up on the next popup open — so callers should not hold this
     * cached across an open.
     */
    byChat: (chatId: string) => ['custom-tools', chatId] as const,
    /**
     * Pascal's Workbench: every definition in every enabled store, no
     * per-invoker shadowing. Fresh per request, same doctrine as `byChat`.
     */
    library: () => ['custom-tools', 'library'] as const,
    /**
     * Run presets for one tool in one character's vault —
     * `Tools/{toolName}.{preset}.settings.json`, listed by the run dialog.
     * Invalidated after a save; refetched per dialog open, same doctrine as
     * `byChat` (the files live in a store the user edits).
     */
    presets: (vaultMountPointId: string, toolName: string) =>
      ['custom-tools', 'presets', vaultMountPointId, toolName] as const,
    /** The Workbench save-target list, grouped by attachment. */
    destinations: () => ['custom-tools', 'destinations'] as const,
  },
  userProfile: {
    detail: ['user', 'profile'] as const,
  },
  roleplayTemplates: {
    all: ['roleplay-templates'] as const,
  },
  images: {
    all: ['images'] as const,
    list: (filters?: Filters) => ['images', 'list', filters ?? {}] as const,
  },
  apiKeys: {
    all: ['api-keys'] as const,
  },
  themes: {
    registrySources: ['themes', 'registry-sources'] as const,
    registry: ['themes', 'registry'] as const,
  },
  mountPoints: {
    all: ['mount-points'] as const,
    list: (filters?: Filters) => ['mount-points', 'list', filters ?? {}] as const,
  },
  tags: {
    all: ['tags'] as const,
    list: (filters?: Filters) => ['tags', 'list', filters ?? {}] as const,
  },
  plugins: {
    all: ['plugins'] as const,
    config: (pluginName: string) => ['plugins', pluginName, 'config'] as const,
  },
  photos: {
    all: ['photos'] as const,
    list: (filters?: Filters) => ['photos', 'list', filters ?? {}] as const,
  },
  files: {
    all: ['files'] as const,
    list: (filters?: Filters) => ['files', 'list', filters ?? {}] as const,
    folders: (projectId?: string) => ['files', 'folders', projectId ?? null] as const,
    content: (url: string) => ['files', 'content', url] as const,
  },
  mailbox: {
    all: ['mailbox'] as const,
    /** Letters in a chat-participant character's Mail/ folder (Compose Mail dialog). */
    byCharacter: (chatId: string, characterId: string) =>
      ['mailbox', chatId, characterId] as const,
  },
  helpChat: {
    all: ['help-chat'] as const,
    entity: (apiUrl: string) => ['help-chat', 'entity', apiUrl] as const,
    eligibility: ['help-chat', 'eligibility'] as const,
    pastChats: ['help-chat', 'past-chats'] as const,
  },
  brahmaConsole: {
    all: ['brahma-console'] as const,
    entity: (apiUrl: string) => ['brahma-console', 'entity', apiUrl] as const,
    pastChats: ['brahma-console', 'past-chats'] as const,
  },
  home: {
    /** Home dashboard payload for the workspace home tab. */
    all: ['home'] as const,
  },
} as const
