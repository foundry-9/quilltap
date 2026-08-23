/**
 * Image transport capability — can this provider's plugin actually put image
 * bytes on the wire?
 *
 * This is a *different* question from "is this model vision-capable", and
 * conflating the two is what bug 91 was. A connection profile's
 * `supportsImageUpload` flag answers the model question: the operator ticks it
 * because `deepseek-v4-flash-vision-exp` really does read pictures. It says
 * nothing about whether the plugin routing to that model serialises an
 * `image_url` part — and three of ours don't (NanoGPT, DeepSeek and
 * OpenAI-Compatible all inherit a base that marks every attachment failed).
 *
 * When the two disagree, the old code took the profile's word for it: the
 * describe-fallback was suppressed *and* the plugin dropped the bytes, so the
 * model received nothing at all and nothing said so. Both halves have to
 * agree before raw bytes are worth sending.
 *
 * The plugin manifest is the source of truth. `lib/llm/attachment-support.ts`
 * keeps a client-safe mirror for UI queries; this module is server-only
 * because the provider registry pulls in server-only code.
 *
 * @module llm/image-transport
 */

import { getAttachmentSupport, isProviderRegistryInitialized } from '@/lib/plugins/provider-registry';
import { staticProviderCanTransportImages } from '@/lib/llm/attachment-support';

/**
 * True when the provider's plugin can serialise image attachments into its
 * request payload.
 *
 * Consults the live plugin registry first — a plugin declaring
 * `attachmentSupport.supportsAttachments` with at least one `image/*` MIME
 * type can transport images. Falls back to the client-safe static mirror when
 * the registry isn't up yet (startup, tests, the job child before it boots
 * plugins), and to `true` for a provider neither source knows, so a
 * third-party vision plugin isn't crippled by our ignorance of it.
 */
export function providerCanTransportImages(provider: string): boolean {
  if (isProviderRegistryInitialized()) {
    const support = getAttachmentSupport(provider.toUpperCase());
    if (support) {
      return (
        support.supportsAttachments === true &&
        (support.supportedMimeTypes ?? []).some(t => t.startsWith('image/'))
      );
    }
  }
  return staticProviderCanTransportImages(provider);
}
