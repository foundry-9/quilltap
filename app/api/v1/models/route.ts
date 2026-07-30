/**
 * Models API v1
 *
 * GET /api/v1/models - List available models
 * GET /api/v1/models?provider=openai - Filter models by provider
 * POST /api/v1/models - Fetch models from a specific provider
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import {
  successResponse,
  badRequest,
  notFound,
} from '@/lib/api/responses';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { createLLMProvider } from '@/lib/llm';
import { requiresBaseUrl, requiresApiKey } from '@/lib/plugins/provider-validation';
import { z } from 'zod';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextHandler(async (req, context) => {
  const { searchParams } = req.nextUrl;
  const providerFilter = searchParams.get('provider');
  const hasVisionFilter = searchParams.get('hasVision');
  const hasStreamingFilter = searchParams.get('hasStreaming');
  const { repos } = context;

  // Get cached models from the database
  const allModels = providerFilter
    ? await repos.providerModels.findByProvider(providerFilter)
    : await repos.providerModels.findAll();

  logger.info('[Models v1] Listed cached models', {
    count: allModels.length,
    provider: providerFilter,
  });

  return successResponse({
    models: allModels,
    count: allModels.length,
    filters: {
      provider: providerFilter,
      hasVision: hasVisionFilter === 'true',
      hasStreaming: hasStreamingFilter === 'true',
    },
    cached: true,
  });
});

// ============================================================================
// POST Handler
// ============================================================================

// Validation schema
const getModelsSchema = z.object({
  provider: z.string().min(1, 'Provider is required'),
  apiKeyId: z.string().optional(),
  baseUrl: z.string().optional(),
});

/**
 * POST /api/v1/models
 * Fetch available models from a specific provider
 */
export const POST = createContextHandler(async (req, { user, repos }) => {
  const body = await req.json();
  const { provider, apiKeyId, baseUrl } = getModelsSchema.parse(body);

  // Get API key if provided (security: verify ownership)
  let decryptedKey = '';
  if (apiKeyId) {
    const apiKey = await repos.connections.findApiKeyByIdAndUserId(apiKeyId, user.id);

    if (!apiKey) {
      return notFound('API key not found');
    }

    decryptedKey = apiKey.key_value;
  }

  // Validate baseUrl requirements
  if (requiresBaseUrl(provider) && !baseUrl) {
    return badRequest(`Base URL is required for ${provider} provider`);
  }

  // Validate API key requirements
  if (requiresApiKey(provider) && !decryptedKey) {
    return badRequest(`API key is required for ${provider} provider`);
  }

  // Create LLM provider instance
  const llmProvider = await createLLMProvider(provider, baseUrl);

  // Get available models
  const models = await llmProvider.getAvailableModels(decryptedKey);

  // Get model metadata if supported
  const modelMetadata = llmProvider.getModelsWithMetadata
    ? await llmProvider.getModelsWithMetadata(decryptedKey)
    : [];

  // Get static model info from the plugin
  const plugin = providerRegistry.getProvider(provider);
  const staticModelInfo = plugin?.getModelInfo?.() || [];

  // Build response with model info
  const modelsWithInfo = models.map(modelId => {
    const metadata = modelMetadata.find(m => m.id === modelId)
      || (llmProvider.getModelMetadata ? llmProvider.getModelMetadata(modelId) : undefined);
    const staticInfo = staticModelInfo.find(m => m.id === modelId);
    return {
      id: modelId,
      displayName: metadata?.displayName,
      warnings: metadata?.warnings,
      deprecated: metadata?.deprecated,
      experimental: metadata?.experimental,
      missingCapabilities: metadata?.missingCapabilities,
      maxOutputTokens: staticInfo?.maxOutputTokens,
      contextWindow: staticInfo?.contextWindow,
    };
  });

  // Cache the fetched models in the database
  try {
    await repos.providerModels.upsertModelsForProvider(
      provider,
      modelsWithInfo.map(m => ({
        modelId: m.id,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        deprecated: m.deprecated,
        experimental: m.experimental,
      })),
      'chat',
      baseUrl
    );
  } catch (cacheError) {
    logger.warn('[Models v1] Failed to cache models', {
      provider,
      error: cacheError instanceof Error ? cacheError.message : String(cacheError),
    });
  }

  return successResponse({
    provider,
    models,
    modelsWithInfo,
    count: models.length,
  });
});
