/**
 * Migration registry guard.
 *
 * `migrations/scripts/index.ts` names every migration twice: once in the
 * `migrations` array the runner actually consumes, and once in the trailing
 * `export { ... }` block that merely re-exports the symbols. Adding a new
 * migration to the second list only is silent — the file compiles, lints,
 * imports cleanly, and the runner never sees it. That happened once already
 * (`add-doc-mount-link-groups-v1`, which reported "0 run, 175 skipped" and
 * left the database a column short of the code that queried it).
 *
 * Guards:
 *   - migrations/scripts/index.ts (registration completeness)
 */

import { describe, it, expect } from '@jest/globals';
import * as scripts from '@/migrations/scripts';
import type { Migration } from '@/migrations/types';

function isMigration(value: unknown): value is Migration {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<Migration>;
  return typeof m.id === 'string' && typeof m.run === 'function' && typeof m.shouldRun === 'function';
}

describe('migration registry', () => {
  const registered = scripts.migrations;

  it('registers every exported migration in the runner array', () => {
    const registeredIds = new Set(registered.map(m => m.id));

    const unregistered = Object.entries(scripts)
      .filter(([, value]) => isMigration(value))
      .filter(([, value]) => !registeredIds.has((value as Migration).id))
      .map(([exportName, value]) => `${exportName} (${(value as Migration).id})`);

    expect(unregistered).toEqual([]);
  });

  it('has no duplicate migration ids', () => {
    const ids = registered.map(m => m.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  it('gives every registered migration an id, description, and shouldRun', () => {
    for (const migration of registered) {
      expect(typeof migration.id).toBe('string');
      expect(migration.id.length).toBeGreaterThan(0);
      expect(typeof migration.description).toBe('string');
      expect(typeof migration.shouldRun).toBe('function');
      expect(typeof migration.run).toBe('function');
    }
  });

  it('resolves every declared dependency to a registered migration', () => {
    const registeredIds = new Set(registered.map(m => m.id));
    const dangling: string[] = [];
    for (const migration of registered) {
      for (const dep of migration.dependsOn ?? []) {
        if (!registeredIds.has(dep)) dangling.push(`${migration.id} → ${dep}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});
