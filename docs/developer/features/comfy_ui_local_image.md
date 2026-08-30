# Feature Request: ComfyUI Image Generation Plugin

**Status:** Proposal / Not Implemented

> **The LoRA half of this proposal now has a host-side home.**
> [complete/nanogpt-lora.md](./complete/nanogpt-lora.md) shipped the
> provider-generic seam this document sketched: the canonical
> `loras: [{ source, scale, triggerPhrase }]` list stored on the image profile,
> the `ImageLoraSupport` capability declaration a plugin uses to opt in, the
> dedicated list editor, and one shared params builder that carries the list to
> every image call site. This proposal's `{ name, weight }` request shape *is*
> `{ source, scale }`; a ComfyUI plugin implements only the mapping onto a
> `LoraLoader` node chain and declares `loraSupport`. Nothing else in the host
> changes. Its `listLoras()` idea becomes an optional future hook
> (`listImageLoras?()`) letting the editor offer a picker instead of a bare URL
> field — additive, and not required for a first ComfyUI plugin. The
> `ImageGenPlugin` / `profileFields` vocabulary below predates the real plugin
> API and should be read as requirements, not as an interface.

## Summary

Add ComfyUI as an image generation provider via a new plugin (`qtap-plugin-imagegen-comfyui`), enabling locally-hosted Stable Diffusion image generation with full LoRA support.

## Motivation

ComfyUI provides:
- **Local/offline image generation** — No API costs, full privacy
- **LoRA support** — Train and use custom models for consistent character rendering
- **Flexible workflows** — Node-based system allows complex generation pipelines
- **MPS support** — Runs well on Apple Silicon

This complements existing cloud providers (OpenAI DALL·E, Google Imagen, Grok, OpenRouter) with a self-hosted option.

## Technical Approach

### Plugin Structure
```
plugins/qtap-plugin-imagegen-comfyui/
├── package.json
├── index.ts                 # Plugin entry point
├── lib/
│   ├── comfyui-client.ts    # WebSocket/REST client for ComfyUI API
│   ├── workflow-manager.ts  # Load, modify, and submit workflow JSON
│   └── types.ts             # TypeScript interfaces
├── workflows/
│   └── default-txt2img.json # Default workflow template (API format)
└── README.md
```

### Plugin Registration
```typescript
// index.ts
import { ImageGenPlugin, ImageGenRequest, ImageGenResult } from '@quilltap/plugin-api';

export default {
  id: 'qtap-plugin-imagegen-comfyui',
  name: 'ComfyUI',
  version: '1.0.0',
  type: 'imagegen',
  
  providerKey: 'COMFYUI',
  
  // No API key required - uses endpoint URL
  requiresApiKey: false,
  
  configSchema: {
    endpoint: { type: 'string', default: 'http://127.0.0.1:8188', label: 'ComfyUI URL' },
    defaultWorkflow: { type: 'string', default: 'default-txt2img', label: 'Default Workflow' },
    timeout: { type: 'number', default: 120000, label: 'Timeout (ms)' },
  },
  
  profileFields: [
    { key: 'workflow', type: 'select', label: 'Workflow', options: 'dynamic' },
    { key: 'loras', type: 'lora-selector', label: 'LoRAs' },
    { key: 'checkpoint', type: 'select', label: 'Checkpoint', options: 'dynamic' },
    { key: 'width', type: 'number', label: 'Width', default: 1024 },
    { key: 'height', type: 'number', label: 'Height', default: 1024 },
    { key: 'steps', type: 'number', label: 'Steps', default: 20 },
    { key: 'cfg', type: 'number', label: 'CFG Scale', default: 7 },
    { key: 'sampler', type: 'select', label: 'Sampler', options: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_sde'] },
  ],
  
  async generate(request: ImageGenRequest): Promise<ImageGenResult> {
    // Implementation in comfyui-client.ts
  },
  
  async listModels(config): Promise<string[]> {
    // GET /object_info or /models endpoint
  },
  
  async listLoras(config): Promise<LoraInfo[]> {
    // Scan ComfyUI's models/loras directory via API
  },
  
  async testConnection(config): Promise<{ success: boolean; message: string }> {
    // GET /system_stats to verify ComfyUI is running
  },
} satisfies ImageGenPlugin;
```

### ComfyUI Client
```typescript
// lib/comfyui-client.ts
import WebSocket from 'ws';

export class ComfyUIClient {
  private endpoint: string;
  private clientId: string;
  
  constructor(endpoint: string) {
    this.endpoint = endpoint;
    this.clientId = crypto.randomUUID();
  }
  
  async queuePrompt(workflow: object): Promise<string> {
    const response = await fetch(`${this.endpoint}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: workflow,
        client_id: this.clientId,
      }),
    });
    const { prompt_id } = await response.json();
    return prompt_id;
  }
  
  async waitForCompletion(promptId: string, timeout: number): Promise<ComfyUIOutput> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.endpoint}/ws?clientId=${this.clientId}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Generation timed out'));
      }, timeout);
      
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'executed' && msg.data.prompt_id === promptId) {
          clearTimeout(timer);
          ws.close();
          resolve(msg.data.output);
        }
        if (msg.type === 'execution_error') {
          clearTimeout(timer);
          ws.close();
          reject(new Error(msg.data.exception_message));
        }
      });
    });
  }
  
  async fetchImage(filename: string, subfolder: string = ''): Promise<Buffer> {
    const params = new URLSearchParams({ filename, subfolder, type: 'output' });
    const response = await fetch(`${this.endpoint}/view?${params}`);
    return Buffer.from(await response.arrayBuffer());
  }
  
  async getCheckpoints(): Promise<string[]> {
    // Parse /object_info for CheckpointLoaderSimple input options
  }
  
  async getLoras(): Promise<LoraInfo[]> {
    // Parse /object_info for LoraLoader input options
  }
}
```

### Workflow Manager
```typescript
// lib/workflow-manager.ts
export class WorkflowManager {
  private workflows: Map<string, object> = new Map();
  
