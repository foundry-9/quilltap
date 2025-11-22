# Image Generation Tool for Tool-Capable LLMs

## Overview

This feature introduces a **dedicated image generation system** with its own provider abstraction, separate from chat LLM providers. Image generation profiles can be provided to tool-capable LLMs, enabling them to generate images on demand in any context.

**Key architectural decision**: Image generation uses dedicated image APIs (OpenAI Images API, Google Imagen API, Stability AI, etc.) rather than routing through chat completion APIs. This provides better control, proper API usage, and access to image-specific providers.

## Problem Statement

### Current Limitations

1. **Coupled Profiles**: A `ConnectionProfile` currently handles both chat and image generation, forcing users to choose providers that support both or forgo image generation entirely.

2. **Provider Mismatch**: Users with Claude (Anthropic) for chat cannot generate images since Anthropic doesn't support image generation.

3. **Model Coupling**: Cannot use different models from the same provider (e.g., GPT-4o for chat, DALL-E 3 for images).

4. **No Tool Integration**: Tool-capable LLMs have no standardized way to generate images mid-conversation.

5. **Cost Inflexibility**: No way to optimize costs by using cheaper chat models alongside premium image models.

6. **Wrong API Usage**: Current Google implementation routes image generation through the chat API (`generateContent`) instead of the dedicated Imagen API.

## Solution: Separate Image Generation System

### Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Quilltap                                  │
├─────────────────────────────┬───────────────────────────────────┤
│     Chat System             │     Image Generation System       │
│                             │                                   │
│  ┌─────────────────────┐    │    ┌─────────────────────────┐   │
│  │ ConnectionProfile   │    │    │ ImageProfile            │   │
│  │ - provider (LLM)    │    │    │ - provider (Image)      │   │
│  │ - modelName         │    │    │ - modelName             │   │
│  │ - apiKeyId          │    │    │ - apiKeyId              │   │
│  └─────────────────────┘    │    └─────────────────────────┘   │
│           │                 │              │                    │
│           ▼                 │              ▼                    │
│  ┌─────────────────────┐    │    ┌─────────────────────────┐   │
│  │ lib/llm/            │    │    │ lib/image-gen/          │   │
│  │ - OpenAIProvider    │    │    │ - OpenAIImageProvider   │   │
│  │ - AnthropicProvider │    │    │ - GrokImageProvider     │   │
│  │ - GoogleProvider    │    │    │ - GoogleImagenProvider  │   │
│  │ - GrokProvider      │    │    │                         │   │
│  │ - etc.              │    │    │                         │   │
│  └─────────────────────┘    │    └─────────────────────────┘   │
│           │                 │              │                    │
│           ▼                 │              ▼                    │
│  Chat Completion APIs       │    Image Generation APIs          │
│  - POST /chat/completions   │    - OpenAI /images/generations   │
│  - generateContent          │    - xAI /images/generations      │
│                             │    - Google Imagen predict API    │
└─────────────────────────────┴───────────────────────────────────┘
```

### Phase 1: Schema - New ImageProfile Model

Create a dedicated model for image generation, separate from chat profiles:

```prisma
enum ImageProvider {
  OPENAI          // gpt-image-1, DALL-E 3, DALL-E 2
  GROK            // grok-2-image (xAI)
  GOOGLE_IMAGEN   // Imagen 4, Imagen 3
}

model ImageProfile {
  id              String        @id @default(uuid())
  userId          String
  name            String
  provider        ImageProvider
  apiKeyId        String?
  baseUrl         String?       // For self-hosted or custom endpoints
  modelName       String        // e.g., "dall-e-3", "imagen-4", "stable-diffusion-3"
  parameters      Json          @default("{}")  // Provider-specific defaults
  isDefault       Boolean       @default(false)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  apiKey          ApiKey?       @relation(fields: [apiKeyId], references: [id], onDelete: SetNull)
  tags            ImageProfileTag[]

  @@unique([userId, name])
}

model ImageProfileTag {
  id              String       @id @default(uuid())
  imageProfileId  String
  tagId           String
  createdAt       DateTime     @default(now())

  imageProfile    ImageProfile @relation(fields: [imageProfileId], references: [id], onDelete: Cascade)
  tag             Tag          @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@unique([imageProfileId, tagId])
}
```

**Key design decisions:**

- **Separate `ImageProvider` enum**: Image providers are distinct from chat providers. We support three providers initially: OpenAI, Grok (xAI), and Google Imagen.
- **Dedicated `ImageProfile` model**: Completely separate from `ConnectionProfile` - no `profileType` field needed.
- **Provider-specific parameters**: JSON field for quality, style, aspect ratio, etc.
- **Tag support**: Can associate profiles with characters/personas for automatic selection.

### Phase 2: Image Provider Abstraction

Create a dedicated provider system for image generation, separate from the chat LLM providers.

**Supported Providers (Initial Release):**

- **OpenAI**: gpt-image-1, dall-e-3, dall-e-2
- **Grok (xAI)**: grok-2-image
- **Google Imagen**: imagen-4.0-generate-001, imagen-3.0-generate-002, imagen-3.0-fast-generate-001

```typescript
// lib/image-gen/base.ts

