'use client'

import { queryKeys } from '@/lib/query/keys'
import { BoundedNumberInstanceSetting } from './components/BoundedNumberInstanceSetting'

const DEFAULT_STALE_CHAT_DAYS = 30
const MIN_DAYS = 1
const MAX_DAYS = 3650

/**
 * The instance-wide stale-chat retention window
 * (`instance_settings['dataRetention']`). Read daily by the maintenance sweep
 * to decide when a quiet conversation's regenerable working data (compression
 * caches, rendered markdown, model scratch-work, cold-tier chunk embeddings)
 * is tidied away. Global only — there is deliberately no per-chat control.
 */
export function DataRetentionSettings() {
  return (
    <BoundedNumberInstanceSetting
      queryKey={queryKeys.settings.dataRetention}
      url="/api/v1/settings/data-retention"
      field="staleChatDays"
      defaultValue={DEFAULT_STALE_CHAT_DAYS}
      min={MIN_DAYS}
      max={MAX_DAYS}
      loadFailureMessage="Failed to load data-retention settings"
      saveFailureMessage="Failed to save data-retention settings"
      successToast="Retention window saved"
      inputId="stale-chat-days"
      loadingText={<>Loading retention settings&hellip;</>}
      intro={
        <>
          A conversation left to gather dust accumulates a surprising amount of behind-the-scenes
          paraphernalia — compression caches, pre-rendered pages, the models&rsquo; own scratch-work.
          Once a chat has gone this many days without anyone actually speaking in it, Quilltap&rsquo;s
          nightly housekeeping quietly tidies that working data away. The conversation itself — every
          word anyone said — remains exactly as you left it, and the tidied bits are rebuilt the
          moment you take up the thread again.
        </>
      }
      label={<>Keep inactive chats&rsquo; working data for</>}
      unit="days"
      footnote={
        <>
          Applies to the whole establishment — there is no per-chat dial. Announcements from the
          Staff don&rsquo;t count as activity; only you and your characters do.
        </>
      }
    />
  )
}
