/**
 * Static DeepSeek model catalog. Used by the plugin wrapper's
 * `getModelInfo()` and as a fallback list for `getAvailableModels()`
 * when the /models endpoint is unreachable.
 *
 * Both flagship models share a 1M-token context window and a 384K
 * max output. `deepseek-v4-flash` is the faster, cheaper tier;
 * `deepseek-v4-pro` is the higher-quality tier.
 *
 * Both are marked as reasoning **without being asked**. That was *observed*
 * on `deepseek-v4-flash`, whose profile carried `parameters: {}` and still
 * came back with `reasoning_content` (bug 85); `deepseek-v4-pro` is assumed to
 * match, which is the safe direction to be wrong in. `thinksByDefault` telling
 * the host so is what keeps the multi-character `[Name]` prefill off a profile
 * that would otherwise take a 400 reading *"The `reasoning_content` in the
 * thinking mode must be passed back to the API"*; being wrong the other way
 * costs only the weaker prose anchor on a model strong enough not to need it.
 * Setting `thinking` to `disabled` on the profile restores the prefill.
 */

import type { ModelInfo } from './types';

export const STATIC_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1048576,
    maxOutputTokens: 393216,
    supportsImages: false,
    supportsTools: true,
    supportsThinking: true,
    thinksByDefault: true,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    contextWindow: 1048576,
    maxOutputTokens: 393216,
    supportsImages: false,
    supportsTools: true,
    supportsThinking: true,
    thinksByDefault: true,
  },
];

export const STATIC_MODEL_IDS: string[] = STATIC_MODELS.map((m) => m.id);
