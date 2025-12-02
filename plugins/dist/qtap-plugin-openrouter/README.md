# OpenRouter Provider Plugin for Quilltap

This plugin provides integration with OpenRouter's API, enabling Quilltap to access 100+ AI models from multiple providers including OpenAI, Anthropic, Google, Meta, and more, all through a single unified interface.

## Features

- **Access to 100+ Models**: Chat completion models from OpenAI (GPT-4, GPT-3.5), Anthropic (Claude 3 family), Google (Gemini), Meta (Llama), Mistral, and many more
- **Real-time Pricing**: Fetch current pricing for all available models directly from OpenRouter
- **Cost-aware Model Selection**: Use the pricing fetcher to select the most cost-effective models for your use case
- **Unified API**: Single API key to access models from multiple providers
- **Function Calling**: Tool use and function calling support (model-dependent)
- **Image Generation**: Support for image generation via available models
- **Streaming**: Support for streaming responses for real-time chat
- **Router Intelligence**: OpenRouter's intelligent routing and fallback handling

## Installation

The plugin is included with Quilltap. To ensure you have the latest version of the OpenRouter SDK:

```bash
npm install @openrouter/sdk@latest
```

## Configuration

### API Key Setup

1. Create an OpenRouter account at https://openrouter.ai
2. Generate an API key from the API Keys section of your account
3. In Quilltap settings, add your API key under the OpenRouter provider configuration

### Required Permissions

This plugin requires the following:
- Network access to `openrouter.ai`
- A valid OpenRouter API account with credits or payment method

## Supported Models

### Popular Models (100+ available)

| Provider | Model | Context | Vision | Tools |
|----------|-------|---------|--------|-------|
| OpenAI | gpt-4-turbo | 128K | Yes | Yes |
| OpenAI | gpt-3.5-turbo | 4K | No | Yes |
| Anthropic | claude-3-opus | 200K | Yes | Yes |
| Anthropic | claude-3-sonnet | 200K | Yes | Yes |
| Anthropic | claude-3-haiku | 200K | Yes | Yes |
| Google | gemini-pro-1.5 | 1M | Yes | Yes |
| Meta | llama-2-70b-chat | 4K | No | No |
| Mistral | mistral-7b-instruct | 8K | No | No |

**Note**: OpenRouter provides access to 100+ models. Use the "Fetch Available Models" feature in Quilltap to see the complete current list and their latest pricing.

### Model Categories

- **Large Language Models (LLMs)**: Chat completion with various capabilities
- **Multimodal Models**: Vision-capable models for image analysis
- **Open Source Models**: Llama, Mistral, and other open-source options
- **Specialized Models**: Domain-specific and fine-tuned variants

## File Attachment Support

OpenRouter proxies to many different models with varying capabilities. File attachment support is **model-dependent** and not yet fully implemented in this plugin version.

### Current Status
- **Attachments**: Conservative implementation - not enabled by default
- **Vision Support**: Many models support image analysis through OpenRouter
- **Model Variations**: Check individual model documentation on https://openrouter.ai for capabilities

## Parameters

### Chat Completion Parameters

- **model**: The model to use (e.g., 'openai/gpt-4-turbo', 'anthropic/claude-3-opus')
- **temperature**: Randomness of responses (0-2, default: 0.7)
- **maxTokens**: Maximum response length (default: 1000)
- **topP**: Diversity parameter (0-1, default: 1)
- **tools**: Function definitions for tool use (model-dependent)
- **stop**: Stop sequences for response termination

### Image Generation Parameters

- **model**: Image generation model (varies by availability)
- **prompt**: Text description of the image
- **size**: Image dimensions
- **aspectRatio**: Aspect ratio (varies by model)

## Pricing

### Real-time Pricing Fetch

The plugin includes a pricing fetcher that retrieves current costs directly from OpenRouter:

