/**
 * Importers for the configuration-shaped export types: prompt templates,
 * the provider model catalogue, plugin configuration, and instance settings.
 *
 * These carry setup rather than content, so they behave a little differently
 * from the entity importers: nothing is id-remapped (nothing references them
 * by id), and the last three upsert by natural key instead of minting rows.
 *
 * @module import/quilltap-import/import-configuration
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { writeInstanceSetting } from '@/lib/instance-settings';
import type { PromptTemplate, ProviderModel } from '@/lib/schemas/types';
import type { ExportedPluginConfig, ExportedInstanceSetting } from '@/lib/export/types';
import type { ImportOptions, ImportCounts } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * Prompt templates, mirroring the roleplay-template importer. Built-ins never
 * appear in an archive (the writer filters them), so every row here is
 * user-created. Dedup is by name, which is what a user recognises.
 */
export async function importPromptTemplates(
  userId: string,
  templates: PromptTemplate[],
  options: ImportOptions,
  warnings: string[]
): Promise<ImportCounts> {
  const globalRepos = getRepositories();
  let imported = 0;
  let skipped = 0;

  moduleLogger.debug('Importing prompt templates', {
    userId,
    count: templates.length,
    conflictStrategy: options.conflictStrategy,
  });

  for (const template of templates) {
    try {
      const existing = await globalRepos.promptTemplates.findByName(userId, template.name);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          continue;
        }
        if (options.conflictStrategy === 'overwrite') {
          await globalRepos.promptTemplates.delete(existing.id);
        }
      }

      const {
        id: _id,
        userId: _userId,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...templateData
      } = template;

      await globalRepos.promptTemplates.create({
        ...templateData,
        userId,
        ...(existing && options.conflictStrategy === 'duplicate' && {
          name: `${template.name} (imported)`,
        }),
      });
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import prompt template "${template.name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import prompt template', {
        templateId: template.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  moduleLogger.debug('Prompt template import complete', { userId, imported, skipped });
  return { imported, skipped };
}

/**
 * The provider model catalogue.
 *
 * A **regenerable cache**: every row here is normally minted by a live refetch
 * from the provider (`/api/v1/models`), and the next refetch supersedes
 * whatever an import wrote. Importing it is a convenience for offline /
 * air-gapped instances, not a source of truth. Upsert by (provider, modelId)
 * with ids and timestamps stripped — nothing references a model row by id.
 */
export async function importProviderModels(
  models: ProviderModel[],
  warnings: string[]
): Promise<ImportCounts> {
  const globalRepos = getRepositories();
  let imported = 0;
  let skipped = 0;

  moduleLogger.debug('Importing provider models', { count: models.length });

  for (const model of models) {
    try {
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...modelData } = model;
      await globalRepos.providerModels.upsertModel(modelData);
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import provider model "${model.modelId}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import provider model', {
        modelId: model.modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      skipped++;
    }
  }

  moduleLogger.debug('Provider model import complete', { imported, skipped });
  return { imported, skipped };
}

/**
 * Plugin configuration.
 *
 * `upsertForUserPlugin` **merges** into any existing config, which is exactly
 * what we want: the exporter redacts password-typed keys, so a redacted key
 * simply doesn't overwrite whatever secret this instance already holds.
 *
 * `_redactedKeys` is surfaced as an import warning so the user knows which
 * secrets they have to re-enter by hand.
 */
export async function importPluginConfigs(
  userId: string,
  configs: ExportedPluginConfig[],
  warnings: string[]
): Promise<ImportCounts> {
  const globalRepos = getRepositories();
  let imported = 0;
  let skipped = 0;

  moduleLogger.debug('Importing plugin configs', { userId, count: configs.length });

  for (const config of configs) {
    try {
      await globalRepos.pluginConfigs.upsertForUserPlugin(
        userId,
        config.pluginName,
        config.config as Record<string, unknown>,
        config.enabled
      );
      imported++;

      const redacted = config._redactedKeys ?? [];
      if (redacted.length > 0) {
        warnings.push(
          redacted.includes('*')
            ? `Plugin "${config.pluginName}" was exported without its settings because its manifest ` +
                'was unavailable; re-enter them on this instance.'
            : `Plugin "${config.pluginName}" was imported without these secret settings: ` +
                `${redacted.join(', ')}. Re-enter them on this instance.`
        );
      }
    } catch (error) {
      warnings.push(
        `Failed to import plugin config for "${config.pluginName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import plugin config', {
        pluginName: config.pluginName,
        error: error instanceof Error ? error.message : String(error),
      });
      skipped++;
    }
  }

  moduleLogger.debug('Plugin config import complete', { userId, imported, skipped });
  return { imported, skipped };
}

/**
 * Instance settings — the "move my setup" import.
 *
 * Values overwrite the receiving instance's own, unconditionally: that *is*
 * the point of the type, so the conflict strategy does not apply. Keys that
 * only make sense inside the exporting instance (mount-point pointers, sweep
 * timing, the version guard) never make it into an archive in the first place;
 * see `NON_PORTABLE_INSTANCE_SETTING_KEYS`.
 */
export async function importInstanceSettings(
  settings: ExportedInstanceSetting[],
  warnings: string[]
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  moduleLogger.debug('Importing instance settings', { count: settings.length });

  for (const setting of settings) {
    try {
      await writeInstanceSetting(setting.key, setting.value);
      imported++;
      moduleLogger.debug('Imported instance setting', { key: setting.key });
    } catch (error) {
      warnings.push(
        `Failed to import instance setting "${setting.key}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import instance setting', {
        key: setting.key,
        error: error instanceof Error ? error.message : String(error),
      });
      skipped++;
    }
  }

  moduleLogger.debug('Instance setting import complete', { imported, skipped });
  return { imported, skipped };
}
