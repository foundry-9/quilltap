/**
 * NewChatForm scenario-layering tests
 *
 * Covers the "layer free text onto a chosen scenario" change:
 * - The free-text editor is now ALWAYS shown (even when a preset is selected).
 * - Selecting a preset preset shows the read-only preview plus the editor and a
 *   "added beneath the scenario above" hint.
 * - Selecting a preset no longer clears the typed free text (`scenario`).
 *
 * Uses global jest (not @jest/globals) so the bare jest.mock factories hoist
 * cleanly. Heavy child components are stubbed; MarkdownLexicalEditor is replaced
 * with a plain textarea that surfaces its aria-label.
 */

import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { NewChatForm } from '../NewChatForm'
import type {
  Character,
  GeneralScenarioOption,
  NewChatFormState,
  RoleplayTemplateOption,
  SelectedCharacter,
} from '../types'

// --- Stub heavy / irrelevant children -------------------------------------

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@/components/ui/icon', () => ({
  Icon: () => null,
}))

jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string
    onChange: (v: string) => void
    ariaLabel?: string
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

jest.mock('@/components/image-profiles/ImageProfilePicker', () => ({
  ImageProfilePicker: () => null,
}))

jest.mock('@/components/settings/chat-settings/components/TimestampConfigCard', () => ({
  TimestampConfigCard: () => null,
}))

jest.mock('@/components/wardrobe', () => ({
  OutfitSelector: () => null,
}))

jest.mock('@/components/new-chat/AutonomousRoomCard', () => ({
  AutonomousRoomCard: () => null,
}))

jest.mock('@/hooks/usePersonaDisplayName', () => ({
  useUserCharacterDisplayName: () => ({
    formatCharacterName: (c: { name?: string } | null | undefined) => c?.name ?? '',
  }),
}))

// --- Fixtures --------------------------------------------------------------

function makeState(overrides: Partial<NewChatFormState> = {}): NewChatFormState {
  return {
    imageProfileId: '',
    roleplayTemplateId: null,
    roleplayTemplateTouched: false,
    scenario: '',
    scenarioId: null,
    projectScenarioPath: null,
    generalScenarioPath: null,
    groupScenarioPath: null,
    groupScenarioGroupId: null,
    timestampConfig: null,
    avatarGenerationEnabled: false,
    outfitSelections: [],
    autonomous: {
      enabled: false,
      scheduleCron: '',
      scheduleFreshnessHours: null,
      budgetMaxTurns: null,
      budgetMaxTokens: null,
      budgetMaxWallClockMinutes: null,
      budgetEstimatedSpendCapUSD: null,
      runVisibility: null,
      runDestructiveToolsAllowed: false,
      budgetExcludeCacheHits: true,
    },
    ...overrides,
  }
}

const GENERAL_SCENARIO: GeneralScenarioOption = {
  path: 'Scenarios/foggy-moor.md',
  filename: 'foggy-moor.md',
  name: 'Foggy Moor',
  isDefault: false,
  body: 'A foggy moor at dawn.',
}

function renderForm(stateOverrides: Partial<NewChatFormState> = {}, props: Record<string, unknown> = {}) {
  const setState = jest.fn()
  render(
    <NewChatForm
      profiles={[]}
      imageProfiles={[]}
      userControlledCharacters={[]}
      selectedCharacters={[]}
      setSelectedCharacters={jest.fn()}
      state={makeState(stateOverrides)}
      setState={setState}
      project={null}
      creating={false}
      {...props}
    />
  )
  return { setState }
}

// --- Tests -----------------------------------------------------------------

describe('NewChatForm scenario layering', () => {
  it('shows the "Starting scenario" editor when no preset is selected', () => {
    renderForm()
    expect(screen.getByLabelText('Starting scenario')).toBeInTheDocument()
    expect(screen.queryByLabelText('Additional scenario notes')).not.toBeInTheDocument()
  })

  it('shows the preset preview, append hint, and editor when a preset is selected', () => {
    renderForm(
      { generalScenarioPath: GENERAL_SCENARIO.path },
      { generalScenarios: [GENERAL_SCENARIO] }
    )
    // Read-only preview of the chosen scenario body
    expect(screen.getByText('A foggy moor at dawn.')).toBeInTheDocument()
    // The append hint
    expect(screen.getByText(/added beneath the scenario above/i)).toBeInTheDocument()
    // The editor is still present, relabelled
    expect(screen.getByLabelText('Additional scenario notes')).toBeInTheDocument()
    expect(screen.queryByLabelText('Starting scenario')).not.toBeInTheDocument()
  })

  it('does NOT clear typed free text when a preset is selected from the dropdown', () => {
    const { setState } = renderForm(
      { scenario: 'typed notes' },
      { generalScenarios: [GENERAL_SCENARIO] }
    )

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: `general:${GENERAL_SCENARIO.path}` } })

    // handleScenarioSelectChange calls setState with a functional updater.
    expect(setState).toHaveBeenCalledTimes(1)
    const updater = setState.mock.calls[0][0] as (prev: NewChatFormState) => NewChatFormState
    const next = updater(makeState({ scenario: 'typed notes' }))

    // The preset is set, but the free text survives (no `scenario: ''` reset).
    expect(next.generalScenarioPath).toBe(GENERAL_SCENARIO.path)
    expect(next.scenario).toBe('typed notes')
  })
})

