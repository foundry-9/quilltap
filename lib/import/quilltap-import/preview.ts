/**
 * Import preview: count what each entity type would import and flag conflicts
 * (by id, with a cross-instance name-match fallback for characters) without
 * writing anything.
 *
 * @module import/quilltap-import/preview
 */

import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type { Character } from '@/lib/schemas/types';
import type { QuilltapExport, ExportedCharacter } from '@/lib/export/types';
import { getExportData, type ImportPreview, type ImportPreviewEntity } from './types';
import { withStrictRepositoryFailures } from '@/lib/database/repositories/strict-failures';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * Previews what will be imported without actually importing.
 *
 * Runs under {@link withStrictRepositoryFailures}: the whole preview is a
 * report on what the destination already holds, so a read that fails must
 * surface as a failure rather than as "no conflict" — a preview that
 * under-reports collisions is what talks the user into the strategy that
 * duplicates their data (Bug 79).
 */
export async function previewImport(
  userId: string,
  exportData: QuilltapExport
): Promise<ImportPreview> {
  return withStrictRepositoryFailures(() => previewImportStrict(userId, exportData));
}

async function previewImportStrict(
  userId: string,
  exportData: QuilltapExport
): Promise<ImportPreview> {
  moduleLogger.info('Starting import preview', { userId });

  const repos = getUserRepositories(userId);
  const conflictCounts: Record<string, number> = {};

  // Helper to check existence
  const checkExists = async <T extends { id: string }>(
    items: T[] | undefined,
    finder: (id: string) => Promise<T | null>,
    entityType: string
  ): Promise<ImportPreviewEntity[]> => {
    if (!items) return [];

    const results: ImportPreviewEntity[] = [];
    let conflicts = 0;

    for (const item of items) {
      const existing = await finder(item.id);
      const exists = !!existing;
      if (exists) conflicts++;

      results.push({
        id: item.id,
        name: ('name' in item ? item.name : 'title' in item ? (item as any).title : 'Unknown') as string,
        exists,
      });
    }

    if (conflicts > 0) {
      conflictCounts[entityType] = conflicts;
    }

    return results;
  };

  const data = getExportData(exportData);

  // Check characters with name-based fallback for cross-instance imports
  const checkCharacterExists = async (
    items: ExportedCharacter[] | undefined
  ): Promise<ImportPreviewEntity[]> => {
    if (!items) return [];

    const results: ImportPreviewEntity[] = [];
    let conflicts = 0;

    // Pre-fetch all existing characters for name matching
    const existingCharacters = await repos.characters.findAll();
    const existingByName = new Map<string, Character>();
    for (const char of existingCharacters) {
      existingByName.set(char.name.toLowerCase(), char);
    }

    for (const item of items) {
      // First check by ID (same instance re-import)
      const existingById = await repos.characters.findById(item.id);
      if (existingById) {
        conflicts++;
        results.push({ id: item.id, name: item.name, exists: true });
        continue;
      }

      // Fallback: check by name (cross-instance import)
      const existingByNameMatch = existingByName.get(item.name.toLowerCase());
      if (existingByNameMatch) {
        conflicts++;
        results.push({
          id: item.id,
          name: item.name,
          exists: true,
          matchedExistingId: existingByNameMatch.id,
        });
        continue;
      }

      results.push({ id: item.id, name: item.name, exists: false });
    }

    if (conflicts > 0) {
      conflictCounts.characters = conflicts;
    }

    return results;
  };

  // Preview all entity types
  const [characters, chats, tags, connectionProfiles, imageProfiles, embeddingProfiles, roleplayTemplates, projects, groups] =
    await Promise.all([
      checkCharacterExists(data.characters),
      checkExists(
        data.chats,
        (id) => repos.chats.findById(id),
        'chats'
      ),
      checkExists(
        data.tags,
        (id) => repos.tags.findById(id),
        'tags'
      ),
      checkExists(
        data.connectionProfiles,
        (id) => repos.connections.findById(id),
        'connectionProfiles'
      ),
      checkExists(
        data.imageProfiles,
        (id) => repos.imageProfiles.findById(id),
        'imageProfiles'
      ),
      checkExists(
        data.embeddingProfiles,
        (id) => repos.embeddingProfiles.findById(id),
        'embeddingProfiles'
      ),
      checkExists(
        data.roleplayTemplates,
        (id) => {
          const globalRepos = getRepositories();
          return globalRepos.roleplayTemplates.findById(id);
        },
        'roleplayTemplates'
      ),
      checkExists(
        data.projects,
        (id) => repos.projects.findById(id),
        'projects'
      ),
      checkExists(
        data.groups,
        (id) => repos.groups.findById(id),
        'groups'
      ),
    ]);

  // Document stores and the configuration-shaped types. Each is previewed
  // against its own natural key rather than an id, because that is what the
  // corresponding importer dedupes on.
  const globalRepos = getRepositories();

  const documentStores: ImportPreviewEntity[] = [];
  for (const mp of data.mountPoints ?? []) {
    const exists = !!(await globalRepos.docMountPoints.findById(mp.id));
    if (exists) conflictCounts.documentStores = (conflictCounts.documentStores ?? 0) + 1;
    documentStores.push({ id: mp.id, name: mp.name, exists });
  }

  const files: ImportPreviewEntity[] = [];
  for (const file of data.files ?? []) {
    const exists = !!(await repos.files.findById(file.id));
    if (exists) conflictCounts.files = (conflictCounts.files ?? 0) + 1;
    files.push({
      id: file.id,
      name: file.originalFilename,
      exists,
      ...(file._bytesMissing && { detail: 'contents missing — will be skipped' }),
    });
  }

  const promptTemplates: ImportPreviewEntity[] = [];
  for (const template of data.promptTemplates ?? []) {
    const existing = await globalRepos.promptTemplates.findByName(userId, template.name);
    if (existing) conflictCounts.promptTemplates = (conflictCounts.promptTemplates ?? 0) + 1;
    promptTemplates.push({
      id: template.id,
      name: template.name,
      exists: !!existing,
      ...(existing && { matchedExistingId: existing.id }),
    });
  }

  const providerModels: ImportPreviewEntity[] = (data.providerModels ?? []).map((model) => ({
    id: model.id,
    name: `${model.provider} / ${model.modelId}`,
    // Always an upsert by (provider, modelId), so "exists" would be noise.
    exists: false,
  }));

  const pluginConfigs: ImportPreviewEntity[] = [];
  for (const config of data.pluginConfigs ?? []) {
    const existing = await globalRepos.pluginConfigs.findByUserAndPlugin(
      userId,
      config.pluginName
    );
    if (existing) conflictCounts.pluginConfigs = (conflictCounts.pluginConfigs ?? 0) + 1;
    // Secrets are stripped at export time; tell the user exactly what they
    // will have to type back in rather than letting them discover it later.
    const redacted = config._redactedKeys ?? [];
    pluginConfigs.push({
      id: config.id,
      name: config.pluginName,
      exists: !!existing,
      ...(redacted.length > 0 && {
        detail: redacted.includes('*')
          ? 'all settings withheld — re-enter them here'
          : `secrets withheld: ${redacted.join(', ')}`,
      }),
    });
  }

  const instanceSettings: ImportPreviewEntity[] = (data.instanceSettings ?? []).map((setting) => ({
    id: setting.key,
    name: setting.key,
    // Instance settings always overwrite — that's the point of the type.
    exists: false,
  }));

  const preview: ImportPreview = {
    manifest: exportData.manifest,
    entities: {
      ...(documentStores.length > 0 && { documentStores }),
      ...(files.length > 0 && { files }),
      ...(promptTemplates.length > 0 && { promptTemplates }),
      ...(providerModels.length > 0 && { providerModels }),
      ...(pluginConfigs.length > 0 && { pluginConfigs }),
      ...(instanceSettings.length > 0 && { instanceSettings }),
      ...(characters.length > 0 && { characters }),
      ...(chats.length > 0 && { chats }),
      ...(tags.length > 0 && { tags }),
      ...(connectionProfiles.length > 0 && { connectionProfiles }),
      ...(imageProfiles.length > 0 && { imageProfiles }),
      ...(embeddingProfiles.length > 0 && { embeddingProfiles }),
      ...(roleplayTemplates.length > 0 && { roleplayTemplates }),
      ...(projects.length > 0 && { projects }),
      ...(groups.length > 0 && { groups }),
      ...(data.memories && {
        memories: { count: data.memories.length },
      }),
    },
    conflictCounts,
  };

  moduleLogger.info('Import preview completed', {
    userId,
    conflicts: Object.keys(conflictCounts).length,
  });

  return preview;
}