  async loadWorkflow(name: string): Promise<object> {
    // Load from plugin's workflows/ directory or user-uploaded workflows
  }
  
  injectParameters(workflow: object, params: WorkflowParams): object {
    // Deep clone and modify workflow JSON
    // - Find KSampler node, set seed/steps/cfg/sampler
    // - Find CLIP Text Encode nodes, set prompt/negative
    // - Find Empty Latent Image node, set width/height
    // - Find CheckpointLoaderSimple, set checkpoint
    // - Insert/modify LoraLoader nodes for selected LoRAs
    return modifiedWorkflow;
  }
}

interface WorkflowParams {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  sampler?: string;
  checkpoint?: string;
  loras?: Array<{ name: string; weight: number }>;
}
```

## Configuration

### Environment Variables
```env
# Optional - can also be set per-profile
COMFYUI_ENDPOINT=http://127.0.0.1:8188
```

### Image Profile Schema Addition

Add to existing image profile schema:
```typescript
// For provider: 'COMFYUI'
comfyuiSettings?: {
  workflow: string;           // Workflow template name
  checkpoint: string;         // SD checkpoint to use
  loras: Array<{
    name: string;
    weight: number;           // Typically 0.0 - 1.0
  }>;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  negativePrompt?: string;
};
```

## UI Components

### Settings → Image Profiles (ComfyUI-specific)

When `COMFYUI` provider is selected:

1. **Endpoint URL** — Text input with connection test button
2. **Workflow** — Dropdown populated from available workflows (built-in + user-uploaded)
3. **Checkpoint** — Dropdown populated from ComfyUI's available checkpoints
4. **LoRA Selector** — Multi-select with weight sliders
   - List populated from ComfyUI's available LoRAs
   - Each selected LoRA gets a weight slider (0.0 - 1.0)
5. **Dimensions** — Width/Height inputs (or aspect ratio presets)
6. **Generation Settings** — Steps, CFG, Sampler dropdowns
7. **Negative Prompt** — Default negative prompt for this profile

### LoRA Management Page (Optional Enhancement)

New page under Settings for managing LoRAs:

- View installed LoRAs with preview images (if available)
- Associate LoRAs with characters (for automatic inclusion when generating that character)
- Set default weights per LoRA
- Upload trigger words / usage notes

## Integration with Existing Systems

### Physical Description Integration

Leverage existing `{{Character}}` and `{{me}}` placeholder expansion:
```typescript
// When generating for a character with a LoRA association
const characterLoras = character.imageSettings?.loras ?? [];
const profileLoras = imageProfile.comfyuiSettings?.loras ?? [];
const combinedLoras = [...profileLoras, ...characterLoras];
```

### Character Schema Addition
```typescript
// Optional per-character image generation overrides
imageSettings?: {
  loras?: Array<{ name: string; weight: number }>;
  negativePrompt?: string;
  preferredCheckpoint?: string;
};
```

### File Manager Integration

Generated images flow through existing pipeline:
1. Fetch completed image from ComfyUI `/view` endpoint
2. Upload to S3 via `addFile()`
3. Tag with chat/character via `addFileTag()`
4. Return file ID to chat for display

### Tool System Integration

Existing `generate_image` tool works with new provider:
```typescript
// tools/generate-image.ts - no changes needed if plugin conforms to ImageGenPlugin interface
const result = await imageGenRegistry.generate(profileId, {
  prompt: expandedPrompt,
  // ... other params
});
```

## Implementation Phases

### Phase 1: Basic Generation
- [ ] Plugin scaffold and registration
- [ ] ComfyUI client (queue, wait, fetch)
- [ ] Single default txt2img workflow
- [ ] Basic image profile UI fields
- [ ] Connection testing

### Phase 2: Model Selection
- [ ] Checkpoint listing and selection
- [ ] LoRA listing and multi-select
- [ ] Weight controls for LoRAs
- [ ] Sampler/steps/cfg controls

### Phase 3: Workflow Management
- [ ] Multiple built-in workflows (txt2img, img2img, inpainting)
- [ ] User workflow upload
- [ ] Workflow parameter mapping UI

### Phase 4: Character Integration
- [ ] Per-character LoRA associations
- [ ] Per-character negative prompts
- [ ] Automatic LoRA inclusion based on `{{Character}}` in prompt

### Phase 5: Advanced Features (Future)
- [ ] ControlNet integration
- [ ] img2img from chat images
- [ ] Batch generation
- [ ] Generation queue management UI

## Dependencies

Plugin dependencies:
- `ws` — WebSocket client for Node.js

No changes to core Quilltap dependencies required.

## Testing

- [ ] Unit tests for workflow parameter injection
- [ ] Unit tests for ComfyUI client (mocked responses)
- [ ] Integration test with running ComfyUI instance
- [ ] E2E test: create profile → generate image → verify in gallery

## Documentation

- [ ] Plugin README with setup instructions
- [ ] ComfyUI installation guide for macOS (MPS)
- [ ] Workflow creation guide (export as API format)
- [ ] LoRA training recommendations for character consistency

## Open Questions

1. **Workflow storage** — Store user workflows in S3 alongside files, or in MongoDB as documents?
2. **LoRA file management** — Should Quilltap have any role in managing LoRA files on disk, or purely reference what ComfyUI has available?
3. **Progress streaming** — Worth implementing SSE progress updates from ComfyUI's WebSocket events, or just show spinner until complete?
4. **Multi-user ComfyUI** — Any considerations for shared ComfyUI instances (queue prioritization, user isolation)?