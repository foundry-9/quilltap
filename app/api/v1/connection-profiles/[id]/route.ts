/**
 * Connection Profiles API v1 - Individual Profile Endpoint
 *
 * GET /api/v1/connection-profiles/[id] - Get a specific profile
 * PUT /api/v1/connection-profiles/[id] - Update a profile
 * DELETE /api/v1/connection-profiles/[id] - Delete a profile
 * POST /api/v1/connection-profiles/[id]?action=add-tag - Add a tag
 * POST /api/v1/connection-profiles/[id]?action=remove-tag - Remove a tag
 * POST /api/v1/connection-profiles/[id]?action=auto-configure - Auto-configure profile settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, RequestContext } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, forbidden, badRequest, serverError, conflict } from '@/lib/api/responses';
import { isValidModelClassName } from '@/lib/llm/model-classes';
import { normalizeProfileName } from '@/lib/llm/connection-profile-names';
import { autoConfigureProfile } from '@/lib/services/auto-configure.service';

// Disable caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Validation schemas
const addTagSchema = z.object({
  tagId: z.uuid(),
});

const removeTagSchema = z.object({
  tagId: z.uuid(),
});

const CONNECTION_PROFILE_ITEM_POST_ACTIONS = ['add-tag', 'remove-tag', 'auto-configure'] as const;
type ConnectionProfileItemPostAction = typeof CONNECTION_PROFILE_ITEM_POST_ACTIONS[number];

/**
 * Helper to enrich profile with API key info
 */
async function enrichProfile(profile: Record<string, unknown>, repos: RequestContext['repos']) {
  let apiKey = null;
  if (profile.apiKeyId) {
    const key = await repos.connections.findApiKeyById(profile.apiKeyId as string);
    if (key) {
      apiKey = {
        id: key.id,
        label: key.label,
        provider: key.provider,
        isActive: key.isActive,
      };
    }
  }

  // Get tag details
  const tagIds = (profile.tags as string[]) || [];
  const tagDetails = await Promise.all(
    tagIds.map(async (tagId: string) => {
      const tag = await repos.tags.findById(tagId);
      return tag ? { tagId, tag } : null;
    })
  );

  return {
    ...profile,
    apiKey,
    tags: tagDetails.filter(Boolean),
  };
}

/**
 * GET /api/v1/connection-profiles/[id] - Get a specific connection profile
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {const profile = await repos.connections.findById(id);

      if (!profile) {
        return notFound('Connection profile');
      }

      const enrichedProfile = await enrichProfile(profile, repos);

      return NextResponse.json({ profile: enrichedProfile });
    } catch (error) {
      logger.error('[Connection Profiles v1] Error fetching profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch connection profile');
    }
  }
);

/**
 * PUT /api/v1/connection-profiles/[id] - Update a profile
 */
