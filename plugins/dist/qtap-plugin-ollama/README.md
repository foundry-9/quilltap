# Ollama Provider Plugin for Quilltap

This plugin provides integration with Ollama, enabling Quilltap to use open-source LLM models running locally on your machine or a remote server. Run powerful AI models completely offline with no cloud dependencies.

## Features

- **Local Inference**: Run LLM models on your own hardware with no internet required
- **Offline Support**: Complete AI capabilities without relying on cloud services
- **Multiple Models**: Support for Llama 2, Mistral, Neural Chat, Dolphin, and many others
- **Multimodal Models**: Support for vision-capable models like LLaVA for image analysis
- **Zero Cost**: Use open-source models without API fees
- **Streaming**: Support for streaming responses for real-time chat
- **Remote Server**: Connect to Ollama running on other machines in your network
- **Embeddings**: Support for embedding models through compatible Ollama installations

## Installation

### Prerequisites

1. **Install Ollama**: Download from https://ollama.ai
2. **Start Ollama**: The Ollama server runs on `http://localhost:11434` by default
3. **Pull a Model**: Example: `ollama pull llama2`

### In Quilltap

The plugin is included with Quilltap. No additional dependencies required since Ollama communicates via HTTP API.

## Configuration

### Server Connection

1. Ensure Ollama is running locally or accessible at a specific address
2. In Quilltap settings, configure the Ollama provider with:
   - **Base URL**: The HTTP endpoint (default: `http://localhost:11434`)
   - **No API Key required**: Ollama doesn't use API authentication by default

### Network Access

For remote Ollama servers:
- Make sure the Ollama server is accessible from your network
- Default port: `11434`
- Example remote URL: `http://192.168.1.100:11434`

## Supported Models

### Popular Conversation Models

| Model | Size | Speed | Best For |
|-------|------|-------|----------|
| llama2 | 7B-70B | Fast | General purpose chat |
| mistral | 7B | Very Fast | Fast responses |
| neural-chat | 7B | Fast | Instruction following |
| orca-mini | 3B-13B | Very Fast | Small devices |
| dolphin-mixtral | 8x7B | Moderate | Complex reasoning |

### Vision Models

| Model | Capabilities |
|-------|--------------|
| llava | Image analysis and description |
| llava-phi | Lightweight image understanding |

### Specialized Models

| Model | Purpose |
|-------|---------|
| codellama | Code generation |
| nomic-embed-text | Text embeddings |
| all-minilm | Fast embeddings |

## Getting Started

### Pull a Model

```bash
# Pull Llama 2
ollama pull llama2

# Or Mistral for faster responses
ollama pull mistral

# Or LLaVA for vision capabilities
ollama pull llava
```

### Verify Installation

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# You should see a JSON response with available models
```

## File Attachment Support

File attachments are not yet supported. However, if using a multimodal model like LLaVA, you can describe images in text form, and the model may be able to process them with proper instructions.

## Parameters

### Chat Completion Parameters

- **model**: The model to use (e.g., 'llama2', 'mistral', 'llava')
- **temperature**: Randomness of responses (0-1, default: 0.7)
  - Lower = more focused and deterministic
  - Higher = more creative and diverse
- **maxTokens**: Maximum response length (default: 1000)
- **topP**: Diversity parameter (0-1, default: 1)
- **tools**: Function definitions for tool use (if supported by model)

## Logging

The plugin includes comprehensive debug logging for all operations:

- Server connection validation
- Available models listing
- API calls and responses
- Stream processing
- Error handling and diagnostics

Set `LOG_LEVEL=debug` to see detailed operation logs.

## Performance Considerations

### Hardware Requirements

**Minimum** (for small models like Mistral 7B):
- 8GB RAM
- 5GB disk space
- Modern CPU or GPU

**Recommended** (for larger models like Llama 2 70B):
- 32GB+ RAM
- GPU with 24GB+ VRAM (NVIDIA/AMD)
- 100GB+ disk space

### Speed Optimization

1. **Use smaller models** for faster responses: mistral, neural-chat
2. **Enable GPU acceleration** if available (Ollama auto-detects)
3. **Adjust temperature** down for faster convergence
4. **Reduce max tokens** if you don't need long responses

## Network Setup

### Local Network Access

To share your Ollama instance across your local network:

```bash
# On Mac/Linux, set environment variable
OLLAMA_HOST=0.0.0.0:11434 ollama serve

