import { z } from 'zod';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { logger } from '@/lib/logger';

export const moveFileSchema = z.object({
  folderPath: z.string().optional(),
  filename: z.string().optional(),
  projectId: z.uuid().nullable().optional(),
});

export const promoteFileSchema = z.object({
  targetProjectId: z.uuid().nullable().optional(),
  folderPath: z.string().optional(),
});

export const FILE_ITEM_POST_ACTIONS = ['move', 'promote'] as const;
export type FileItemPostAction = typeof FILE_ITEM_POST_ACTIONS[number];

export { buildContentDisposition } from '@/lib/api/content-disposition';

export function buildManagedFileResponse(file: any) {
  return {
    id: file.id,
    userId: file.userId,
    filename: file.originalFilename,
    filepath: getFilePath(file),
    mimeType: file.mimeType,
    size: file.size,
    category: file.category,
    projectId: file.projectId,
    folderPath: file.folderPath,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export function validateFilename(filename: string):
  | { success: true }
  | { success: false; error: string } {
  if (filename.trim().length === 0) {
    return { success: false, error: 'Filename cannot be empty' };
  }
  if (filename.length > 255) {
    return { success: false, error: 'Filename must be 255 characters or less' };
  }
  if (/[<>:"|?*\x00-\x1f/\\]/.test(filename)) {
    return { success: false, error: 'Filename contains invalid characters' };
  }
  return { success: true };
}

export async function dissociateFileFromAll(fileId: string, file: any, repos: any): Promise<void> {
  const timestamp = new Date().toISOString();
  const filename = file.originalFilename || 'unknown file';

  const chats = await repos.chats.findAll();
  for (const entityId of file.linkedTo) {
    for (const chat of chats) {
      try {
        const messages = await repos.chats.getMessages(chat.id);
        const message = messages.find((entry: any) => entry.id === entityId && entry.type === 'message');
        if (
          message &&
          message.type === 'message' &&
          'attachments' in message &&
          message.attachments?.includes(fileId)
        ) {
          const note = `\n\n[Attachment "${filename}" deleted ${timestamp}]`;
          await repos.chats.updateMessage(chat.id, message.id, {
            content: message.content + note,
            attachments: message.attachments.filter((attachmentId: string) => attachmentId !== fileId),
          });
          break;
        }
      } catch (error) {
        logger.warn('[Files v1] Error updating message during dissociation', {
          chatId: chat.id,
          fileId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  try {
    const charsWithDefault = await repos.characters.findByDefaultImageId(fileId);
    for (const character of charsWithDefault) {
      await repos.characters.update(character.id, { defaultImageId: null });
    }
  } catch (error) {
    logger.warn('[Files v1] Error clearing character defaultImageId', {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const charsWithOverride = await repos.characters.findByAvatarOverrideImageId(fileId);
    for (const character of charsWithOverride) {
      const filteredOverrides = character.avatarOverrides.filter(
        (override: any) => override.imageId !== fileId
      );
      await repos.characters.update(character.id, { avatarOverrides: filteredOverrides });
    }
  } catch (error) {
    logger.warn('[Files v1] Error clearing character avatarOverrides', {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await repos.files.update(fileId, { linkedTo: [] });
  } catch (error) {
    logger.warn('[Files v1] Error clearing file linkedTo', {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('[Files v1] File dissociation complete', {
    fileId,
    filename,
  });
}