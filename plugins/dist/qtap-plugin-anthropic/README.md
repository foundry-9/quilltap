# Anthropic Provider Plugin for Quilltap

This plugin provides integration with Anthropic's API, enabling Quilltap to use Claude models for chat completions with support for image and PDF analysis.

## Features

- **Chat Completions**: Access to Claude Sonnet, Opus, and Haiku models
- **Vision Capabilities**: Analyze images with all Claude models
- **PDF Support**: Analyze PDF documents
- **Function Calling**: Use tools and function calling for structured outputs
- **Streaming**: Support for streaming responses for real-time chat

## Installation

The plugin is included with Quilltap. To ensure you have the latest version of the Anthropic SDK:

```bash
npm install @anthropic-ai/sdk@latest
```

## Configuration

### API Key Setup

1. Create an Anthropic account at https://console.anthropic.com
2. Generate an API key from the API Keys section
3. In Quilltap settings, add your API key under the Anthropic provider configuration

### Required Permissions

This plugin requires the following:
- Network access to `api.anthropic.com`
- A valid Anthropic API account with billing enabled

## Supported Models

### Chat Completion Models

| Model | Context Window | Supports Vision | Supports Tools | Release Date |
|-------|---|---|---|---|
| claude-sonnet-4-5-20250929 | 200K | Yes | Yes | Sept 2025 |
| claude-haiku-4-5-20251015 | 200K | Yes | Yes | Oct 2025 |
| claude-opus-4-1-20250805 | 200K | Yes | Yes | Aug 2025 |
| claude-sonnet-4-20250514 | 200K | Yes | Yes | May 2025 |
| claude-opus-4-20250514 | 200K | Yes | Yes | May 2025 |
| claude-3-opus-20240229 | 200K | Yes | Yes | Feb 2024 |
| claude-3-haiku-20240307 | 200K | Yes | Yes | Mar 2024 |

**Note**: The exact available models depend on your Anthropic account access and may change over time. Use the "Fetch Available Models" feature in Quilltap to see your accessible models.

**Deprecation Notice**:
- Claude 3.5 models were deprecated on October 22, 2025
- Claude 3 Sonnet was retired on July 21, 2025
- Claude 3 Opus will retire on January 5, 2026

## File Attachment Support

The plugin supports image and PDF attachments for all Claude models:

### Supported MIME Types
- image/jpeg
- image/png
- image/gif
- image/webp
- application/pdf

### Supported Models
- Claude Sonnet 4.5
- Claude Haiku 4.5
- Claude Opus 4.1
- Claude Sonnet 4
- Claude Opus 4
- Claude 3 Opus
- Claude 3 Haiku

Images and PDFs are automatically encoded to base64 and sent with your message for analysis.

## Parameters

### Chat Completion Parameters

- **model**: The model to use (e.g., 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251015')
- **temperature**: Randomness of responses (0-1, default: 1.0)
- **maxTokens**: Maximum response length
- **topP**: Diversity parameter (0-1)
- **tools**: Function definitions for tool use
- **stop**: Stop sequences

## Logging

The plugin includes comprehensive debug logging for all operations:

- API calls and responses
- Stream processing
- Tool/function calls
- Image and PDF attachment handling
- API key validation
- Error handling

Set `LOG_LEVEL=debug` to see detailed operation logs.

## Pricing & Rate Limits

Refer to the Anthropic documentation for current pricing and rate limits:
https://www.anthropic.com/pricing

The plugin respects Anthropic's:
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
  model: 'claude-sonnet-4-5-20250929',
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
  model: 'claude-sonnet-4-5-20250929',
}, apiKey);
```

### PDF Analysis

```typescript
const response = await provider.sendMessage({
  messages: [
    {
      role: 'user',
      content: 'Summarize this document',
      attachments: [
        {
          id: 'pdf1',
          filepath: '/path/to/document.pdf',
          filename: 'document.pdf',
          mimeType: 'application/pdf',
          size: 5024,
          data: 'base64encodeddata...'
        }
      ]
    }
  ],
  model: 'claude-sonnet-4-5-20250929',
}, apiKey);
```

### Streaming

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'claude-sonnet-4-5-20250929',
}, apiKey)) {
  console.log(chunk.content);
}
```

### System Prompts

```typescript
const response = await provider.sendMessage({
  messages: [
    {
      role: 'system',
      content: 'You are a helpful assistant specializing in technical writing.'
    },
    {
      role: 'user',
      content: 'Explain quantum computing to a beginner'
    }
  ],
  model: 'claude-sonnet-4-5-20250929',
}, apiKey);
```

## Troubleshooting

### Invalid API Key
- Verify the key is correct from https://console.anthropic.com/account/keys
- Ensure the key has not expired
- Check that billing is enabled on your Anthropic account

### No Models Available
- Ensure your API key has access to the models
- Check that your account is not in a restricted region
- Some models may require specific account tier

### Attachment Processing Fails
- Verify the file is in a supported MIME type
- Check that the file data is properly encoded in base64
- Ensure the file is not corrupted

### Slow Responses
- Check Anthropic status page: https://status.anthropic.com
- Verify network connection
- Check rate limiting (429 errors)
- Consider using a faster model like claude-haiku-4-5

## Support

For issues with the plugin, refer to:
- Quilltap GitHub: https://github.com/Foundry-9/F9-Quilltap
- Anthropic Documentation: https://docs.anthropic.com
- Anthropic Support: https://support.anthropic.com

## License

MIT License - See LICENSE file for details
