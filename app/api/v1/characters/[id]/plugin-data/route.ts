/**
 * Character Plugin Data API v1 - Collection Endpoint
 *
 * GET /api/v1/characters/[id]/plugin-data - Get all plugin data for a character
 * POST /api/v1/characters/[id]/plugin-data - Upsert plugin data for a character
 */

import { NextResponse } from 'next/server';
import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, badRequest, created } from '@/lib/api/responses';

const upsertPluginDataSchema = z.object({
  pluginName: z.string().min(1).max(200),
  data: z.unknown(),
});

// GET /api/v1/characters/[id]/plugin-data
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!exists(character)) {
        return notFound('Character');
      }

      const pluginDataMap = await repos.characterPluginData.getPluginDataMap(id);
      return NextResponse.json({ pluginData: pluginDataMap });
    } catch (error) {
      logger.error('[PluginData v1] Error fetching plugin data', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch plugin data');
    }
  }
);

// POST /api/v1/characters/[id]/plugin-data
export const POST = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const character = await repos.characters.findById(id);

    if (!exists(character)) {
      return notFound('Character');
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest('Invalid JSON body');
    }

    const parsed = upsertPluginDataSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(`Invalid request: ${parsed.error.issues.map(i => i.message).join(', ')}`);
    }

    const { pluginName, data } = parsed.data;

    // Validate that data is JSON-serializable
    try {
      JSON.stringify(data);
    } catch {
      return badRequest('Data must be a valid JSON value');
    }

    try {
      const entry = await repos.characterPluginData.upsert(id, pluginName, data);

      logger.info('[PluginData v1] Plugin data upserted', {
        characterId: id,
        pluginName,
        entryId: entry.id,
      });

      return created({ pluginData: entry });
    } catch (error) {
      logger.error('[PluginData v1] Error upserting plugin data', {
        characterId: id,
        pluginName,
      }, error instanceof Error ? error : undefined);
      return serverError('Failed to save plugin data');
    }
  }
);
