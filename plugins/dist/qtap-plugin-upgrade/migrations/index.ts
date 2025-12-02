/**
 * Migration Registry
 *
 * All migrations should be imported and exported here.
 * They are executed in dependency order as defined in each migration.
 */

import type { Migration } from '../migration-types';
import { convertOpenRouterProfilesMigration } from './convert-openrouter-profiles';
import { enableProviderPluginsMigration } from './enable-provider-plugins';

/**
 * All available migrations.
 * Order here doesn't matter - migrations will be sorted by dependencies.
 */
export const migrations: Migration[] = [
  convertOpenRouterProfilesMigration,
  enableProviderPluginsMigration,
];

export {
  convertOpenRouterProfilesMigration,
  enableProviderPluginsMigration,
};
