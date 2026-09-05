'use client'

import { queryKeys } from '@/lib/query/keys'
import { BoundedNumberInstanceSetting } from './components/BoundedNumberInstanceSetting'

const DEFAULT_MAX_AGENT_TURNS = 50
const MIN_TURNS = 5
const MAX_TURNS = 200

/**
 * The instance-wide Brahma Console agent-turn budget
 * (`instance_settings['brahmaConsole']`). Read at the start of every Console
 * query — and every one-shot `@Brahma` consultation — to cap how many tool-use
 * rounds the engine may take before it must answer. Global only; there is no
 * per-conversation dial.
 */
export function BrahmaConsoleSettings() {
  return (
    <BoundedNumberInstanceSetting
      queryKey={queryKeys.settings.brahmaConsole}
      url="/api/v1/settings/brahma-console"
      field="maxAgentTurns"
      defaultValue={DEFAULT_MAX_AGENT_TURNS}
      min={MIN_TURNS}
      max={MAX_TURNS}
      loadFailureMessage="Failed to load Brahma Console settings"
      saveFailureMessage="Failed to save Brahma Console settings"
      successToast="Console turn budget saved"
      inputId="brahma-max-turns"
      loadingText={<>Loading Console settings&hellip;</>}
      intro={
        <>
          Put a knotty question to the Brahma Console &mdash; &ldquo;where in the ledgers is such-and-such
          buried?&rdquo; &mdash; and it sets about the search one step at a time: a query here, a document
          read there, each a <em>turn</em> at the telegraph key. This dial sets how many turns it may
          take on a single question before it must down tools and tell you what it has found so far.
          Raise it when the Console keeps running out of rope mid-investigation; the higher ceiling
          costs nothing on questions it answers quickly.
        </>
      }
      label="Let the Console take up to"
      unit="turns"
      footnote={
        <>
          A generous budget only helps a Console that is making headway. Should it fall to asking the
          same question twice over, Quilltap notices the engine chasing its own tail and calls a halt
          regardless of this figure &mdash; so raising the ceiling never lets a truly stuck search run
          on and on.
        </>
      }
    />
  )
}
