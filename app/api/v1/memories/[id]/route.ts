/**
 * Memories API v1 - Individual Memory Endpoint
 *
 * GET /api/v1/memories/[id] - Get a specific memory
 * PUT /api/v1/memories/[id] - Update a memory
 * DELETE /api/v1/memories/[id] - Delete a memory
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { scheduleRefit, handleEntityDeletion } from '@/lib/embedding/embedding-job-scheduler';
import { deleteMemoryWithUnlink } from '@/lib/memory/memory-gate';

// Validation schema for updating a memory
const updateMemorySchema = z.object({
  content: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.uuid()).optional(),
  importance: z.number().min(0).max(1).optional(),
  aboutCharacterId: z.uuid().nullable().optional(),
  chatId: z.uuid().nullable().optional(),
  relatedMemoryIds: z.array(z.uuid()).optional(),
});

/**
 * GET /api/v1/memories/[id] - Get a specific memory
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: memoryId }) => {
    try {// Find the memory - need to check ownership via character
      const memory = await repos.memories.findById(memoryId);
      if (!memory) {
        return notFound('Memory');
      }

      // Verify ownership via character
      const character = await repos.characters.findById(memory.characterId);
      if (!character) {
        return notFound('Memory'); // Return 404 instead of 403 to not leak existence
      }

      // Enrich with tag names
      const allTags = await repos.tags.findAll();
      const tagMap = new Map(allTags.map((t: any) => [t.id, t]));

      const memoryWithTags = {
        ...memory,
        tagDetails: memory.tags
          .map((tagId: string) => tagMap.get(tagId))
          .filter(Boolean),
      };

      // Update access time (fire and forget)
      repos.memories.updateAccessTime(memory.characterId, memoryId).catch((err: Error) =>
        logger.warn('[Memories API v1] Failed to update access time', {
          memoryId,
          error: err.message,
        })
      );

      return NextResponse.json({ memory: memoryWithTags });
    } catch (error) {
      logger.error('[Memories API v1] Error fetching memory', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch memory');
    }
  }
);

/**
 * PUT /api/v1/memories/[id] - Update a memory
 */
export const PUT = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: memoryId }) => {
    // Find the memory
    const existingMemory = await repos.memories.findById(memoryId);
    if (!existingMemory) {
      return notFound('Memory');
    }

    // Verify ownership via character
    const character = await repos.characters.findById(existingMemory.characterId);
    if (!character) {
      return notFound('Memory');
    }

    const body = await req.json();
    const validatedData = updateMemorySchema.parse(body);

    const memory = await repos.memories.updateForCharacter(
      existingMemory.characterId,
      memoryId,
      validatedData
    );

    if (!memory) {
      return notFound('Memory');
    }

    // Schedule refit for BUILTIN profiles (non-blocking)
    scheduleRefit(user.id).catch((err: Error) =>
      logger.warn('[Memories API v1] Failed to schedule refit after update', {
        memoryId,
        error: err.message,
      })
    );

    return NextResponse.json({ memory });
  }
);

/**
 * DELETE /api/v1/memories/[id] - Delete a memory
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: memoryId }) => {
    try {// Find the memory
      const existingMemory = await repos.memories.findById(memoryId);
      if (!existingMemory) {
        return notFound('Memory');
      }

      // Verify ownership via character
      const character = await repos.characters.findById(existingMemory.characterId);
      if (!character) {
        return notFound('Memory');
      }

      await deleteMemoryWithUnlink(memoryId);

      // Clean up embedding status (non-blocking)
      handleEntityDeletion('MEMORY', memoryId).catch((err: Error) =>
        logger.warn('[Memories API v1] Failed to handle entity deletion', {
          memoryId,
          error: err.message,
        })
      );

      // Schedule refit for BUILTIN profiles (non-blocking)
      scheduleRefit(user.id).catch((err: Error) =>
        logger.warn('[Memories API v1] Failed to schedule refit after delete', {
          memoryId,
          error: err.message,
        })
      );

      logger.info('[Memories API v1] Memory deleted', {
        memoryId,
        characterId: existingMemory.characterId,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('[Memories API v1] Error deleting memory', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to delete memory');
    }
  }
);
