/**
 * User Profile API v1
 *
 * GET /api/v1/user/profile - Get user profile
 * GET /api/v1/user/profile?action=theme-preference - Get theme preference
 * PUT /api/v1/user/profile - Update user profile
 * PUT /api/v1/user/profile?action=theme-preference - Update theme preference
 * PATCH /api/v1/user/profile?action=set-avatar - Set or clear profile avatar
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler, RequestContext } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { ThemePreferenceSchema, type ThemePreference } from '@/lib/themes/types';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  badRequest,
  notFound,
  serverError,
  successResponse,
} from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const updateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.email().optional(),
  image: z.url().optional().or(z.literal('')),
});

const avatarSchema = z.object({
  imageId: z.string().nullable(),
});

const themePreferenceUpdateSchema = z.object({
  activeThemeId: z.string().nullable().optional(),
  colorMode: z.enum(['light', 'dark', 'system']).optional(),
  customOverrides: z.record(z.string(), z.string()).optional(),
  showNavThemeSelector: z.boolean().optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextHandler(async (req, context) => {
  const { user, repos } = context;
  const action = getActionParam(req);

  // Handle theme-preference action
  if (action === 'theme-preference') {
    // Get user's chat settings
    let chatSettings = await repos.chatSettings.findByUserId(user.id);

    // If no settings exist, create with defaults
    if (!chatSettings) {
      chatSettings = await repos.chatSettings.updateForUser(user.id, {
        avatarDisplayMode: 'ALWAYS',
        avatarDisplayStyle: 'CIRCULAR',
        tagStyles: {},
        themePreference: {
          activeThemeId: null,
          colorMode: 'system',
          showNavThemeSelector: false,
        },
      });
    }

    // Extract theme preference (with fallback to defaults)
    const themePreference: ThemePreference = chatSettings?.themePreference ?? {
      activeThemeId: null,
      colorMode: 'system',
      showNavThemeSelector: false,
    };

    return successResponse({ data: themePreference });
  }

  // Default: get profile
  // Get full user record from database
  const userRecord = await repos.users.findById(user.id);

  if (!userRecord) {
    return serverError('User not found');
  }

  return successResponse({
    profile: {
      id: userRecord.id,
      email: userRecord.email,
      username: userRecord.username,
      name: userRecord.name,
      image: userRecord.image,
      createdAt: userRecord.createdAt,
      updatedAt: userRecord.updatedAt,
    },
  });
});

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createContextHandler(async (req, context) => {
  const { user, repos } = context;
  const action = getActionParam(req);

  // Handle theme-preference action
  if (action === 'theme-preference') {
    const body = await req.json();

    // Validate the incoming data
    const validated = themePreferenceUpdateSchema.parse(body);

    // Validate colorMode if provided
    if (validated.colorMode !== undefined) {
      const validModes = ['light', 'dark', 'system'];
      if (!validModes.includes(validated.colorMode)) {
        return badRequest('Invalid color mode. Must be one of: light, dark, system');
      }
    }

    // Validate activeThemeId if provided (and not null)
    if (validated.activeThemeId !== undefined && validated.activeThemeId !== null) {
      if (!themeRegistry.has(validated.activeThemeId)) {
        return badRequest(`Theme not found: ${validated.activeThemeId}`);
      }
    }

    // Get current settings to merge with
    let chatSettings = await repos.chatSettings.findByUserId(user.id);
    const currentPreference = chatSettings?.themePreference ?? {
      activeThemeId: null,
      colorMode: 'system',
      showNavThemeSelector: false,
    };

    // Build updated preference
    const updatedPreference: ThemePreference = {
      ...currentPreference,
      ...(validated.activeThemeId !== undefined && { activeThemeId: validated.activeThemeId }),
      ...(validated.colorMode !== undefined && { colorMode: validated.colorMode }),
      ...(validated.customOverrides !== undefined && { customOverrides: validated.customOverrides }),
      ...(validated.showNavThemeSelector !== undefined && { showNavThemeSelector: validated.showNavThemeSelector }),
    };

    // Validate the complete preference
    const validationResult = ThemePreferenceSchema.safeParse(updatedPreference);
    if (!validationResult.success) {
      logger.warn('[User Profile v1] Theme preference validation failed', {
        userId: user.id,
        errors: validationResult.error.issues,
      });
      return badRequest('Invalid theme preference data');
    }

    // Update chat settings with new theme preference
    chatSettings = await repos.chatSettings.updateForUser(user.id, {
      themePreference: validationResult.data,
    });

    if (!chatSettings) {
      return serverError('Failed to update theme preference');
    }

    logger.info('[User Profile v1] Theme preference updated', {
      userId: user.id,
      activeThemeId: validationResult.data.activeThemeId,
      colorMode: validationResult.data.colorMode,
    });

    return successResponse({ data: validationResult.data });
  }

  // Default: update profile
  const body = await req.json();
  const validatedData = updateProfileSchema.parse(body);

  const updateData: any = {};

  if (validatedData.name !== undefined) {
    updateData.name = validatedData.name;
  }

  if (validatedData.image !== undefined) {
    updateData.image = validatedData.image || null;
  }

  // Email changes should be handled carefully (may require verification)
  if (validatedData.email !== undefined) {
    const existingUser = await repos.users.findByEmail(validatedData.email);

    if (existingUser && existingUser.id !== user.id) {
      return badRequest('Email already in use');
    }

    updateData.email = validatedData.email;
  }

  const updatedUser = await repos.users.update(user.id, updateData);

  if (!updatedUser) {
    return serverError('Failed to update profile');
  }

  logger.info('[User Profile v1] Profile updated', { userId: user.id });

  return successResponse({
    profile: {
      id: updatedUser.id,
      email: updatedUser.email,
      username: updatedUser.username,
      name: updatedUser.name,
      image: updatedUser.image,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    },
  });
});

// ============================================================================
// PATCH Handler - Avatar
// ============================================================================

export const PATCH = createContextHandler(async (req, context) => {
  const { user, repos } = context;
  const action = getActionParam(req);

  if (action !== 'set-avatar') {
    return badRequest(`Unknown action: ${action}. Available actions: set-avatar`);
  }

  const body = await req.json();
  const { imageId } = avatarSchema.parse(body);

  // If imageId is provided, verify it from repository
  if (imageId) {
    const fileEntry = await repos.files.findById(imageId);

    // Verify file exists
    if (!fileEntry) {
      logger.warn('[User Profile v1] File not found for avatar', {
        fileId: imageId,
        userId: user.id,
      });
      return notFound('File');
    }

    // Verify file category is valid for avatar
    const validCategories = ['IMAGE', 'AVATAR'];
    if (!validCategories.includes(fileEntry.category)) {
      logger.warn('[User Profile v1] File category invalid for avatar', {
        fileId: imageId,
        category: fileEntry.category,
      });
      return badRequest(`Invalid file category. Expected IMAGE or AVATAR, got ${fileEntry.category}`);
    }
  }

  // Update user with the image URL (file API path) or null
  const imageUrl = imageId ? `/api/v1/files/${imageId}` : null;
  const updatedUser = await repos.users.update(user.id, { image: imageUrl });

  if (!updatedUser) {
    logger.warn('[User Profile v1] User not found during avatar update', { userId: user.id });
    return notFound('User');
  }

  logger.info('[User Profile v1] Avatar updated', {
    userId: user.id,
    imageId: imageId || null,
  });

  // Build response with image info
  let image = null;
  if (imageId) {
    const fileEntry = await repos.files.findById(imageId);
    if (fileEntry) {
      image = {
        id: fileEntry.id,
        filepath: getFilePath(fileEntry),
        url: imageUrl,
      };
    }
  }

  return successResponse({
    profile: {
      id: updatedUser.id,
      email: updatedUser.email,
      username: updatedUser.username,
      name: updatedUser.name,
      image: updatedUser.image,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    },
  });
});