# Or on Windows, modify the Ollama startup configuration
```

Then connect from other machines using:
```
http://<your-machine-ip>:11434
```

### Security Note

Ollama doesn't have built-in authentication. If exposing to untrusted networks:
- Use a firewall to restrict access
- Use a reverse proxy with authentication
- Bind to localhost only in untrusted environments

## Error Handling

### Common Issues

#### "Connection refused"
- Verify Ollama is running: `ollama serve`
- Check the base URL matches your Ollama instance
- For remote servers, verify network connectivity

#### "No models available"
- Pull a model: `ollama pull llama2`
- Verify models are installed: `ollama list`

#### "Out of memory"
- Use a smaller model (see model sizes above)
- Reduce `maxTokens` parameter
- Close other applications
- Enable GPU acceleration if available

#### "Slow responses"
- Check hardware performance
- Try a smaller model
- Reduce concurrent requests
- Monitor Ollama logs: check system resources

## Troubleshooting

### Check Ollama Status

```bash
# Verify Ollama is running
curl http://localhost:11434/api/tags

# See available models
ollama list

# Monitor logs
ollama logs
```

### Enable Debug Logging

Set `LOG_LEVEL=debug` in Quilltap to see:
- All API requests and responses
- Model loading information
- Performance metrics
- Connection diagnostics

### Restart Ollama

```bash
# Stop Ollama
killall ollama

# Restart
ollama serve
```

## Advantages vs Cloud Providers

| Feature | Ollama (Local) | Cloud LLMs |
|---------|---|---|
| Cost | Free | Per API call |
| Privacy | Complete | Data sent to servers |
| Speed | Local latency | Network latency |
| Offline | Yes | No |
| Customization | Full | Limited |
| Setup | Install locally | API key + account |

## Examples

### Basic Chat

```typescript
const response = await provider.sendMessage({
  messages: [
    { role: 'user', content: 'What is machine learning?' }
  ],
  model: 'llama2',
}, '');
```

### Streaming Response

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'mistral',
}, '')) {
  console.log(chunk.content);
}
```

### Vision Analysis (with llava)

```typescript
const response = await provider.sendMessage({
  messages: [
    {
      role: 'user',
      content: 'Describe this image in detail'
      // Note: Direct image attachments not yet supported
      // Describe image contents in text instead
    }
  ],
  model: 'llava',
}, '');
```

### Different Models for Different Tasks

```typescript
// Fast responses
const quick = await provider.sendMessage({
  messages: [{ role: 'user', content: 'Hello!' }],
  model: 'mistral', // Fastest 7B model
}, '');

// Better quality
const quality = await provider.sendMessage({
  messages: [{ role: 'user', content: 'Explain quantum computing' }],
  model: 'llama2:13b', // Larger model for better responses
}, '');
```

## Integration Tips

### Set as Default Local Provider

In Quilltap settings, you can set Ollama as your default provider when offline, providing a seamless fallback from cloud providers.

### Combine with Other Providers

Use Ollama for:
- Local testing before using expensive cloud APIs
- Privacy-sensitive conversations
- Offline operation
- Development and prototyping

### Monitor Resource Usage

Keep an eye on:
- Memory consumption during inference
- Disk space for model storage
- CPU/GPU utilization
- Network bandwidth (if using remote server)

## Models Disk Space

- Mistral 7B: 5GB
- Llama 2 7B: 4GB
- Llama 2 13B: 8GB
- Llama 2 70B: 40GB
- Orca Mini: 2-3GB
- LLaVA: 5GB
- Dolphin Mixtral: 26GB

## Support & Resources

For issues and information:
- **Ollama Official**: https://ollama.ai
- **Model Library**: https://ollama.ai/library
- **Quilltap GitHub**: https://github.com/Foundry-9/F9-Quilltap
- **Community**: https://github.com/jmorganca/ollama/discussions

## License

MIT License - See LICENSE file for details

## Notes

- Ollama is an open-source project maintained independently
- Models used with this plugin are subject to their respective licenses
- This plugin communicates with Ollama via the standard HTTP API
- All inference happens locally on your hardware
