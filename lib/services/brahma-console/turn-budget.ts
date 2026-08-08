import { getBrahmaConsoleSettings } from '@/lib/instance-settings'

/**
 * Fallback agent-turn budget, used only when the instance setting can't be
 * read. Kept in step with `BrahmaConsoleSettingsSchema`'s default (50) and the
 * `DEFAULT_BRAHMA_CONSOLE_SETTINGS` object in `lib/instance-settings`.
 */
export const DEFAULT_BRAHMA_MAX_AGENT_TURNS = 50

/**
 * Resolve the Brahma Console's per-query agent-turn budget (Settings → Chat →
 * Brahma Console). Shared by both the streaming orchestrator and the one-shot
 * `@Brahma` path so they always agree. Never throws — falls back to the
 * documented default if the setting is unreadable.
 *
 * This is only the hard ceiling on tool-use rounds; the duplicate/stale-query
 * guard in the loop is independent and still stops a stuck loop well before it.
 */
export async function resolveBrahmaMaxAgentTurns(): Promise<number> {
  try {
    const settings = await getBrahmaConsoleSettings()
    return settings.maxAgentTurns ?? DEFAULT_BRAHMA_MAX_AGENT_TURNS
  } catch {
    return DEFAULT_BRAHMA_MAX_AGENT_TURNS
  }
}
