/**
 * Custom-tool run presets — the naming contract.
 *
 * A preset is an ordinary JSON document in the running character's vault,
 * `Tools/{toolname}.{preset}.settings.json`: a flat object of parameter name →
 * value, saved from and loaded back into the run dialog's form. This module is
 * the single source of truth for the filename shape — both the dialog and the
 * tests build and parse paths through it, never by hand.
 *
 * Pure and client-safe: no imports beyond this file's own constants, so the
 * Salon can use it directly.
 *
 * The preset segment is deliberately stricter than a general filename: tool
 * names (`IDENTIFIER_PATTERN`) never contain a dot, so keeping dots out of the
 * preset name too makes `{toolname}.{preset}.settings.json` parse unambiguously
 * — and keeps the name safe on every filesystem shape a vault can take.
 */

import { TOOLS_FOLDER } from './custom-tool.types';

/** What a preset name must look like: lowercase, filename-safe, dot-free. */
export const PRESET_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The suffix every preset file wears. */
export const PRESET_FILE_SUFFIX = '.settings.json';

/**
 * The keystroke filter for the preset-name input: lowercase, strip anything
 * outside `[a-z0-9_-]`, cap at 64. Applied on change so an illegal character
 * cannot be typed at all; the result still needs {@link PRESET_NAME_PATTERN}
 * (it can be empty, or lead with `_`/`-`) before a save is allowed.
 */
export function sanitizePresetNameInput(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
}

/** Vault-relative path of one preset file. */
export function presetSettingsPath(toolName: string, preset: string): string {
  return `${TOOLS_FOLDER}/${toolName}.${preset}${PRESET_FILE_SUFFIX}`;
}

/**
 * The preset name a vault path holds for `toolName`, or null when the path is
 * anything else: another tool's preset, a nested path, a `.tool.json`
 * definition, or a preset segment that would not have been accepted as input.
 */
export function parsePresetFromPath(toolName: string, relativePath: string): string | null {
  const prefix = `${TOOLS_FOLDER}/${toolName}.`;
  if (!relativePath.startsWith(prefix) || !relativePath.endsWith(PRESET_FILE_SUFFIX)) return null;
  const preset = relativePath.slice(prefix.length, -PRESET_FILE_SUFFIX.length);
  return PRESET_NAME_PATTERN.test(preset) ? preset : null;
}
