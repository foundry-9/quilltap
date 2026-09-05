/**
 * Connection Profiles API v1 - Collection Endpoint
 *
 * GET /api/v1/connection-profiles - List all profiles for current user
 * POST /api/v1/connection-profiles - Create a new profile
 * POST /api/v1/connection-profiles?action=test-connection - Test connection settings
 * POST /api/v1/connection-profiles?action=test-message - Send test message
 * POST /api/v1/connection-profiles?action=reorder - Bulk update sort indices
 * POST /api/v1/connection-profiles?action=reset-sort - Reset sort order to default
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler, RequestContext, enrichWithApiKey, enrichWithTags } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { supportsImageGeneration } from '@/lib/llm/image-capable';
import { createLLMProvider } from '@/lib/llm';
import { requiresBaseUrl, testProviderConnection, validateProviderConfig } from '@/lib/plugins/provider-validation';
import { ProviderEnum } from '@/lib/schemas/types';
import { supportsMimeType as providerSupportsMimeType } from '@/lib/llm/attachment-support';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { badRequest, serverError, notFound, successResponse, created, conflict } from '@/lib/api/responses';
import { isValidModelClassName } from '@/lib/llm/model-classes';
import { normalizeProfileName } from '@/lib/llm/connection-profile-names';
import { defaultMultiCharacterPrefill } from '@/lib/llm/multi-character-prefill';
import { profileRunsThinkingTurn } from '@/lib/plugins/provider-registry';
import { autoConfigureProfile } from '@/lib/services/auto-configure.service';

// Disable caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Validation schemas
const testConnectionSchema = z.object({
  provider: ProviderEnum,
  apiKeyId: z.string().optional(),
  baseUrl: z.string().optional(),
});

const testMessageSchema = z.object({
  provider: ProviderEnum,
  apiKeyId: z.string().optional(),
  baseUrl: z.string().optional(),
  modelName: z.string(),
  parameters: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      max_tokens: z.number().min(1).optional(),
      top_p: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

  const CONNECTION_PROFILE_POST_ACTIONS = ['test-connection', 'test-message', 'reorder', 'reset-sort', 'auto-configure'] as const;
  type ConnectionProfilePostAction = typeof CONNECTION_PROFILE_POST_ACTIONS[number];

/**
 * GET /api/v1/connection-profiles
 * List all connection profiles for the authenticated user
 */
export const GET = createContextHandler(async (req, { user, repos }) => {
  try {
    const { searchParams } = req.nextUrl;
    const sortByCharacter = searchParams.get('sortByCharacter');
    const imageCapable = searchParams.get('imageCapable') === 'true';// Get all connection profiles for user
    let profiles = await repos.connections.findByUserId(user.id);

    // Enrich with API key info and tags
    let enrichedProfiles = await Promise.all(
      profiles.map(async (profile) => {
        // Enrich with API key and tag details
        const apiKey = await enrichWithApiKey(profile.apiKeyId, repos);
        const tags = await enrichWithTags(profile.tags, repos);

        return {
          ...profile,
          apiKey,
          tags,
        };
      })
    );

    // Filter to image-capable providers if requested
    if (imageCapable) {
      enrichedProfiles = enrichedProfiles.filter((profile) =>
        supportsImageGeneration(profile.provider)
      );
    }

    // Sort by sortIndex ascending, then by name alphabetically for ties
    enrichedProfiles.sort((a, b) => {
      const aIndex = a.sortIndex ?? 0;
      const bIndex = b.sortIndex ?? 0;
      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }
      return a.name.localeCompare(b.name);
    });

    // If sortByCharacter is specified, sort by matching tags
    if (sortByCharacter) {
      const character = await repos.characters.findById(sortByCharacter);
      const characterTagIds = new Set(character?.tags || []);

      const allTagIds = characterTagIds;

      enrichedProfiles.sort((a, b) => {
        const aMatchingTags = a.tags.filter((t) => t && allTagIds.has(t.tagId)).length;
        const bMatchingTags = b.tags.filter((t) => t && allTagIds.has(t.tagId)).length;

        if (aMatchingTags === bMatchingTags) {
          return b.isDefault ? 1 : a.isDefault ? -1 : 0;
        }

        return bMatchingTags - aMatchingTags;
      });

      const profilesWithMatches = enrichedProfiles.map((profile) => ({
        ...profile,
        matchingTags: profile.tags
          .filter((t) => t && allTagIds.has(t.tagId))
          .map((t) => t?.tag),
        matchingTagCount: profile.tags.filter((t) => t && allTagIds.has(t.tagId)).length,
      }));

      return successResponse({
        profiles: profilesWithMatches,
        count: profilesWithMatches.length,
      });
    }

    return successResponse({
      profiles: enrichedProfiles,
      count: enrichedProfiles.length,
    });
  } catch (error) {
    logger.error('[Connection Profiles v1] Error listing profiles', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch connection profiles');
  }
});