export interface ImageGenParams {
  prompt: string;
  negativePrompt?: string;
  model: string;
  n?: number;                    // Number of images
  size?: string;                 // e.g., "1024x1024"
  aspectRatio?: string;          // e.g., "16:9" (for providers that use this instead of size)
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  seed?: number;
  guidanceScale?: number;        // CFG scale for diffusion models
  steps?: number;                // Inference steps for diffusion models
}

export interface GeneratedImage {
  data: string;                  // Base64-encoded image data
  mimeType: string;
  revisedPrompt?: string;        // Some providers revise the prompt
  seed?: number;                 // Seed used for generation
}

export interface ImageGenResponse {
  images: GeneratedImage[];
  raw: unknown;                  // Provider-specific raw response
}

export abstract class ImageGenProvider {
  abstract readonly provider: string;
  abstract readonly supportedModels: string[];

  abstract generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>;
  abstract validateApiKey(apiKey: string): Promise<boolean>;
  abstract getAvailableModels(apiKey: string): Promise<string[]>;
}
```

```typescript
// lib/image-gen/openai.ts
// Uses OpenAI Images API: POST /v1/images/generations

import OpenAI from 'openai';
import { ImageGenProvider, ImageGenParams, ImageGenResponse } from './base';

export class OpenAIImageProvider extends ImageGenProvider {
  readonly provider = 'OPENAI';
  // gpt-image-1 is the latest model, dall-e-3 and dall-e-2 are legacy
  readonly supportedModels = ['gpt-image-1', 'dall-e-3', 'dall-e-2'];

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const client = new OpenAI({ apiKey });

    // gpt-image-1 has different parameter support than DALL-E models
    const isGptImage = params.model === 'gpt-image-1';

    const requestParams: any = {
      model: params.model,
      prompt: params.prompt,
      n: params.n ?? 1,
      response_format: 'b64_json',
    };

    // Size handling differs between models
    if (params.size) {
      requestParams.size = params.size;
    } else {
      requestParams.size = '1024x1024';
    }

    // quality and style are DALL-E 3 specific parameters
    if (!isGptImage) {
      requestParams.quality = params.quality ?? 'standard';
      requestParams.style = params.style ?? 'vivid';
    }

    const response = await client.images.generate(requestParams);

    return {
      images: response.data.map(img => ({
        data: img.b64_json!,
        mimeType: 'image/png',
        revisedPrompt: img.revised_prompt,
      })),
      raw: response,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new OpenAI({ apiKey });
      await client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return this.supportedModels;
  }
}
```

```typescript
// lib/image-gen/google-imagen.ts
// Uses Google Generative Language API for Imagen (same API key as Gemini)
// API: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predict

import { ImageGenProvider, ImageGenParams, ImageGenResponse } from './base';

export class GoogleImagenProvider extends ImageGenProvider {
  readonly provider = 'GOOGLE_IMAGEN';
  readonly supportedModels = [
    'imagen-4.0-generate-001',      // Latest Imagen 4
    'imagen-3.0-generate-002',      // Imagen 3
    'imagen-3.0-fast-generate-001', // Imagen 3 Fast
  ];

  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const model = params.model ?? 'imagen-4.0-generate-001';
    const endpoint = `${this.baseUrl}/models/${model}:predict`;

    const requestBody: Record<string, unknown> = {
      instances: [{
        prompt: params.prompt,
      }],
      parameters: {
        sampleCount: params.n ?? 1,
      },
    };

    // Add optional parameters
    if (params.aspectRatio) {
      (requestBody.parameters as Record<string, unknown>).aspectRatio = params.aspectRatio;
    }
    if (params.negativePrompt) {
      (requestBody.parameters as Record<string, unknown>).negativePrompt = params.negativePrompt;
    }
    if (params.seed !== undefined) {
      (requestBody.parameters as Record<string, unknown>).seed = params.seed;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `Google Imagen API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      images: data.predictions.map((pred: any) => ({
        data: pred.bytesBase64Encoded,
        mimeType: pred.mimeType || 'image/png',
      })),
      raw: data,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // Use the models list endpoint to validate the API key
      const response = await fetch(
        `${this.baseUrl}/models?key=${apiKey}`,
        { method: 'GET' }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return this.supportedModels;
  }
}
```

```typescript
// lib/image-gen/grok.ts
// Uses xAI Grok Image API: POST /v1/images/generations

import { ImageGenProvider, ImageGenParams, ImageGenResponse } from './base';

export class GrokImageProvider extends ImageGenProvider {
  readonly provider = 'GROK';
  readonly supportedModels = ['grok-2-image'];

  private baseUrl = 'https://api.x.ai/v1';

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const endpoint = `${this.baseUrl}/images/generations`;

    const requestBody: Record<string, unknown> = {
      model: params.model ?? 'grok-2-image',
      prompt: params.prompt,
    };

    // Add optional parameters if supported by the API
    if (params.n) requestBody.n = params.n;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Grok API error: ${response.status}`);
    }

    const data = await response.json();

    // Grok returns data in OpenAI-compatible format
    return {
      images: data.data.map((img: any) => ({
        data: img.b64_json,
        mimeType: 'image/png',
        revisedPrompt: img.revised_prompt,
      })),
      raw: data,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // Use a lightweight endpoint to validate the key
      const response = await fetch('https://api.x.ai/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return this.supportedModels;
  }
}
```

```typescript
// lib/image-gen/factory.ts

