/**
 * HuggingFace repository lookup for LoRA sources.
 *
 * A LoRA row on an image profile is free text: the user types `owner/name` or
 * a weights URL, and it goes to the provider unexamined. This module is the
 * one place that asks HuggingFace what it knows about such a source, so the
 * editor can show the user the facts and let them draw their own conclusions.
 *
 * **It deliberately renders no verdict on compatibility.** Whether a given
 * adapter works with a given provider model would have to be inferred by
 * matching two independent naming conventions — NanoGPT's model ids against
 * HuggingFace's `base_model` strings — and neither owes us stability. A false
 * "this will not work" on an adapter that works is worse than silence, so this
 * reports what the repository declares and stops there.
 *
 * What it does answer is factual and durable: does the repository resolve, is
 * it gated, which weights files does it hold, what base model does its card
 * name, and what trigger phrase does it declare. That last one is the reason
 * the feature earns a button — `cardData.instance_prompt` is exactly the magic
 * word the LoRA row's Trigger Phrase field wants, and it is otherwise buried
 * in a model card the user has to go read.
 *
 * Network-touching and host-side only: the browser never calls HuggingFace
 * directly, so egress stays in one place and a token for gated weights can be
 * attached without ever reaching the page.
 *
 * @module lib/image-gen/huggingface-lookup
 */

import { logger } from '@/lib/logger';
import { extractHuggingFaceRepoId, huggingFaceCardUrl } from './huggingface-repo-id';

export { extractHuggingFaceRepoId, huggingFaceCardUrl };

/** Where the metadata comes from. */
const HUGGINGFACE_API_BASE = 'https://huggingface.co/api/models';

/** HuggingFace is not in the request path of anything; it gets ten seconds. */
const LOOKUP_TIMEOUT_MS = 10_000;

/** Why a lookup produced no facts. The UI owns the wording for each. */
export type HuggingFaceLookupFailure =
  | 'not-a-repo-id'
  | 'missing-or-private'
  | 'not-found'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'http';

/** What a repository declares about itself, as facts and nothing more. */
export interface HuggingFaceLoraFacts {
  /** The canonical `owner/name` that was actually queried. */
  repoId: string;
  /** The model card, for the user to go read. */
  url: string;
  /**
   * What the card says this was trained on — `cardData.base_model` merged
   * with any `base_model:adapter:…` tags, deduplicated, order preserved.
   */
  baseModels: string[];
  /** Whether HuggingFace tags this as an adapter rather than a checkpoint. */
  isAdapter: boolean;
  /** Whether the `lora` tag is present. */
  isLora: boolean;
  /** `text-to-image`, `image-to-image`, and so on. */
  pipelineTag: string | null;
  /**
   * `false`, or HuggingFace's gate mode (`auto` / `manual`). Anything but
   * `false` means the weights need a token — which only some provider models
   * have anywhere to put.
   */
  gated: string | false;
  /** `.safetensors` files in the repository. More than one means a choice. */
  weightFiles: string[];
  /** `cardData.instance_prompt` — the adapter's magic word, when declared. */
  triggerPhrase: string | null;
  downloads: number | null;
  likes: number | null;
  lastModified: string | null;
}

export type HuggingFaceLookupResult =
  | { ok: true; facts: HuggingFaceLoraFacts }
  | {
      ok: false;
      reason: HuggingFaceLookupFailure;
      /** The id that was attempted, when one could be made out. */
      repoId: string | null;
      /** The card URL, so "go look yourself" stays available even on failure. */
      url: string | null;
      /** Transport or status detail, for the log and for the curious. */
      detail?: string;
    };

/** `base_model` may be a string, a list, or absent. Normalise all three. */
function readCardBaseModels(cardData: Record<string, unknown> | undefined): string[] {
  const raw = cardData?.base_model;
  if (typeof raw === 'string') return raw.trim() ? [raw.trim()] : [];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim());
  }
  return [];
}

/** `instance_prompt` is nearly always a string; a list is tolerated. */
function readInstancePrompt(cardData: Record<string, unknown> | undefined): string | null {
  const raw = cardData?.instance_prompt;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    const first = raw.find((v): v is string => typeof v === 'string' && v.trim().length > 0);
    return first ? first.trim() : null;
  }
  return null;
}

