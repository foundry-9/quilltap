# OpenAI-Compatible Provider Plugin for Quilltap

This plugin provides integration with OpenAI-compatible APIs, enabling Quilltap to use local and remote LLM services that implement the OpenAI API specification.

## Features

- **Chat Completions**: Access to any LLM via OpenAI-compatible APIs
- **Local Deployment**: Run models locally with LM Studio, vLLM, or Text Generation Web UI
- **Remote Services**: Connect to hosted OpenAI-compatible services
- **Streaming**: Support for streaming responses for real-time chat
- **Model Discovery**: Automatically detect available models from your deployment
- **Flexible Configuration**: Support for custom base URLs and optional API keys

## Supported Implementations

The plugin is compatible with the following OpenAI-compatible implementations:

### Local LLM Servers

- **[LM Studio](https://lmstudio.ai/)** - Desktop LLM application for running models locally
  - Default URL: `http://localhost:8080/v1`
  - Supports: Llama 2, Mistral, Neural Chat, and many more

- **[vLLM](https://github.com/vllm-project/vllm)** - High-throughput LLM serving engine
  - Default URL: `http://localhost:8000/v1`
  - Supports: LLaMA, Mistral, Qwen, Falcon, and more

- **[Text Generation Web UI](https://github.com/oobabooga/text-generation-webui)** - Browser-based interface for running LLMs
  - Default URL: `http://localhost:5000/v1`
  - OpenAI compatible extension required

- **[Ollama](https://ollama.ai/)** - Simple LLM runner with OpenAI-compatible API
  - Default URL: `http://localhost:11434/v1`
  - Supports: Llama 2, Mistral, Neural Chat, and more

### Remote/Cloud Services

- Any service implementing the OpenAI API specification
- Custom enterprise deployments
- Self-hosted solutions

## Installation

The plugin is included with Quilltap. To ensure you have the latest version of the OpenAI SDK:

```bash
npm install openai@latest
```

## Configuration

### Required Configuration

**Base URL** (Required)
- The endpoint of your OpenAI-compatible service
- Examples:
  - LM Studio: `http://localhost:8080/v1`
  - vLLM: `http://localhost:8000/v1`
  - Ollama: `http://localhost:11434/v1`
  - Text Generation Web UI: `http://localhost:5000/v1`
  - Remote service: `https://api.example.com/v1`

### Optional Configuration

**API Key** (Optional)
- Some implementations require an API key
- Others (like LM Studio, local vLLM) may not require authentication
- Leave empty if your local implementation doesn't require keys

## Getting Started

### LM Studio Setup

1. Download and install [LM Studio](https://lmstudio.ai/)
2. Load a model (e.g., Mistral 7B, Llama 2)
3. Start the local server from LM Studio
4. In Quilltap, add a new provider:
   - Provider: OpenAI-Compatible
   - Base URL: `http://localhost:8080/v1`
   - API Key: (leave empty unless required)

### vLLM Setup

1. Install vLLM: `pip install vllm`
2. Start the server:
   ```bash
   python -m vllm.entrypoints.openai.api_server \
     --model mistralai/Mistral-7B-Instruct-v0.1 \
     --port 8000
   ```
3. In Quilltap, add a new provider:
   - Provider: OpenAI-Compatible
   - Base URL: `http://localhost:8000/v1`
   - API Key: (any value, or leave empty)

### Ollama Setup

1. Download and install [Ollama](https://ollama.ai/)
2. Pull a model: `ollama pull mistral` (or your preferred model)
3. Ollama starts automatically on `http://localhost:11434`
4. In Quilltap, add a new provider:
   - Provider: OpenAI-Compatible
   - Base URL: `http://localhost:11434/v1`
   - API Key: (leave empty)

### Text Generation Web UI Setup

1. Clone and set up [text-generation-webui](https://github.com/oobabooga/text-generation-webui)
2. Start the server with OpenAI API enabled:
   ```bash
   python server.py --listen --api
   ```
3. Load a model through the web interface
4. In Quilltap, add a new provider:
   - Provider: OpenAI-Compatible
   - Base URL: `http://localhost:5000/v1`
   - API Key: (leave empty or use configured key)

## Supported Models

The plugin automatically discovers available models from your compatible API. Common models include:

### Popular Open-Source Models

- **Mistral 7B** - Fast, capable general-purpose model
- **Llama 2** - Meta's open-source model family
- **Neural Chat** - Intel's optimized conversational model
- **Zephyr** - HuggingFace's fine-tuned models
- **OpenHermes** - High-quality instruction-following model
- **Qwen** - Alibaba's multilingual models
- **Falcon** - Technology Innovation Institute's models

To see available models in your deployment:
1. Configure the base URL and API key
2. Click "Fetch Available Models" in Quilltap settings
3. Select from the discovered models

## Parameters

### Chat Completion Parameters

- **model**: The model to use (discovered from your API)
- **temperature**: Randomness of responses (0-2, default: 0.7)
- **maxTokens**: Maximum response length (default: 1000)
- **topP**: Diversity parameter (0-1, default: 1)
- **stop**: Optional stop sequences

## File Attachment Support

This plugin does not support file attachments by default. Attachment support varies by implementation and is not yet implemented for generic compatibility.

### Limitations

- Images and files cannot be sent as attachments
- Some implementations may support multimodal models (vision), but this requires implementation-specific setup
- Text content can be sent in messages

## Logging

The plugin includes comprehensive debug logging for all operations:

- API calls and responses
- Stream processing
- Connection validation
- Model discovery
- Error handling and connection issues

Set `LOG_LEVEL=debug` to see detailed operation logs.

## Performance Considerations

### Memory Requirements

Local implementations require sufficient RAM:
- 7B models: 8-16 GB RAM (or with quantization: 4-8 GB)
- 13B models: 16-24 GB RAM (or 8-16 GB with quantization)
- Larger models scale accordingly

### Speed

Performance depends on:
- Hardware (GPU acceleration recommended for speed)
- Model size (smaller models run faster)
- Batch processing
- Network latency (for remote APIs)

### Recommendations

- Use quantized models for faster inference and lower memory usage
- Enable GPU acceleration when available
- For remote APIs, monitor network latency
- Consider model size vs. capability tradeoff

## Error Handling

The plugin provides detailed error messages for:
- Connection failures to the base URL
- Invalid or missing models
- API errors from the compatible service
- Invalid parameters or unsupported features

### Troubleshooting

#### Connection Refused
- Verify the service is running on the specified base URL
- Check firewall settings if using remote services
- Ensure the correct port is specified

```bash
# Test LM Studio connection
curl http://localhost:8080/v1/models

# Test vLLM connection
curl http://localhost:8000/v1/models

# Test Ollama connection
curl http://localhost:11434/v1/models
```

#### No Models Found
- Ensure a model is loaded in your local implementation
- Check API key if the service requires authentication
- Verify the base URL is correct

#### Slow Responses
- Check available system memory
- Monitor GPU/CPU utilization
- Consider using a smaller model
- Check network latency for remote services

#### Out of Memory
- Reduce model size
- Use quantized versions of models
- Close other applications
- Reduce `maxTokens` parameter

## Network Configuration

### Local Network

For local deployments, the default addresses are:
- `http://localhost:8080/v1` (LM Studio)
- `http://127.0.0.1:8000/v1` (vLLM)
- `http://localhost:11434/v1` (Ollama)

### Remote Networks

To access a compatible API on a remote machine:
1. Ensure the service is configured to listen on all interfaces (`0.0.0.0`)
2. Update the base URL with the remote machine's IP or domain
3. Example: `http://192.168.1.100:8080/v1`

### Security Considerations

- For remote APIs, use HTTPS when available
- Protect API keys if your service requires authentication
- Consider network firewalls and VPNs for remote access
- Don't expose unencrypted local services to the internet

## Advanced Configuration

### Custom Headers

Some implementations may support custom headers. You can test connectivity:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" http://your-base-url/v1/models
```

### Rate Limiting

Compatible APIs may implement rate limiting. The plugin respects:
- 429 (Too Many Requests) responses
- Token limits per request
- Concurrent request limits (varies by implementation)

## Examples

### Basic Chat

```typescript
const response = await provider.sendMessage({
  messages: [
    { role: 'user', content: 'Hello, how are you?' }
  ],
  model: 'mistral',
}, apiKey);
```

### Streaming

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'mistral',
}, apiKey)) {
  console.log(chunk.content);
}
```

### Multi-turn Conversation

```typescript
const response = await provider.sendMessage({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the capital of France?' },
    { role: 'assistant', content: 'The capital of France is Paris.' },
    { role: 'user', content: 'Tell me more about it.' }
  ],
  model: 'mistral',
  temperature: 0.7,
}, apiKey);
```

## Limitations

- **No Image Generation**: Currently not supported (varies by implementation)
- **No Web Search**: Local models don't have web access
- **No Tool/Function Calling**: Varies by implementation and model
- **No Image Analysis**: Multimodal models not yet fully supported
- **File Attachments**: Not yet implemented for generic compatibility

## Support

For issues with the plugin, refer to:

### General Help
- Quilltap GitHub: https://github.com/Foundry-9/F9-Quilltap
- Quilltap Documentation: Check the repository README

### Implementation-Specific Help
- **LM Studio**: https://lmstudio.ai/
- **vLLM**: https://github.com/vllm-project/vllm
- **Ollama**: https://ollama.ai/
- **Text Generation Web UI**: https://github.com/oobabooga/text-generation-webui

## License

MIT License - See LICENSE file for details

## Contributing

Contributions are welcome! This plugin can be improved with:
- Support for additional compatible implementations
- Better error handling for specific services
- Multimodal capabilities
- Function calling support
- Performance optimizations

Please visit the [Quilltap repository](https://github.com/Foundry-9/F9-Quilltap) to contribute.