/**
 * Create a new connection profile
 */
async function handleCreate(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const {
      name,
      transport = 'api',
      courierDeltaMode = true,
      provider,
      apiKeyId,
      baseUrl,
      modelName,
      parameters = {},
      isDefault = false,
      isCheap = false,
      isDangerousCompatible = false,
      allowWebSearch = false,
      useNativeWebSearch = false,
      allowToolUse = true,
      pseudoToolMode = 'auto',
      modelClass = null,
      maxContext = null,
      supportsImageUpload,
      multiCharacterPrefill,
      fallbackProfileId = null,
      allowTierFallback = false,
    } = body;

    if (transport !== 'api' && transport !== 'courier') {
      return badRequest('Transport must be "api" or "courier"');
    }
    const isCourier = transport === 'courier';

    if (multiCharacterPrefill !== undefined && typeof multiCharacterPrefill !== 'boolean') {
      return badRequest('multiCharacterPrefill must be a boolean');
    }

    if (typeof allowTierFallback !== 'boolean') {
      return badRequest('allowTierFallback must be a boolean');
    }

    // The fallback chain's named understudy. A brand-new profile has no id
    // yet, so the self-reference rule can't bite here; what can is a target
    // that isn't the user's, or one whose transport is Courier — a request a
    // human carries by hand is no kind of automatic failover.
    let resolvedFallbackProfileId: string | null = null;
    if (fallbackProfileId !== null && fallbackProfileId !== '') {
      if (typeof fallbackProfileId !== 'string') {
        return badRequest('fallbackProfileId must be a profile id or null');
      }
      const fallbackTarget = await repos.connections.findById(fallbackProfileId);
      if (!fallbackTarget || fallbackTarget.userId !== user.id) {
        return badRequest('Fallback profile not found');
      }
      if (fallbackTarget.transport === 'courier') {
        return badRequest(
          'A Courier profile cannot be used as a fallback — its requests are carried by hand, so it cannot stand in automatically'
        );
      }
      resolvedFallbackProfileId = fallbackProfileId;
    }
    // Clients that don't send the field get the resolved default — off for
    // Anthropic (4.6+ rejects an assistant tail) and off for a profile that
    // will run a thinking turn (bug 85), on everywhere else.
    const resolvedMultiCharacterPrefill =
      typeof multiCharacterPrefill === 'boolean'
        ? multiCharacterPrefill
        : defaultMultiCharacterPrefill(
            provider,
            profileRunsThinkingTurn(provider, modelName, parameters)
          );

    // Default supportsImageUpload from the historic per-provider capability map
    // so clients that don't send the field keep their current behavior on providers
    // that used to be hardcoded vision-capable.
    const resolvedSupportsImageUpload =
      typeof supportsImageUpload === 'boolean'
        ? supportsImageUpload
        : providerSupportsMimeType(provider, 'image/jpeg', baseUrl || undefined);

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

    // Connection-profile names must be unique per user (case-insensitive,
    // trimmed) — the name is the load-bearing identifier in the participant
    // picker. The DB also enforces this via a unique index; this check yields
    // a friendly 409 before we hit the constraint.
    const existingProfiles = await repos.connections.findByUserId(user.id);
    const normalizedName = normalizeProfileName(name);
    if (existingProfiles.some((p) => normalizeProfileName(p.name) === normalizedName)) {
      logger.debug('Rejected duplicate connection-profile name on create', {
        userId: user.id,
        name: name.trim(),
      });
      return conflict(`A connection profile named "${name.trim()}" already exists`);
    }

    // Validate apiKeyId if provided. Courier profiles never carry an apiKey.
    if (apiKeyId && !isCourier) {
      const apiKey = await repos.connections.findApiKeyById(apiKeyId);

      if (!apiKey) {
        return notFound('API key');
      }

      if (apiKey.provider !== provider) {
        return badRequest('API key provider does not match profile provider');
      }
    }

    // Validate modelClass if provided
    if (modelClass !== null && modelClass !== undefined && modelClass !== '') {
      if (!isValidModelClassName(modelClass)) {
        return badRequest(`Invalid model class: ${modelClass}`);
      }
    }

    // Validate maxContext if provided
    if (maxContext !== null && maxContext !== undefined) {
      const parsed = typeof maxContext === 'string' ? parseInt(maxContext, 10) : maxContext;
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return badRequest('maxContext must be a positive integer');
      }
    }

    // Validate baseUrl for providers that need it. Courier never needs a base URL.
    if (!isCourier && requiresBaseUrl(provider) && !baseUrl) {
      return badRequest(`Base URL is required for ${provider}`);
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      for (const existingProfile of existingProfiles) {
        if (existingProfile.isDefault) {
          await repos.connections.update(existingProfile.id, { isDefault: false });
        }
      }
    }

    // Auto-assign sortIndex to max existing + 1
    const maxSortIndex = existingProfiles.reduce(
      (max, p) => Math.max(max, (p as any).sortIndex ?? 0),
      -1
    );

    // Create profile. Courier profiles force tool/web-search/vision flags off
    // regardless of what the client sent — the external LLM can't reach them.
    const profile = await repos.connections.create({
      userId: user.id,
      name: name.trim(),
      transport,
      courierDeltaMode: isCourier ? courierDeltaMode !== false : true,
      provider: provider,
      apiKeyId: isCourier ? null : (apiKeyId || null),
      baseUrl: isCourier ? null : (baseUrl || null),
      modelName: modelName.trim(),
      parameters: parameters,
      isDefault,
      isCheap,
      isDangerousCompatible: isCourier ? false : isDangerousCompatible,
      allowWebSearch: isCourier ? false : allowWebSearch,
      useNativeWebSearch: isCourier ? false : useNativeWebSearch,
      allowToolUse: isCourier ? false : allowToolUse,
      pseudoToolMode: isCourier ? 'auto' : (
        pseudoToolMode === 'native' || pseudoToolMode === 'simple-json' || pseudoToolMode === 'text-block'
          ? pseudoToolMode
          : 'auto'
      ),
      multiCharacterPrefill: resolvedMultiCharacterPrefill,
      fallbackProfileId: resolvedFallbackProfileId,
      allowTierFallback,
      modelClass: modelClass || null,
      maxContext: maxContext ? (typeof maxContext === 'string' ? parseInt(maxContext, 10) : maxContext) : null,
      supportsImageUpload: isCourier ? false : resolvedSupportsImageUpload,
      tags: [],
      sortIndex: maxSortIndex + 1,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      messageCount: 0,
    });

    // Enrich with API key info
    const apiKey = await enrichWithApiKey(profile.apiKeyId, repos);

    logger.info('[Connection Profiles v1] Profile created', {
      profileId: profile.id,
      provider: profile.provider,
    });

    return created({ profile: { ...profile, apiKey } });
  } catch (error) {
    logger.error('[Connection Profiles v1] Error creating profile', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create connection profile');
  }
}

