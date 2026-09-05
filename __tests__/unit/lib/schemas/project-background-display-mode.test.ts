/**
 * `project` and `static` background display modes were retired in 4.9 — both
 * were offered in the UI and neither ever produced an image.
 *
 * ProjectPropertiesSchema is `.parse`d (not safeParse'd) on every project read
 * in lib/projects/project-store/overlay.ts, so narrowing the enum without
 * coercing would throw away every project still stored in a retired mode.
 */

import {
  ProjectPropertiesSchema,
  normalizeBackgroundDisplayMode,
  RETIRED_BACKGROUND_DISPLAY_MODES,
} from '@/lib/schemas/project.types'

describe('normalizeBackgroundDisplayMode', () => {
  it('passes the surviving modes through untouched', () => {
    expect(normalizeBackgroundDisplayMode('latest_chat')).toBe('latest_chat')
    expect(normalizeBackgroundDisplayMode('theme')).toBe('theme')
  })

  it('coerces every retired mode to theme', () => {
    for (const retired of RETIRED_BACKGROUND_DISPLAY_MODES) {
      expect(normalizeBackgroundDisplayMode(retired)).toBe('theme')
    }
  })

  it('coerces an unrecognised value to theme', () => {
    expect(normalizeBackgroundDisplayMode('wallpaper')).toBe('theme')
    expect(normalizeBackgroundDisplayMode(7)).toBe('theme')
  })

  it('leaves absent values to the schema default', () => {
    expect(normalizeBackgroundDisplayMode(undefined)).toBeUndefined()
    expect(normalizeBackgroundDisplayMode(null)).toBeUndefined()
  })
})

describe('ProjectPropertiesSchema.backgroundDisplayMode', () => {
  it('parses a project stored in a retired mode instead of throwing', () => {
    for (const retired of RETIRED_BACKGROUND_DISPLAY_MODES) {
      const parsed = ProjectPropertiesSchema.parse({ backgroundDisplayMode: retired })
      expect(parsed.backgroundDisplayMode).toBe('theme')
    }
  })

  it('keeps latest_chat, the one image-bearing mode that works', () => {
    expect(
      ProjectPropertiesSchema.parse({ backgroundDisplayMode: 'latest_chat' }).backgroundDisplayMode
    ).toBe('latest_chat')
  })

  it('defaults to theme when the field is absent', () => {
    expect(ProjectPropertiesSchema.parse({}).backgroundDisplayMode).toBe('theme')
  })
})
