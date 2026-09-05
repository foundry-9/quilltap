/**
 * Unit tests for standing instructions (project + group `instructions`
 * rendered into the system prompt).
 *
 * Load-bearing behaviors:
 *  - **Empty means absent.** A chat with no project/group instructions must
 *    produce a byte-identical prompt to one built before the feature existed,
 *    or the golden cache-determinism hash moves for everybody.
 *  - **Deterministic order.** Group sources sort by name so the cacheable
 *    prefix never wobbles with membership-row iteration order.
 *  - **Fail soft.** A broken project store or degraded mount index drops the
 *    source, never the turn.
 *  - **Placement.** After the Taboo section, before the per-turn tool
 *    instructions — inside cacheable system block 1.
 */

import {
  resolveStandingInstructions,
  renderStandingInstructionsSection,
  resolveStandingInstructionsSection,
} from '@/lib/chat/context/standing-instructions'
import { buildSystemPrompt } from '@/lib/chat/context/system-prompt-builder'
import { getRepositories } from '@/lib/repositories/factory'
import type { Character } from '@/lib/schemas/types'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

const mockGetRepositories = getRepositories as jest.Mock

const now = '2025-01-01T00:00:00.000Z'

const CHARACTER = {
  id: 'char-1',
  name: 'Test Character',
  personality: 'Friendly and helpful',
  systemPrompts: [],
  scenarios: [],
  createdAt: now,
  updatedAt: now,
} as unknown as Character

const MARKER = '[STANDING INSTRUCTIONS]'
const TABOO_MARKER = '[STYLE: FORBIDDEN PHRASES]'

