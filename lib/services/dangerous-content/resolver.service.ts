/**
 * Dangerous Content Settings Resolver Service
 *
 * Resolves the effective dangerous content settings.
 * Currently global-only (from ChatSettings). Ready for future per-chat/project cascade.
 *
 * Follows the same resolver pattern as agent-mode-resolver.service.ts.
 */

import type { ChatSettings } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import { isModerationExemptChatType } from '@/lib/schemas/chat.types'
import { getConciergeState, type ConciergeOverrideValue } from './chat-override'

/**
 * Resolved dangerous content settings
 */
export interface ResolvedDangerousContentSettings {
  /** The effective settings */
  settings: DangerousContentSettings
  /** Where the settings came from */
  source: 'global' | 'default' | 'chat-vouched' | 'chat-uncensored' | 'chat-type-exempt'
}

/**
 * Default dangerous content settings when not configured
 */
export const DEFAULT_DANGEROUS_CONTENT_SETTINGS: DangerousContentSettings = {
  mode: 'OFF',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
}

/**
 * Settings forced when the operator has vouched a chat safe. Everything the
 * Concierge would normally do is disabled, while still returning a concrete
 * `DangerousContentSettings` so callers don't have to special-case the shape.
 * Deliberately carries no uncensored profile IDs — a vouched-safe chat rides
 * the ordinary providers.
 */
export const VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS: DangerousContentSettings = {
  mode: 'OFF',
  threshold: 1.0,
  scanTextChat: false,
  scanImagePrompts: false,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: false,
}

/**
 * Resolve the effective dangerous content settings.
 *
 * When `chat` is supplied and carries an operator override, the returned
 * settings reflect it regardless of the global setting. That keeps the
 * override decision in one place: callers that already gate behavior on
 * `dangerSettings.mode` pick up the override for free.
 *
 *   - Vouched Safe collapses to `mode: 'OFF'` with every scan disabled.
 *   - Uncensored spreads the *global* settings (so the configured uncensored
 *     profile IDs ride through) and forces `mode: 'AUTO_ROUTE'` with every
 *     scan disabled — the operator has already returned the verdict, so there
 *     is nothing left to classify. Forcing AUTO_ROUTE even under a global
 *     `OFF` is deliberate: asking for uncensored routing on one chat should
 *     not first require flipping a global switch. (Flagged, by contrast,
 *     continues to obey the global mode.)
 *
 * Otherwise, currently uses global ChatSettings only.
 * Future: cascade through Global -> Project -> Chat (like agent mode).
 *
 * @param globalSettings - The global chat settings (has dangerousContentSettings)
 * @param chat - Optional chat for per-chat override consideration
 */
export function resolveDangerousContentSettings(
  globalSettings: ChatSettings | null,
  chat?: { conciergeOverride?: ConciergeOverrideValue | null; chatType?: string | null } | null
): ResolvedDangerousContentSettings {
  // Help Chats and the Brahma Console are never moderated — the Concierge has
  // no standing on those surfaces at all, regardless of the global setting.
  if (chat && isModerationExemptChatType(chat.chatType)) {
    return {
      settings: VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS,
      source: 'chat-type-exempt',
    }
  }

  if (chat && getConciergeState(chat) === 'uncensored') {
    const global = globalSettings?.dangerousContentSettings ?? DEFAULT_DANGEROUS_CONTENT_SETTINGS
    return {
      settings: {
        ...global,                    // carries uncensoredImageProfileId / uncensoredTextProfileId
        mode: 'AUTO_ROUTE',           // the operator has already returned the verdict
        threshold: 1.0,               // nothing left to classify
        scanTextChat: false,
        scanImagePrompts: false,
        scanImageGeneration: false,
        showWarningBadges: false,
      },
      source: 'chat-uncensored',
    }
  }

  if (chat && getConciergeState(chat) === 'vouched') {
    return {
      settings: VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS,
      source: 'chat-vouched',
    }
  }

  if (globalSettings?.dangerousContentSettings) {
    return {
      settings: globalSettings.dangerousContentSettings,
      source: 'global',
    }
  }

  return {
    settings: DEFAULT_DANGEROUS_CONTENT_SETTINGS,
    source: 'default',
  }
}