/**
 * Test connection settings
 */
async function handleTestConnection(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json();
  const { provider, apiKeyId, baseUrl } = testConnectionSchema.parse(body);// Get API key if provided
  let decryptedKey = '';
  if (apiKeyId) {
    const apiKey = await repos.connections.findApiKeyById(apiKeyId);

    if (!apiKey) {
      return notFound('API key');
    }

    decryptedKey = apiKey.key_value;
  }

  // Validate configuration
  const configValidation = validateProviderConfig(provider, {
    apiKey: decryptedKey,
    baseUrl,
  });

  if (!configValidation.valid) {
    logger.warn('[Connection Profiles v1] Config validation failed', {
      provider,
      errors: configValidation.errors,
    });
    return successResponse(
      {
        valid: false,
        provider,
        error: configValidation.errors[0] || 'Configuration validation failed',
      },
      400
    );
  }

  // Test the connection
  const result = await testProviderConnection(provider, decryptedKey, baseUrl);

  if (result.valid) {
    logger.info('[Connection Profiles v1] Connection test successful', { provider });
    return successResponse({
      valid: true,
      provider,
      message: `Successfully connected to ${provider}`,
    });
  }

  logger.warn('[Connection Profiles v1] Connection test failed', {
    provider,
    error: result.error,
  });
  return successResponse(
    {
      valid: false,
      provider,
      error: result.error,
    },
    400
  );
}

