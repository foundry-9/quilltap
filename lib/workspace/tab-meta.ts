/**
 * Default titles and icons per tab kind.
 *
 * Used by the reducer when it has to mint a tab on its own (the home fallback)
 * and by the provider's `openTab` convenience when a caller does not supply an
 * explicit title/icon. User-facing titles are in the house voice.
 *
 * @module lib/workspace/tab-meta
 */

import type { TabKind } from './types'

export interface TabMeta {
  title: string
  icon: string
}

/**
 * Per-kind defaults. Salon/terminal/document/settings/wardrobe titles are
 * usually overridden by the opener with a chat- or target-specific label; the
 * defaults here are the fallbacks.
 */
// Icon values must be canonical names from the icon registry
// (`components/ui/icons/icon-registry.ts`).
export const DEFAULT_TAB_META: Record<TabKind, TabMeta> = {
  home: { title: 'Home', icon: 'sparkles' },
  salon: { title: 'Conversation', icon: 'chat' },
  'salon-list': { title: 'Chats', icon: 'chat' },
  terminal: { title: 'Terminal', icon: 'code' },
  document: { title: 'Document', icon: 'file' },
  aurora: { title: 'Characters', icon: 'characters' },
  prospero: { title: 'Projects', icon: 'projects' },
  scriptorium: { title: 'The Scriptorium', icon: 'scriptorium' },
  settings: { title: 'The Foundry', icon: 'settings' },
  files: { title: 'Files', icon: 'files' },
  photos: { title: 'My Photos', icon: 'photos' },
  scenarios: { title: 'Scenarios', icon: 'scenarios' },
  brahma: { title: 'Brahma Console', icon: 'brahma-console' },
  wardrobe: { title: 'The Wardrobe', icon: 'wardrobe' },
  profile: { title: 'Profile', icon: 'profile' },
  about: { title: 'About', icon: 'info' },
  'generate-image': { title: 'Generate Image', icon: 'image' },
  'document-standalone': { title: 'Document', icon: 'file' },
  'character-new': { title: 'New Character', icon: 'user-plus' },
  'character-edit': { title: 'Edit Character', icon: 'pencil' },
  'character-view': { title: 'Character', icon: 'characters' },
  'settings-wizard': { title: 'Provider Setup', icon: 'wand' },
  'custom-tools': { title: "Pascal's Workbench", icon: 'wrench' },
}

export function defaultTabMeta(kind: TabKind): TabMeta {
  return DEFAULT_TAB_META[kind]
}
