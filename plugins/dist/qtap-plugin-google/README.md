# Google Gemini Provider Plugin for Quilltap

This plugin provides integration with Google's Generative AI API, enabling Quilltap to use Gemini models for chat completions and Imagen models for image generation.

## Features

- **Chat Completions**: Access to Gemini, Gemini 2.0, Gemini 2.5 Flash, and other Google models
- **Vision Capabilities**: Analyze images with vision-enabled models (Gemini, Gemini 2.0+)
- **Image Generation**: Create images using Imagen models and Gemini image generation
- **Function Calling**: Use tools and function calling for structured outputs
- **Web Search**: Google Search integration for web-aware responses
- **Streaming**: Support for streaming responses for real-time chat

## Installation

The plugin is included with Quilltap. To ensure you have the latest version of the Google Generative AI SDK:

```bash
npm install @google/generative-ai@latest
```

## Configuration

### API Key Setup

1. Create a Google Cloud account or use an existing Google account
2. Generate an API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
3. In Quilltap settings, add your API key under the Google Gemini provider configuration

### Required Permissions

This plugin requires the following:
- Network access to `generativelanguage.googleapis.com`
- A valid Google Generative AI API key

## Supported Models

### Chat Completion Models

| Model | Context Window | Supports Vision | Supports Tools | Supports Web Search |
|-------|---|---|---|---|
| gemini-2.5-flash | 1M | Yes | Yes | Yes |
| gemini-2.5-flash-image | 1M | Yes | Yes | Yes |
| gemini-3-pro-image-preview | 1M | Yes | Yes | Yes |
| gemini-pro-vision | 32K | Yes | Yes | Yes |

**Note**: The exact available models depend on your Google AI account access and may change over time. Use the "Fetch Available Models" feature in Quilltap to see your accessible models.

### Image Generation Models

- **imagen-4**: Latest Imagen generation model with improved quality
- **imagen-4-fast**: Faster version of Imagen 4
- **gemini-2.5-flash-image**: Gemini model with image generation capabilities
- **gemini-3-pro-image-preview**: Gemini 3 Pro model with image generation

## File Attachment Support

The plugin supports image attachments for vision-capable models:

### Supported MIME Types
- image/jpeg
- image/png
- image/gif
- image/webp

### Supported Models
- Gemini 2.5 Flash
- Gemini 2.5 Flash Image
- Gemini 3 Pro Image Preview
- Gemini Pro Vision

Images are automatically encoded to base64 and sent with your message for analysis.

## Parameters

### Chat Completion Parameters

- **model**: The model to use (e.g., 'gemini-2.5-flash', 'gemini-pro-vision')
- **temperature**: Randomness of responses (0-2, default: 0.7)
- **maxTokens**: Maximum response length (default: 1000)
- **topP**: Diversity parameter (0-1, default: 1)
- **tools**: Function definitions for tool use
- **webSearchEnabled**: Enable Google Search integration

### Image Generation Parameters

- **model**: Image model ('imagen-4', 'imagen-4-fast', 'gemini-2.5-flash-image')
- **prompt**: Text description of the image
- **aspectRatio**: Aspect ratio for generated images
- **seed**: Random seed for reproducible results
- **n**: Number of images to generate (default: 1)

## Web Search

The plugin supports web search integration with compatible models. Enable the `webSearchEnabled` parameter when using Gemini 2.0+ models to include real-time web results in responses.

## Logging

The plugin includes comprehensive debug logging for all operations:

- API calls and responses
- Stream processing
- Tool/function calls
- Image generation
- API key validation
- Error handling

Set `LOG_LEVEL=debug` to see detailed operation logs.

## Pricing & Rate Limits

Refer to the [Google Generative AI pricing](https://ai.google.dev/pricing) for current pricing and rate limits.

The plugin respects Google's:
- Rate limiting (429 responses)
- Token limits per model
- Concurrent request limits

## Error Handling

The plugin provides detailed error messages for:
- Invalid API keys
- Unsupported file types
- Unsupported model parameters
- API errors and rate limiting

## Examples

### Basic Chat

```typescript
const response = await provider.sendMessage({
  messages: [
    { role: 'user', content: 'Hello, how are you?' }
  ],
  model: 'gemini-2.5-flash',
}, apiKey);
```

### Vision Analysis

```typescript
const response = await provider.sendMessage({
  messages: [
    {
      role: 'user',
      content: 'Describe this image',
      attachments: [
        {
          id: 'img1',
          filepath: '/path/to/image.jpg',
          filename: 'image.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          data: 'base64encodeddata...'
        }
      ]
    }
  ],
  model: 'gemini-2.5-flash',
}, apiKey);
```

### Image Generation

```typescript
const result = await provider.generateImage({
  prompt: 'A serene mountain landscape at sunset',
  model: 'imagen-4',
}, apiKey);
```

### Streaming

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'gemini-2.5-flash',
}, apiKey)) {
  console.log(chunk.content);
}
```

## Troubleshooting

### Invalid API Key
- Verify the key is correct from [Google AI Studio](https://aistudio.google.com/app/apikey)
- Ensure the key has not expired
- Check that your Google account has access to the API

### No Models Available
- Ensure your API key has access to the models
- Check that your account is not in a restricted region
- Some models may require specific account tier

### Image Generation Fails
- Verify the model supports image generation
- Ensure the prompt is not too long or violates content policy
- Check that your account has image generation enabled

### Slow Responses
- Check Google's API status
- Verify network connection
- Check rate limiting (429 errors)
- Consider using a faster model like gemini-2.5-flash

## Support

For issues with the plugin, refer to:
- Quilltap GitHub: https://github.com/Foundry-9/F9-Quilltap
- Google Generative AI Documentation: https://ai.google.dev/
- Google AI Studio: https://aistudio.google.com/

## License

MIT License - See LICENSE file for details