/**
 * Send test message to verify provider functionality
 */
async function handleTestMessage(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json();
  const { provider, apiKeyId, baseUrl, modelName, parameters = {} } = testMessageSchema.parse(body);

  // Get API key if provided
  let decryptedKey = '';
  if (apiKeyId) {
    const apiKey = await repos.connections.findApiKeyById(apiKeyId);

    if (!apiKey) {
      return notFound('API key');
    }

    decryptedKey = apiKey.key_value;
  }

  // Validate configuration
  const configValidation = validateProviderConfig(provider, {
    apiKey: decryptedKey,
    baseUrl,
  });
  if (!configValidation.valid) {
    return badRequest(configValidation.errors[0]);
  }

  // Create provider instance
  const llmProvider = await createLLMProvider(provider, baseUrl);

  // Send test message
  const testPrompt = 'Hello! Please respond with a brief greeting to confirm the connection is working.';

  const requestParams = {
    model: modelName,
    messages: [
      {
        role: 'user' as const,
        content: testPrompt,
      },
    ],
    temperature: parameters.temperature,
    maxTokens: parameters.max_tokens || 50,
    topP: parameters.top_p,
  };try {
    const response = await llmProvider.sendMessage(requestParams, decryptedKey);

    if (!response) {
      return successResponse(
        {
          success: false,
          provider,
          error: 'No response received from model',
        },
        500
      );
    }

    if (response.content !== undefined && response.content !== null) {
      const preview = response.content.substring(0, 100);
      const isTruncated = response.content.length > 100;
      const suffix = isTruncated ? '...' : '';
      const message =
        preview.length === 0
          ? 'Test message successful! Model responded but returned empty content.'
          : `Test message successful! Model responded: "${preview}${suffix}"`;

      return successResponse({
        success: true,
        provider,
        modelName,
        message,
        responsePreview: response.content.substring(0, 200),
      });
    }

    return successResponse(
      {
        success: false,
        provider,
        error: 'No response received from model',
      },
      500
    );
  } catch (error) {return successResponse(
      {
        success: false,
        provider,
        error: error instanceof Error ? error.message : 'Failed to send test message',
      },
      500
    );
  }
}

/**
 * Reorder profiles - bulk update sort indices
 */
