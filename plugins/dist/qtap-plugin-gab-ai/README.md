# Gab AI Provider Plugin for Quilltap

This plugin provides integration with Gab AI's API, enabling Quilltap to use Gab AI language models for chat completions.

## Features

- **Chat Completions**: Access to Gab AI language models for conversational AI
- **Streaming**: Support for streaming responses for real-time chat
- **Text-Only**: Text input and output (no file attachments)
- **OpenAI-Compatible**: Uses OpenAI SDK with Gab AI's base URL

## Installation

The plugin is included with Quilltap. To ensure you have the latest version of the OpenAI SDK (used for API compatibility):

```bash
npm install openai@latest
```

## Configuration

### API Key Setup

1. Create a Gab AI account at https://api.gab.com
2. Generate an API key from your account dashboard
3. In Quilltap settings, add your API key under the Gab AI provider configuration

### Required Permissions

This plugin requires the following:
- Network access to `api.gab.com`
- A valid Gab AI API account with billing enabled

## Supported Models

The available models depend on your Gab AI account access. Use the "Fetch Available Models" feature in Quilltap to see your accessible models.

### Chat Completion Models

Gab AI provides various language models optimized for different use cases:
- Standard models for general-purpose chat
- Specialized models for specific domains

**Note**: The exact available models and their capabilities depend on your Gab AI account access and may change over time. Use the "Fetch Available Models" feature in Quilltap to see your current accessible models.

## File Attachment Support

The plugin does not support file attachments. All interactions are text-only.

### Supported MIME Types

None - text only

## Parameters

### Chat Completion Parameters

- **model**: The model to use (varies by account access)
- **temperature**: Randomness of responses (0-2, default: 0.7)
- **maxTokens**: Maximum response length (default: 1000)
- **topP**: Diversity parameter (0-1, default: 1)
- **stop**: Stop sequences to end generation

## Logging

The plugin includes comprehensive debug logging for all operations:

- API calls and responses
- Stream processing
- Model fetching
- API key validation
- Error handling

Set `LOG_LEVEL=debug` to see detailed operation logs.

## Error Handling

The plugin provides detailed error messages for:
- Invalid API keys
- Model availability errors
- API errors and rate limiting
- Network connectivity issues

## Examples

### Basic Chat

```typescript
const response = await provider.sendMessage({
  messages: [
    { role: 'user', content: 'Hello, how are you?' }
  ],
  model: 'gab-01',
}, apiKey);
```

### Streaming

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'gab-01',
}, apiKey)) {
  console.log(chunk.content);
}
```

## Troubleshooting

### Invalid API Key

- Verify the key is correct from your Gab AI account dashboard
- Ensure the key has not expired
- Check that billing is enabled on your Gab AI account

### No Models Available

- Ensure your API key has access to the models
- Check that your account is not in a restricted region
- Verify your billing information is valid

### Slow Responses

- Check Gab AI status page
- Verify network connection
- Check rate limiting (429 errors)

## Support

For issues with the plugin, refer to:
- Quilltap GitHub: https://github.com/Foundry-9/F9-Quilltap
- Gab AI Documentation: https://api.gab.com/docs

## License

MIT License - See LICENSE file for details
