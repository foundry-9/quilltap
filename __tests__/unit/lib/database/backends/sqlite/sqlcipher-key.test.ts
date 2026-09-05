/**
 * @jest-environment node
 *
 * The one place `ENCRYPTION_MASTER_PEPPER` becomes a key pragma.
 *
 * Every connection to an encrypted Quilltap database — main, mount-index,
 * llm-logs, the job child's readonly handle, ad-hoc maintenance connections —
 * routes through this. The pepper is base64 and SQLCipher wants raw hex in the
 * `x'...'` form, which bypasses SQLCipher's own KDF; get the encoding wrong and
 * the database opens to a key nothing else in the instance derives, which reads
 * as corruption rather than as a wrong password.
 */

import { applySqlcipherKey } from '@/lib/database/backends/sqlite/sqlcipher-key'
import type { Database as DatabaseType } from 'better-sqlite3'

/** A connection stub that records the pragmas applied to it. */
function fakeDb(): { db: DatabaseType; pragmas: string[] } {
  const pragmas: string[] = []
  const db = { pragma: (sql: string) => pragmas.push(sql) } as unknown as DatabaseType
  return { db, pragmas }
}

describe('applySqlcipherKey', () => {
  const original = process.env.ENCRYPTION_MASTER_PEPPER

  afterEach(() => {
    if (original === undefined) delete process.env.ENCRYPTION_MASTER_PEPPER
    else process.env.ENCRYPTION_MASTER_PEPPER = original
  })

  it('applies the pepper as a raw hex key, bypassing SQLCipher\'s KDF', () => {
    const pepper = Buffer.alloc(32, 0xab).toString('base64')
    process.env.ENCRYPTION_MASTER_PEPPER = pepper
    const { db, pragmas } = fakeDb()

    expect(applySqlcipherKey(db)).toBe(true)
    expect(pragmas).toEqual([`key = "x'${'ab'.repeat(32)}'"`])
  })

  it('decodes base64 rather than passing the pepper through verbatim', () => {
    process.env.ENCRYPTION_MASTER_PEPPER = Buffer.from('hello').toString('base64')
    const { db, pragmas } = fakeDb()

    applySqlcipherKey(db)
    expect(pragmas[0]).toBe(`key = "x'68656c6c6f'"`)
    expect(pragmas[0]).not.toContain(process.env.ENCRYPTION_MASTER_PEPPER!)
  })

  it('applies exactly one pragma — it must be the first thing to touch the file', () => {
    process.env.ENCRYPTION_MASTER_PEPPER = Buffer.alloc(32, 1).toString('base64')
    const { db, pragmas } = fakeDb()

    applySqlcipherKey(db)
    expect(pragmas).toHaveLength(1)
  })

  it('does nothing and says so for a plaintext database', () => {
    delete process.env.ENCRYPTION_MASTER_PEPPER
    const { db, pragmas } = fakeDb()

    expect(applySqlcipherKey(db)).toBe(false)
    expect(pragmas).toEqual([])
  })

  it('treats an empty pepper as no pepper', () => {
    process.env.ENCRYPTION_MASTER_PEPPER = ''
    const { db, pragmas } = fakeDb()

    expect(applySqlcipherKey(db)).toBe(false)
    expect(pragmas).toEqual([])
  })
})
