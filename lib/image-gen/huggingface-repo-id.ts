/**
 * Reading a HuggingFace repository id out of a LoRA source.
 *
 * Split out of `huggingface-lookup` for one reason: the LoRA editor needs to
 * know whether a source is even askable-about before it offers a Query button,
 * and that decision runs in the browser. This module is therefore **pure and
 * dependency-free** — no logger, no fetch, nothing that would drag the server's
 * world into the client bundle.
 *
 * @module lib/image-gen/huggingface-repo-id
 */

const HUGGINGFACE_SITE_BASE = 'https://huggingface.co';

/**
 * Owner and repository name as HuggingFace spells them: letters, digits,
 * hyphen, underscore and dot, in exactly two segments.
 */
const REPO_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The `owner/name` inside a LoRA source, or null when there isn't one.
 *
 * Accepts a bare repo id and any huggingface.co URL — including the
 * `/resolve/main/weights.safetensors` form, which is how the fal-hosted models
 * usually want their adapters named. A weights URL on some other host has no
 * repository behind it and yields null, which is the editor's signal not to
 * offer the button at all.
 */
export function extractHuggingFaceRepoId(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (!/(^|\.)huggingface\.co$/i.test(parsed.hostname)) {
      return null;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const candidate = `${segments[0]}/${segments[1]}`;
    return REPO_ID_PATTERN.test(candidate) ? candidate : null;
  }

  return REPO_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** The public model-card URL for a repository id. */
export function huggingFaceCardUrl(repoId: string): string {
  return `${HUGGINGFACE_SITE_BASE}/${repoId}`;
}
