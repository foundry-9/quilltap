/**
 * Unit tests for the scenario precedence chain.
 *
 * `resolveScenarioSelection` is the one place a picked scenario becomes text,
 * for both chat creation and the in-chat `?action=scenario` change. The
 * precedence between tiers — and the fail-soft behaviour when a pointer no
 * longer resolves — is what keeps the two surfaces honest with each other.
 */

// Uses global jest (not @jest/globals) for proper SWC mock hoisting

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

const mockResolveProjectScenarioBody = jest.fn()
const mockResolveGroupScenarioBody = jest.fn()
const mockResolveGeneralScenarioBody = jest.fn()

jest.mock('@/lib/mount-index/project-scenarios', () => ({
  resolveProjectScenarioBody: (...args: unknown[]) => mockResolveProjectScenarioBody(...args),
}))
jest.mock('@/lib/mount-index/group-scenarios', () => ({
  resolveGroupScenarioBody: (...args: unknown[]) => mockResolveGroupScenarioBody(...args),
}))
jest.mock('@/lib/mount-index/general-scenarios', () => ({
  resolveGeneralScenarioBody: (...args: unknown[]) => mockResolveGeneralScenarioBody(...args),
}))

import { resolveScenarioSelection } from '@/lib/chat/scenario-selection'
import { logger } from '@/lib/logger'
import type { RepositoryContainer } from '@/lib/repositories/factory'

const PROJECT_ID = 'project-1'
const GROUP_ID = 'group-1'

const CHARACTER = {
  id: 'char-1',
  scenarios: [
    { id: 'scenario-1', content: 'A tavern at dusk.' },
    { id: 'scenario-2', content: 'A rooftop in the rain.' },
  ],
}

function makeRepos(overrides: {
  projectMountPointId?: string | null
  groupMountPointId?: string | null
} = {}): RepositoryContainer {
  const {
    projectMountPointId = 'project-mount',
    groupMountPointId = 'group-mount',
  } = overrides
  return {
    projects: {
      findByIdRaw: jest.fn().mockResolvedValue(
        projectMountPointId === null ? null : { officialMountPointId: projectMountPointId },
      ),
    },
    groups: {
      findByIdRaw: jest.fn().mockResolvedValue(
        groupMountPointId === null ? null : { officialMountPointId: groupMountPointId },
      ),
    },
  } as unknown as RepositoryContainer
}

