/**
 * Taboo Settings Routes (v1)
 *
 * GET /api/v1/settings/taboo - Read the instance-wide forbidden-phrase list
 * PUT /api/v1/settings/taboo - Replace the forbidden-phrase list
 *
 * Instance-wide setting (`instance_settings['taboo']`), not a `chat_settings`
 * column — same class as the data-retention window. Read once per turn on the
 * conversational path (`lib/chat/context-manager.ts`) and rendered into the
 * cacheable prefix of every character's system prompt.
 *
 * PUT merges the body over the stored value, so a partial body ({} in
 * particular) never wipes the list. The response echoes what was actually
 * stored — `setTabooSettings` trims, drops empties, and dedupes
 * case-insensitively — so the UI's local cache matches the database.
 */

import { createInstanceSettingHandlers } from '@/lib/api/instance-setting-handlers';
import {
  getTabooSettings,
  setTabooSettings,
  TabooSettingsSchema,
} from '@/lib/instance-settings';

export const { GET, PUT } = createInstanceSettingHandlers({
  label: 'taboo',
  get: getTabooSettings,
  set: setTabooSettings,
  schema: TabooSettingsSchema,
  logSummary: (settings) => ({ phraseCount: settings.phrases.length }),
});
