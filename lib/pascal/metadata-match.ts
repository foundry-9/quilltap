/**
 * Fail-soft metadata comparison — one semantics table, two callers.
 *
 * A `metadata` comparator names a key on a character the definition has never
 * met, so nothing about the subject is knowable at load time: the key may be
 * absent, may hold a list, may hold a string where the table wanted a number.
 * Each of those simply fails to match. That rule is load-bearing in two places —
 * the outcome table (`matchesWhen`, at roll time) and the availability gate
 * (`evaluateToolGate`, before a tool is ever offered) — and a second
 * implementation of it would drift the moment one side gained a comparator.
 *
 * CLIENT-SAFE: no logger, no repositories, no node built-ins. The Workbench runs
 * this in the browser to tell an author whether a fact sheet would be dealt to,
 * against the same code the roster loader runs on the server.
 */

import { COMPARATOR_KEYS, type MetadataComparator } from './custom-tool.types';

/** The value types a comparator can actually compare. */
export type Primitive = number | string | boolean;

/** True for the value types a comparator can actually compare. */
export function isPrimitive(value: unknown): value is Primitive {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
}

export interface MetadataMatchHooks {
  /**
   * Resolve one comparator operand to the value it compares against. The
   * outcome table passes a resolver that follows `$param`/`$state` references;
   * the gate, whose operands are literals by construction, passes the identity.
   */
  resolveOperand: (key: (typeof COMPARATOR_KEYS)[number]) => Primitive;
  /** Why a comparator declined, for a caller that wants to log it. */
  onDecline?: (reason: string) => void;
}

/**
 * Evaluate one comparator against one metadata key. Keys AND together.
 *
 * Everything a declared-parameter comparison would treat as a regression is,
 * here, an ordinary fact about a character — so it declines the row rather than
 * throwing. Throwing would punish an author whose table is working exactly as
 * designed: a lockpicking table branches on the key its author invented, and
 * must still deal sensibly to the character who has never heard of it.
 *
 * Operand resolution is the caller's business, and may still throw: a `$param`
 * reference IS load-validated, so its failure is a regression rather than a
 * fact about the character.
 */
export function metadataComparatorHolds(
  comparator: MetadataComparator,
  key: string,
  metadata: Record<string, unknown>,
  hooks: MetadataMatchHooks
): boolean {
  const decline = (reason: string): false => {
    hooks.onDecline?.(reason);
    return false;
  };

  if (!(key in metadata)) return decline('the character has no such metadata key');

  const subject = metadata[key];
  if (!isPrimitive(subject)) {
    return decline(
      `the key holds ${subject === null ? 'null' : Array.isArray(subject) ? 'an array' : 'an object'}, which cannot be compared`
    );
  }

  for (const comparatorKey of ['gt', 'gte', 'lt', 'lte'] as const) {
    if (comparator[comparatorKey] === undefined) continue;
    const operand = hooks.resolveOperand(comparatorKey);
    if (typeof subject !== 'number' || typeof operand !== 'number') {
      return decline(`${comparatorKey} orders ${JSON.stringify(subject)}, and only numbers can be ordered`);
    }
    const held =
      comparatorKey === 'gt'
        ? subject > operand
        : comparatorKey === 'gte'
          ? subject >= operand
          : comparatorKey === 'lt'
            ? subject < operand
            : subject <= operand;
    if (!held) return false;
  }

  if (comparator.eq !== undefined && subject !== hooks.resolveOperand('eq')) return false;
  if (comparator.neq !== undefined && subject === hooks.resolveOperand('neq')) return false;

  // Containment follows the same fail-soft rule as ordering: a key holding
  // anything but a string cannot be searched, so the row declines — including
  // under ncontains, where (as with neq) absence-of-a-string is not a miss.
  for (const comparatorKey of ['contains', 'ncontains'] as const) {
    if (comparator[comparatorKey] === undefined) continue;
    const operand = hooks.resolveOperand(comparatorKey);
    if (typeof subject !== 'string' || typeof operand !== 'string') {
      return decline(`${comparatorKey} searches ${JSON.stringify(subject)}, and only a string can contain a substring`);
    }
    const held = subject.includes(operand);
    if (comparatorKey === 'contains' ? !held : held) return false;
  }

  return true;
}
