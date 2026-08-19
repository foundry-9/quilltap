/**
 * Provider Base Classes
 *
 * Reusable base classes for building LLM provider plugins.
 * External plugins can extend these classes to create custom providers
 * with minimal boilerplate.
 *
 * @packageDocumentation
 */

export {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderConfig,
} from './openai-compatible';

export {
  applyProfileParameters,
  type ProfileParamNormalizer,
} from './profile-parameters';

export { collapseLeadingSystemMessages } from './system-messages';

export {
  DEFAULT_REQUEST_TIMEOUT_MS,
  resolveRequestTimeoutMs,
  buildSdkRequestOptions,
  buildSdkClientOptions,
  buildRequestAbortSignal,
} from './request-budget';
