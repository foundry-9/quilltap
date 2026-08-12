/**
 * Unit tests for the pure state path helpers.
 *
 * These mirror the behaviour previously covered indirectly through the state
 * tool handler; extracting them made them worth exercising directly.
 */

import {
  parsePath,
  getAtPath,
  setAtPath,
  deleteAtPath,
} from '@/lib/state/state-paths';

describe('parsePath', () => {
  it('returns [] for empty / whitespace / undefined', () => {
    expect(parsePath(undefined)).toEqual([]);
    expect(parsePath('')).toEqual([]);
    expect(parsePath('   ')).toEqual([]);
  });

  it('parses dot notation into string segments', () => {
    expect(parsePath('player.health')).toEqual(['player', 'health']);
  });

  it('parses array indices into numbers', () => {
    expect(parsePath('inventory[0].name')).toEqual(['inventory', 0, 'name']);
    expect(parsePath('a[2][3]')).toEqual(['a', 2, 3]);
  });
});

describe('getAtPath', () => {
  const obj = { player: { health: 10, inventory: [{ name: 'sword' }] } };

  it('returns the root object for an empty path', () => {
    expect(getAtPath(obj, [])).toBe(obj);
  });

  it('reads nested values', () => {
    expect(getAtPath(obj, ['player', 'health'])).toBe(10);
    expect(getAtPath(obj, ['player', 'inventory', 0, 'name'])).toBe('sword');
  });

  it('returns undefined for missing paths and primitives mid-path', () => {
    expect(getAtPath(obj, ['player', 'mana'])).toBeUndefined();
    expect(getAtPath(obj, ['player', 'health', 'nope'])).toBeUndefined();
  });
});

describe('setAtPath', () => {
  it('sets nested values, creating intermediate objects/arrays', () => {
    const obj: Record<string, unknown> = {};
    setAtPath(obj, ['player', 'stats', 'hp'], 5);
    expect(obj).toEqual({ player: { stats: { hp: 5 } } });

    setAtPath(obj, ['player', 'inventory', 0], 'sword');
    expect((obj.player as Record<string, unknown>).inventory).toEqual(['sword']);
  });

  it('replaces the whole object when the path is root and value is an object', () => {
    const obj: Record<string, unknown> = { a: 1 };
    const result = setAtPath(obj, [], { b: 2 });
    expect(result).toEqual({ b: 2 });
  });

  it('throws a plain Error on root-set with a non-object value', () => {
    expect(() => setAtPath({}, [], 5)).toThrow('Cannot set root state to non-object value');
    expect(() => setAtPath({}, [], [1, 2])).toThrow();
  });
});

describe('deleteAtPath', () => {
  it('deletes nested keys and reports success', () => {
    const obj: Record<string, unknown> = { player: { health: 10, mana: 3 } };
    expect(deleteAtPath(obj, ['player', 'mana'])).toBe(true);
    expect(obj).toEqual({ player: { health: 10 } });
  });

  it('splices array elements', () => {
    const obj: Record<string, unknown> = { list: ['a', 'b', 'c'] };
    expect(deleteAtPath(obj, ['list', 1])).toBe(true);
    expect(obj.list).toEqual(['a', 'c']);
  });

  it('returns false for missing paths and the root', () => {
    expect(deleteAtPath({ a: 1 }, [])).toBe(false);
    expect(deleteAtPath({ a: 1 }, ['b'])).toBe(false);
    expect(deleteAtPath({ a: 1 }, ['a', 'deep'])).toBe(false);
  });
});
