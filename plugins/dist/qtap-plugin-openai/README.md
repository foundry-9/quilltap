# OpenAI Provider Plugin for Quilltap

This plugin provides integration with OpenAI's API, enabling Quilltap to use GPT models for chat completions and DALL-E models for image generation.

## Features

- **Chat Completions**: Access to GPT-4, GPT-4o, GPT-3.5 Turbo, and other OpenAI models
- **Vision Capabilities**: Analyze images with vision-enabled models (GPT-4V, GPT-4o)
- **Image Generation**: Create images using DALL-E 2, DALL-E 3, or gpt-image-1
- **Function Calling**: Use tools and function calling for structured outputs
- **Web Search**: Native web search integration with search-capable models
- **Streaming**: Support for streaming responses for real-time chat

## Installation

The plugin is included with Quilltap. To ensure you have the latest version of the OpenAI SDK:

```bash
npm install openai@latest
```

## Configuration

### API Key Setup

1. Create an OpenAI account at https://platform.openai.com
2. Generate an API key from the API Keys section
3. In Quilltap settings, add your API key under the OpenAI provider configuration

### Required Permissions

This plugin requires the following:
- Network access to `api.openai.com`
- A valid OpenAI API account with billing enabled

## Supported Models

### Chat Completion Models

| Model | Context Window | Supports Vision | Supports Tools |
|-------|---|---|---|
| gpt-4o | 128K | Yes | Yes |
| gpt-4-turbo | 128K | Yes | Yes |
| gpt-4 | 8K | No | Yes |
| gpt-3.5-turbo | 4K | No | Yes |

**Note**: The exact available models depend on your OpenAI account access and may change over time. Use the "Fetch Available Models" feature in Quilltap to see your accessible models.

### Image Generation Models

- **gpt-image-1**: Latest image generation model with improved quality
- **dall-e-3**: High quality, improved prompt following
- **dall-e-2**: Stable, widely available model

#### Size Support by Model

**gpt-image-1**:
- 1024x1024
- 1024x1536
- 1536x1024
- auto

**dall-e-3**:
- 1024x1024
- 1024x1792
- 1792x1024

**dall-e-2**:
- 256x256
- 512x512
- 1024x1024

## File Attachment Support

The plugin supports image attachments for vision-capable models:

### Supported MIME Types
- image/jpeg
- image/png
- image/gif
- image/webp

### Supported Models
- GPT-4V
- GPT-4o
- GPT-4 Turbo

Images are automatically encoded to base64 and sent with your message for analysis.

## Parameters

### Chat Completion Parameters

- **model**: The model to use (e.g., 'gpt-4o', 'gpt-3.5-turbo')
- **temperature**: Randomness of responses (0-2, default: 1)
- **maxTokens**: Maximum response length
- **topP**: Diversity parameter (0-1, default: 1)
- **tools**: Function definitions for tool use
- **webSearchEnabled**: Enable web search (requires search-capable model)

### Image Generation Parameters

- **model**: Image model ('dall-e-3', 'dall-e-2', or 'gpt-image-1')
- **prompt**: Text description of the image
- **size**: Image dimensions (varies by model)
- **quality**: 'standard' or 'hd' (DALL-E 3 only)
- **style**: 'vivid' or 'natural' (DALL-E 3 only)
- **n**: Number of images to generate (1-10)

## Web Search

The plugin supports native web search with compatible models:

- **gpt-4o-search-preview**: GPT-4o with web search
- **gpt-4o-mini-search-preview**: GPT-4o mini with web search

Enable the `webSearchEnabled` parameter when using these models to include real-time web results in responses.

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

Refer to the OpenAI documentation for current pricing and rate limits:
https://platform.openai.com/pricing

The plugin respects OpenAI's:
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
  model: 'gpt-4o',
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
  model: 'gpt-4o',
}, apiKey);
```

### Image Generation

```typescript
const result = await provider.generateImage({
  prompt: 'A serene mountain landscape at sunset',
  model: 'dall-e-3',
  size: '1024x1792',
  quality: 'hd',
}, apiKey);
```

### Streaming

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'gpt-4o',
}, apiKey)) {
  console.log(chunk.content);
}
```

## Troubleshooting

### Invalid API Key
- Verify the key is correct from https://platform.openai.com/api-keys
- Ensure the key has not expired
- Check that billing is enabled on your OpenAI account

### No Models Available
- Ensure your API key has access to the models
- Check that your account is not in a restricted region
- Some models may require specific account tier

### Image Generation Fails
- Verify the model supports the requested size
- Ensure the prompt is not too long or violates content policy
- Check that your account has image generation enabled

### Slow Responses
- Check OpenAI status page: https://status.openai.com
- Verify network connection
- Check rate limiting (429 errors)
- Consider using a faster model like gpt-3.5-turbo

## Support

For issues with the plugin, refer to:
- Quilltap GitHub: https://github.com/Foundry-9/F9-Quilltap
- OpenAI Documentation: https://platform.openai.com/docs
- OpenAI Community: https://community.openai.com

## License

MIT License - See LICENSE file for details
