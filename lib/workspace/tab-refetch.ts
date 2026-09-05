/**
 * Tab re-activation → TanStack Query invalidation.
 *
 * The workspace keeps every open tab's view mounted (hidden via CSS, never
 * unmounted), so a view's queries never remount — and without help, whatever a
 * tab showed when you left is what it still shows when you come back. This map
 * is the single source of truth for which query-key prefixes go stale when a
 * tab is re-activated (navigated back to). `TabView` invalidates them on every
 * hidden→visible transition; TanStack Query then refetches every mounted
 * observer, so sibling tabs sharing a prefix come back fresh too.
 *
 * Deliberately left empty:
 *  - `salon` / `terminal` / `document` — live surfaces fed by SSE/PTY; a
 *    blanket invalidation risks disturbing an in-flight stream (the Salon's
 *    streaming transport is out of bounds per the TanStack migration spec).
 *  - `character-edit`, `character-new`, `document-standalone`,
 *    `settings-wizard` — editors holding unsaved user state; refreshing under
 *    the user's feet could clobber work in progress.
 *  - `brahma` — a console chat, live by nature.
 *  - `about` — static.
 *  - `scenarios` / `wardrobe` — their views fetch outside TanStack Query and
 *    re-run their own loads via `useOnTabActivated`.
 *
 * Views that still fetch outside TanStack Query (Prospero, the Scriptorium,
 * Photos, the character detail, FileBrowser, …) additionally re-run their own
 * loads via `useOnTabActivated` (see
 * `components/workspace/workspace-tab-context.tsx`); the entries here cover
 * their TanStack-side reads and keep working as those views migrate.
 *
 * @module lib/workspace/tab-refetch
 */

import { queryKeys } from '@/lib/query/keys'
import { queryKeysForTopic } from '@/lib/realtime/topic-map'
import type { CharacterViewTabPayload, WorkspaceTab } from './types'

type QueryKeyPrefix = readonly unknown[]

/**
 * The query-key prefixes to invalidate when `tab` is re-activated. Empty for
 * tabs that must not be blanket-refreshed (live streams, editors) — see the
 * module doc for the roster.
 */
export function tabActivationQueryKeys(tab: WorkspaceTab): QueryKeyPrefix[] {
  switch (tab.kind) {
    case 'home':
      // The dashboard payload plus the entities it summarizes, so list tabs
      // sharing those prefixes come back fresh alongside it.
      return [
        queryKeys.home.all,
        queryKeys.chats.lists,
        queryKeys.projects.all,
        queryKeys.characters.all,
      ]
    case 'salon-list':
      return [
        queryKeys.chats.lists,
        queryKeys.characters.all,
        queryKeys.connectionProfiles.all,
        queryKeys.system.autonomousRooms,
        queryKeys.settings.chat,
      ]
    case 'aurora':
      return [queryKeys.characters.all, queryKeys.groups.all, queryKeys.tags.all]
    case 'character-view': {
      const payload = tab.payload as CharacterViewTabPayload | undefined
      if (!payload?.characterId) return []
      // The realtime topic map already owns the row-scoped character keys
      // (detail/prompts/photos); reuse it rather than restating the triple.
      return [...queryKeysForTopic('characters', payload.characterId)]
    }
    case 'prospero':
      return [queryKeys.projects.all]
    case 'scriptorium':
      return [queryKeys.mountPoints.all]
    case 'files':
      return [queryKeys.files.all]
    case 'photos':
      return [queryKeys.photos.all]
    case 'generate-image':
      return [queryKeys.characters.all, queryKeys.imageProfiles.all]
    case 'custom-tools':
      return [queryKeys.customTools.all]
    case 'profile':
      return [queryKeys.userProfile.detail]
    case 'settings':
      return [
        queryKeys.settings.chat,
        queryKeys.settings.textReplacements,
        queryKeys.settings.generalState,
        queryKeys.settings.taboo,
        queryKeys.connectionProfiles.all,
        queryKeys.embeddingProfiles.all,
        queryKeys.imageProfiles.all,
        queryKeys.providers.all,
        queryKeys.apiKeys.all,
        queryKeys.roleplayTemplates.all,
        queryKeys.plugins.all,
      ]
    default:
      return []
  }
}
