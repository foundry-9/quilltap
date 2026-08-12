/**
 * Image Profiles API v1 - Individual Profile Endpoint
 *
 * GET /api/v1/image-profiles/[id] - Get a specific profile
 * PUT /api/v1/image-profiles/[id] - Update a profile
 * DELETE /api/v1/image-profiles/[id] - Delete a profile
 * POST /api/v1/image-profiles/[id]?action=generate - Generate image using this profile
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, enrichProfile } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { notFound, badRequest, serverError, messageResponse, successResponse } from '@/lib/api/responses';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import { executeImageGenerationTool } from '@/lib/tools/handlers/image-generation-handler';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  chatId: z.uuid().optional(),
  count: z.int().min(1).max(10).optional().prefault(1),
  size: z.string().optional(),
  quality: z.enum(['standard', 'hd']).optional(),
  style: z.enum(['vivid', 'natural']).optional(),
  aspectRatio: z.string().optional(),
  negativePrompt: z.string().optional(),
});

/**
 * GET /api/v1/image-profiles/[id]
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

      const profile = await repos.imageProfiles.findById(id);

      if (!profile) {
        return notFound('Image profile');
      }

      // Enrich with API key and tag details
      const enriched = await enrichProfile(profile, repos);

      return NextResponse.json({
        ...profile,
        ...enriched,
      });
    } catch (error) {
      logger.error('[Image Profiles v1] Error fetching profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch image profile');
    }
  }
);

/**
 * PUT /api/v1/image-profiles/[id]
 */
export const PUT = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

      // Verify ownership
      const existingProfile = await repos.imageProfiles.findById(id);

      if (!existingProfile) {
        return notFound('Image profile');
      }

      const body = await req.json();
      const { name, provider, apiKeyId, baseUrl, modelName, parameters, isDefault, isDangerousCompatible } = body;

      // Build update data
      const updateData: Record<string, unknown> = {};

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return badRequest('Name must be a non-empty string');
        }

        // Check for duplicate name (excluding current profile)
        const duplicateProfile = await repos.imageProfiles.findByName(user.id, name.trim());

        if (duplicateProfile && duplicateProfile.id !== id) {
          return NextResponse.json(
            { error: 'An image profile with this name already exists' },
            { status: 409 }
          );
        }

        updateData.name = name.trim();
      }

      if (provider !== undefined) {
        if (typeof provider !== 'string' || provider.trim().length === 0) {
          return badRequest('Provider must be a non-empty string');
        }

        // Verify provider is available
        try {
          createImageProvider(provider);
        } catch {
          return badRequest(`Provider ${provider} is not available`);
        }

        updateData.provider = provider;
      }

      if (apiKeyId !== undefined) {
        if (apiKeyId === null) {
          updateData.apiKeyId = null;
        } else {
          const apiKey = await repos.connections.findApiKeyById(apiKeyId);
          if (!apiKey) {
            return notFound('API key');
          }
          updateData.apiKeyId = apiKeyId;
        }
      }

      if (baseUrl !== undefined) {
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
          await repos.imageProfiles.unsetAllDefaults(user.id);
        }

        updateData.isDefault = isDefault;
      }

      if (isDangerousCompatible !== undefined) {
        if (typeof isDangerousCompatible !== 'boolean') {
          return badRequest('isDangerousCompatible must be a boolean');
        }
        updateData.isDangerousCompatible = isDangerousCompatible;
      }

      // Update the profile
      const updatedProfile = await repos.imageProfiles.update(id, updateData);

      if (!updatedProfile) {
        return serverError('Failed to update profile');
      }

      // Enrich with API key and tag details
      const enriched = await enrichProfile(updatedProfile, repos);

      logger.info('[Image Profiles v1] Profile updated', { profileId: id });

      return NextResponse.json({
        ...updatedProfile,
        ...enriched,
      });
    } catch (error) {
      logger.error('[Image Profiles v1] Error updating profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to update image profile');
    }
  }
);

/**
 * DELETE /api/v1/image-profiles/[id]
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {

      // Verify ownership
      const existingProfile = await repos.imageProfiles.findById(id);

      if (!existingProfile) {
        return notFound('Image profile');
      }

      // Delete the profile
      await repos.imageProfiles.delete(id);

      logger.info('[Image Profiles v1] Profile deleted', { profileId: id });

      return messageResponse('Image profile deleted successfully');
    } catch (error) {
      logger.error('[Image Profiles v1] Error deleting profile', { profileId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete image profile');
    }
  }
);

/**
 * POST /api/v1/image-profiles/[id]?action=generate
 * Generate images using this profile with placeholder expansion support
 */
export const POST = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const action = getActionParam(req);

    if (action !== 'generate') {
      return badRequest(`Unknown action: ${action}. Available actions: generate`);
    }

    // Verify profile exists and belongs to user
    const profile = await repos.imageProfiles.findById(id);

    if (!profile) {
      return notFound('Image profile');
    }

    // Validate request body
    const body = await req.json();
    const validated = generateImageSchema.parse(body);

    // Execute image generation with prompt expansion support
    const result = await executeImageGenerationTool(
      {
        prompt: validated.prompt,
        count: validated.count,
        size: validated.size,
        quality: validated.quality,
        style: validated.style,
        aspectRatio: validated.aspectRatio,
        negativePrompt: validated.negativePrompt,
      },
      {
        userId: user.id,
        profileId: id,
        chatId: validated.chatId,
      }
    );

    if (!result.success) {
      logger.warn('[Image Profiles v1] Image generation failed', {
        profileId: id,
        error: result.error,
      });
      return badRequest(result.error || 'Image generation failed');
    }

    logger.info('[Image Profiles v1] Image generation complete', {
      profileId: id,
      imageCount: result.images?.length || 0,
    });

    return successResponse({
      success: true,
      data: result.images,
      expandedPrompt: result.expandedPrompt,
      metadata: {
        originalPrompt: validated.prompt,
        provider: result.provider,
        model: result.model,
        count: result.images?.length || 0,
      },
    }, 201);
  }
);