import { ImageGenProvider } from './base';
import { OpenAIImageProvider } from './openai';
import { GrokImageProvider } from './grok';
import { GoogleImagenProvider } from './google-imagen';

const providers: Record<string, () => ImageGenProvider> = {
  OPENAI: () => new OpenAIImageProvider(),
  GROK: () => new GrokImageProvider(),
  GOOGLE_IMAGEN: () => new GoogleImagenProvider(),
};

export function getImageGenProvider(provider: string): ImageGenProvider {
  const factory = providers[provider];
  if (!factory) {
    throw new Error(`Unknown image provider: ${provider}`);
  }
  return factory();
}
```

### Phase 3: Image Generation Tool Definition

Create a standardized tool that can be provided to any tool-capable LLM:

```typescript
// lib/tools/image-generation-tool.ts

export interface ImageGenerationToolConfig {
  profileId: string;           // The image profile to use
  allowedSizes?: string[];     // Restrict available sizes
  allowedStyles?: string[];    // Restrict available styles
  maxImagesPerCall?: number;   // Limit images per invocation
}

export const imageGenerationToolDefinition = {
  name: "generate_image",
  description: "Generate an image based on a text description. Use this when the user requests an image, illustration, artwork, or visual content.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "A detailed description of the image to generate. Be specific about style, composition, colors, and mood."
      },
      size: {
        type: "string",
        enum: ["1024x1024", "1792x1024", "1024x1792"],
        description: "Image dimensions. Use 1024x1024 for square, 1792x1024 for landscape, 1024x1792 for portrait.",
        default: "1024x1024"
      },
      style: {
        type: "string",
        enum: ["vivid", "natural"],
        description: "Image style. 'vivid' for dramatic, hyper-real images. 'natural' for more realistic, less exaggerated images.",
        default: "vivid"
      },
      quality: {
        type: "string",
        enum: ["standard", "hd"],
        description: "Image quality. 'hd' produces finer details and greater consistency.",
        default: "standard"
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 4,
        description: "Number of images to generate.",
        default: 1
      }
    },
    required: ["prompt"]
  }
};
```

### Phase 4: Tool Execution Handler

```typescript
// lib/tools/handlers/image-generation-handler.ts

import { getImageGenProvider } from '@/lib/image-gen/factory';
import { saveGeneratedImage } from '@/lib/images/storage';
import prisma from '@/lib/prisma';

export interface ImageToolInput {
  prompt: string;
  negativePrompt?: string;
  size?: string;
  aspectRatio?: string;
  style?: string;
  quality?: string;
  count?: number;
}

export interface ImageToolOutput {
  success: boolean;
  images?: Array<{
    id: string;
    url: string;
    filename: string;
    revisedPrompt?: string;
  }>;
  error?: string;
}

export async function executeImageGenerationTool(
  input: ImageToolInput,
  config: ImageGenerationToolConfig,
  userId: string
): Promise<ImageToolOutput> {
  try {
    // 1. Load the image profile (from ImageProfile, not ConnectionProfile)
    const profile = await prisma.imageProfile.findFirst({
      where: {
        id: config.profileId,
        userId,
      },
      include: { apiKey: true }
    });

    if (!profile) {
      return { success: false, error: 'Image generation profile not found or not authorized' };
    }

    if (!profile.apiKey?.key) {
      return { success: false, error: 'No API key configured for image profile' };
    }

    // 2. Get the dedicated image generation provider
    const provider = getImageGenProvider(profile.provider);

    // 3. Merge profile defaults with request parameters
    const profileParams = profile.parameters as Record<string, unknown>;

    const count = Math.min(
      input.count || 1,
      config.maxImagesPerCall || 4
    );

    // 4. Generate the image(s) using dedicated image API
    const response = await provider.generateImage({
      prompt: input.prompt,
      negativePrompt: input.negativePrompt || profileParams.negativePrompt as string,
      model: profile.modelName,
      size: input.size || profileParams.size as string,
      aspectRatio: input.aspectRatio || profileParams.aspectRatio as string,
      style: input.style || profileParams.style as string,
      quality: input.quality || profileParams.quality as string,
      n: count,
      guidanceScale: profileParams.guidanceScale as number,
      steps: profileParams.steps as number,
    }, profile.apiKey.key);

    // 5. Save images and create database records
    const savedImages = await Promise.all(
      response.images.map(async (imageData) => {
        const saved = await saveGeneratedImage({
          data: imageData.data,
          mimeType: imageData.mimeType,
          userId,
          prompt: input.prompt,
          revisedPrompt: imageData.revisedPrompt,
          model: profile.modelName,
          provider: profile.provider,
          seed: imageData.seed,
        });
        return { ...saved, revisedPrompt: imageData.revisedPrompt };
      })
    );

    return {
      success: true,
      images: savedImages.map(img => ({
        id: img.id,
        url: `/api/images/${img.id}`,
        filename: img.filename,
        revisedPrompt: img.revisedPrompt,
      }))
    };

  } catch (error) {
    console.error('Image generation tool error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Image generation failed'
    };
  }
}
```

### Phase 5: Tool Registry

Create a system to register and manage available tools for LLM conversations:

```typescript
// lib/tools/registry.ts

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: object;
  handler: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  userId: string;
  chatId?: string;
  config: Record<string, unknown>;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  // Convert to provider-specific format
  toOpenAIFormat(): OpenAI.ChatCompletionTool[] {
    return this.getAll().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  toAnthropicFormat(): Anthropic.Tool[] {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }
}
```

### Phase 6: Chat Integration

Update the chat message handler to support tool use:

```typescript
// In app/api/chats/[id]/messages/route.ts

