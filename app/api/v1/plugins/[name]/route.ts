/**
 * Plugins API v1 - Individual Plugin Endpoint
 *
 * GET /api/v1/plugins/[name] - Get plugin details
 * GET /api/v1/plugins/[name]?action=get-config - Get plugin configuration
 * PUT /api/v1/plugins/[name] - Enable/disable plugin
 * POST /api/v1/plugins/[name]?action=set-config - Update plugin configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { pluginRegistry } from '@/lib/plugins/registry';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';

const PLUGIN_POST_ACTIONS = ['set-config'] as const;
type PluginPostAction = typeof PLUGIN_POST_ACTIONS[number];

// ============================================================================
// Schemas
// ============================================================================

const setConfigSchema = z.object({
  config: z.record(z.string(), z.unknown()),
});

// ============================================================================
// Action Handlers
// ============================================================================

async function handleGetConfig(req: NextRequest, context: any, name: string) {
  const { user, repos } = context;

  try {

    if (!pluginRegistry.has(name)) {
      logger.warn('[Plugins v1] Plugin not found for config request', {
        pluginName: name,
        userId: user.id,
      });
      return notFound('Plugin');
    }

    const plugin = pluginRegistry.get(name);
    if (!plugin) {
      return notFound('Plugin');
    }

    // Get the config schema from the manifest
    const configSchema = plugin.manifest.configSchema || [];

    // Get user's current configuration
    const userConfig = await repos.pluginConfigs.findByUserAndPlugin(user.id, name);

    // Build default config from schema
    const defaultConfig: Record<string, unknown> = {};
    for (const field of configSchema) {
      if (field.default !== undefined) {
        defaultConfig[field.key] = field.default;
      }
    }

    // Merge default config with user config
    const effectiveConfig = {
      ...defaultConfig,
      ...(userConfig?.config || {}),
    };return NextResponse.json({
      pluginName: name,
      pluginTitle: plugin.manifest.title,
      configSchema,
      config: effectiveConfig,
      hasUserConfig: !!userConfig,
    });
  } catch (error) {
    logger.error(
      '[Plugins v1] Error getting plugin config',
      { pluginName: name, userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to get plugin configuration');
  }
}

async function handleSetConfig(req: NextRequest, context: any, name: string) {
  const { user, repos } = context;

  if (!pluginRegistry.has(name)) {
    logger.warn('[Plugins v1] Plugin not found for config update', {
      pluginName: name,
      userId: user.id,
    });
    return notFound('Plugin');
  }

  const plugin = pluginRegistry.get(name);
  if (!plugin) {
    return notFound('Plugin');
  }

  // Parse request body
  const body = await req.json();
  const parseResult = setConfigSchema.safeParse(body);

  if (!parseResult.success) {
    return validationError(parseResult.error);
  }

  const { config } = parseResult.data;

  // Validate config against schema
  const configSchema = plugin.manifest.configSchema || [];
  const validatedConfig: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const field of configSchema) {
    const value = config[field.key];

    // Apply default if not provided
    if (value === undefined || value === null) {
      if (field.default !== undefined) {
        validatedConfig[field.key] = field.default;
      }
      continue;
    }

    // Type validation based on field type
    switch (field.type) {
      case 'text':
      case 'textarea':
      case 'password':
      case 'url':
      case 'email':
        if (typeof value !== 'string') {
          errors.push(`${field.key}: expected string`);
        } else {
          validatedConfig[field.key] = value;
        }
        break;

      case 'number':
        if (typeof value !== 'number') {
          errors.push(`${field.key}: expected number`);
        } else {
          if (field.min !== undefined && value < field.min) {
            errors.push(`${field.key}: value must be at least ${field.min}`);
          } else if (field.max !== undefined && value > field.max) {
            errors.push(`${field.key}: value must be at most ${field.max}`);
          } else {
            validatedConfig[field.key] = value;
          }
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`${field.key}: expected boolean`);
        } else {
          validatedConfig[field.key] = value;
        }
        break;

      case 'select':
        if (field.options && Array.isArray(field.options)) {
          const validValues = field.options.map((o: any) =>
            typeof o === 'object' ? o.value : o
          );
          if (!validValues.includes(value)) {
            errors.push(`${field.key}: invalid option`);
          } else {
            validatedConfig[field.key] = value;
          }
        } else {
          validatedConfig[field.key] = value;
        }
        break;

      default:
        validatedConfig[field.key] = value;
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Validation failed', details: errors },
      { status: 400 }
    );
  }

  // Upsert the configuration
  const updatedConfig = await repos.pluginConfigs.upsertForUserPlugin(
    user.id,
    name,
    validatedConfig
  );

  logger.info('[Plugins v1] Plugin config updated', {
    pluginName: name,
    userId: user.id,
    fieldCount: Object.keys(validatedConfig).length,
  });

  return NextResponse.json({
    success: true,
    pluginName: name,
    config: updatedConfig.config,
  });
}

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextParamsHandler<{ name: string }>(
  async (req: NextRequest, context, { name }) => {
    const { user } = context;

    try {

      const action = getActionParam(req);

      if (action === 'get-config') {
        return handleGetConfig(req, context, name);
      }

      if (!pluginRegistry.has(name)) {
        logger.warn('[Plugins v1] Plugin not found', {
          pluginName: name,
          userId: user.id,
        });
        return notFound('Plugin');
      }

      const plugin = pluginRegistry.get(name);return NextResponse.json({
        name: plugin?.manifest.name,
        title: plugin?.manifest.title,
        version: plugin?.manifest.version,
        description: plugin?.manifest.description,
        author: plugin?.manifest.author,
        enabled: plugin?.enabled,
        capabilities: plugin?.capabilities,
      });
    } catch (error) {
      logger.error(
        '[Plugins v1] Error fetching plugin',
        { pluginName: name, userId: user.id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to fetch plugin');
    }
  }
);

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createContextParamsHandler<{ name: string }>(
  async (req: NextRequest, context, { name }) => {
    const action = getActionParam(req);

    if (!isValidAction(action, PLUGIN_POST_ACTIONS)) {
      return badRequest(`Unknown action: ${action}. Available actions: ${PLUGIN_POST_ACTIONS.join(', ')}`);
    }

    const actionHandlers: Record<PluginPostAction, () => Promise<NextResponse>> = {
      'set-config': () => handleSetConfig(req, context, name),
    };

    return actionHandlers[action]();
  }
);

// ============================================================================
// PUT Handler - Enable/Disable Plugin
// ============================================================================

export const PUT = createContextParamsHandler<{ name: string }>(
  async (req: NextRequest, context, { name }) => {
    const { user } = context;

    try {

      const body = await req.json().catch(() => ({}));
      const { enabled } = body;

      if (enabled === undefined) {
        return badRequest('Missing required field: enabled');
      }

      // Try to find plugin by name first in registry
      let pluginName = name;
      let found = false;

      if (pluginRegistry.has(pluginName)) {
        found = true;
      } else {
        // Try to find by package name if direct name lookup fails
        const allPlugins = pluginRegistry.getAll();
        const registryPlugin = allPlugins.find(p => p.packageName === name);

        if (registryPlugin) {
          pluginName = registryPlugin.manifest.name;
          found = true;
        }
      }

      if (!found) {
        logger.warn('[Plugins v1] Plugin not found for toggle', { pluginName: name, userId: user.id });
        return notFound('Plugin');
      }

      // Enable or disable the plugin
      if (enabled) {
        pluginRegistry.enable(pluginName);
      } else {
        pluginRegistry.disable(pluginName);
      }

      logger.info('[Plugins v1] Plugin toggled', { pluginName, enabled, userId: user.id });

      return NextResponse.json({
        success: true,
        message: `Plugin ${enabled ? 'enabled' : 'disabled'} successfully`,
        name: pluginName,
        enabled,
      });
    } catch (error) {
      logger.error(
        '[Plugins v1] Error toggling plugin',
        { pluginName: name, userId: user.id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to toggle plugin');
    }
  }
);
