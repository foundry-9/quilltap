/**
 * Help Guide Categories
 *
 * Static configuration for the browseable Guide tab in the Help dialog.
 * Maps help documents to navigable categories and provides URL-based
 * context matching for auto-expanding the relevant category.
 */

interface HelpCategory {
  id: string;
  label: string;
  documents: string[];
}

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    documents: ['startup-wizard', 'setup-wizard', 'homepage'],
  },
  {
    id: 'characters',
    label: 'Characters (Aurora)',
    documents: [
      'characters',
      'character-creation',
      'character-editing',
      'character-system-prompts',
      'character-management',
      'character-organization',
      'character-import-export',
      'ai-character-import',
      'character-optimizer',
    ],
  },
  {
    id: 'chats',
    label: 'Chats (The Salon)',
    documents: [
      'chats',
      'chat-multi-character',
      'chat-turn-manager',
      'chat-participants',
      'chat-message-actions',
      'chat-state',
      'chat-settings',
      'math-notation',
      'answer-confirmation',
      'templates-in-chats',
      'agent-mode',
      'rng-tool',
      'run-tool',
      'shell-tools',
      'brahma-console',
    ],
  },
  {
    id: 'projects',
    label: 'Projects (Prospero)',
    documents: ['projects', 'project-chats', 'project-files', 'project-characters', 'project-settings'],
  },
  {
    id: 'files',
    label: 'Files',
    documents: ['files', 'file-uploads', 'file-organization', 'file-search-preview', 'files-with-ai'],
  },
  {
    id: 'memory-search',
    label: 'Commonplace Book',
    documents: ['embedding-profiles', 'memory-housekeeping', 'search'],
  },
  {
    id: 'ai-providers',
    label: 'AI Providers & Connections',
    documents: [
      'api-keys-settings',
      'connection-profiles',
      'image-generation-profiles',
      'tools',
      'tools-settings',
      'tools-usage',
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance & Themes',
    documents: [
      'appearance-settings',
      'themes',
      'theme-quick-switcher',
      'tags',
      'tags-customization',
      'quick-hide',
      'width-toggle',
      'sidebar',
    ],
  },
  {
    id: 'settings-system',
    label: 'Settings & System',
    documents: [
      'settings',
      'prompts',
      'roleplay-templates',
      'roleplay-templates-settings',
      'plugins',
      'database-protection',
      'data-directory',
      'system-tools',
      'system-backup-restore',
      'system-import-export',
      'system-llm-logs',
      'system-tasks-queue',
      'the-almanack',
      'system-capabilities-report',
      'system-delete-data',
    ],
  },
  {
    id: 'account',
    label: 'Your Account',
    documents: ['profile', 'profile-settings', 'profile-avatar', 'account-information'],
  },
  {
    id: 'content-routing',
    label: 'Content Routing (The Concierge)',
    documents: ['dangerous-content', 'story-backgrounds', 'scene-state-tracker'],
  },
];

export const URL_CATEGORY_MAP: readonly { pattern: string; categoryId: string }[] = [
  { pattern: '/settings?tab=system', categoryId: 'settings-system' },
  { pattern: '/settings?tab=templates', categoryId: 'settings-system' },
  { pattern: '/settings?tab=images', categoryId: 'content-routing' },
  { pattern: '/settings?tab=memory', categoryId: 'memory-search' },
  { pattern: '/settings?tab=appearance', categoryId: 'appearance' },
  { pattern: '/settings?tab=chat', categoryId: 'chats' },
  { pattern: '/settings?tab=providers', categoryId: 'ai-providers' },
  { pattern: '/settings', categoryId: 'settings-system' },
  { pattern: '/profile', categoryId: 'account' },
  { pattern: '/prospero', categoryId: 'projects' },
  { pattern: '/salon', categoryId: 'chats' },
  { pattern: '/aurora', categoryId: 'characters' },
  { pattern: '/files', categoryId: 'files' },
  { pattern: '/setup', categoryId: 'getting-started' },
  { pattern: '/', categoryId: 'getting-started' },
];

export function getCategoryForUrl(pathname: string): string | null {
  // Find all matching patterns
  const matches = URL_CATEGORY_MAP.filter((entry) => {
    const patternPath = entry.pattern.split('?')[0];

    // Exact root match: '/' only matches '/'
    if (patternPath === '/') {
      const inputPath = pathname.split('?')[0];
      return inputPath === '/';
    }

    // Prefix match for other paths (e.g., /aurora matches /aurora/123/edit)
    const inputPath = pathname.split('?')[0];
    if (!inputPath.startsWith(patternPath)) {
      return false;
    }

    // If pattern has a query parameter, parse and match
    if (entry.pattern.includes('?')) {
      const patternQuery = entry.pattern.split('?')[1];
      const [key, value] = patternQuery.split('=');

      const urlParts = pathname.split('?');
      if (urlParts.length < 2) {
        return false;
      }

      const queryParams = new URLSearchParams(urlParts[1]);
      return queryParams.get(key) === value;
    }

    return true;
  });

  if (matches.length === 0) {
    return null;
  }

  // Return the most specific match (longest pattern)
  const mostSpecific = matches.reduce((prev, current) => {
    return current.pattern.length > prev.pattern.length ? current : prev;
  });

  return mostSpecific.categoryId;
}

export const EXCLUDED_DOCUMENTS: readonly string[] = ['help-chat'];
