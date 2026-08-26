/**
 * Archived-scenario helpers for character scenarios.
 *
 * `character.scenarios` deliberately carries archived entries: the vault write
 * overlay projects that array back over the `Scenarios/` folder and deletes
 * every file the array doesn't contain, so a pre-filtered array would delete
 * the archived files (see `CharacterScenarioSchema.archived`). Filtering
 * therefore happens at the point of use — here — and never at the vault read.
 *
 * Resolving a scenario the user (or the chat) named explicitly does NOT go
 * through this: archiving hides a scenario from the menus, it does not break
 * the chats that already chose it.
 *
 * @module characters/active-scenarios
 */

import type { CharacterScenario } from '@/lib/schemas/character.types';

/** The scenarios a picker or an implicit default may draw from. */
export function activeScenarios(
  scenarios: CharacterScenario[] | null | undefined,
): CharacterScenario[] {
  return (scenarios ?? []).filter((s) => s.archived !== true);
}

/**
 * The content of the character's first non-archived scenario, or `''`.
 *
 * Used as the implicit scenario when a chat names none. An archived scenario
 * sitting at index 0 must not become the scene by accident — that's the same
 * rule as "an archived file can't be the folder's default".
 */
export function firstActiveScenarioContent(
  scenarios: CharacterScenario[] | null | undefined,
): string {
  return activeScenarios(scenarios)[0]?.content ?? '';
}
