/**
 * Recognising a unique-constraint violation.
 *
 * This predicate is what lets `FoldersRepository.ensureByPath` resolve a lost
 * race to the row that won instead of propagating — the fix for bug 114, where
 * six hand-rolled find-then-create guards grew the `folders` table to 607 rows
 * for 24 folders. A false negative here puts that back: the loser throws and
 * the caller retries the insert. A false *positive* is worse — a genuine
 * failure swallowed as "someone else got there first".
 */

import { isUniqueConstraintError } from '@/lib/database/sqlite-errors'

describe('isUniqueConstraintError — recognised', () => {
  it('reads the structured better-sqlite3 code', () => {
    expect(isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true)
  })

  it('reads the primary-key variant', () => {
    expect(isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })).toBe(true)
  })

  it('reads any SQLITE_CONSTRAINT code', () => {
    expect(isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT_TRIGGER' })).toBe(true)
    expect(isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT' })).toBe(true)
  })

  it('reads the message a wrapped or re-thrown error carries', () => {
    const err = new Error('UNIQUE constraint failed: folders.userId, folders.path')
    expect(isUniqueConstraintError(err)).toBe(true)
  })

  it('reads the message case-insensitively', () => {
    expect(isUniqueConstraintError(new Error('unique constraint failed: x.y'))).toBe(true)
  })

  it('reads the message even when the code says something else', () => {
    expect(
      isUniqueConstraintError({ code: 'ERR_INTERNAL', message: 'UNIQUE constraint failed: x.y' })
    ).toBe(true)
  })
})

describe('isUniqueConstraintError — refused', () => {
  it('refuses a non-object', () => {
    expect(isUniqueConstraintError(null)).toBe(false)
    expect(isUniqueConstraintError(undefined)).toBe(false)
    expect(isUniqueConstraintError('UNIQUE constraint failed')).toBe(false)
    expect(isUniqueConstraintError(0)).toBe(false)
  })

  it('refuses an unrelated SQLite error', () => {
    expect(isUniqueConstraintError({ code: 'SQLITE_BUSY' })).toBe(false)
    expect(isUniqueConstraintError({ code: 'SQLITE_READONLY' })).toBe(false)
    expect(isUniqueConstraintError(new Error('no such table: folders'))).toBe(false)
  })

  it('refuses a NOT NULL constraint reported only by message', () => {
    expect(isUniqueConstraintError(new Error('NOT NULL constraint failed: folders.path'))).toBe(
      false
    )
  })

  it('refuses an error with neither field', () => {
    expect(isUniqueConstraintError({})).toBe(false)
    expect(isUniqueConstraintError({ code: 42, message: 99 })).toBe(false)
  })
})