function mockRepos(overrides: {
  project?: unknown
  projectError?: Error
  memberships?: Array<{ groupId: string }>
  membershipsError?: Error
  groupsById?: Record<string, unknown>
  groupErrors?: Record<string, Error>
} = {}) {
  mockGetRepositories.mockReturnValue({
    projects: {
      findById: jest.fn(async () => {
        if (overrides.projectError) throw overrides.projectError
        return overrides.project ?? null
      }),
    },
    groupCharacterMembers: {
      findByCharacterId: jest.fn(async () => {
        if (overrides.membershipsError) throw overrides.membershipsError
        return overrides.memberships ?? []
      }),
    },
    groups: {
      findById: jest.fn(async (id: string) => {
        const err = overrides.groupErrors?.[id]
        if (err) throw err
        return overrides.groupsById?.[id] ?? null
      }),
    },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRepos()
})

describe('resolveStandingInstructions', () => {
  it('returns nothing when neither a project nor a character is given', async () => {
    expect(await resolveStandingInstructions({})).toEqual([])
  })

  it('returns the project source when the project has instructions', async () => {
    mockRepos({ project: { id: 'p1', name: 'The Expedition', instructions: 'Stay in period voice.' } })
    const sources = await resolveStandingInstructions({ projectId: 'p1' })
    expect(sources).toEqual([
      { kind: 'project', name: 'The Expedition', instructions: 'Stay in period voice.' },
    ])
  })

  it('skips a project whose instructions are empty or whitespace', async () => {
    mockRepos({ project: { id: 'p1', name: 'The Expedition', instructions: '   ' } })
    expect(await resolveStandingInstructions({ projectId: 'p1' })).toEqual([])
  })

  it('drops the project source when the lookup throws', async () => {
    mockRepos({ projectError: new Error('store unavailable') })
    expect(await resolveStandingInstructions({ projectId: 'p1' })).toEqual([])
  })

  it('collects group instructions sorted by name, not membership order', async () => {
    mockRepos({
      memberships: [{ groupId: 'g-z' }, { groupId: 'g-a' }],
      groupsById: {
        'g-z': { id: 'g-z', name: 'Zeppelin Crew', instructions: 'Mind the ballast.' },
        'g-a': { id: 'g-a', name: 'Aeronauts', instructions: 'Log every flight.' },
      },
    })
    const sources = await resolveStandingInstructions({ characterId: 'char-1' })
    expect(sources.map(s => s.name)).toEqual(['Aeronauts', 'Zeppelin Crew'])
  })

  it('survives one broken group and keeps the rest', async () => {
    mockRepos({
      memberships: [{ groupId: 'g-bad' }, { groupId: 'g-ok' }],
      groupsById: { 'g-ok': { id: 'g-ok', name: 'Aeronauts', instructions: 'Log every flight.' } },
      groupErrors: { 'g-bad': new Error('vault gone') },
    })
    const sources = await resolveStandingInstructions({ characterId: 'char-1' })
    expect(sources).toEqual([
      { kind: 'group', name: 'Aeronauts', instructions: 'Log every flight.' },
    ])
  })

  it('drops all group sources when the membership lookup throws', async () => {
    mockRepos({ membershipsError: new Error('mount index degraded') })
    expect(await resolveStandingInstructions({ characterId: 'char-1' })).toEqual([])
  })

  it('puts the project source ahead of group sources', async () => {
    mockRepos({
      project: { id: 'p1', name: 'The Expedition', instructions: 'Stay in period voice.' },
      memberships: [{ groupId: 'g-a' }],
      groupsById: { 'g-a': { id: 'g-a', name: 'Aeronauts', instructions: 'Log every flight.' } },
    })
    const sources = await resolveStandingInstructions({ projectId: 'p1', characterId: 'char-1' })
    expect(sources.map(s => s.kind)).toEqual(['project', 'group'])
  })
})

describe('renderStandingInstructionsSection', () => {
  it('returns null for an empty or absent source list', () => {
    expect(renderStandingInstructionsSection([])).toBeNull()
    expect(renderStandingInstructionsSection(null)).toBeNull()
    expect(renderStandingInstructionsSection(undefined)).toBeNull()
  })

  it('returns null when every source is whitespace', () => {
    expect(
      renderStandingInstructionsSection([{ kind: 'project', name: 'P', instructions: '   ' }]),
    ).toBeNull()
  })

  it('renders the preamble plus one headed block per source, in order', () => {
    const section = renderStandingInstructionsSection([
      { kind: 'project', name: 'The Expedition', instructions: 'Stay in period voice.' },
      { kind: 'group', name: 'Aeronauts', instructions: 'Log every flight.' },
    ])!
    expect(section.startsWith(MARKER)).toBe(true)
    expect(section).toContain('## Project Instructions — The Expedition\nStay in period voice.')
    expect(section).toContain('## Group Instructions — Aeronauts\nLog every flight.')
    expect(section.indexOf('Project Instructions')).toBeLessThan(section.indexOf('Group Instructions'))
  })

  it('is byte-identical across consecutive calls', () => {
    const sources = [
      { kind: 'project' as const, name: 'P', instructions: 'A' },
      { kind: 'group' as const, name: 'G', instructions: 'B' },
    ]
    expect(renderStandingInstructionsSection(sources)).toBe(renderStandingInstructionsSection(sources))
  })
})

describe('resolveStandingInstructionsSection', () => {
  it('resolves and renders in one call', async () => {
    mockRepos({ project: { id: 'p1', name: 'The Expedition', instructions: 'Stay in period voice.' } })
    const section = await resolveStandingInstructionsSection({ projectId: 'p1' })
    expect(section).toContain(MARKER)
    expect(section).toContain('Stay in period voice.')
  })

  it('returns null when there is nothing to say', async () => {
    expect(await resolveStandingInstructionsSection({ projectId: 'p1', characterId: 'char-1' })).toBeNull()
  })
})

describe('buildSystemPrompt — standing-instructions integration', () => {
  const SECTION = `${MARKER}
The sections below are standing instructions attached to this chat's project and to groups you belong to. They hold for the entire conversation. They refine how you conduct yourself here; they never replace who you are.

## Project Instructions — The Expedition
{{char}} keeps the expedition journal.`

  it('omits the section entirely when the option is absent', () => {
    const prompt = buildSystemPrompt({ character: CHARACTER })
    expect(prompt).not.toContain(MARKER)
  })

  it('produces a byte-identical prompt for "absent", "null", and "empty string"', () => {
    const without = buildSystemPrompt({ character: CHARACTER })
    const withNull = buildSystemPrompt({ character: CHARACTER, standingInstructions: null })
    const withEmpty = buildSystemPrompt({ character: CHARACTER, standingInstructions: '' })
    expect(withNull).toBe(without)
    expect(withEmpty).toBe(without)
  })

  it('places the section after Taboo and before tool instructions', () => {
    const prompt = buildSystemPrompt({
      character: CHARACTER,
      toolInstructions: 'Tools available: foo, bar.',
      tabooPhrases: ['weight-bearing'],
      standingInstructions: SECTION,
    })
    const tabooIdx = prompt.indexOf(TABOO_MARKER)
    const standingIdx = prompt.indexOf(MARKER)
    const toolIdx = prompt.indexOf('Tools available: foo, bar.')
    expect(tabooIdx).toBeGreaterThanOrEqual(0)
    expect(standingIdx).toBeGreaterThan(tabooIdx)
    expect(toolIdx).toBeGreaterThan(standingIdx)
  })

  it('template-processes the section, unlike Taboo', () => {
    const prompt = buildSystemPrompt({ character: CHARACTER, standingInstructions: SECTION })
    expect(prompt).toContain('Test Character keeps the expedition journal.')
    expect(prompt).not.toContain('{{char}} keeps the expedition journal.')
  })
})
