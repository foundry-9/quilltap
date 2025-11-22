# Image Generation API Reference

## Endpoint: POST `/api/images/generate`

Generate images using your configured LLM providers.

## Authentication

Requires valid NextAuth session cookie (automatically included in browser requests).

## Request Body

```typescript
{
  // Required: The image description
  prompt: string (1-4000 characters)

  // Required: UUID of the connection profile to use
  profileId: string

  // Optional: Tags to apply to generated images
  tags?: Array<{
    tagType: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME'
    tagId: string (UUID of character/persona/chat/theme)
  }>

  // Optional: Generation options (provider-dependent)
  options?: {
    n?: number              // Number of images (1-10, default 1)
    size?: string           // e.g., "1024x1024", "1024x1792", "16:9"
    quality?: 'standard'    // 'standard' or 'hd' (DALL-E only)
    style?: 'vivid'         // 'vivid' or 'natural' (DALL-E only)
    aspectRatio?: string    // "16:9", "4:3", "3:2" etc (Gemini only)
  }
}
```

## Response: Success (200 OK)

```typescript
{
  data: Array<{
    id: string                    // Database image ID
    filename: string              // Generated filename
    filepath: string              // Relative path (uploads/generated/...)
    url: string                   // Public URL (/uploads/generated/...)
    mimeType: string              // e.g., "image/png"
    size: number                  // File size in bytes
    revisedPrompt?: string        // Revised prompt from provider (if applicable)
    tags: Array<{
      id: string                  // Tag ID
      imageId: string
      tagType: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME'
      tagId: string
      createdAt: string           // ISO datetime
    }>
  }>

  metadata: {
    prompt: string                // Original prompt
    provider: string              // Provider name
    model: string                 // Model name
    count: number                 // Number of images generated
  }
}
```

## Response: Error Cases

### 401 Unauthorized
```json
{
  "error": "Unauthorized"
}
```
No authenticated user. Check NextAuth session.

### 400 Bad Request - Validation Error
```json
{
  "error": "Validation error",
  "details": [
    {
      "code": "too_small",
      "message": "String must contain at least 1 character(s)",
      "path": ["prompt"]
    }
  ]
}
```
Request validation failed. Check prompt, profileId, and options.

### 400 Bad Request - Provider Not Supported
```json
{
  "error": "ANTHROPIC provider does not support image generation"
}
```
The selected profile's provider doesn't support image generation.

### 404 Not Found
```json
{
  "error": "Connection profile not found"
}
```
The specified profileId doesn't exist or doesn't belong to the user.

### 500 Internal Server Error
```json
{
  "error": "Failed to generate images",
  "details": "Rate limit exceeded"
}
```
An error occurred during image generation or file saving.

## Provider-Specific Options

### OpenAI (DALL-E)
```json
{
  "options": {
    "n": 1,                        // 1-10 for DALL-E 2, 1 for DALL-E 3
    "size": "1024x1024",           // 256x256, 512x512, 1024x1024, 1792x1024, 1024x1792
    "quality": "hd",               // standard, hd (DALL-E 3 only)
    "style": "vivid"               // vivid, natural (DALL-E 3 only)
  }
}
```

### Google (Gemini)
```json
{
  "options": {
    "n": 1,                        // Usually 1
    "aspectRatio": "16:9"          // 1:1, 16:9, 4:3, 3:2, 9:16
  }
}
```

### xAI (Grok)
```json
{
  "options": {
    "n": 1                         // 1-4 typically
  }
}
```

## Example Requests

### Basic Image Generation
```bash
curl -X POST http://localhost:3000/api/images/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A serene mountain landscape at sunset",
    "profileId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

### With Quality Options
```bash
curl -X POST http://localhost:3000/api/images/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A medieval knight in shining armor",
    "profileId": "550e8400-e29b-41d4-a716-446655440000",
    "options": {
      "size": "1024x1024",
      "quality": "hd",
      "style": "vivid"
    }
  }'
```

### With Character Tagging
```bash
curl -X POST http://localhost:3000/api/images/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A wise wizard with a long beard and staff",
    "profileId": "550e8400-e29b-41d4-a716-446655440000",
    "tags": [
      {
        "tagType": "CHARACTER",
        "tagId": "char-uuid-123"
      }
    ]
  }'
```

### Multiple Tags
```bash
curl -X POST http://localhost:3000/api/images/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful fantasy scene",
    "profileId": "550e8400-e29b-41d4-a716-446655440000",
    "tags": [
      {
        "tagType": "CHARACTER",
        "tagId": "char-uuid-123"
      },
      {
        "tagType": "CHAT",
        "tagId": "chat-uuid-456"
      }
    ]
  }'
```

## JavaScript/TypeScript Example

```typescript
async function generateImage(
  prompt: string,
  profileId: string,
  options?: {
    size?: string
    quality?: 'standard' | 'hd'
    style?: 'vivid' | 'natural'
  }
) {
  const response = await fetch('/api/images/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      profileId,
      options,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error)
  }

  const { data, metadata } = await response.json()

  return {
    images: data,
    metadata,
  }
}

// Usage
const result = await generateImage(
  'A majestic phoenix rising from flames',
  '550e8400-e29b-41d4-a716-446655440000',
  {
    size: '1024x1024',
    quality: 'hd',
    style: 'vivid',
  }
)

console.log('Generated images:', result.images)
result.images.forEach((img) => {
  console.log(`Image URL: ${img.url}`)
})
```

## Rate Limiting

Currently unlimited (depends on provider rate limits):
- OpenAI: Check your account limits
- Google: Check your API quota
- xAI: Check your API limits

## File Storage

Generated images are stored at:
```
public/uploads/generated/{userId}/{filename}
```

Accessible via:
```
/{image.filepath}
```

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Unauthorized" | No session | Ensure user is logged in |
| "Validation error" | Invalid input | Check prompt (1-4000 chars), profileId is valid UUID |
| "Connection profile not found" | Wrong profileId | Use correct profile UUID |
| "Provider does not support" | Wrong provider | Use an image-capable provider (OpenAI, Google, Grok) |
| "Rate limit exceeded" | Too many requests | Wait before retrying |
| "Invalid API key" | Decryption failed | Check provider API key configuration |

## Related Endpoints

- `POST /api/images` - Upload or import images
- `GET /api/images` - List images with optional filtering
- `GET /api/profiles` - List connection profiles