export const PUT = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {// Verify ownership
      const existingProfile = await repos.connections.findById(id);

      if (!existingProfile) {
        return notFound('Connection profile');
      }

      const body = await req.json();
      const {
        name,
        transport,
        courierDeltaMode,
        provider,
        apiKeyId,
        baseUrl,
        modelName,
        parameters,
        isDefault,
        isCheap,
        isDangerousCompatible,
        allowWebSearch,
        useNativeWebSearch,
        allowToolUse,
        pseudoToolMode,
        modelClass,
        maxContext,
        sortIndex,
        supportsImageUpload,
      } = body;

      // Build update data
      const updateData: Record<string, unknown> = {};

      if (transport !== undefined) {
        if (transport !== 'api' && transport !== 'courier') {
          return badRequest('Transport must be "api" or "courier"');
        }
        updateData.transport = transport;
      }

      if (courierDeltaMode !== undefined) {
        if (typeof courierDeltaMode !== 'boolean') {
          return badRequest('courierDeltaMode must be a boolean');
        }
        updateData.courierDeltaMode = courierDeltaMode;
      }

      // Effective transport for this update — newly-set value if present,
      // otherwise the existing row's setting. Courier-mode validation gates
      // (no API key, no tools, etc.) hinge on this.
      const effectiveTransport =
        (updateData.transport as 'api' | 'courier' | undefined) ??
        ((existingProfile as { transport?: 'api' | 'courier' }).transport ?? 'api');
      const isCourier = effectiveTransport === 'courier';
      if (isCourier) {
        updateData.apiKeyId = null;
        updateData.baseUrl = null;
        updateData.allowToolUse = false;
        updateData.allowWebSearch = false;
        updateData.useNativeWebSearch = false;
        updateData.supportsImageUpload = false;
        updateData.isDangerousCompatible = false;
      }

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return badRequest('Name must be a non-empty string');
        }
        // Names are unique per user (case-insensitive, trimmed). Reject a
        // rename that collides with a *different* profile before the DB's
        // unique index would. Renaming a profile to its own name is fine.
        const normalizedName = normalizeProfileName(name);
        const userProfiles = await repos.connections.findByUserId(user.id);
        if (userProfiles.some((p) => p.id !== id && normalizeProfileName(p.name) === normalizedName)) {
          logger.debug('Rejected duplicate connection-profile name on update', {
            userId: user.id,
            profileId: id,
            name: name.trim(),
          });
          return conflict(`A connection profile named "${name.trim()}" already exists`);
        }
        updateData.name = name.trim();
      }

      if (provider !== undefined) {
        if (typeof provider !== 'string' || provider.trim().length === 0) {
          return badRequest('Provider must be a non-empty string');
        }
        updateData.provider = provider;
      }

      if (apiKeyId !== undefined && !isCourier) {
        if (apiKeyId === null) {
          updateData.apiKeyId = null;
        } else {
          const apiKey = await repos.connections.findApiKeyById(apiKeyId);

          if (!apiKey) {
            return notFound('API key');
          }

          const providerToCheck = provider !== undefined ? provider : existingProfile.provider;
          if (apiKey.provider !== providerToCheck) {
            return badRequest('API key provider does not match profile provider');
          }

          updateData.apiKeyId = apiKeyId;
        }
      }

      if (baseUrl !== undefined && !isCourier) {
        updateData.baseUrl = baseUrl || null;
      }

      if (modelName !== undefined) {
        if (typeof modelName !== 'string' || modelName.trim().length === 0) {
          return badRequest('Model name must be a non-empty string');
        }
        updateData.modelName = modelName.trim();
      }

      if (parameters !== undefined) {
        if (typeof parameters !== 'object' || Array.isArray(parameters)) {
          return badRequest('Parameters must be an object');
        }
        updateData.parameters = parameters;
      }

      if (isDefault !== undefined) {
        if (typeof isDefault !== 'boolean') {
          return badRequest('isDefault must be a boolean');
        }

        // If setting as default, unset other defaults
        if (isDefault) {
          const allProfiles = await repos.connections.findByUserId(user.id);
          for (const profile of allProfiles) {
            if (profile.isDefault && profile.id !== id) {
              await repos.connections.update(profile.id, { isDefault: false });
            }
          }
        }

        updateData.isDefault = isDefault;
      }

      if (isCheap !== undefined) {
        if (typeof isCheap !== 'boolean') {
          return badRequest('isCheap must be a boolean');
        }
        updateData.isCheap = isCheap;
      }

      if (isDangerousCompatible !== undefined && !isCourier) {
        if (typeof isDangerousCompatible !== 'boolean') {
          return badRequest('isDangerousCompatible must be a boolean');
        }
        updateData.isDangerousCompatible = isDangerousCompatible;
      }

      if (allowWebSearch !== undefined && !isCourier) {
        if (typeof allowWebSearch !== 'boolean') {
          return badRequest('allowWebSearch must be a boolean');
        }
        updateData.allowWebSearch = allowWebSearch;
      }

      if (useNativeWebSearch !== undefined && !isCourier) {
        if (typeof useNativeWebSearch !== 'boolean') {
          return badRequest('useNativeWebSearch must be a boolean');
        }
        updateData.useNativeWebSearch = useNativeWebSearch;
      }

      if (allowToolUse !== undefined && !isCourier) {
        if (typeof allowToolUse !== 'boolean') {
          return badRequest('allowToolUse must be a boolean');
        }
        updateData.allowToolUse = allowToolUse;
      }

      if (pseudoToolMode !== undefined && !isCourier) {
        if (pseudoToolMode !== 'auto' && pseudoToolMode !== 'native' && pseudoToolMode !== 'simple-json' && pseudoToolMode !== 'text-block') {
          return badRequest('pseudoToolMode must be one of auto, native, simple-json, text-block');
        }
        updateData.pseudoToolMode = pseudoToolMode;
      }

      if (modelClass !== undefined) {
        if (modelClass === null || modelClass === '') {
          updateData.modelClass = null;
        } else {
          if (!isValidModelClassName(modelClass)) {
            return badRequest(`Invalid model class: ${modelClass}`);
          }
          updateData.modelClass = modelClass;
        }
      }

      if (maxContext !== undefined) {
        if (maxContext === null || maxContext === '' || maxContext === 0) {
          updateData.maxContext = null;
        } else {
          const parsed = typeof maxContext === 'string' ? parseInt(maxContext, 10) : maxContext;
          if (!Number.isInteger(parsed) || parsed <= 0) {
            return badRequest('maxContext must be a positive integer');
          }
          updateData.maxContext = parsed;
        }
      }

      if (sortIndex !== undefined) {
        if (typeof sortIndex !== 'number' || !Number.isInteger(sortIndex) || sortIndex < 0) {
          return badRequest('sortIndex must be a non-negative integer');
        }
        updateData.sortIndex = sortIndex;
      }

      if (supportsImageUpload !== undefined && !isCourier) {
        if (typeof supportsImageUpload !== 'boolean') {
          return badRequest('supportsImageUpload must be a boolean');
        }
        updateData.supportsImageUpload = supportsImageUpload;
      }

      // Update the profile
      const updatedProfile = await repos.connections.update(id, updateData);

      if (!updatedProfile) {
        return serverError('Failed to update connection profile');
      }

      const enrichedProfile = await enrichProfile(updatedProfile, repos);

      logger.info('[Connection Profiles v1] Profile updated', { profileId: id });

      return NextResponse.json({ profile: enrichedProfile });
    } catch (error) {
      logger.error('[Connection Profiles v1] Error updating profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to update connection profile');
    }
  }
);