/** Turn the API payload into the facts we are willing to stand behind. */
function readFacts(repoId: string, payload: Record<string, unknown>): HuggingFaceLoraFacts {
  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((t): t is string => typeof t === 'string')
    : [];
  const lowerTags = tags.map(t => t.toLowerCase());
  const cardData =
    typeof payload.cardData === 'object' && payload.cardData !== null && !Array.isArray(payload.cardData)
      ? (payload.cardData as Record<string, unknown>)
      : undefined;

  const adapterTargets = tags
    .filter(t => t.startsWith('base_model:adapter:'))
    .map(t => t.slice('base_model:adapter:'.length))
    .filter(Boolean);

  // The card's own declaration first, then the tags — the two usually agree,
  // and when they don't the card is the author's more deliberate statement.
  const baseModels: string[] = [];
  for (const candidate of [...readCardBaseModels(cardData), ...adapterTargets]) {
    if (!baseModels.includes(candidate)) baseModels.push(candidate);
  }

  const siblings = Array.isArray(payload.siblings) ? payload.siblings : [];
  const weightFiles = siblings
    .map(s =>
      typeof s === 'object' && s !== null && typeof (s as { rfilename?: unknown }).rfilename === 'string'
        ? (s as { rfilename: string }).rfilename
        : null
    )
    .filter((name): name is string => name !== null && name.endsWith('.safetensors'));

  const gatedRaw = payload.gated;

  return {
    repoId: typeof payload.id === 'string' ? payload.id : repoId,
    url: huggingFaceCardUrl(typeof payload.id === 'string' ? payload.id : repoId),
    baseModels,
    isAdapter: adapterTargets.length > 0,
    isLora: lowerTags.includes('lora'),
    pipelineTag: typeof payload.pipeline_tag === 'string' ? payload.pipeline_tag : null,
    gated: typeof gatedRaw === 'string' ? gatedRaw : false,
    weightFiles,
    triggerPhrase: readInstancePrompt(cardData),
    downloads: typeof payload.downloads === 'number' ? payload.downloads : null,
    likes: typeof payload.likes === 'number' ? payload.likes : null,
    lastModified: typeof payload.lastModified === 'string' ? payload.lastModified : null,
  };
}

/**
 * Ask HuggingFace what it knows about a LoRA source.
 *
 * `token` is the profile's `hf_api_token`, when one is configured — it widens
 * the lookup to private and gated repositories, and it is the reason this runs
 * host-side. It is never logged and never returned.
 *
 * **The 401 case is reported honestly as "missing or private".** HuggingFace
 * answers an unauthenticated request for a nonexistent repository and one for
 * a private repository identically — both 401, both
 * `"Invalid username or password."` — and deliberately so. Calling that
 * "doesn't exist" would be wrong exactly when it matters most, so the two stay
 * fused until a token is supplied and HuggingFace itself distinguishes them
 * with a 404.
 */
export async function lookupHuggingFaceLora(
  source: string,
  token?: string
): Promise<HuggingFaceLookupResult> {
  const repoId = extractHuggingFaceRepoId(source);
  if (!repoId) {
    logger.debug('[Image LoRA] Source carries no HuggingFace repository id; nothing to query', {
      sourceLength: source.trim().length,
    });
    return { ok: false, reason: 'not-a-repo-id', repoId: null, url: null };
  }

  const url = huggingFaceCardUrl(repoId);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  logger.debug('[Image LoRA] Querying HuggingFace for adapter metadata', {
    repoId,
    hasToken: Boolean(token),
  });

  let response: Response;
  try {
    response = await fetch(`${HUGGINGFACE_API_BASE}/${repoId}`, {
      headers,
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn('[Image LoRA] HuggingFace lookup could not complete', { repoId, timedOut, detail });
    return { ok: false, reason: timedOut ? 'timeout' : 'network', repoId, url, detail };
  }

  if (!response.ok) {
    // 401 fuses "no such repository" with "private and not yours"; 404 only
    // appears once a token has proved who is asking.
    const reason: HuggingFaceLookupFailure =
      response.status === 401 || response.status === 403
        ? 'missing-or-private'
        : response.status === 404
          ? 'not-found'
          : response.status === 429
            ? 'rate-limited'
            : 'http';
    logger.info('[Image LoRA] HuggingFace declined the lookup', {
      repoId,
      status: response.status,
      reason,
      hasToken: Boolean(token),
    });
    return { ok: false, reason, repoId, url, detail: `HTTP ${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn('[Image LoRA] HuggingFace answered with something that was not JSON', { repoId, detail });
    return { ok: false, reason: 'http', repoId, url, detail };
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    logger.warn('[Image LoRA] HuggingFace answered with an unexpected payload shape', { repoId });
    return { ok: false, reason: 'http', repoId, url, detail: 'Unexpected payload shape' };
  }

  const facts = readFacts(repoId, payload as Record<string, unknown>);
  logger.debug('[Image LoRA] HuggingFace answered', {
    repoId: facts.repoId,
    baseModels: facts.baseModels,
    isLora: facts.isLora,
    gated: facts.gated,
    weightFileCount: facts.weightFiles.length,
    hasTriggerPhrase: facts.triggerPhrase !== null,
  });

  return { ok: true, facts };
}
