/**
 * Migration: Widen the Concierge Override Domain
 *
 * The per-chat Concierge control grew from three states to four: the
 * `chats.conciergeOverride` column now admits 'UNCENSORED' (the operator
 * asserts the chat is spicy and takes every uncensored route, with no
 * classification and no danger styling) alongside the existing values:
 * - NULL:  the classifier decides (Monitored / Flagged via isDangerousChat)
 * - 'OFF': Vouched Safe — the operator vouches; no Concierge effects,
 *          ordinary providers
 *
 * SQLite TEXT columns carry no CHECK constraint here, so no DDL change is
 * needed and no rows are touched — every existing row keeps its exact
 * current meaning ('OFF' was relabeled Vouched Safe; the storage did not
 * change). This migration exists to record the domain widening in the
 * migration ledger so downgrade detection and the documented schema
 * (DDL.md, qtap-export.schema.json) stay honest.
 *
 * Migration ID: widen-concierge-override-domain-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const widenConciergeOverrideDomainMigration: Migration = {
  id: 'widen-concierge-override-domain-v1',
  description: "Widen chats.conciergeOverride to admit 'UNCENSORED' (four-state Concierge control)",
  introducedInVersion: '4.9.0',
  dependsOn: ['add-chat-concierge-override-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    // The column must exist (the dependency added it); the widening itself is
    // ledger-only, so presence of the column is the whole precondition.
    const columns = getSQLiteTableColumns('chats');
    return columns.some((col) => col.name === 'conciergeOverride');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    logger.info("Recorded widened conciergeOverride domain ('OFF' | 'UNCENSORED' | NULL); no rows touched", {
      context: 'migration.widen-concierge-override-domain',
    });

    return {
      id: 'widen-concierge-override-domain-v1',
      success: true,
      itemsAffected: 0,
      message: "Widened the conciergeOverride domain to admit 'UNCENSORED'; no data changed",
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