/**
 * DELETE /api/v1/connection-profiles/[id] - Delete a profile
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {// Verify ownership
      const existingProfile = await repos.connections.findById(id);

      if (!existingProfile) {
        return notFound('Connection profile');
      }

      // Delete the profile
      await repos.connections.delete(id);

      logger.info('[Connection Profiles v1] Profile deleted', { profileId: id });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('[Connection Profiles v1] Error deleting profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete connection profile');
    }
  }
);

/**
 * POST /api/v1/connection-profiles/[id] - Action dispatch
 */
export const POST = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const action = getActionParam(req);

    // Verify ownership first
    const profile = await repos.connections.findById(id);
    if (!profile) {
      return notFound('Connection profile');
    }

    if (!isValidAction(action, CONNECTION_PROFILE_ITEM_POST_ACTIONS)) {
      return badRequest(`Unknown action: ${action}. Available actions: ${CONNECTION_PROFILE_ITEM_POST_ACTIONS.join(', ')}`);
    }

    const actionHandlers: Record<ConnectionProfileItemPostAction, () => Promise<NextResponse>> = {
      'add-tag': async () => {
        const body = await req.json();
        const validatedData = addTagSchema.parse(body);

        // Verify tag exists and belongs to user
        const tag = await repos.tags.findById(validatedData.tagId);
        if (!tag) {
          return notFound('Tag');
        }

        // Add tag to profile
        await repos.connections.addTag(id, validatedData.tagId);

        logger.info('[Connection Profiles v1] Tag added to profile', {
          profileId: id,
          tagId: validatedData.tagId,
        });

        return NextResponse.json({ success: true, tag }, { status: 201 });
      },
      'remove-tag': async () => {
        const body = await req.json();
        const validatedData = removeTagSchema.parse(body);

        // Remove tag from profile
        await repos.connections.removeTag(id, validatedData.tagId);

        logger.info('[Connection Profiles v1] Tag removed from profile', {
          profileId: id,
          tagId: validatedData.tagId,
        });

        return NextResponse.json({ success: true });
      },
      'auto-configure': async () => {
        try {
          // Call auto-configure service
          const result = await autoConfigureProfile(profile.provider, profile.modelName, user.id);

          // Merge result into profile
          const existingParams = typeof profile.parameters === 'string' ? JSON.parse(profile.parameters) : (profile.parameters || {});
          const updateData: Record<string, unknown> = {
            maxContext: result.maxContext,
            maxTokens: result.maxTokens,
            modelClass: result.modelClass,
            isDangerousCompatible: result.isDangerousCompatible,
            parameters: {
              ...existingParams,
              temperature: result.temperature,
              max_tokens: result.maxTokens,
              top_p: result.topP,
            },
          };

          // Update the profile
          const updatedProfile = await repos.connections.update(id, updateData);

          if (!updatedProfile) {
            return serverError('Failed to update connection profile with auto-configure results');
          }

          // Enrich and return the profile
          const enrichedProfile = await enrichProfile(updatedProfile, repos);

          logger.info('[Connection Profiles v1] Profile auto-configured', {
            profileId: id,
            provider: profile.provider,
            modelName: profile.modelName,
            result: {
              maxContext: result.maxContext,
              maxTokens: result.maxTokens,
              temperature: result.temperature,
              topP: result.topP,
              modelClass: result.modelClass,
              isDangerousCompatible: result.isDangerousCompatible,
            },
          });

          return NextResponse.json({ profile: enrichedProfile, autoConfigureResult: result }, { status: 200 });
        } catch (error) {
          logger.error('[Connection Profiles v1] Error auto-configuring profile', { profileId: id }, error instanceof Error ? error : undefined);
          return serverError(error instanceof Error ? error.message : 'Failed to auto-configure connection profile');
        }
      },
    };

    return actionHandlers[action]();
  }
);
