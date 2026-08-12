/**
 * Embedding Profiles API v1 - Collection Endpoint
 *
 * GET /api/v1/embedding-profiles - List all embedding profiles for current user
 * POST /api/v1/embedding-profiles - Create a new embedding profile
 * GET /api/v1/embedding-profiles?action=list-models - List available embedding models
 * GET /api/v1/embedding-profiles?action=fetch-models&provider=OLLAMA&baseUrl=... - Fetch installed models from provider
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler, RequestContext, enrichWithApiKey, enrichWithTags } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { successResponse, created, notFound, badRequest, serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import type { EmbeddingProfileProvider } from '@/lib/schemas/types';
import {
  getEmbeddingProviders,
  getEmbeddingModels,
  getAllEmbeddingModels,
} from '@/lib/plugins/provider-validation';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { isLocalEmbeddingProvider } from '@quilltap/plugin-types';

/**
 * GET /api/v1/embedding-profiles
 * List all embedding profiles for the authenticated user
 * GET /api/v1/embedding-profiles?action=list-models - List available models
 * GET /api/v1/embedding-profiles?action=list-providers - List available providers
 */
export const GET = createContextHandler(async (req, context) => {
  const { user, repos } = context;
  const action = getActionParam(req);

  // Handle list-models action
  if (action === 'list-models') {
    return handleListModels(req, context);
  }

  // Handle fetch-models action (dynamic fetch from provider)
  if (action === 'fetch-models') {
    return handleFetchModels(req, context);
  }

  // Handle list-providers action
  if (action === 'list-providers') {
    return handleListProviders();
  }

  try {

    // Get all embedding profiles for user
    const profiles = await repos.embeddingProfiles.findByUserId(user.id);

    // Enrich with API key info, tags, vocabulary stats, and embedding stats
    const enrichedProfiles = await Promise.all(
      profiles.map(async (profile) => {
        // Enrich with API key and tag details
        const apiKey = await enrichWithApiKey(profile.apiKeyId, repos);
        const tags = await enrichWithTags(profile.tags, repos);

        // Get vocabulary stats for BUILTIN profiles
        let vocabularyStats = null;
        if (profile.provider === 'BUILTIN') {
          const vocab = await repos.tfidfVocabularies.findByProfileId(profile.id);
          if (vocab) {
            vocabularyStats = {
              vocabularySize: vocab.vocabularySize,
              avgDocLength: vocab.avgDocLength,
              includeBigrams: vocab.includeBigrams,
              fittedAt: vocab.fittedAt,
            };
          }
        }

        // Get embedding status stats
        let embeddingStats = null;
        try {
          const stats = await repos.embeddingStatus.getStatsByProfileId(profile.id);
          if (stats.total > 0) {
            embeddingStats = stats;
          }
        } catch {
          // Ignore errors - stats are optional
        }

        return {
          ...profile,
          apiKey,
          tags,
          vocabularyStats,
          embeddingStats,
        };
      })
    );

    // Sort by default first, then by creation date
    enrichedProfiles.sort((a, b) => {
      if (a.isDefault !== b.isDefault) {
        return b.isDefault ? 1 : -1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return NextResponse.json({
      profiles: enrichedProfiles,
      count: enrichedProfiles.length,
    });
  } catch (error) {
    logger.error('[Embedding Profiles v1] Error listing profiles', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch embedding profiles');
  }
});

/**
 * Handle list-providers action
 * Returns the list of providers that support embeddings
 */
function handleListProviders() {
  try {
    const providers = getEmbeddingProviders();
    return successResponse({ providers });
  } catch (error) {
    logger.error('[Embedding Profiles v1] Error in list-providers', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch embedding providers');
  }
}

/**
 * Handle fetch-models action
 * Dynamically fetches installed models from the provider (e.g., Ollama /api/tags)
 */
async function handleFetchModels(req: NextRequest, context: RequestContext) {
  try {
    const { searchParams } = req.nextUrl;
    const provider = searchParams.get('provider')?.toUpperCase();
    const baseUrl = searchParams.get('baseUrl') || undefined;

    if (!provider) {
      return badRequest('Provider is required');
    }

    const embeddingProviders = getEmbeddingProviders();
    if (!embeddingProviders.includes(provider)) {
      return badRequest('Invalid provider. Must be one of: ' + embeddingProviders.join(', '));
    }

    // Create the embedding provider instance
    let embeddingProvider;
    try {
      embeddingProvider = providerRegistry.createEmbeddingProvider(provider, baseUrl);
    } catch {
      return badRequest(`Provider ${provider} does not support embeddings`);
    }

    // Local providers (BUILTIN) don't fetch models dynamically
    if (isLocalEmbeddingProvider(embeddingProvider)) {
      return successResponse({ provider, models: [] });
    }

    // Fetch models dynamically
    if (!embeddingProvider.getAvailableModels) {
      return successResponse({ provider, models: [] });
    }

    const modelIds = await embeddingProvider.getAvailableModels('');

    // Get static model info for dimension hints
    const staticModels = getEmbeddingModels(provider);

    // Merge: use static info where available, otherwise return bare model IDs
    const models = modelIds.map(id => {
      const staticInfo = staticModels.find(m => m.id === id);
      return {
        id,
        name: staticInfo?.name || id,
        dimensions: staticInfo?.dimensions,
        description: staticInfo?.description,
        installed: true,
      };
    });

    logger.info('[Embedding Profiles v1] Fetched models from provider', {
      provider,
      baseUrl,
      modelCount: models.length,
    });

    return successResponse({ provider, models });
  } catch (error) {
    logger.error('[Embedding Profiles v1] Error fetching models from provider', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch models from provider');
  }
}

/**
 * Handle list-models action
 */
async function handleListModels(req: NextRequest, context: RequestContext) {
  try {
    const { searchParams } = req.nextUrl;
    const provider = searchParams.get('provider')?.toUpperCase();

    if (provider) {
      const embeddingProviders = getEmbeddingProviders();

      if (!embeddingProviders.includes(provider)) {return badRequest('Invalid provider. Must be one of: ' + embeddingProviders.join(', '));
      }

      const models = getEmbeddingModels(provider);// Cache the fetched embedding models in the database
      try {
        await context.repos.providerModels.upsertModelsForProvider(
          provider,
          models.map((m) => ({
            modelId: m.id,
            displayName: m.name,
          })),
          'embedding',
          undefined
        );
      } catch (cacheError) {
        logger.warn('[Embedding Profiles v1] Failed to cache embedding models', {
          error: cacheError instanceof Error ? cacheError.message : String(cacheError),
        });
      }

      return NextResponse.json({ provider, models });
    }

    // Return all models grouped by provider
    const allModels = getAllEmbeddingModels();// Cache all embedding models in the database
    try {
      for (const [providerName, models] of Object.entries(allModels)) {
        await context.repos.providerModels.upsertModelsForProvider(
          providerName,
          models.map((m) => ({
            modelId: m.id,
            displayName: m.name,
          })),
          'embedding',
          undefined
        );
      }
    } catch (cacheError) {
      logger.warn('[Embedding Profiles v1] Failed to cache all embedding models', {
        error: cacheError instanceof Error ? cacheError.message : String(cacheError),
      });
    }

    return NextResponse.json(allModels);
  } catch (error) {
    logger.error('[Embedding Profiles v1] Error in list-models', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch embedding models');
  }
}

/**
 * POST /api/v1/embedding-profiles - Create a new embedding profile
 */
export const POST = createContextHandler(async (req, { user, repos }) => {
  try {
    const body = await req.json();
    const {
      name,
      provider,
      apiKeyId,
      baseUrl,
      modelName,
      dimensions,
      truncateToDimensions,
      normalizeL2,
      isDefault = false,
    } = body;


    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return badRequest('Name is required');
    }

    if (!provider || typeof provider !== 'string' || provider.trim().length === 0) {
      return badRequest('Provider is required');
    }

    if (!modelName || typeof modelName !== 'string' || modelName.trim().length === 0) {
      return badRequest('Model name is required');
    }

    if (dimensions !== undefined && dimensions !== null && (typeof dimensions !== 'number' || dimensions <= 0)) {
      return badRequest('Dimensions must be a positive number');
    }

    if (
      truncateToDimensions !== undefined &&
      truncateToDimensions !== null &&
      (typeof truncateToDimensions !== 'number' || !Number.isInteger(truncateToDimensions) || truncateToDimensions <= 0)
    ) {
      return badRequest('truncateToDimensions must be a positive integer');
    }

    if (normalizeL2 !== undefined && typeof normalizeL2 !== 'boolean') {
      return badRequest('normalizeL2 must be a boolean');
    }

    // Validate apiKeyId if provided
    if (apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(apiKeyId);
      if (!apiKey) {
        return notFound('API key');
      }
    }

    // Check for duplicate name
    const existingProfile = await repos.embeddingProfiles.findByName(user.id, name.trim());
    if (existingProfile) {
      return NextResponse.json(
        { error: 'An embedding profile with this name already exists' },
        { status: 409 }
      );
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await repos.embeddingProfiles.unsetAllDefaults(user.id);
    }

    // Create profile
    const profile = await repos.embeddingProfiles.create({
      userId: user.id,
      name: name.trim(),
      provider: provider as EmbeddingProfileProvider,
      apiKeyId: apiKeyId || null,
      baseUrl: baseUrl || null,
      modelName: modelName.trim(),
      dimensions: dimensions || null,
      truncateToDimensions: truncateToDimensions ?? null,
      normalizeL2: normalizeL2 ?? true,
      isDefault,
      tags: [],
    });

    // Enrich with API key info
    const apiKey = await enrichWithApiKey(profile.apiKeyId, repos);

    logger.info('[Embedding Profiles v1] Profile created', { profileId: profile.id, provider: profile.provider });

    // If this is a default profile, trigger help doc embedding immediately
    if (profile.isDefault) {
      try {
        const { enqueueEmbeddingReindexAll } = await import('@/lib/background-jobs/queue-service');
        await enqueueEmbeddingReindexAll(user.id, { profileId: profile.id });
        logger.info('[Embedding Profiles v1] Triggered initial embedding for new default profile', {
          profileId: profile.id,
        });
      } catch (embeddingError) {
        logger.warn('[Embedding Profiles v1] Failed to trigger initial embedding', {
          profileId: profile.id,
          error: embeddingError instanceof Error ? embeddingError.message : String(embeddingError),
        });
      }
    }

    return created({ ...profile, apiKey });
  } catch (error) {
    logger.error('[Embedding Profiles v1] Error creating profile', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create embedding profile');
  }
});