interface ChatConfig {
  connectionProfileId: string;
  imageProfileId?: string;      // Optional separate image profile
  enabledTools?: string[];      // Which tools are available
}

async function handleToolCall(
  toolName: string,
  toolInput: unknown,
  chatConfig: ChatConfig,
  userId: string
): Promise<unknown> {
  const registry = getToolRegistry();
  const tool = registry.get(toolName);

  if (!tool) {
    return { error: `Unknown tool: ${toolName}` };
  }

  // Build context with appropriate profile
  const context: ToolContext = {
    userId,
    chatId: chatConfig.chatId,
    config: {}
  };

  if (toolName === 'generate_image' && chatConfig.imageProfileId) {
    context.config.profileId = chatConfig.imageProfileId;
  }

  return tool.handler(toolInput, context);
}
```

### Phase 7: API Endpoints

#### Image Profile CRUD

```typescript
// app/api/image-profiles/route.ts
// Dedicated endpoints for image profiles (separate from chat profiles)

import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { getImageGenProvider } from '@/lib/image-gen/factory';

// GET /api/image-profiles
// List all image generation profiles for the user
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profiles = await prisma.imageProfile.findMany({
    where: { userId: session.user.id },
    include: {
      apiKey: { select: { id: true, name: true } },  // Don't expose key
      tags: { include: { tag: true } },
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });

  return Response.json(profiles);
}

// POST /api/image-profiles
// Create a new image generation profile
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { name, provider, apiKeyId, baseUrl, modelName, parameters, isDefault } = body;

  // Validate provider
  try {
    getImageGenProvider(provider);
  } catch {
    return Response.json({ error: `Invalid image provider: ${provider}` }, { status: 400 });
  }

  // If setting as default, clear other defaults
  if (isDefault) {
    await prisma.imageProfile.updateMany({
      where: { userId: session.user.id, isDefault: true },
      data: { isDefault: false },
    });
  }

  const profile = await prisma.imageProfile.create({
    data: {
      userId: session.user.id,
      name,
      provider,
      apiKeyId,
      baseUrl,
      modelName,
      parameters: parameters || {},
      isDefault: isDefault || false,
    },
  });

  return Response.json(profile, { status: 201 });
}
```

```typescript
// app/api/image-profiles/[id]/route.ts

// GET /api/image-profiles/[id]
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profile = await prisma.imageProfile.findFirst({
    where: { id: params.id, userId: session.user.id },
    include: {
      apiKey: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
    },
  });

  if (!profile) {
    return Response.json({ error: 'Profile not found' }, { status: 404 });
  }

  return Response.json(profile);
}

// PUT /api/image-profiles/[id]
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { name, provider, apiKeyId, baseUrl, modelName, parameters, isDefault } = body;

  // If setting as default, clear other defaults
  if (isDefault) {
    await prisma.imageProfile.updateMany({
      where: { userId: session.user.id, isDefault: true, id: { not: params.id } },
      data: { isDefault: false },
    });
  }

  const profile = await prisma.imageProfile.update({
    where: { id: params.id },
    data: { name, provider, apiKeyId, baseUrl, modelName, parameters, isDefault },
  });

  return Response.json(profile);
}

// DELETE /api/image-profiles/[id]
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await prisma.imageProfile.delete({
    where: { id: params.id },
  });

  return new Response(null, { status: 204 });
}
```

#### Get Available Models for Provider

```typescript
// GET /api/image-profiles/models?provider=OPENAI&apiKeyId=xxx
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get('provider');
  const apiKeyId = searchParams.get('apiKeyId');

  if (!provider) {
    return Response.json({ error: 'Provider required' }, { status: 400 });
  }

  const imageProvider = getImageGenProvider(provider);

  if (apiKeyId) {
    const apiKey = await prisma.apiKey.findFirst({
      where: { id: apiKeyId, userId: session.user.id },
    });
    if (apiKey) {
      const models = await imageProvider.getAvailableModels(apiKey.key);
      return Response.json({ models });
    }
  }

  // Return default models without API key validation
  return Response.json({ models: imageProvider.supportedModels });
}
```

### Phase 8: UI Components

#### Image Profile Form

```tsx
// components/image-profiles/ImageProfileForm.tsx

