/**
 * Image Provider — Shape 2: Text -> Image
 *
 * Send instructions (a prompt) to an image generation model,
 * receive one or more generated images.
 *
 * @module @quilltap/plugin-types/providers/image
 */

/**
 * Semantic image shape intent.
 *
 * Callers and the `generate_image` tool speak orientation; the host resolver
 * maps it onto whatever each provider actually supports (a concrete size, an
 * aspect ratio, or prompt wording). This is the provider-agnostic core of the
 * orientation-gating design.
 */
export type ImageOrientation = 'portrait' | 'landscape' | 'square';

/**
 * One LoRA (low-rank adaptation) adapter riding an image request.
 *
 * Provider-neutral by design: the host stores and edits this shape, and each
 * plugin translates it into whatever its own API calls the same idea —
 * NanoGPT's indexed `lora_url_N`/`lora_scale_N` pairs, fal's
 * `loras: [{path, scale}]` array, a ComfyUI `LoraLoader` chain, or a
 * `<lora:name:weight>` prompt tag. A plugin that declares no
 * {@link ImageLoraSupport} never receives this shape at all.
 */
export interface ImageLoraSpec {
  /**
   * URL to weights (typically `.safetensors`), an `owner/repo` reference, or
   * a provider-scoped identifier — the plugin decides what it accepts, and
   * says so through `ImageLoraSupport.sourceKinds`.
   */
  source: string;
  /** Strength/scale. Omitted means "the provider's own default". */
  scale?: number;
  /**
   * Optional trigger phrase injected into the prompt when this LoRA rides a
   * request. Reuses the host's existing style-trigger-phrase plumbing, so a
   * LoRA that needs its magic word gets it without the plugin touching the
   * prompt.
   */
  triggerPhrase?: string;
  /** Display label for the editor UI; never sent on the wire. */
  label?: string;
}

/**
 * Image generation parameters
 */
export interface ImageGenParams {
  /** Image generation prompt */
  prompt: string;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Model identifier */
  model?: string;
  /** Image size (e.g., '1024x1024') */
  size?: string;
  /** Aspect ratio (e.g., '16:9') */
  aspectRatio?: string;
  /**
   * Semantic shape intent. When set, the host resolver maps it onto this
   * provider's own supported size / aspect ratio / prompt wording before the
   * call, writing `size` or `aspectRatio` (or appending to `prompt`) as needed.
   */
  orientation?: ImageOrientation;
  /** Image quality */
  quality?: 'standard' | 'hd';
  /** Image style */
  style?: 'vivid' | 'natural';
  /** Number of images to generate */
  n?: number;
  /** Response format */
  responseFormat?: 'url' | 'b64_json';
  /** Seed for reproducibility */
  seed?: number;
  /** Guidance scale for diffusion models */
  guidanceScale?: number;
  /** Inference steps for diffusion models */
  steps?: number;
  /**
   * LoRA adapters to apply, in the order the user arranged them. The host only
   * sets this for providers that declared `loraSupport` for the selected
   * model, and has already capped the list at the declared `maxLoras`; a
   * plugin that declares nothing never sees the key.
   */
  loras?: ImageLoraSpec[];
  /**
   * The profile's residual `parameters` bag, minus the keys the host owns
   * (`size`, `quality`, `loras`, …). Mirrors `LLMParams.profileParameters`:
   * the plugin — not the host — decides which of these keys reach the wire,
   * so schema-driven per-model options (`num_inference_steps`,
   * `guidance_scale`, `hf_api_token`, …) travel without the host enumerating
   * them.
   */
  profileParameters?: Record<string, unknown>;
}

/**
 * Generated image result
 */
export interface GeneratedImage {
  /** Base64 encoded image data */
  data?: string;
  /** URL to the generated image */
  url?: string;
  /** Deprecated: use 'data' instead */
  b64Json?: string;
  /** Image MIME type */
  mimeType?: string;
  /** Revised prompt (some providers modify the prompt) */
  revisedPrompt?: string;
  /** Seed used for generation */
  seed?: number;
}

/**
 * Image generation response
 */
export interface ImageGenResponse {
  /** Array of generated images */
  images: GeneratedImage[];
  /** Provider-specific raw response */
  raw?: unknown;
}

/**
 * Image generation provider interface — Shape 2: Text -> Image
 *
 * Sends a text prompt to an image generation model and receives
 * one or more generated images.
 */
export interface ImageProvider {
  /** Provider identifier */
  readonly provider: string;
  /** Models supported by this provider */
  readonly supportedModels: string[];

  /**
   * Generate an image from a text prompt
   */
  generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>;

  /**
   * Validate an API key
   */
  validateApiKey(apiKey: string): Promise<boolean>;

  /**
   * Get available models
   */
  getAvailableModels(apiKey?: string): Promise<string[]>;
}
