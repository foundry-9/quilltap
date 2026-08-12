/**
 * The Almanack's premises collector — specifically the backup census.
 *
 * The main-DB filename parser is the loosest of the three, so parser order is
 * load-bearing: run it first and it swallows `quilltap-llm-logs-…` and
 * `quilltap-mount-index-…` too, and the report claims one database has every
 * backup while the other two have none. That is exactly what the pre-4.9 report
 * did with the mount index, which it did not know existed at all.
 */

import { collectBackupStatus } from '@/lib/tools/almanack/phase1-premises'

// Uses global jest (not @jest/globals) for proper SWC mock hoisting

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('node:fs/promises', () => ({
  readdir: jest.fn(),
  stat: jest.fn(),
}))

jest.mock('@/lib/paths', () => ({
  getBackupsDir: () => '/backups',
  getDataDir: () => '/data',
  getSQLiteDatabasePath: () => '/data/quilltap.db',
  getLLMLogsDatabasePath: () => '/data/quilltap-llm-logs.db',
  getMountIndexDatabasePath: () => '/data/quilltap-mount-index.db',
  getElectronShellVersion: () => null,
  getShellCapabilities: () => [],
  isDockerEnvironment: () => false,
  isElectronShell: () => false,
  isLimaEnvironment: () => false,
}))

jest.mock('@/lib/startup/dbkey', () => ({
  getHasUserPassphrase: () => false,
}))

jest.mock('@/lib/tools/almanack/db', () => ({
  mainRow: jest.fn().mockResolvedValue(null),
  mainRows: jest.fn().mockResolvedValue([]),
}))

import fs from 'node:fs/promises'

const mockReaddir = fs.readdir as unknown as jest.MockedFunction<() => Promise<string[]>>
const mockStat = fs.stat as unknown as jest.MockedFunction<() => Promise<{ size: number }>>

beforeEach(() => {
  jest.clearAllMocks()
  mockStat.mockResolvedValue({ size: 1_000 })
})

function byLabel(rows: Awaited<ReturnType<typeof collectBackupStatus>>, label: string) {
  return rows.find(r => r.label === label)!
}

describe('collectBackupStatus', () => {
  it('reports all three databases even when none have backups', async () => {
    mockReaddir.mockResolvedValue([])

    const rows = await collectBackupStatus()

    expect(rows.map(r => r.label)).toEqual(['Main', 'LLM Logs', 'Mount Index'])
    expect(rows.every(r => r.count === 0 && r.newestDate === null)).toBe(true)
  })

  it('attributes each backup to the right database', async () => {
    mockReaddir.mockResolvedValue([
      'quilltap-2026-08-01T120000.db',
      'quilltap-2026-08-02T120000.db',
      'quilltap-llm-logs-2026-08-02T120000.db',
      'quilltap-mount-index-2026-08-03T120000.db',
      'not-a-backup.txt',
    ])

    const rows = await collectBackupStatus()

    expect(byLabel(rows, 'Main').count).toBe(2)
    expect(byLabel(rows, 'LLM Logs').count).toBe(1)
    expect(byLabel(rows, 'Mount Index').count).toBe(1)
  })

  it('sums sizes per database', async () => {
    mockReaddir.mockResolvedValue([
      'quilltap-2026-08-01T120000.db',
      'quilltap-2026-08-02T120000.db',
    ])
    mockStat.mockResolvedValue({ size: 2_500 })

    const rows = await collectBackupStatus()

    expect(byLabel(rows, 'Main').totalSizeBytes).toBe(5_000)
  })

  it('reports oldest and newest per database', async () => {
    mockReaddir.mockResolvedValue([
      'quilltap-2026-08-03T120000.db',
      'quilltap-2026-08-01T120000.db',
      'quilltap-2026-08-02T120000.db',
    ])

    const main = byLabel(await collectBackupStatus(), 'Main')

    expect(main.oldestDate).not.toBeNull()
    expect(main.newestDate).not.toBeNull()
    expect(new Date(main.oldestDate!).getTime()).toBeLessThan(
      new Date(main.newestDate!).getTime(),
    )
  })

  it('still counts a backup it cannot stat', async () => {
    mockReaddir.mockResolvedValue(['quilltap-2026-08-01T120000.db'])
    mockStat.mockRejectedValue(new Error('EPERM'))

    const main = byLabel(await collectBackupStatus(), 'Main')

    expect(main.count).toBe(1)
    expect(main.totalSizeBytes).toBe(0)
  })

  it('reports zeroes rather than throwing when the backups directory is absent', async () => {
    mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const rows = await collectBackupStatus()

    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.count === 0)).toBe(true)
  })
})
