/**
 * The `instance-settings` export type dumps the whole key/value table minus a
 * named exclusion list, which means a *new* setting is portable by default.
 * That's the right default — it is how "move my setup" keeps working as
 * settings are added — but it makes the exclusion list load-bearing, so it is
 * pinned here.
 *
 * Each excluded key would do specific damage if it travelled: the three
 * mount-point pointers are UUIDs into the exporting instance's own mount-index
 * database, `lastMaintenanceSweepAt` would make the receiving instance skip a
 * sweep it never ran, and `highest_app_version` is the version guard's
 * downgrade tripwire — an imported value could lock a healthy instance out of
 * its own database.
 */

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}))

import {
  listPortableInstanceSettings,
  NON_PORTABLE_INSTANCE_SETTING_KEYS,
} from '@/lib/instance-settings'
import { rawQuery } from '@/lib/database/manager'

const NON_PORTABLE = [
  'lanternBackgroundsMountPointId',
  'userUploadsMountPointId',
  'generalMountPointId',
  'lastMaintenanceSweepAt',
  'highest_app_version',
]

describe('listPortableInstanceSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('withholds every instance-local key and keeps the rest', async () => {
    ;(rawQuery as jest.Mock).mockResolvedValue([
      { key: 'maxConcurrentJobs', value: '8' },
      { key: 'lanternBackgroundsMountPointId', value: 'mp-lantern' },
      { key: 'memoryRecall', value: '{"scopePolicy":"down-weight"}' },
      { key: 'userUploadsMountPointId', value: 'mp-uploads' },
      { key: 'generalMountPointId', value: 'mp-general' },
      { key: 'lastMaintenanceSweepAt', value: '2026-08-01T00:00:00.000Z' },
      { key: 'highest_app_version', value: '4.8.0' },
      { key: 'dataRetention', value: '{"staleChatDays":30}' },
    ])

    const settings = await listPortableInstanceSettings()

    expect(settings.map((s) => s.key)).toEqual([
      'maxConcurrentJobs',
      'memoryRecall',
      'dataRetention',
    ])
    for (const key of NON_PORTABLE) {
      expect(settings.some((s) => s.key === key)).toBe(false)
    }
  })

  it('exposes the exclusion list itself, so the writer and the docs agree', () => {
    expect([...NON_PORTABLE_INSTANCE_SETTING_KEYS].sort()).toEqual([...NON_PORTABLE].sort())
  })

  it('returns [] rather than throwing when the table is missing', async () => {
    // Very old databases predate the instance_settings provisioning migration.
    ;(rawQuery as jest.Mock).mockRejectedValue(new Error('no such table: instance_settings'))

    await expect(listPortableInstanceSettings()).resolves.toEqual([])
  })
})
