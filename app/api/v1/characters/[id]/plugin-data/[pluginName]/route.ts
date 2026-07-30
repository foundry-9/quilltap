/**
 * Character Plugin Data API v1 - Individual Plugin Endpoint
 *
 * GET /api/v1/characters/[id]/plugin-data/[pluginName] - Get plugin data
 * PUT /api/v1/characters/[id]/plugin-data/[pluginName] - Replace plugin data
 * DELETE /api/v1/characters/[id]/plugin-data/[pluginName] - Delete plugin data
 */

import { NextResponse } from 'next/server';
import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError, badRequest } from '@/lib/api/responses';

// GET /api/v1/characters/[id]/plugin-data/[pluginName]
export const GET = createContextParamsHandler<{ id: string; pluginName: string }>(
  async (req, { user, repos }, { id, pluginName }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!exists(character)) {
        return notFound('Character');
      }

      const entry = await repos.characterPluginData.findByCharacterAndPlugin(id, pluginName);

      if (!entry) {
        return notFound('Plugin data');
      }

      return NextResponse.json({ pluginData: entry });
    } catch (error) {
      logger.error('[PluginData v1] Error fetching plugin data', { characterId: id, pluginName }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch plugin data');
    }
  }
);

// PUT /api/v1/characters/[id]/plugin-data/[pluginName]
export const PUT = createContextParamsHandler<{ id: string; pluginName: string }>(
  async (req, { user, repos }, { id, pluginName }) => {
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

    // The entire body IS the data value (any valid JSON)
    // Validate that it's JSON-serializable
    try {
      JSON.stringify(body);
    } catch {
      return badRequest('Body must be a valid JSON value');
    }

    try {
      const entry = await repos.characterPluginData.upsert(id, pluginName, body);

      logger.info('[PluginData v1] Plugin data replaced', {
        characterId: id,
        pluginName,
        entryId: entry.id,
      });

      return NextResponse.json({ pluginData: entry });
    } catch (error) {
      logger.error('[PluginData v1] Error replacing plugin data', {
        characterId: id,
        pluginName,
      }, error instanceof Error ? error : undefined);
      return serverError('Failed to replace plugin data');
    }
  }
);

// DELETE /api/v1/characters/[id]/plugin-data/[pluginName]
export const DELETE = createContextParamsHandler<{ id: string; pluginName: string }>(
  async (req, { user, repos }, { id, pluginName }) => {
    const character = await repos.characters.findById(id);

    if (!exists(character)) {
      return notFound('Character');
    }

    try {
      const deleted = await repos.characterPluginData.deleteByCharacterAndPlugin(id, pluginName);

      if (!deleted) {
        return notFound('Plugin data');
      }

      logger.info('[PluginData v1] Plugin data deleted', {
        characterId: id,
        pluginName,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('[PluginData v1] Error deleting plugin data', {
        characterId: id,
        pluginName,
      }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete plugin data');
    }
  }
);