```typescript
import { fetchOpenRouterPricing, sortByCost, findCheapestModel } from './pricing-fetcher';

// Fetch all current models and pricing
const models = await fetchOpenRouterPricing(apiKey);

// Sort by cost
const sorted = sortByCost(models);

// Find cheapest option
const cheapest = findCheapestModel(models);

// Find cheapest with vision
const cheapestVision = findCheapestModel(models, { requireVision: true });
```

### Cost Information

OpenRouter provides transparent, per-token pricing. Costs are significantly lower for many open-source models compared to directly using premium APIs.

Refer to https://openrouter.ai/prices for current pricing information.

## Logging

The plugin includes comprehensive debug logging for all operations:

- API calls and responses
- Stream processing
- Tool/function calls
- Image generation
- API key validation
- Model fetching
- Error handling

Set `LOG_LEVEL=debug` to see detailed operation logs.

## Rate Limits

OpenRouter enforces rate limiting based on your account tier. The plugin respects:
- Per-minute request limits
- Concurrent request limits
- Token limits per model
- Account-level quotas

Monitor your OpenRouter dashboard for usage statistics.

## Error Handling

The plugin provides detailed error messages for:
- Invalid or expired API keys
- Model not available in your region/account
- Rate limiting (429 responses)
- API errors and service issues
- Unsupported parameters for specific models

## Examples

### Basic Chat

```typescript
const response = await provider.sendMessage({
  messages: [
    { role: 'user', content: 'Hello, how are you?' }
  ],
  model: 'openai/gpt-4-turbo',
}, apiKey);
```

### Using Claude for Advanced Analysis

```typescript
const response = await provider.sendMessage({
  messages: [
    {
      role: 'user',
      content: 'Analyze this complex text and provide insights'
    }
  ],
  model: 'anthropic/claude-3-opus',
}, apiKey);
```

### Cost-aware Model Selection

```typescript
import { fetchOpenRouterPricing, findCheapestModel } from './pricing-fetcher';

const models = await fetchOpenRouterPricing(apiKey);
const cheapest = findCheapestModel(models);

const response = await provider.sendMessage({
  messages: [{ role: 'user', content: 'Quick question' }],
  model: cheapest.modelId,
}, apiKey);
```

### Using Tools/Function Calling

```typescript
const response = await provider.sendMessage({
  messages: [
    { role: 'user', content: 'What is the weather?' }
  ],
  model: 'anthropic/claude-3-opus',
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' }
          }
        }
      }
    }
  ]
}, apiKey);
```

### Streaming Responses

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'openai/gpt-4-turbo',
}, apiKey)) {
  if (chunk.done) {
    console.log('Done! Usage:', chunk.usage);
  } else {
    console.log(chunk.content);
  }
}
```

## Advantages of OpenRouter

1. **Model Variety**: Access to models from multiple providers with a single API
2. **Cost Optimization**: Transparent per-token pricing, often cheaper than direct APIs
3. **High Availability**: Automatic failover and load balancing
4. **No Vendor Lock-in**: Easy to switch between models
5. **Unified Authentication**: Single API key for all models
6. **Latest Models**: Quick access to newly released models
7. **Open Source Support**: Direct access to community-driven models

## Troubleshooting

### Invalid API Key
- Verify the key is correct from https://openrouter.ai
- Ensure the key has not expired
- Check that your account has active credits

### No Models Available
- Verify your API key has access to models
- Check that your account is not in a restricted region
- Some models may have usage restrictions

### Rate Limiting
- Monitor your OpenRouter dashboard for usage
- Implement exponential backoff for retries
- Consider using cheaper models if hitting limits

### Stream Errors
- Verify network connection stability
- Check OpenRouter status: https://status.openai.com
- Retry with exponential backoff

### Model-Specific Issues
- Check model documentation on https://openrouter.ai
- Some models may not support certain parameters
- Vision capability varies by model

## Support

For issues with the plugin, refer to:
- Quilltap GitHub: https://github.com/Foundry-9/F9-Quilltap
- OpenRouter Documentation: https://openrouter.ai/docs
- OpenRouter Status: https://status.openrouter.ai

## License

MIT License - See LICENSE file for details
