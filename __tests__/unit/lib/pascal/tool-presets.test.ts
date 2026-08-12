/**
 * Custom-tool run presets — the naming contract.
 *
 * Two properties under test. First, the preset name is locked down: nothing
 * that could not sit in a filename — spaces, dots, path delimiters — survives
 * the input filter or the pattern, so `{toolname}.{preset}.settings.json`
 * always parses back unambiguously (tool names themselves never contain dots).
 * Second, parsing is exact: another tool's preset, a nested path, or a
 * `.tool.json` definition never reads as a preset of this tool.
 */

import {
  PRESET_NAME_PATTERN,
  parsePresetFromPath,
  presetSettingsPath,
  sanitizePresetNameInput,
} from '@/lib/pascal/tool-presets'

describe('PRESET_NAME_PATTERN', () => {
  it.each(['a', 'hard-mode', 'take_2', '2nd-attempt', 'a'.repeat(64)])('accepts %j', (name) => {
    expect(PRESET_NAME_PATTERN.test(name)).toBe(true)
  })

  it.each([
    '',
    'has space',
    'dotted.name',
    'path/name',
    'back\\slash',
    'Uppercase',
    '-leading-dash',
    '_leading-underscore',
    '..',
    'a'.repeat(65),
  ])('rejects %j', (name) => {
    expect(PRESET_NAME_PATTERN.test(name)).toBe(false)
  })
})

describe('sanitizePresetNameInput', () => {
  it('lowercases and strips everything outside the preset alphabet', () => {
    expect(sanitizePresetNameInput('Hard Mode! v2.0')).toBe('hardmodev20')
  })

  it('strips path delimiters and dots outright', () => {
    expect(sanitizePresetNameInput('../../etc/passwd')).toBe('etcpasswd')
  })

  it('caps the result at 64 characters', () => {
    expect(sanitizePresetNameInput('x'.repeat(200))).toHaveLength(64)
  })

  it('leaves an already-legal name alone', () => {
    expect(sanitizePresetNameInput('hard-mode_2')).toBe('hard-mode_2')
  })

  it('can still produce a name the pattern refuses — the two are both required', () => {
    // The filter cannot fix a leading dash or an emptied string; the Save
    // button's pattern check is the second gate, not a redundancy.
    expect(sanitizePresetNameInput('-x')).toBe('-x')
    expect(PRESET_NAME_PATTERN.test(sanitizePresetNameInput('-x'))).toBe(false)
    expect(sanitizePresetNameInput('!!!')).toBe('')
  })
})

describe('presetSettingsPath / parsePresetFromPath', () => {
  it('round-trips through the filename', () => {
    const path = presetSettingsPath('coin_toss', 'hard-mode')
    expect(path).toBe('Tools/coin_toss.hard-mode.settings.json')
    expect(parsePresetFromPath('coin_toss', path)).toBe('hard-mode')
  })

  it("rejects another tool's preset, including a prefix-sharing name", () => {
    expect(parsePresetFromPath('coin', 'Tools/coin_toss.hard.settings.json')).toBeNull()
    expect(parsePresetFromPath('coin_toss', 'Tools/coin.hard.settings.json')).toBeNull()
  })

  it('rejects a tool definition file', () => {
    expect(parsePresetFromPath('coin_toss', 'Tools/coin_toss.tool.json')).toBeNull()
  })

  it('rejects a nested path and a file outside Tools/', () => {
    expect(parsePresetFromPath('coin_toss', 'Tools/deep/coin_toss.hard.settings.json')).toBeNull()
    expect(parsePresetFromPath('coin_toss', 'coin_toss.hard.settings.json')).toBeNull()
  })

  it('rejects a preset segment the input lockdown would never have allowed', () => {
    expect(parsePresetFromPath('coin_toss', 'Tools/coin_toss.Hard Mode.settings.json')).toBeNull()
    expect(parsePresetFromPath('coin_toss', 'Tools/coin_toss..settings.json')).toBeNull()
    expect(parsePresetFromPath('coin_toss', 'Tools/coin_toss.a.b.settings.json')).toBeNull()
  })
})
