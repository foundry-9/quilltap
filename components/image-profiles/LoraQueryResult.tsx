/**
 * The read-out for a queried LoRA source.
 *
 * Shows what HuggingFace declares about a repository and **passes no judgement
 * on whether it will work here**. Which adapters suit which provider model is
 * a question of matching NanoGPT's model ids against HuggingFace's
 * `base_model` strings — two naming conventions that answer to nobody — so the
 * facts are laid out and the reader draws the conclusion. The card itself is
 * always one click away for anyone who wants the whole story.
 *
 * The one thing this panel offers to *do* is fill in the trigger phrase, since
 * `instance_prompt` is exactly that field and is otherwise buried in a model
 * card. It never touches the Source field.
 */

'use client'

import type { HuggingFaceLookupResult } from '@/lib/image-gen/huggingface-lookup'

interface LoraQueryResultProps {
  result: HuggingFaceLookupResult
  /** Whether the selected model has anywhere to put a token for gated weights. */
  supportsPrivateWeightsToken: boolean
  /** The row's current trigger phrase, so an identical one is not re-offered. */
  currentTriggerPhrase: string
  onUseTriggerPhrase: (phrase: string) => void
}

/** A link out to the model card, opened away from the half-filled form. */
function CardLink({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="qt-link text-xs">
      {label} ↗
    </a>
  )
}

/** What went wrong, in terms the reader can act on. */
function failureCopy(result: Extract<HuggingFaceLookupResult, { ok: false }>): string {
  switch (result.reason) {
    case 'not-a-repo-id':
      return 'That source carries no HuggingFace address, so there is no registry to consult. Weights hosted elsewhere must be taken on trust.'
    case 'missing-or-private':
      return 'HuggingFace declines to confirm this one. Either no such repository exists, or it is private and you are not on the list — the registry answers both cases identically, and does so on purpose. Check the spelling first; if it is a private or gated repository, a HuggingFace token will settle the question.'
    case 'not-found':
      return 'No such repository. Your token was accepted, so this is a genuine absence rather than a door held shut.'
    case 'rate-limited':
      return 'HuggingFace begs a moment’s patience — too many enquiries too quickly. Try again shortly.'
    case 'timeout':
      return 'HuggingFace did not answer within ten seconds. The registry may be having a trying afternoon.'
    case 'network':
      return 'HuggingFace could not be reached at all. Check that this machine can see the outside world.'
    default:
      return 'HuggingFace answered, but not in any language this establishment recognises.'
  }
}

/** How the repository describes its own nature. */
function kindCopy(facts: Extract<HuggingFaceLookupResult, { ok: true }>['facts']): string {
  if (facts.isLora) return 'Tagged a LoRA adapter.'
  if (facts.isAdapter) return 'Tagged an adapter, though not specifically a LoRA.'
  return 'Not tagged as an adapter at all — this may be a full checkpoint rather than something to layer on top of one.'
}

export function LoraQueryResult({
  result,
  supportsPrivateWeightsToken,
  currentTriggerPhrase,
  onUseTriggerPhrase,
}: LoraQueryResultProps) {
  if (!result.ok) {
    return (
      <div className="rounded border qt-border-warning qt-bg-surface-alt p-3 space-y-2">
        <p className="qt-text-label-xs">
          {result.repoId ? `HuggingFace — ${result.repoId}` : 'HuggingFace'}
        </p>
        <p className="qt-text-xs">{failureCopy(result)}</p>
        {result.url && <CardLink url={result.url} label="Try the page yourself" />}
      </div>
    )
  }

  const { facts } = result
  const phraseOnOffer =
    facts.triggerPhrase && facts.triggerPhrase !== currentTriggerPhrase.trim() ? facts.triggerPhrase : null

  return (
    <div className="rounded border qt-border-default qt-bg-surface-alt p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="qt-text-label-xs">HuggingFace says</p>
        <CardLink url={facts.url} label={facts.repoId} />
      </div>

      <dl className="space-y-1 qt-text-xs">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 qt-text-secondary">Trained on</dt>
          <dd>
            {facts.baseModels.length > 0
              ? facts.baseModels.join(', ')
              : 'The card names no base model. Whether it suits your chosen model is a matter for the model card.'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 qt-text-secondary">Nature</dt>
          <dd>{kindCopy(facts)}</dd>
        </div>
        {facts.pipelineTag && (
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 qt-text-secondary">Pipeline</dt>
            <dd>{facts.pipelineTag}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 qt-text-secondary">Weights</dt>
          <dd>
            {facts.weightFiles.length === 0 ? (
              <span className="qt-text-warning">
                No .safetensors file in the repository — the weights may live elsewhere, or under another name.
              </span>
            ) : facts.weightFiles.length === 1 ? (
              facts.weightFiles[0]
            ) : (
              <>
                {facts.weightFiles.join(', ')}
                <span className="qt-text-warning">
                  {' '}
                  — more than one, so a bare owner/name leaves the choice to your provider. Name the file
                  directly if you have a preference.
                </span>
              </>
            )}
          </dd>
        </div>
        {facts.gated !== false && (
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 qt-text-secondary">Gated</dt>
            <dd className="qt-text-warning">
              This repository is gated ({facts.gated}); the weights want a HuggingFace token.{' '}
              {supportsPrivateWeightsToken
                ? 'The selected model accepts one — see the HuggingFace Token field in the options above.'
                : 'The selected model has nowhere to put one, so these weights are unlikely to load.'}
            </dd>
          </div>
        )}
        {(facts.downloads !== null || facts.likes !== null) && (
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 qt-text-secondary">Standing</dt>
            <dd>
              {[
                facts.likes !== null ? `${facts.likes.toLocaleString()} likes` : null,
                facts.downloads !== null ? `${facts.downloads.toLocaleString()} downloads` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </dd>
          </div>
        )}
      </dl>

      {facts.triggerPhrase && (
        <div className="flex flex-wrap items-center gap-2 border-t qt-border-default pt-2">
          <span className="qt-text-xs">
            Declared trigger phrase: <code>{facts.triggerPhrase}</code>
          </span>
          {phraseOnOffer ? (
            <button
              type="button"
              onClick={() => onUseTriggerPhrase(phraseOnOffer)}
              className="qt-button px-2 py-1 qt-button-secondary text-xs"
            >
              Use it
            </button>
          ) : (
            <span className="qt-text-xs qt-text-success">— already in place.</span>
          )}
        </div>
      )}

      <p className="qt-text-xs qt-text-secondary">
        This is what the registry declares, and nothing more. Whether these weights agree with your chosen model
        is between you and your provider — read the card if in doubt.
      </p>
    </div>
  )
}

export default LoraQueryResult
