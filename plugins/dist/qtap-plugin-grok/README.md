# Grok Provider Plugin for Quilltap

This plugin provides integration with xAI's Grok API, enabling Quilltap to use Grok models for chat completions and image generation.

## Features

- **Chat Completions**: Access to Grok-2 and other Grok models
- **Vision Capabilities**: Analyze images with vision-enabled models (Grok-2 Vision)
- **Image Generation**: Create images using grok-2-image
- **Function Calling**: Use tools and function calling for structured outputs
- **Web Search**: Native live search integration (searches web, X/Twitter, news)
- **Streaming**: Support for streaming responses for real-time chat

## Installation

The plugin is included with Quilltap. To ensure you have the latest version of the OpenAI SDK (Grok uses OpenAI-compatible API):

```bash
npm install openai@latest
```

## Configuration

### API Key Setup

1. Create a Grok account at https://console.x.ai
2. Generate an API key from the API Keys section
3. In Quilltap settings, add your API key under the Grok provider configuration

### Required Permissions

This plugin requires the following:
- Network access to `api.x.ai`
- A valid Grok API account with billing enabled

## Supported Models

### Chat Completion Models

| Model | Context Window | Supports Vision | Supports Tools |
|-------|---|---|---|
| grok-2 | 128K | Yes | Yes |
| grok-2-vision-1212 | 128K | Yes | Yes |

### Image Generation Models

- **grok-2-image**: Image generation model

## File Attachment Support

The plugin supports image attachments for vision-capable models:

### Supported MIME Types
- image/jpeg
- image/png
- image/gif
- image/webp

### Supported Models
- Grok-2
- Grok-2 Vision

Images are automatically encoded to base64 and sent with your message for analysis.

## Parameters

### Chat Completion Parameters

- **model**: The model to use (e.g., 'grok-2', 'grok-2-vision-1212')
- **temperature**: Randomness of responses (0-2, default: 0.7)
- **maxTokens**: Maximum response length (default: 1000)
- **topP**: Diversity parameter (0-1, default: 1)
- **tools**: Function definitions for tool use
- **webSearchEnabled**: Enable web search (searches web, X/Twitter, news)

### Image Generation Parameters

- **model**: Image model ('grok-2-image')
- **prompt**: Text description of the image
- **n**: Number of images to generate (1-10)

## Web Search

The plugin supports native web search with Grok models:

When `webSearchEnabled` is true, Grok's Live Search API will:
- Search the web, X/Twitter, and news sources
- Return citations for search results
- Automatically decide when to search based on the query

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

Refer to the Grok documentation for current pricing and rate limits:
https://console.x.ai/docs

The plugin respects Grok's:
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
  model: 'grok-2',
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
  model: 'grok-2',
}, apiKey);
```

### Image Generation

```typescript
const result = await provider.generateImage({
  prompt: 'A futuristic city at night',
  model: 'grok-2-image',
}, apiKey);
```

### Web Search

```typescript
const response = await provider.sendMessage({
  messages: [{ role: 'user', content: 'What are the latest AI developments?' }],
  model: 'grok-2',
  webSearchEnabled: true,
}, apiKey);
```

### Streaming

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'grok-2',
}, apiKey)) {
  console.log(chunk.content);
}
```

## Troubleshooting

### Invalid API Key
- Verify the key is correct from https://console.x.ai
- Ensure the key has not expired
- Check that billing is enabled on your Grok account

### No Models Available
- Ensure your API key has access to the models
- Check that your account is not in a restricted region
- Some models may require specific account tier

### Image Generation Fails
- Verify the model is 'grok-2-image'
- Ensure the prompt is not too long or violates content policy
- Check that your account has image generation enabled

### Slow Responses
- Check Grok status page: https://console.x.ai/status
- Verify network connection
- Check rate limiting (429 errors)

## Support

For issues with the plugin, refer to:
- Quilltap GitHub: https://github.com/Foundry-9/F9-Quilltap
- Grok Documentation: https://console.x.ai/docs
- xAI Support: https://support.x.ai

## License

MIT License - See LICENSE file for details
