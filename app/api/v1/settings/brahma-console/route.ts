/**
 * Brahma Console Settings Routes (v1)
 *
 * GET /api/v1/settings/brahma-console - Read the instance-wide Console settings
 * PUT /api/v1/settings/brahma-console - Update the Console settings
 *
 * Instance-wide setting (`instance_settings['brahmaConsole']`), not a
 * `chat_settings` column — same class as the data-retention knob. Holds the
 * agent-turn budget the streaming orchestrator and the one-shot `@Brahma` path
 * read via `resolveBrahmaMaxAgentTurns`.
 */

import { createInstanceSettingHandlers } from '@/lib/api/instance-setting-handlers';
import {
  getBrahmaConsoleSettings,
  setBrahmaConsoleSettings,
  BrahmaConsoleSettingsSchema,
} from '@/lib/instance-settings';

export const { GET, PUT } = createInstanceSettingHandlers({
  label: 'brahma-console',
  get: getBrahmaConsoleSettings,
  set: setBrahmaConsoleSettings,
  schema: BrahmaConsoleSettingsSchema,
  logSummary: (settings) => ({ maxAgentTurns: settings.maxAgentTurns }),
});
