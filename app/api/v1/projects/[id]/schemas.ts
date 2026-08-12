/**
 * Projects API v1 - Zod Schemas
 *
 * Validation schemas for project route requests
 */

import { z } from 'zod';

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(10000).nullable().optional(),
  allowAnyCharacter: z.boolean().optional(),
  characterRoster: z.array(z.uuid()).optional(),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  defaultAgentModeEnabled: z.boolean().nullable().optional(),
  defaultAvatarGenerationEnabled: z.boolean().nullable().optional(),
  defaultImageProfileId: z.string().uuid().nullable().optional(),
  defaultRoleplayTemplateId: z.string().uuid().nullable().optional(),
  defaultAlertCharactersOfLanternImages: z.boolean().nullable().optional(),
  answerConfirmationOverride: z.enum(['ON', 'OFF']).nullable().optional(),
  backgroundDisplayMode: z.enum(['latest_chat', 'project', 'static', 'theme']).optional(),
});

export const addCharacterSchema = z.object({
  characterId: z.uuid(),
});

export const removeCharacterSchema = z.object({
  characterId: z.uuid(),
});

export const addChatSchema = z.object({
  chatId: z.uuid(),
});

export const removeChatSchema = z.object({
  chatId: z.uuid(),
});

export const addFileSchema = z.object({
  fileId: z.uuid(),
});

export const removeFileSchema = z.object({
  fileId: z.uuid(),
});

export const updateToolSettingsSchema = z.object({
  defaultDisabledTools: z.array(z.string()),
  defaultDisabledToolGroups: z.array(z.string()),
});

export const setStateSchema = z.object({
  state: z.record(z.string(), z.unknown()),
});
