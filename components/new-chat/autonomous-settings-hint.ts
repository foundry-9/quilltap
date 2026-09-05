/**
 * The user-level autonomous-room defaults, shaped for the New Room form.
 *
 * `chat_settings.autonomousRoomSettings` speaks milliseconds; the
 * {@link AutonomousRoomCard} speaks hours and only wants three fields. Every
 * surface that seeds the card from the settings row — the New Chat modal, the
 * standalone `/salon/new` page, the Edit Enclave modal, and `useNewChat`'s
 * seed — reads through this one projection.
 *
 * @module components/new-chat/autonomous-settings-hint
 */

import type { ChatSettings } from '@/components/settings/chat-settings/types'

const MS_PER_HOUR = 60 * 60 * 1000

/** What the form needs to know about the user's autonomous-room defaults. */
export interface AutonomousSettingsHint {
  visibilityDefault?: 'owner_only' | 'household' | 'open'
  destructiveToolPolicy?: 'always_refuse' | 'opt_in_per_room'
  /** The default catch-up window in whole hours; absent when unset or non-positive. */
  defaultFreshnessHours?: number
}

/**
 * Project the settings row onto the hint, or `undefined` when the row has no
 * autonomous-room block at all (a fresh instance).
 */
export function toAutonomousSettingsHint(
  settings: Pick<ChatSettings, 'autonomousRoomSettings'> | null | undefined,
): AutonomousSettingsHint | undefined {
  const ar = settings?.autonomousRoomSettings
  if (!ar) return undefined
  return {
    visibilityDefault: ar.visibilityDefault,
    destructiveToolPolicy: ar.destructiveToolPolicy,
    defaultFreshnessHours:
      typeof ar.defaultFreshnessWindowMs === 'number' && ar.defaultFreshnessWindowMs > 0
        ? Math.round(ar.defaultFreshnessWindowMs / MS_PER_HOUR)
        : undefined,
  }
}