// --- "Play As" in-place + autonomous toggle --------------------------------

function makeChar(id: string, name: string, overrides: Partial<Character> = {}): Character {
  return { id, name, ...overrides }
}

function llm(character: Character, connectionProfileId = 'profile-1'): SelectedCharacter {
  return { character, connectionProfileId, controlledBy: 'llm' }
}

function user(character: Character): SelectedCharacter {
  return { character, connectionProfileId: '', controlledBy: 'user' }
}

/**
 * Render with explicit cast + roster and a `setSelectedCharacters` spy so the
 * Play-As updater can be inspected.
 */
function renderPlayAs(
  selectedCharacters: SelectedCharacter[],
  userControlledCharacters: Character[] = [],
  stateOverrides: Partial<NewChatFormState> = {}
) {
  const setSelectedCharacters = jest.fn()
  render(
    <NewChatForm
      profiles={[]}
      imageProfiles={[]}
      userControlledCharacters={userControlledCharacters}
      selectedCharacters={selectedCharacters}
      setSelectedCharacters={setSelectedCharacters}
      state={makeState(stateOverrides)}
      setState={jest.fn()}
      project={null}
      creating={false}
    />
  )
  return { setSelectedCharacters }
}

/** Apply the functional updater the dropdown handed to setSelectedCharacters. */
function applyUpdater(
  spy: jest.Mock,
  prev: SelectedCharacter[]
): SelectedCharacter[] {
  expect(spy).toHaveBeenCalledTimes(1)
  const updater = spy.mock.calls[0][0] as (p: SelectedCharacter[]) => SelectedCharacter[]
  return updater(prev)
}

const autonomousCheckbox = () =>
  screen.getByRole('checkbox', { name: /Make this an autonomous room/i })

describe('NewChatForm Play As (in-place)', () => {
  it('lists only cast characters in the dropdown', () => {
    const alice = makeChar('a', 'Alice')
    const bob = makeChar('b', 'Bob', { controlledBy: 'user' })
    // Bob is a default-user character but is NOT in the cast, so he is absent
    // from the dropdown — he would be added via the picker on the left instead.
    renderPlayAs([llm(alice)], [bob])

    const select = screen.getByLabelText('Play As (Optional)')
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Chat as yourself', 'Alice'])
  })

  it('flips exactly the chosen cast character to user, leaving the rest LLM', () => {
    const alice = makeChar('a', 'Alice')
    const carol = makeChar('c', 'Carol')
    const cast = [llm(alice), llm(carol)]
    const { setSelectedCharacters } = renderPlayAs(cast)

    fireEvent.change(screen.getByLabelText('Play As (Optional)'), {
      target: { value: 'a' },
    })

    const next = applyUpdater(setSelectedCharacters, cast)
    const a = next.find((sc) => sc.character.id === 'a')!
    const c = next.find((sc) => sc.character.id === 'c')!
    expect(a.controlledBy).toBe('user')
    expect(a.connectionProfileId).toBe('')
    expect(c.controlledBy).toBe('llm')
    expect(c.connectionProfileId).toBe('profile-1')
  })

  it('"Chat as yourself" reverts a flipped default-LLM character to llm with no profile', () => {
    // Alice is a default-LLM character currently flipped to user; she is NOT in
    // the default-user roster, so reverting hands her back to the LLM.
    const alice = makeChar('a', 'Alice')
    const cast = [user(alice)]
    const { setSelectedCharacters } = renderPlayAs(cast, [])

    fireEvent.change(screen.getByLabelText('Play As (Optional)'), {
      target: { value: '' },
    })

    const next = applyUpdater(setSelectedCharacters, cast)
    expect(next).toHaveLength(1)
    expect(next[0].controlledBy).toBe('llm')
    expect(next[0].connectionProfileId).toBe('')
  })

  it('"Chat as yourself" reverts a default-user cast member to llm', () => {
    // Bob is a default-user character who was added to the cast from the picker
    // and is currently the persona. Reverting hands him back to the LLM in place
    // (he stays in the cast) rather than being removed.
    const alice = makeChar('a', 'Alice')
    const bob = makeChar('b', 'Bob', { controlledBy: 'user' })
    const cast = [llm(alice), user(bob)]
    const { setSelectedCharacters } = renderPlayAs(cast, [bob])

    fireEvent.change(screen.getByLabelText('Play As (Optional)'), {
      target: { value: '' },
    })

    const next = applyUpdater(setSelectedCharacters, cast)
    expect(next).toHaveLength(2)
    const b = next.find((sc) => sc.character.id === 'b')!
    expect(b.controlledBy).toBe('llm')
    expect(b.connectionProfileId).toBe('')
  })

  it('disables the autonomous toggle and shows the note when a user entry is present', () => {
    const alice = makeChar('a', 'Alice')
    const bob = makeChar('b', 'Bob', { controlledBy: 'user' })
    renderPlayAs([llm(alice), user(bob)], [bob])

    expect(autonomousCheckbox()).toBeDisabled()
    expect(screen.getByText(/revert it to/i)).toBeInTheDocument()
  })

  it('enables the autonomous toggle with only LLM characters', () => {
    const alice = makeChar('a', 'Alice')
    const carol = makeChar('c', 'Carol')
    renderPlayAs([llm(alice), llm(carol)])

    expect(autonomousCheckbox()).not.toBeDisabled()
    expect(screen.queryByText(/revert it to/i)).not.toBeInTheDocument()
  })
})

