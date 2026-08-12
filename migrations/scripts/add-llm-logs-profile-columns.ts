/**
 * Migration: Add connectionProfileId + imageProfileId columns to llm_logs
 *
 * `provider` and `modelName` on an llm_logs row are flattened copies taken from
 * the serving profile at call time. They look like profile attribution but
 * cannot distinguish two profiles that share a provider/model pair, which is
 * exactly the case the Almanack's per-profile statistics need to tell apart.
 *
 * These two nullable columns record the actual profile id. Rows written before
 * this lands keep NULL and are attributed by joining on (provider, modelName),
 * which the Almanack renders as "approximate".
 *
 * Migration ID: add-llm-logs-profile-columns-v1
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import type { Migration, MigrationResult } from '../types'
import { logger } from '../lib/logger'
import { isSQLiteBackend } from '../lib/database-utils'
import { getDataDir } from '../../lib/paths'

const MIGRATION_ID = 'add-llm-logs-profile-columns-v1'

const NEW_COLUMNS = ['connectionProfileId', 'imageProfileId'] as const

function getLLMLogsDbPath(): string {
  return process.env.SQLITE_LLM_LOGS_PATH || path.join(getDataDir(), 'quilltap-llm-logs.db')
}

function openLogsDb(logsDbPath: string): Database.Database {
  const db = new Database(logsDbPath)
  const sqlcipherKey = process.env.ENCRYPTION_MASTER_PEPPER
  if (sqlcipherKey) {
    const keyHex = Buffer.from(sqlcipherKey, 'base64').toString('hex')
    db.pragma(`key = "x'${keyHex}'"`)
  }
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  return db
}

function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>
  return rows.some(r => r.name === column)
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
  return !!row
}

export const addLLMLogsProfileColumnsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add connectionProfileId + imageProfileId columns (and indexes) to llm_logs',
  introducedInVersion: '4.9.0',
  dependsOn: ['add-llm-logs-autonomous-run-id-column-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false
    }
    const logsDbPath = getLLMLogsDbPath()
    if (!fs.existsSync(logsDbPath)) {
      // Fresh installs create the table from the Zod-derived DDL on first
      // access; the columns will be there from the start.
      return false
    }
    let db: Database.Database | null = null
    try {
      db = openLogsDb(logsDbPath)
      if (!tableExists(db, 'llm_logs')) {
        return false
      }
      return NEW_COLUMNS.some(column => !tableHasColumn(db!, 'llm_logs', column))
    } catch {
      return false
    } finally {
      db?.close()
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now()
    const logsDbPath = getLLMLogsDbPath()
    let db: Database.Database | null = null

    try {
      db = openLogsDb(logsDbPath)

      if (!tableExists(db, 'llm_logs')) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'llm_logs table does not exist; nothing to do',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        }
      }

      let added = 0
      for (const column of NEW_COLUMNS) {
        if (!tableHasColumn(db, 'llm_logs', column)) {
          db.exec(`ALTER TABLE "llm_logs" ADD COLUMN "${column}" TEXT DEFAULT NULL`)
          added++
          logger.info(`Added ${column} column to llm_logs`, {
            context: 'migration.add-llm-logs-profile-columns',
          })
        }
        // Supporting index for the Almanack's per-profile GROUP BY.
        db.exec(
          `CREATE INDEX IF NOT EXISTS "idx_llm_logs_${column}" ON "llm_logs" ("${column}")`
        )
      }

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: added,
        message: `Added ${added} profile-attribution column(s) + indexes to llm_logs`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to add profile-attribution columns to llm_logs', {
        context: 'migration.add-llm-logs-profile-columns',
        error: errorMessage,
      })
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add profile-attribution columns',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }
    } finally {
      db?.close()
    }
  },
}
