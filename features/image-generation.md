# Image Generation API Integration

## Research Summary

### Provider Capabilities

| Provider | Image Generation? | Model(s) | Endpoint | Response Format |
|----------|------------------|----------|----------|-----------------|
| **OpenAI** | Yes | `gpt-image-1`, `dall-e-3`, `dall-e-2` | `/v1/images/generations` | URL or base64 |
| **xAI (Grok)** | Yes | `grok-2-image` (`grok-2-image-1212`) | `/v1/images/generations` | URL or base64 (JPG) |
| **Google Gemini** | Yes | `gemini-2.5-flash-image`, `gemini-3-pro-image-preview`, `imagen-4` | `/v1beta/models/{model}:generateContent` | Inline base64 in response |
| **Anthropic** | No | N/A | N/A | N/A |
| **OpenRouter** | Yes | Various (wraps Gemini, OpenAI, etc.) | `/api/v1/chat/completions` | base64 in `images` array |

---

## API Details by Provider

### OpenAI (DALL-E / GPT-Image-1)

```typescript
// Endpoint: POST https://api.openai.com/v1/images/generations
// Request:
{
  "model": "dall-e-3",  // or "gpt-image-1"
  "prompt": "A cat sitting on a rainbow",
  "n": 1,               // dall-e-3 only supports n=1
  "size": "1024x1024",  // "1792x1024", "1024x1792" for dall-e-3
  "quality": "standard", // or "hd" for dall-e-3
  "style": "vivid",     // or "natural" for dall-e-3
  "response_format": "url" // or "b64_json"
}
// Response:
{
  "data": [{
    "url": "https://...", // if response_format="url"
    "b64_json": "..."     // if response_format="b64_json"
    "revised_prompt": "..." // dall-e-3 returns the revised prompt
  }]
}
```

**Notes:**
- DALL-E 3 only supports `n=1`
- DALL-E 2 supports up to `n=10`
- Prompt max length: 1000 chars (DALL-E 2), 4000 chars (DALL-E 3)
- DALL-E 3 sizes: 1024x1024, 1792x1024, 1024x1792
- DALL-E 2 sizes: 256x256, 512x512, 1024x1024

### xAI Grok

```typescript
// Endpoint: POST https://api.x.ai/v1/images/generations
// Request:
{
  "model": "grok-2-image",
  "prompt": "A cat sitting on a rainbow",
  "n": 1,  // up to 10
  "response_format": "url" // or "b64_json"
}
// Response:
{
  "data": [{
    "url": "https://...",  // if response_format="url"
    "b64_json": "..."      // if response_format="b64_json"
  }]
}
```

**Notes:**
- `quality`, `size`, and `style` parameters are NOT supported
- Output format is always JPG
- Prompt is automatically revised by a chat model before generation
- Up to 10 images per request, max 5 requests/second
- Compatible with OpenAI SDK (change base_url to `https://api.x.ai/v1`)

### Google Gemini

```typescript
// Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
// Request:
{
  "contents": [{
    "parts": [{ "text": "Generate an image of a cat on a rainbow" }]
  }],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "16:9"  // optional: "1:1", "3:4", "4:3", "9:16", "16:9"
    }
  }
}
// Response:
{
  "candidates": [{
    "content": {
      "parts": [
        { "text": "Here's the image..." },
        { "inlineData": { "mimeType": "image/png", "data": "base64..." }}
      ]
    }
  }]
}
```

**Notes:**
- Uses the same endpoint as chat, with `responseModalities` including `"IMAGE"`
- Models: `gemini-2.5-flash-image` (fast), `gemini-3-pro-image-preview` (quality)
- Imagen models (`imagen-4`, `imagen-4-fast`) use a different endpoint structure
- Can do multi-turn conversations with image context
- All generated images include SynthID watermark

### OpenRouter

```typescript
// Endpoint: POST https://openrouter.ai/api/v1/chat/completions
// Request:
{
  "model": "google/gemini-2.5-flash-image-preview",
  "messages": [{ "role": "user", "content": "Generate a cat on a rainbow" }],
  "modalities": ["image", "text"],
  "image_config": { "aspect_ratio": "16:9" }  // optional
}
// Response:
{
  "choices": [{
    "message": {
      "content": "Description text",
      "images": [{
        "type": "image_url",
        "image_url": { "url": "data:image/png;base64,..." }
      }]
    }
  }]
}
```

**Notes:**
- Uses chat completions endpoint with `modalities` parameter
- Images returned as base64 data URLs in `images` array
- Filter models by `output_modalities` containing `"image"`
- Pricing varies by underlying model

### Anthropic

**No image generation support.** Claude can analyze/understand images but cannot generate them. Anthropic has focused on text/code reasoning and safety rather than image synthesis.

---

## Implementation Plan

### Phase 1: Core Infrastructure

1. **Extend Base Interface** (`lib/llm/base.ts`)
   - Add `supportsImageGeneration: boolean` property
   - Add `generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>` method
   - Define `ImageGenParams` and `ImageGenResponse` interfaces