// --- Roleplay template picker ----------------------------------------------

const TEMPLATES: RoleplayTemplateOption[] = [
  { id: 'tpl-classic', name: 'Classic Roleplay', description: null, isBuiltIn: true },
  { id: 'tpl-house', name: 'House Style', description: null, isBuiltIn: false },
]

function templateSelect() {
  return screen.getByLabelText('Roleplay Template') as HTMLSelectElement
}

describe('NewChatForm roleplay template picker', () => {
  it('is hidden when no templates are available', () => {
    renderForm()
    expect(screen.queryByLabelText('Roleplay Template')).not.toBeInTheDocument()
  })

  it('defaults to the chat default and marks it in the list', () => {
    renderForm(
      { roleplayTemplateId: 'tpl-house' },
      { roleplayTemplates: TEMPLATES, defaultRoleplayTemplateId: 'tpl-house' }
    )

    expect(templateSelect().value).toBe('tpl-house')
    expect(screen.getByRole('option', { name: /House Style \(default\)/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Classic Roleplay (Built-in)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'No Template' })).toBeInTheDocument()
  })

  it('marks "No Template" as the default when no default template is set', () => {
    renderForm({}, { roleplayTemplates: TEMPLATES, defaultRoleplayTemplateId: null })

    expect(templateSelect().value).toBe('')
    expect(screen.getByRole('option', { name: 'No Template (default)' })).toBeInTheDocument()
  })

  it('records an explicit pick as touched so reference reloads cannot re-seed it', () => {
    const { setState } = renderForm(
      { roleplayTemplateId: 'tpl-house' },
      { roleplayTemplates: TEMPLATES, defaultRoleplayTemplateId: 'tpl-house' }
    )

    fireEvent.change(templateSelect(), { target: { value: 'tpl-classic' } })

    const updater = setState.mock.calls[0][0] as (prev: NewChatFormState) => NewChatFormState
    const next = updater(makeState({ roleplayTemplateId: 'tpl-house' }))
    expect(next.roleplayTemplateId).toBe('tpl-classic')
    expect(next.roleplayTemplateTouched).toBe(true)
  })

  it('turns "No Template" into a null id, still marked as touched', () => {
    const { setState } = renderForm(
      { roleplayTemplateId: 'tpl-house' },
      { roleplayTemplates: TEMPLATES, defaultRoleplayTemplateId: 'tpl-house' }
    )

    fireEvent.change(templateSelect(), { target: { value: '' } })

    const updater = setState.mock.calls[0][0] as (prev: NewChatFormState) => NewChatFormState
    const next = updater(makeState({ roleplayTemplateId: 'tpl-house' }))
    expect(next.roleplayTemplateId).toBeNull()
    expect(next.roleplayTemplateTouched).toBe(true)
  })
})