import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const IMAGE_PROVIDERS = [
  { value: 'OPENAI', label: 'OpenAI (DALL-E / GPT Image)' },
  { value: 'GROK', label: 'Grok (xAI)' },
  { value: 'GOOGLE_IMAGEN', label: 'Google Imagen' },
];

interface ImageProfileFormProps {
  profile?: ImageProfile;
  onSubmit: (data: ImageProfileFormData) => void;
}

export function ImageProfileForm({ profile, onSubmit }: ImageProfileFormProps) {
  const [provider, setProvider] = useState(profile?.provider || 'OPENAI');

  const { data: models } = useQuery({
    queryKey: ['image-models', provider],
    queryFn: () => fetch(`/api/image-profiles/models?provider=${provider}`).then(r => r.json()),
  });

  const { data: apiKeys } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => fetch('/api/api-keys').then(r => r.json()),
  });

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Profile Name</Label>
          <Input id="name" defaultValue={profile?.name} required />
        </div>

        <div>
          <Label htmlFor="provider">Provider</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger>
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {IMAGE_PROVIDERS.map(p => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="apiKey">API Key</Label>
          <Select defaultValue={profile?.apiKeyId}>
            <SelectTrigger>
              <SelectValue placeholder="Select API key" />
            </SelectTrigger>
            <SelectContent>
              {apiKeys?.map(key => (
                <SelectItem key={key.id} value={key.id}>{key.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="model">Model</Label>
          <Select defaultValue={profile?.modelName}>
            <SelectTrigger>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models?.models?.map(model => (
                <SelectItem key={model} value={model}>{model}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Provider-specific parameters */}
        <ImageProfileParameters provider={provider} defaults={profile?.parameters} />
      </div>
    </form>
  );
}
```

#### Image Profile Picker (for Chat Settings)

```tsx
// components/chat/ImageProfilePicker.tsx

export function ImageProfilePicker({
  value,
  onChange
}: ImageProfilePickerProps) {
  const { data: profiles } = useQuery({
    queryKey: ['image-profiles'],
    queryFn: () => fetch('/api/image-profiles').then(r => r.json())
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select image generation profile" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">No image generation</SelectItem>
        {profiles?.map(profile => (
          <SelectItem key={profile.id} value={profile.id}>
            <div className="flex items-center gap-2">
              <ProviderIcon provider={profile.provider} className="h-4 w-4" />
              <span>{profile.name}</span>
              <span className="text-muted-foreground text-sm">({profile.modelName})</span>
              {profile.isDefault && <Badge variant="secondary">Default</Badge>}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

#### Provider-Specific Parameters

```tsx
// components/image-profiles/ImageProfileParameters.tsx

interface ImageProfileParametersProps {
  provider: string;
  defaults?: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}

export function ImageProfileParameters({ provider, defaults, onChange }: ImageProfileParametersProps) {
  // Different providers have different parameters
  switch (provider) {
    case 'OPENAI':
      return (
        <div className="space-y-3">
          <div>
            <Label>Quality</Label>
            <Select defaultValue={defaults?.quality as string || 'standard'}>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="hd">HD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Style</Label>
            <Select defaultValue={defaults?.style as string || 'vivid'}>
              <SelectContent>
                <SelectItem value="vivid">Vivid</SelectItem>
                <SelectItem value="natural">Natural</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );

    case 'GOOGLE_IMAGEN':
      return (
        <div className="space-y-3">
          <div>
            <Label>Aspect Ratio</Label>
            <Select defaultValue={defaults?.aspectRatio as string || '1:1'}>
              <SelectContent>
                <SelectItem value="1:1">Square (1:1)</SelectItem>
                <SelectItem value="16:9">Landscape (16:9)</SelectItem>
                <SelectItem value="9:16">Portrait (9:16)</SelectItem>
                <SelectItem value="4:3">Standard (4:3)</SelectItem>
                <SelectItem value="3:2">Photo (3:2)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );

    case 'GROK':
      // Grok has minimal parameters - just prompt
      return null;

    default:
      return null;
  }
}
```

## Implementation Checklist

### 1. Schema & Migration

- [x] Add `ImageProvider` enum to Prisma schema
- [x] Create `ImageProfile` model (separate from ConnectionProfile)
- [x] Create `ImageProfileTag` junction table
- [x] Add `imageProfiles` relation to User model
- [x] Add `imageProfiles` relation to ApiKey model
- [x] Create and run migration

#### Status: ✅ COMPLETED

Migration: `prisma/migrations/20251122045746_phase_1_image_profiles/`

#### Changes Made

- Added `ImageProvider` enum with values: OPENAI, GROK, GOOGLE_IMAGEN
- Created `ImageProfile` model with fields:
  - `id`, `userId`, `name`, `provider`, `apiKeyId`, `baseUrl`, `modelName`, `parameters`, `isDefault`, `createdAt`, `updatedAt`
  - Relations: User (cascade delete), ApiKey (set null on delete), ImageProfileTag[]
  - Unique constraint on (userId, name)
  - Index on (userId, isDefault)
- Created `ImageProfileTag` junction table linking ImageProfile to Tag
  - Unique constraint on (imageProfileId, tagId)
- Updated User model to include `imageProfiles` relation
- Updated ApiKey model to include `imageProfiles` relation
- Updated Tag model to include `imageProfileTags` relation

### 2. Image Provider Abstraction

- [x] Create `lib/image-gen/base.ts` with abstract `ImageGenProvider` class
- [x] Implement `OpenAIImageProvider` using OpenAI Images API
- [x] Implement `GrokImageProvider` using xAI Images API
- [x] Implement `GoogleImagenProvider` using Google Generative Language API
- [x] Create `lib/image-gen/factory.ts` with provider factory function
- [ ] Add unit tests for each provider

Status: ✅ COMPLETED

Implementation Files: `lib/image-gen/` directory with base.ts, openai.ts, grok.ts, google-imagen.ts, and factory.ts

Details:

- Created `lib/image-gen/base.ts`:
  - `ImageGenParams` interface with full parameter support for all providers
  - `GeneratedImage` interface for image responses
  - `ImageGenResponse` interface with raw provider response
  - `ImageGenProvider` abstract base class with three abstract methods

- Created `lib/image-gen/openai.ts`:
  - `OpenAIImageProvider` class supporting gpt-image-1, dall-e-3, dall-e-2
  - Proper handling of model-specific parameters (quality, style only for DALL-E 3)
  - Base64 response format for consistency
  - API key validation using models.list() endpoint

- Created `lib/image-gen/grok.ts`:
  - `GrokImageProvider` class supporting grok-2-image
  - Direct HTTP requests to xAI API (can also use OpenAI SDK with custom base URL)
  - Minimal parameter set (no quality/style/size)
  - API key validation using models endpoint

- Created `lib/image-gen/google-imagen.ts`:
  - `GoogleImagenProvider` class supporting imagen-4.0, imagen-3.0, imagen-3.0-fast
  - Proper parameter handling for aspect ratio and negative prompts
  - API key validation using models list endpoint
  - Base64 image extraction from predictions

- Created `lib/image-gen/factory.ts`:
  - `getImageGenProvider()` factory function with type-safe provider lookup
  - `getSupportedImageProviders()` helper to list available providers
  - Error handling for unknown providers

### 3. Tool Definition

- [x] Create `lib/tools/image-generation-tool.ts` with tool schema
- [x] Define `ImageGenerationToolConfig` interface
- [x] Export tool definition in OpenAI and Anthropic formats

Status: ✅ COMPLETED

Implementation Files: `lib/tools/image-generation-tool.ts` and `lib/tools/registry.ts`

Details:

- Created `lib/tools/image-generation-tool.ts`:
  - `ImageGenerationToolInput` interface for LLM tool parameters
  - `ImageGenerationToolConfig` interface for tool configuration
  - `GeneratedImageResult` interface for image response metadata
  - `ImageGenerationToolOutput` interface for tool execution results
  - OpenAI format tool definition (function calling)
  - Anthropic format tool definition (tool_use)
  - `validateImageGenerationInput()` function for input validation
  - `getProviderConstraints()` for provider-specific capabilities
  - Helper functions: `getOpenAIImageGenerationTool()`, `getAnthropicImageGenerationTool()`

- Created `lib/tools/registry.ts`:
  - `ToolRegistry` class for managing available tools
  - `getToolRegistry()` singleton accessor
  - `toOpenAIFormat()` - Converts tools to OpenAI function calling format
  - `toAnthropicFormat()` - Converts tools to Anthropic tool_use format
  - `toGoogleFormat()` - Converts tools to Google format
  - `toProviderFormat()` - Provider-aware tool format conversion
  - Support for: OpenAI, Anthropic, Grok, Ollama, OpenRouter, Gab AI

- Created `lib/tools/index.ts`:
  - Central exports for all tool functionality
  - Re-exports tool definitions and registry

### 4. Tool Execution Handler

- [x] Create `lib/tools/handlers/image-generation-handler.ts`
- [x] Implement profile loading and validation
- [x] Implement parameter merging (profile defaults + request params)
- [x] Integrate with image storage service
- [x] Add error handling and logging

Status: ✅ COMPLETED

Implementation Files: `lib/tools/handlers/image-generation-handler.ts`

Details:

- Created `lib/tools/handlers/image-generation-handler.ts`:
  - `executeImageGenerationTool()` - Main tool execution function
  - `validateImageProfile()` - Profile validation utility
  - `getDefaultImageProfile()` - Get user's default profile
  - `ImageGenerationError` - Custom error class
  - `ImageToolExecutionContext` - Execution context type
  - `loadAndValidateProfile()` - Profile loading with error handling
  - `generateImagesWithProvider()` - Provider integration and image generation
  - `saveGeneratedImage()` - Image storage and database integration
  - `mergeParameters()` - Profile defaults + user input merging
  - Full error handling with descriptive messages
  - API key decryption using encryption module
  - Comprehensive validation and logging

### 5. Tool Registry

- [x] Create `lib/tools/registry.ts` with `ToolRegistry` class
- [x] Implement tool registration and lookup
- [x] Add format converters for different LLM providers
- [x] Register image generation tool

Status: ✅ COMPLETED (included in Phase 3)

This was implemented as part of Phase 3 to provide central tool management.

### 6. Chat Integration

- [x] Add optional `imageProfileId` to Chat model
- [x] Update chat creation to accept image profile
- [x] Update message handler to detect and execute tool calls
- [x] Implement tool result formatting for conversation context

Status: ✅ COMPLETED

Implementation Files: `lib/chat/tool-executor.ts`, `app/api/chats/[id]/messages/route.ts`, database migration

Details:

- **Database Schema** (`prisma/schema.prisma`):
  - Added optional `imageProfileId` field to Chat model
  - Added foreign key relation to ImageProfile (ON DELETE SET NULL)
  - Added reverse relation in ImageProfile model
  - Migration: `20251122052502_phase_5_chat_image_profile`

- **Tool Execution Module** (`lib/chat/tool-executor.ts`):
  - `executeToolCall()` - Execute image generation tool requests
  - `detectToolCalls()` - Detect tool calls in LLM responses (OpenAI, Anthropic, Grok formats)
  - `formatToolResult()` - Format results for conversation context
  - Type-safe tool call and result handling

- **Message Handler Enhancement** (`app/api/chats/[id]/messages/route.ts`):
  - Load imageProfile with chat
  - Detect tool calls after LLM response
  - Execute tools with image profile
  - Stream tool results to client in real-time
  - Save tool results in conversation history
  - Helper functions: streamLLMResponse(), updateAttachmentStatus(), processToolCalls(), saveToolResults()

- **Streaming Integration**:
  - Stream tool detection: `toolsDetected` event
  - Stream tool results: `toolResult` events
  - Final status: `toolsExecuted` flag
  - Graceful error handling in tool execution

### 7. API Endpoints

- [x] Create `app/api/image-profiles/route.ts` (list, create)
- [x] Create `app/api/image-profiles/[id]/route.ts` (get, update, delete)
- [x] Create `app/api/image-profiles/models/route.ts` (get available models)
- [x] Add API key validation endpoint for image providers

Status: ✅ COMPLETED

Implementation Files: `app/api/image-profiles/`, `PHASE_6_IMPLEMENTATION_SUMMARY.md`

Details:

- **Created `app/api/image-profiles/route.ts`**:
  - `GET /api/image-profiles` - List all user image profiles with sorting by character/persona tags
  - `POST /api/image-profiles` - Create new profile with validation and duplicate prevention
  - Includes API key and tag information in responses

- **Created `app/api/image-profiles/[id]/route.ts`**:
  - `GET /api/image-profiles/[id]` - Get specific profile with all metadata
  - `PUT /api/image-profiles/[id]` - Update profile with partial update support
  - `DELETE /api/image-profiles/[id]` - Delete profile (cascades to chats)
  - Ownership verification on all operations

- **Created `app/api/image-profiles/models/route.ts`**:
  - `GET /api/image-profiles/models?provider=X&apiKeyId=Y` - Get available models
  - Supports both stored keys (decrypted) and direct validation
  - Graceful fallback to default models on API errors
  - Returns provider-specific model lists

- **Created `app/api/image-profiles/validate-key/route.ts`**:
  - `POST /api/image-profiles/validate-key` - Validate API keys before saving
  - Supports apiKeyId (stored) and apiKey (direct) modes
  - Returns validation status and available models if valid
  - Provider-specific validation logic

### 8. UI Components

- [x] Create `ImageProfileForm` component
- [x] Create `ImageProfilePicker` component for chat settings
- [x] Create `ImageProfileParameters` component (provider-specific)
- [x] Add image profiles section to settings page
- [x] Update chat settings to include image profile selection

Status: ✅ COMPLETED

Implementation Files: `components/image-profiles/`, `components/settings/image-profiles-tab.tsx`, `PHASE_7_IMPLEMENTATION_SUMMARY.md`

Details:

- **Created `components/image-profiles/ImageProfileForm.tsx`**:
  - Reusable form for creating and editing image profiles
  - Full form validation with error messages
  - Dynamic provider selection
  - API key selection with compatibility checking
  - Real-time API key validation against provider endpoints
  - Dynamic model discovery based on provider and API key
  - Support for both create and edit modes
  - Default profile management

- **Created `components/image-profiles/ImageProfileParameters.tsx`**:
  - Provider-specific parameter configuration
  - OpenAI: quality, style, size
  - Google Imagen: aspect ratio, negative prompt
  - Grok: minimal parameters with info
  - Context-aware UI based on selected provider

- **Created `components/image-profiles/ImageProfilePicker.tsx`**:
  - Dropdown selector for image profile selection in chats
  - Tag-based sorting by character/persona
  - Profile detail preview
  - Supports null selection (no image generation)
  - Loading and error states

- **Created `components/image-profiles/ProviderIcon.tsx`**:
  - ProviderIcon component with SVG icons
  - ProviderBadge component for profile listings
  - Color-coded by provider
  - Customizable sizing

- **Created `components/settings/image-profiles-tab.tsx`**:
  - Main settings tab for profile management
  - List, create, edit, delete profiles
  - Profile detail cards with parameters
  - Delete confirmation dialog
  - Empty state with CTA
  - Full form integration
  - Error handling and feedback

### 9. Migration from Legacy System

- [ ] Create migration script to identify existing image-capable ConnectionProfiles
- [ ] Optionally create corresponding ImageProfiles for users
- [ ] Update existing image generation endpoint to use new system
- [ ] Remove `supportsImageGeneration` from LLM providers (deprecate)

### 10. Testing & Documentation

- [ ] Unit tests for image providers
- [ ] Unit tests for tool execution
- [ ] Integration tests for tool calls in chat
- [ ] API documentation for new endpoints
- [ ] User guide for creating and using image profiles

## Usage Examples

### Example 1: Creating an Image Profile

```typescript
// User creates a dedicated DALL-E 3 image profile
const imageProfile = await fetch('/api/image-profiles', {
  method: 'POST',
  body: JSON.stringify({
    name: "DALL-E 3 HD",
    provider: "OPENAI",
    modelName: "dall-e-3",
    apiKeyId: openaiKeyId,
    parameters: {
      quality: "hd",
      style: "vivid"
    },
    isDefault: true
  })
}).then(r => r.json());

// User creates a Stability AI profile for a different style
const stabilityProfile = await fetch('/api/image-profiles', {
  method: 'POST',
  body: JSON.stringify({
    name: "Stable Diffusion Anime",
    provider: "STABILITY",
    modelName: "stable-diffusion-3",
    apiKeyId: stabilityKeyId,
    parameters: {
      aspectRatio: "16:9",
      negativePrompt: "photorealistic, photo, realistic"
    }
  })
}).then(r => r.json());
```

### Example 2: Chat with Image Capabilities

```typescript
// Create a chat that uses Claude for conversation
// but DALL-E for image generation
const chat = await createChat({
  connectionProfileId: claudeProfileId,  // For chat (Anthropic)
  imageProfileId: dalleProfileId,        // For images (OpenAI DALL-E)
  enabledTools: ["generate_image"]
});

// The LLM provider used for chat is completely independent
// from the provider used for image generation
```

### Example 3: Tool Invocation by LLM

When the user asks "Can you create an image of a sunset over mountains?", the LLM receives:

```json
{
  "tools": [{
    "type": "function",
    "function": {
      "name": "generate_image",
      "description": "Generate an image based on a text description..."
    }
  }]
}
```

The LLM responds with a tool call:

```json
{
  "tool_calls": [{
    "function": {
      "name": "generate_image",
      "arguments": {
        "prompt": "A breathtaking sunset over majestic mountain peaks, warm orange and purple hues reflecting off snow-capped summits, dramatic clouds catching the last light of day, photorealistic style",
        "size": "1792x1024",
        "style": "vivid",
        "quality": "hd"
      }
    }
  }]
}
```

The system executes this using the configured image profile and returns the result.

## Security Considerations

1. **Profile Authorization**: Always verify the profile belongs to the requesting user
2. **API Key Isolation**: Image profiles can use separate API keys with different quotas
3. **Rate Limiting**: Apply rate limits per profile to prevent abuse
4. **Content Filtering**: Leverage provider-side content filters for generated images
5. **Audit Logging**: Log all image generation requests with profile and prompt details

## Future Enhancements

### Additional Providers

The architecture supports adding more image generation providers. Potential additions:

- **Stability AI**: Stable Diffusion 3, SDXL, Stable Image Core/Ultra
- **Replicate**: Access to many open-source models (Flux, SDXL variants, etc.)
- **Fal.ai**: Fast inference for various models
- **Together AI**: Image generation models
- **Fireworks AI**: Image generation models
- **BFL**: Flux models (Flux Pro, Flux Dev)
- **Leonardo.AI**: Specialized art generation
- **Midjourney**: If/when API becomes available

### Feature Enhancements

1. **Profile Sharing**: Allow users to share image profiles (without API keys) as templates
2. **Profile Presets**: Pre-configured profiles for common use cases (art styles, photo-realistic, etc.)
3. **Cost Tracking**: Track generation costs per profile using provider-specific pricing
4. **Batch Generation**: Queue multiple generation requests with progress tracking
5. **Image Editing Tools**: Add `edit_image` and `variation` tools using the same profile system
6. **LoRA/Fine-tuned Models**: Support for custom models and LoRAs where providers allow
7. **Image-to-Image**: Support inpainting, outpainting, and image variation APIs
8. **Provider Health Monitoring**: Track provider availability and automatically failover
9. **Negative Prompts**: Add UI support for negative prompts (currently only in profile parameters)