2. **Create Image Generation Types**
   ```typescript
   interface ImageGenParams {
     prompt: string
     model?: string           // Provider-specific model
     n?: number               // Number of images (default 1)
     size?: string            // e.g., "1024x1024"
     quality?: 'standard' | 'hd'
     style?: 'vivid' | 'natural'
     aspectRatio?: string     // For Gemini: "16:9", "4:3", etc.
   }

   interface ImageGenResponse {
     images: GeneratedImage[]
     raw: any
   }

   interface GeneratedImage {
     data: string             // Base64 encoded image data
     mimeType: string         // "image/png" or "image/jpeg"
     revisedPrompt?: string   // Some providers return revised prompt
   }
   ```

### Phase 2: Provider Implementations

3. **OpenAI Provider** (`lib/llm/openai.ts`)
   - Add `supportsImageGeneration = true`
   - Implement `generateImage()` using `/v1/images/generations`
   - Support DALL-E 3 and GPT-image-1 models
   - Always request `b64_json` response format

4. **Grok Provider** (`lib/llm/grok.ts`)
   - Add `supportsImageGeneration = true`
   - Implement `generateImage()` using `/v1/images/generations`
   - Use OpenAI SDK with xAI base URL
   - Request `b64_json` response format

5. **Google/Gemini Provider** (new file: `lib/llm/google.ts`)
   - Create new provider class for Google Generative AI
   - Implement both chat and image generation
   - Use `@google/generative-ai` SDK
   - Extract inline base64 data from response parts

6. **OpenRouter Provider** (`lib/llm/openrouter.ts`)
   - Add `supportsImageGeneration = true`
   - Implement `generateImage()` with `modalities: ["image", "text"]`
   - Parse `images` array from response

7. **Anthropic Provider** (`lib/llm/anthropic.ts`)
   - Set `supportsImageGeneration = false`
   - Throw error if `generateImage()` called

### Phase 3: API Endpoint

8. **Create Image Generation API Route** (`app/api/images/generate/route.ts`)
   - Accept POST with `{ prompt, profileId, options }`
   - Load connection profile and decrypt API key
   - Call provider's `generateImage()` method
   - Save generated image(s) to `public/uploads/generated/`
   - Create Image records with appropriate tags
   - Return image URLs/IDs

### Phase 4: Database & Storage

9. **Update Image Model** (if needed)
   - Add `source` field: `'upload' | 'import' | 'generated'`
   - Add `generationPrompt` field for generated images
   - Add `generationModel` field

10. **Image Storage**
    - Save to `public/uploads/generated/{userId}/{timestamp}-{hash}.png`
    - Create Image record with metadata
    - Support tagging to character/persona/chat

### Phase 5: UI Integration

11. **Image Generation Dialog Component**
    - Prompt input field
    - Provider/model selector (filtered to image-capable)
    - Size/quality/style options (provider-dependent)
    - Preview and save functionality

12. **Integrate with Existing Gallery Modals**
    - Add "Generate" tab alongside "Upload" and "Import"
    - Reuse existing tagging and gallery infrastructure

---

## Model Reference

### Image Generation Models by Provider

| Provider | Model ID | Notes |
|----------|----------|-------|
| OpenAI | `dall-e-3` | Best quality, revised prompts, n=1 only |
| OpenAI | `dall-e-2` | Faster, multiple images, smaller sizes |
| OpenAI | `gpt-image-1` | Latest model (limited access) |
| xAI | `grok-2-image` | Alias for `grok-2-image-1212` |
| xAI | `grok-2-image-1212` | Full model ID |
| Google | `gemini-2.5-flash-image` | Fast, efficient |
| Google | `gemini-3-pro-image-preview` | Professional quality, 4K support |
| Google | `imagen-4` | High fidelity, text rendering |
| Google | `imagen-4-fast` | Speed optimized |
| OpenRouter | `google/gemini-2.5-flash-image-preview` | Via OpenRouter |
| OpenRouter | `openai/gpt-5-image` | Via OpenRouter (if available) |

### Size Options

| Provider | Sizes |
|----------|-------|
| OpenAI (DALL-E 3) | 1024x1024, 1792x1024, 1024x1792 |
| OpenAI (DALL-E 2) | 256x256, 512x512, 1024x1024 |
| xAI | Not configurable |
| Google | Aspect ratio based (1:1, 3:4, 4:3, 9:16, 16:9) |

---

## Pricing Reference (as of 2025)

| Provider | Model | Price |
|----------|-------|-------|
| OpenAI | DALL-E 3 Standard | ~$0.04/image (1024x1024) |
| OpenAI | DALL-E 3 HD | ~$0.08/image (1024x1024) |
| Google | Imagen 3 | $0.03/image |
| Google | Imagen 4 Fast | $0.02/image |
| Google | Gemini 2.5 Flash Image | ~$0.039/image (1290 output tokens) |
| xAI | Grok 2 Image | TBD |

---

## Future Considerations

- **Image Editing**: OpenAI and Grok support image editing/inpainting
- **Image Variations**: DALL-E 2 supports creating variations of existing images
- **Streaming**: Some providers support streaming partial images during generation
- **Batch Processing**: Consider queue system for bulk generation
- **Cost Tracking**: Track generation costs per user/chat