async function handleReorder(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const { order } = body;

    if (!Array.isArray(order)) {
      return badRequest('order must be an array of { id, sortIndex } objects');
    }

    // Validate each entry
    for (const entry of order) {
      if (!entry.id || typeof entry.sortIndex !== 'number') {
        return badRequest('Each entry must have id (string) and sortIndex (number)');
      }
    }

    // Verify all profiles belong to user
    const userProfiles = await repos.connections.findByUserId(user.id);
    const userProfileIds = new Set(userProfiles.map((p) => p.id));

    for (const entry of order) {
      if (!userProfileIds.has(entry.id)) {
        return notFound('Connection profile');
      }
    }

    // Bulk update sort indices
    for (const entry of order) {
      await repos.connections.update(entry.id, { sortIndex: entry.sortIndex } as any);
    }

    logger.info('[Connection Profiles v1] Profile sort order updated', {
      profileCount: order.length,
    });

    return successResponse({ success: true, updated: order.length });
  } catch (error) {
    logger.error('[Connection Profiles v1] Error reordering profiles', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to reorder profiles');
  }
}

/**
 * Reset sort order to default: default first, then non-cheap alphabetically, then cheap alphabetically
 */
async function handleResetSort(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const profiles = await repos.connections.findByUserId(user.id);

    // Sort into default order
    let sortIndex = 0;
    const updates: Array<{ id: string; sortIndex: number }> = [];

    // Default profile first
    const defaultProfile = profiles.find((p) => p.isDefault);
    if (defaultProfile) {
      updates.push({ id: defaultProfile.id, sortIndex: sortIndex++ });
    }

    // Non-cheap, non-default profiles alphabetically
    const regularProfiles = profiles
      .filter((p) => !p.isDefault && !p.isCheap)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const profile of regularProfiles) {
      updates.push({ id: profile.id, sortIndex: sortIndex++ });
    }

    // Cheap profiles alphabetically
    const cheapProfiles = profiles
      .filter((p) => !p.isDefault && p.isCheap)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const profile of cheapProfiles) {
      updates.push({ id: profile.id, sortIndex: sortIndex++ });
    }

    // Apply updates
    for (const update of updates) {
      await repos.connections.update(update.id, { sortIndex: update.sortIndex } as any);
    }

    logger.info('[Connection Profiles v1] Profile sort order reset to default', {
      profileCount: updates.length,
    });

    return successResponse({ success: true, updated: updates.length });
  } catch (error) {
    logger.error('[Connection Profiles v1] Error resetting sort order', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to reset sort order');
  }
}

/**
 * Auto-configure profile suggestions based on provider and model
 */
async function handleAutoConfigure(req: NextRequest, context: RequestContext) {
  const { user } = context;

  try {
    const body = await req.json();
    const { provider, modelName } = body;

    // Validation
    if (!provider || typeof provider !== 'string') {
      return badRequest('Provider is required');
    }

    if (!modelName || typeof modelName !== 'string') {
      return badRequest('Model name is required');
    }

    // Call auto-configure service
    const result = await autoConfigureProfile(provider, modelName, user.id);

    logger.info('[Connection Profiles v1] Auto-configure suggestions generated', {
      provider,
      modelName,
    });

    return successResponse({ suggestions: result });
  } catch (error) {
    logger.error('[Connection Profiles v1] Error auto-configuring profile', {}, error instanceof Error ? error : undefined);
    const message = error instanceof Error ? error.message : 'Failed to auto-configure profile';
    return serverError(message);
  }
}

/**
 * POST /api/v1/connection-profiles - Action dispatch or create
 */
export const POST = createContextHandler(async (req, context) => {
  const action = getActionParam(req);

  if (!action || !isValidAction(action, CONNECTION_PROFILE_POST_ACTIONS)) {
    return handleCreate(req, context);
  }

  const actionHandlers: Record<ConnectionProfilePostAction, () => Promise<NextResponse>> = {
    'test-connection': () => handleTestConnection(req, context),
    'test-message': () => handleTestMessage(req, context),
    reorder: () => handleReorder(req, context),
    'reset-sort': () => handleResetSort(req, context),
    'auto-configure': () => handleAutoConfigure(req, context),
  };

  return actionHandlers[action]();
});