describe('resolveScenarioSelection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveProjectScenarioBody.mockResolvedValue('Project scene.')
    mockResolveGroupScenarioBody.mockResolvedValue('Group scene.')
    mockResolveGeneralScenarioBody.mockResolvedValue('General scene.')
  })

  it('returns undefined when nothing is chosen and nothing is typed', async () => {
    const result = await resolveScenarioSelection({}, { repos: makeRepos() })
    expect(result).toBeUndefined()
  })

  it('resolves a character scenarioId against the character record', async () => {
    const result = await resolveScenarioSelection(
      { scenarioId: 'scenario-2' },
      { repos: makeRepos(), character: CHARACTER },
    )
    expect(result).toBe('A rooftop in the rain.')
  })

  it('prefers a character scenario over every file-backed tier', async () => {
    const result = await resolveScenarioSelection(
      {
        scenarioId: 'scenario-1',
        projectScenarioPath: 'Scenarios/p.md',
        groupScenarioPath: 'Scenarios/g.md',
        groupScenarioGroupId: GROUP_ID,
        generalScenarioPath: 'Scenarios/gen.md',
      },
      { repos: makeRepos(), character: CHARACTER, projectId: PROJECT_ID },
    )
    expect(result).toBe('A tavern at dusk.')
    expect(mockResolveProjectScenarioBody).not.toHaveBeenCalled()
    expect(mockResolveGroupScenarioBody).not.toHaveBeenCalled()
    expect(mockResolveGeneralScenarioBody).not.toHaveBeenCalled()
  })

  it('prefers project over group, and group over general', async () => {
    const withProject = await resolveScenarioSelection(
      {
        projectScenarioPath: 'Scenarios/p.md',
        groupScenarioPath: 'Scenarios/g.md',
        groupScenarioGroupId: GROUP_ID,
        generalScenarioPath: 'Scenarios/gen.md',
      },
      { repos: makeRepos(), projectId: PROJECT_ID },
    )
    expect(withProject).toBe('Project scene.')

    const withGroup = await resolveScenarioSelection(
      {
        groupScenarioPath: 'Scenarios/g.md',
        groupScenarioGroupId: GROUP_ID,
        generalScenarioPath: 'Scenarios/gen.md',
      },
      { repos: makeRepos() },
    )
    expect(withGroup).toBe('Group scene.')

    const withGeneral = await resolveScenarioSelection(
      { generalScenarioPath: 'Scenarios/gen.md' },
      { repos: makeRepos() },
    )
    expect(withGeneral).toBe('General scene.')
  })

  it('layers free-text notes beneath the resolved preset', async () => {
    const result = await resolveScenarioSelection(
      { generalScenarioPath: 'Scenarios/gen.md', scenario: 'It is raining.' },
      { repos: makeRepos() },
    )
    expect(result).toBe('General scene.\n\nIt is raining.')
  })

  it('uses free text alone when no preset is chosen', async () => {
    const result = await resolveScenarioSelection(
      { scenario: 'Just the notes.' },
      { repos: makeRepos() },
    )
    expect(result).toBe('Just the notes.')
  })

  describe('fail-soft behaviour', () => {
    it('falls through to the next tier when a scenarioId is not on the character', async () => {
      const result = await resolveScenarioSelection(
        { scenarioId: 'missing-id', generalScenarioPath: 'Scenarios/gen.md' },
        { repos: makeRepos(), character: CHARACTER },
      )
      expect(result).toBe('General scene.')
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('scenarioId not found on character'),
        expect.anything(),
      )
    })

    it('ignores a project path when the chat has no project', async () => {
      const result = await resolveScenarioSelection(
        { projectScenarioPath: 'Scenarios/p.md', generalScenarioPath: 'Scenarios/gen.md' },
        { repos: makeRepos() },
      )
      expect(result).toBe('General scene.')
      expect(mockResolveProjectScenarioBody).not.toHaveBeenCalled()
    })

    it('ignores a project path when the project has no official store', async () => {
      const result = await resolveScenarioSelection(
        { projectScenarioPath: 'Scenarios/p.md', generalScenarioPath: 'Scenarios/gen.md' },
        { repos: makeRepos({ projectMountPointId: null }), projectId: PROJECT_ID },
      )
      expect(result).toBe('General scene.')
    })

    it('ignores a group path with no group id', async () => {
      const result = await resolveScenarioSelection(
        { groupScenarioPath: 'Scenarios/g.md', generalScenarioPath: 'Scenarios/gen.md' },
        { repos: makeRepos() },
      )
      expect(result).toBe('General scene.')
      expect(mockResolveGroupScenarioBody).not.toHaveBeenCalled()
    })

    it('falls through when a file-backed path no longer resolves to a body', async () => {
      mockResolveProjectScenarioBody.mockResolvedValue(null)
      const result = await resolveScenarioSelection(
        { projectScenarioPath: 'Scenarios/gone.md', generalScenarioPath: 'Scenarios/gen.md' },
        { repos: makeRepos(), projectId: PROJECT_ID },
      )
      expect(result).toBe('General scene.')
    })

    it('keeps the free text when every preset tier fails', async () => {
      mockResolveGeneralScenarioBody.mockResolvedValue(null)
      const result = await resolveScenarioSelection(
        { generalScenarioPath: 'Scenarios/gone.md', scenario: 'Notes survive.' },
        { repos: makeRepos() },
      )
      expect(result).toBe('Notes survive.')
    })
  })
})
