/**
 * Unit tests for ParticipantCard component
 *
 * Tests:
 * - Renders participant name and avatar
 * - Shows current turn indicator
 * - Toggle/remove actions
 * - Queue position display
 * - Nudge action functionality
 * - Different states (active, inactive, speaking)
 * - Accessibility attributes
 * - Connection profile dropdown
 * - Turn position badge (turnPosition + turnStatus)
 * - Stop button (turnStatus generating + onStopStreaming)
 * - Active toggle button (visible eye icon)
 * - Inactive card styling
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithQuery as render } from '../../../helpers/renderWithQuery'
import React from 'react'
import { ParticipantCard, ParticipantData } from '@/components/chat/ParticipantCard'


// Mock the Avatar component
jest.mock('@/components/ui/Avatar', () => ({
  __esModule: true,
  default: function MockAvatar({ name, isActive }: { name: string; isActive?: boolean }) {
    return (
      <div
        data-testid="avatar"
        data-name={name}
        data-active={isActive ? 'true' : 'false'}
      >
        Avatar: {name}
      </div>
    )
  },
}))

// Helper to create a character participant
function createCharacterParticipant(overrides: Partial<ParticipantData> = {}): ParticipantData {
  return {
    id: 'participant-char-1',
    type: 'CHARACTER',
    displayOrder: 1,
    isActive: true,
    character: {
      id: 'char-1',
      name: 'Echo',
      title: 'AI Assistant',
      avatarUrl: '/avatars/echo.png',
      talkativeness: 0.7,
      defaultImage: null,
    },
    connectionProfile: {
      id: 'profile-1',
      name: 'GPT-4',
      provider: 'openai',
      modelName: 'gpt-4-turbo',
    },
    ...overrides,
  }
}

// Helper to create a user-controlled character participant
function createUserCharacterParticipant(overrides: Partial<ParticipantData> = {}): ParticipantData {
  return {
    id: 'participant-user-1',
    type: 'CHARACTER',
    controlledBy: 'user',
    displayOrder: 0,
    isActive: true,
    character: {
      id: 'char-user-1',
      name: 'User',
      title: 'Human',
      avatarUrl: '/avatars/user.png',
      defaultImage: null,
    },
    connectionProfile: null,
    ...overrides,
  }
}

// Default mock props
function createDefaultProps(overrides: Partial<Parameters<typeof ParticipantCard>[0]> = {}) {
  return {
    participant: createCharacterParticipant(),
    isCurrentTurn: false,
    queuePosition: 0,
    isGenerating: false,
    onNudge: jest.fn(),
    onQueue: jest.fn(),
    onDequeue: jest.fn(),
    onSkip: jest.fn(),
    onTalkativenessChange: jest.fn(),
    onRemove: jest.fn(),
    isUserParticipant: false,
    canRemove: true,
    canSkip: false,
    ...overrides,
  }
}

describe('ParticipantCard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Rendering participant name and avatar', () => {
    it('renders character name', () => {
      const props = createDefaultProps()
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('Echo')).toBeInTheDocument()
    })

    it('renders character title when provided', () => {
      const props = createDefaultProps()
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('AI Assistant')).toBeInTheDocument()
    })

    it('renders avatar component with correct name', () => {
      const props = createDefaultProps()
      render(<ParticipantCard {...props} />)

      const avatar = screen.getByTestId('avatar')
      expect(avatar).toBeInTheDocument()
      expect(avatar).toHaveAttribute('data-name', 'Echo')
    })

    it('renders persona name and title', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('User')).toBeInTheDocument()
      expect(screen.getByText('Human')).toBeInTheDocument()
    })

    it('renders "You" badge for user participant', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('You')).toBeInTheDocument()
    })

    it('does not render "You" badge for character participant', () => {
      const props = createDefaultProps()
      render(<ParticipantCard {...props} />)

      expect(screen.queryByText('You')).not.toBeInTheDocument()
    })

    it('returns null when entity data is missing', () => {
      const props = createDefaultProps({
        participant: {
          ...createCharacterParticipant(),
          character: null,
        },
      })
      const { container } = render(<ParticipantCard {...props} />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Current turn indicator', () => {
    it('applies active class when isCurrentTurn is true', () => {
      const props = createDefaultProps({ isCurrentTurn: true })
      const { container } = render(<ParticipantCard {...props} />)

      const card = container.querySelector('.qt-participant-card-active')
      expect(card).toBeInTheDocument()
    })

    it('applies inactive class when isCurrentTurn is false', () => {
      const props = createDefaultProps({ isCurrentTurn: false })
      const { container } = render(<ParticipantCard {...props} />)

      const card = container.querySelector('.qt-participant-card')
      expect(card).toBeInTheDocument()
      expect(container.querySelector('.qt-participant-card-active')).not.toBeInTheDocument()
    })

    it('shows turn indicator dot when isCurrentTurn is true', () => {
      const props = createDefaultProps({ isCurrentTurn: true })
      const { container } = render(<ParticipantCard {...props} />)

      const turnDot = container.querySelector('.qt-participant-turn-dot')
      expect(turnDot).toBeInTheDocument()
    })

    it('does not show turn indicator dot when isCurrentTurn is false', () => {
      const props = createDefaultProps({ isCurrentTurn: false })
      const { container } = render(<ParticipantCard {...props} />)

      const turnDot = container.querySelector('.qt-participant-turn-dot')
      expect(turnDot).not.toBeInTheDocument()
    })

    it('passes isActive to avatar when it is the current turn', () => {
      const props = createDefaultProps({ isCurrentTurn: true })
      render(<ParticipantCard {...props} />)

      const avatar = screen.getByTestId('avatar')
      expect(avatar).toHaveAttribute('data-active', 'true')
    })
  })

  describe('Queue position display', () => {
    it('shows queue position badge when queuePosition > 0', () => {
      const props = createDefaultProps({ queuePosition: 2 })
      const { container } = render(<ParticipantCard {...props} />)

      const badge = container.querySelector('.qt-participant-queue-badge')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveTextContent('2')
    })

    it('does not show queue position badge when queuePosition is 0', () => {
      const props = createDefaultProps({ queuePosition: 0 })
      const { container } = render(<ParticipantCard {...props} />)

      const badge = container.querySelector('.qt-participant-queue-badge')
      expect(badge).not.toBeInTheDocument()
    })

    it('shows "Dequeue" button when participant is in queue', () => {
      const props = createDefaultProps({ queuePosition: 1 })
      render(<ParticipantCard {...props} />)

      expect(screen.getByRole('button', { name: /dequeue/i })).toBeInTheDocument()
    })
  })

  describe('Nudge action functionality', () => {
    it('shows "Nudge" button for character when not generating and not in queue', () => {
      const props = createDefaultProps({
        isGenerating: false,
        queuePosition: 0,
        isCurrentTurn: false,
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByRole('button', { name: /nudge/i })).toBeInTheDocument()
    })

    it('calls onNudge when nudge button is clicked for character', () => {
      const onNudge = jest.fn()
      const props = createDefaultProps({
        isGenerating: false,
        queuePosition: 0,
        isCurrentTurn: false,
        onNudge,
      })
      render(<ParticipantCard {...props} />)

      const nudgeButton = screen.getByRole('button', { name: /nudge/i })
      fireEvent.click(nudgeButton)

      expect(onNudge).toHaveBeenCalledWith('participant-char-1')
    })

    it('shows "Nudge" button when character has current turn but not generating', () => {
      const props = createDefaultProps({
        isCurrentTurn: true,
        isGenerating: false,
        queuePosition: 0,
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByRole('button', { name: /nudge/i })).toBeInTheDocument()
    })
  })

  describe('Queue action functionality', () => {
    it('shows "Queue" button when generating and participant not in queue', () => {
      const props = createDefaultProps({
        isGenerating: true,
        queuePosition: 0,
        isCurrentTurn: false,
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByRole('button', { name: /queue/i })).toBeInTheDocument()
    })

    it('calls onQueue when queue button is clicked while generating', () => {
      const onQueue = jest.fn()
      const props = createDefaultProps({
        isGenerating: true,
        queuePosition: 0,
        isCurrentTurn: false,
        onQueue,
      })
      render(<ParticipantCard {...props} />)

      const queueButton = screen.getByRole('button', { name: /queue/i })
      fireEvent.click(queueButton)

      expect(onQueue).toHaveBeenCalledWith('participant-char-1')
    })

    it('calls onDequeue when participant is already in queue', () => {
      const onDequeue = jest.fn()
      const props = createDefaultProps({
        queuePosition: 1,
        onDequeue,
      })
      render(<ParticipantCard {...props} />)

      const dequeueButton = screen.getByRole('button', { name: /dequeue/i })
      fireEvent.click(dequeueButton)

      expect(onDequeue).toHaveBeenCalledWith('participant-char-1')
    })
  })

  describe('Remove action functionality', () => {
    it('shows remove button for removable character', () => {
      const props = createDefaultProps({
        canRemove: true,
        onRemove: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const removeButton = screen.getByTitle(/remove echo from chat/i)
      expect(removeButton).toBeInTheDocument()
    })

    it('does not show remove button when canRemove is false', () => {
      const props = createDefaultProps({
        canRemove: false,
        onRemove: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      expect(screen.queryByTitle(/remove echo from chat/i)).not.toBeInTheDocument()
    })

    it('does not show remove button for user participant', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
        canRemove: true,
        onRemove: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      expect(screen.queryByTitle(/remove user from chat/i)).not.toBeInTheDocument()
    })

    it('does not show remove button when onRemove is not provided', () => {
      const props = createDefaultProps({
        canRemove: true,
        onRemove: undefined,
      })
      render(<ParticipantCard {...props} />)

      expect(screen.queryByTitle(/remove echo from chat/i)).not.toBeInTheDocument()
    })

    it('calls onRemove when remove button is clicked', () => {
      const onRemove = jest.fn()
      const props = createDefaultProps({
        canRemove: true,
        onRemove,
      })
      render(<ParticipantCard {...props} />)

      const removeButton = screen.getByTitle(/remove echo from chat/i)
      fireEvent.click(removeButton)

      expect(onRemove).toHaveBeenCalledWith('participant-char-1')
    })

    it('disables remove button when generating', () => {
      const props = createDefaultProps({
        isGenerating: true,
        canRemove: true,
        onRemove: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const removeButton = screen.getByTitle(/remove echo from chat/i)
      expect(removeButton).toBeDisabled()
    })
  })

  describe('Different states (active, inactive, speaking)', () => {
    it('shows "Speaking..." button when generating and is current turn', () => {
      const props = createDefaultProps({
        isGenerating: true,
        isCurrentTurn: true,
        queuePosition: 0,
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByRole('button', { name: /speaking\.\.\./i })).toBeInTheDocument()
    })

    it('disables action button when speaking', () => {
      const props = createDefaultProps({
        isGenerating: true,
        isCurrentTurn: true,
        queuePosition: 0,
      })
      render(<ParticipantCard {...props} />)

      const speakingButton = screen.getByRole('button', { name: /speaking\.\.\./i })
      expect(speakingButton).toBeDisabled()
    })

    it('enables action button when not speaking', () => {
      const props = createDefaultProps({
        isGenerating: false,
        isCurrentTurn: true,
        queuePosition: 0,
      })
      render(<ParticipantCard {...props} />)

      const nudgeButton = screen.getByRole('button', { name: /nudge/i })
      expect(nudgeButton).not.toBeDisabled()
    })
  })

  describe('Talkativeness slider', () => {
    it('renders talkativeness slider for character', () => {
      const props = createDefaultProps()
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('Talkativeness')).toBeInTheDocument()
      expect(screen.getByRole('slider')).toBeInTheDocument()
    })

    it('displays talkativeness percentage', () => {
      const props = createDefaultProps({
        participant: createCharacterParticipant({
          character: {
            id: 'char-1',
            name: 'Echo',
            title: 'AI Assistant',
            avatarUrl: '/avatars/echo.png',
            talkativeness: 0.7,
            defaultImage: null,
          },
        }),
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('70%')).toBeInTheDocument()
    })

    it('calls onTalkativenessChange when slider value changes', () => {
      const onTalkativenessChange = jest.fn()
      const props = createDefaultProps({ onTalkativenessChange })
      render(<ParticipantCard {...props} />)

      const slider = screen.getByRole('slider')
      fireEvent.change(slider, { target: { value: '0.5' } })

      expect(onTalkativenessChange).toHaveBeenCalledWith('participant-char-1', 0.5)
    })

    it('renders disabled talkativeness slider for user participant', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('Talkativeness')).toBeInTheDocument()
      expect(screen.getByText('N/A')).toBeInTheDocument()
      expect(screen.getByRole('slider')).toBeDisabled()
    })
  })

  describe('LLM backend indicator', () => {
    it('displays connection profile model name for character', () => {
      const props = createDefaultProps()
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('gpt-4-turbo')).toBeInTheDocument()
    })

    it('displays connection profile name as fallback when model name is missing', () => {
      const props = createDefaultProps({
        participant: createCharacterParticipant({
          connectionProfile: {
            id: 'profile-1',
            name: 'Custom Profile',
            provider: 'openai',
            modelName: undefined,
          },
        }),
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('Custom Profile')).toBeInTheDocument()
    })

    it('does not display LLM indicator when no connection profile', () => {
      const props = createDefaultProps({
        participant: createCharacterParticipant({
          connectionProfile: null,
        }),
      })
      render(<ParticipantCard {...props} />)

      expect(screen.queryByText('gpt-4-turbo')).not.toBeInTheDocument()
    })
  })

  describe('User participant with skip button', () => {
    it('shows Queue and Skip buttons for user participant with onSkip', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
        onSkip: jest.fn(),
        canSkip: true,
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByRole('button', { name: /queue/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument()
    })

    it('calls onSkip when skip button is clicked', () => {
      const onSkip = jest.fn()
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
        onSkip,
        canSkip: true,
      })
      render(<ParticipantCard {...props} />)

      const skipButton = screen.getByRole('button', { name: /skip/i })
      fireEvent.click(skipButton)

      expect(onSkip).toHaveBeenCalled()
    })

    it('disables skip button when canSkip is false', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
        onSkip: jest.fn(),
        canSkip: false,
      })
      render(<ParticipantCard {...props} />)

      const skipButton = screen.getByRole('button', { name: /skip/i })
      expect(skipButton).toBeDisabled()
    })

    it('disables skip button when generating', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
        isGenerating: true,
        onSkip: jest.fn(),
        canSkip: true,
      })
      render(<ParticipantCard {...props} />)

      const skipButton = screen.getByRole('button', { name: /skip/i })
      expect(skipButton).toBeDisabled()
    })

    it('shows skip button with proper title when canSkip is true', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
        onSkip: jest.fn(),
        canSkip: true,
      })
      render(<ParticipantCard {...props} />)

      const skipButton = screen.getByRole('button', { name: /skip/i })
      expect(skipButton).toHaveAttribute('title', 'Skip your turn and let a character respond')
    })

    it('shows skip button with proper title when canSkip is false', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
        onSkip: jest.fn(),
        canSkip: false,
      })
      render(<ParticipantCard {...props} />)

      const skipButton = screen.getByRole('button', { name: /skip/i })
      expect(skipButton).toHaveAttribute('title', "It's not your turn to skip")
    })
  })

  describe('Accessibility attributes', () => {
    it('removes button has accessible title', () => {
      const props = createDefaultProps({
        canRemove: true,
        onRemove: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const removeButton = screen.getByTitle('Remove Echo from chat')
      expect(removeButton).toBeInTheDocument()
    })

    it('skip button has accessible title', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
        onSkip: jest.fn(),
        canSkip: true,
      })
      render(<ParticipantCard {...props} />)

      const skipButton = screen.getByTitle('Skip your turn and let a character respond')
      expect(skipButton).toBeInTheDocument()
    })

    it('LLM indicator has title with full provider and model info', () => {
      const props = createDefaultProps()
      render(<ParticipantCard {...props} />)

      const llmIndicators = screen.getAllByTitle('openai: gpt-4-turbo')
      expect(llmIndicators.length).toBeGreaterThan(0)
    })

    it('slider has proper range attributes', () => {
      const props = createDefaultProps()
      render(<ParticipantCard {...props} />)

      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('min', '0.1')
      expect(slider).toHaveAttribute('max', '1')
      expect(slider).toHaveAttribute('step', '0.1')
    })
  })

  describe('Edge cases', () => {
    it('handles participant without title', () => {
      const props = createDefaultProps({
        participant: createCharacterParticipant({
          character: {
            id: 'char-1',
            name: 'Echo',
            title: null,
            avatarUrl: '/avatars/echo.png',
            talkativeness: 0.7,
            defaultImage: null,
          },
        }),
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('Echo')).toBeInTheDocument()
      expect(screen.queryByText('AI Assistant')).not.toBeInTheDocument()
    })

    it('handles default talkativeness when character talkativeness is undefined', () => {
      const props = createDefaultProps({
        participant: {
          ...createCharacterParticipant(),
          character: {
            id: 'char-1',
            name: 'Echo',
            title: 'AI Assistant',
            avatarUrl: '/avatars/echo.png',
            talkativeness: 0.5,
            defaultImage: null,
          },
        },
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByText('50%')).toBeInTheDocument()
    })

    it('persona participant calls onQueue when action button clicked', () => {
      const onQueue = jest.fn()
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
        isGenerating: false,
        queuePosition: 0,
        onQueue,
        onSkip: undefined, // No skip, so single button
      })
      render(<ParticipantCard {...props} />)

      // With no onSkip, the persona should show a Queue button
      const queueButton = screen.getByRole('button', { name: /queue/i })
      fireEvent.click(queueButton)

      expect(onQueue).toHaveBeenCalledWith('participant-user-1')
    })
  })

  describe('Connection profile dropdown', () => {
    const mockProfiles = [
      { id: 'profile-1', name: 'GPT-4', provider: 'openai', modelName: 'gpt-4-turbo' },
      { id: 'profile-2', name: 'Claude', provider: 'anthropic', modelName: 'claude-3-opus' },
    ]

    it('renders dropdown when connectionProfiles and callback provided for character', () => {
      const props = createDefaultProps({
        connectionProfiles: mockProfiles,
        onConnectionProfileChange: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Connection profile for Echo')
      expect(select).toBeInTheDocument()
      expect(select.tagName).toBe('SELECT')
    })

    it('renders dropdown for the active user ("You") participant so it can be switched to an LLM', () => {
      const props = createDefaultProps({
        participant: createUserCharacterParticipant(),
        isUserParticipant: true,
        connectionProfiles: mockProfiles,
        onConnectionProfileChange: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Connection profile for User') as HTMLSelectElement
      expect(select).toBeInTheDocument()
      // A user-controlled participant defaults the dropdown to the impersonation option.
      expect(select.value).toBe('__user__')
    })

    it('does not render dropdown when connectionProfiles not provided', () => {
      const props = createDefaultProps({
        onConnectionProfileChange: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      expect(screen.queryByLabelText(/connection profile/i)).not.toBeInTheDocument()
    })

    it('shows profile options in dropdown', () => {
      const props = createDefaultProps({
        connectionProfiles: mockProfiles,
        onConnectionProfileChange: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Connection profile for Echo')
      const options = select.querySelectorAll('option')
      // "Select a provider...", "User (you type)", + 2 profiles = 4
      expect(options).toHaveLength(4)
    })

    it('labels each option with the profile name and a model hint', () => {
      const props = createDefaultProps({
        connectionProfiles: mockProfiles,
        onConnectionProfileChange: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      // Profile name leads; the underlying model is appended as a hint so two
      // profiles on the same provider+model stay distinguishable.
      expect(screen.getByRole('option', { name: 'GPT-4 — gpt-4-turbo' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Claude — claude-3-opus' })).toBeInTheDocument()
    })

    it('omits the model hint when the name already is the model name', () => {
      const props = createDefaultProps({
        connectionProfiles: [{ id: 'p', name: 'gpt-4-turbo', provider: 'openai', modelName: 'gpt-4-turbo' }],
        onConnectionProfileChange: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const option = screen.getByRole('option', { name: 'gpt-4-turbo' })
      expect(option).toBeInTheDocument()
      expect(option.textContent).not.toContain('—')
    })

    it('selects current connection profile', () => {
      const props = createDefaultProps({
        connectionProfiles: mockProfiles,
        onConnectionProfileChange: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Connection profile for Echo') as HTMLSelectElement
      expect(select.value).toBe('profile-1')
    })

    it('selects user option when controlledBy is user', () => {
      const props = createDefaultProps({
        participant: createCharacterParticipant({ controlledBy: 'user' }),
        connectionProfiles: mockProfiles,
        onConnectionProfileChange: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Connection profile for Echo') as HTMLSelectElement
      expect(select.value).toBe('__user__')
    })

    it('calls onConnectionProfileChange with llm when selecting a profile', () => {
      const onChange = jest.fn()
      const props = createDefaultProps({
        connectionProfiles: mockProfiles,
        onConnectionProfileChange: onChange,
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Connection profile for Echo')
      fireEvent.change(select, { target: { value: 'profile-2' } })

      expect(onChange).toHaveBeenCalledWith('participant-char-1', 'profile-2', 'llm')
    })

    it('calls onConnectionProfileChange with user when selecting user option', () => {
      const onChange = jest.fn()
      const props = createDefaultProps({
        connectionProfiles: mockProfiles,
        onConnectionProfileChange: onChange,
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Connection profile for Echo')
      fireEvent.change(select, { target: { value: '__user__' } })

      expect(onChange).toHaveBeenCalledWith('participant-char-1', null, 'user')
    })

    it('falls back to plain-text indicator when no dropdown props', () => {
      const props = createDefaultProps()
      render(<ParticipantCard {...props} />)

      // Should show plain text model name, not a select
      expect(screen.getByText('gpt-4-turbo')).toBeInTheDocument()
      expect(screen.queryByLabelText(/connection profile/i)).not.toBeInTheDocument()
    })
  })

  describe('Turn position badge', () => {
    it('shows position badge when turnPosition is provided', () => {
      const props = createDefaultProps({
        turnPosition: 3,
        turnStatus: 'eligible',
      })
      render(<ParticipantCard {...props} />)

      const badge = screen.getByTestId('position-badge')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveTextContent('3')
    })

    it('applies generating badge class', () => {
      const props = createDefaultProps({
        turnPosition: 1,
        turnStatus: 'generating',
      })
      render(<ParticipantCard {...props} />)

      const badge = screen.getByTestId('position-badge')
      expect(badge).toHaveClass('qt-participant-position-generating')
    })

    it('applies next badge class', () => {
      const props = createDefaultProps({
        turnPosition: 1,
        turnStatus: 'next',
      })
      render(<ParticipantCard {...props} />)

      const badge = screen.getByTestId('position-badge')
      expect(badge).toHaveClass('qt-participant-position-next')
    })

    it('applies queued badge class', () => {
      const props = createDefaultProps({
        turnPosition: 3,
        turnStatus: 'queued',
      })
      render(<ParticipantCard {...props} />)

      const badge = screen.getByTestId('position-badge')
      expect(badge).toHaveClass('qt-participant-position-queued')
    })

    it('applies user-turn badge class', () => {
      const props = createDefaultProps({
        turnPosition: 4,
        turnStatus: 'user-turn',
      })
      render(<ParticipantCard {...props} />)

      const badge = screen.getByTestId('position-badge')
      expect(badge).toHaveClass('qt-participant-position-user-turn')
    })

    it('applies spoken badge class', () => {
      const props = createDefaultProps({
        turnPosition: 5,
        turnStatus: 'spoken',
      })
      render(<ParticipantCard {...props} />)

      const badge = screen.getByTestId('position-badge')
      expect(badge).toHaveClass('qt-participant-position-spoken')
    })

    it('does not show position badge when turnPosition is null', () => {
      const props = createDefaultProps({
        turnPosition: null,
        turnStatus: 'inactive',
      })
      render(<ParticipantCard {...props} />)

      expect(screen.queryByTestId('position-badge')).not.toBeInTheDocument()
    })

    it('falls back to queue badge when turnPosition not provided', () => {
      const props = createDefaultProps({
        queuePosition: 2,
        // No turnPosition
      })
      const { container } = render(<ParticipantCard {...props} />)

      expect(screen.queryByTestId('position-badge')).not.toBeInTheDocument()
      const badge = container.querySelector('.qt-participant-queue-badge')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveTextContent('2')
    })
  })

  describe('Stop button', () => {
    it('shows stop button when turnStatus is generating and onStopStreaming provided', () => {
      const onStopStreaming = jest.fn()
      const props = createDefaultProps({
        turnStatus: 'generating',
        onStopStreaming,
        isGenerating: true,
        isCurrentTurn: true,
      })
      render(<ParticipantCard {...props} />)

      const stopButton = screen.getByRole('button', { name: /stop generating/i })
      expect(stopButton).toBeInTheDocument()
      expect(stopButton).toHaveTextContent('Stop')
    })

    it('calls onStopStreaming when stop button is clicked', () => {
      const onStopStreaming = jest.fn()
      const props = createDefaultProps({
        turnStatus: 'generating',
        onStopStreaming,
        isGenerating: true,
        isCurrentTurn: true,
      })
      render(<ParticipantCard {...props} />)

      fireEvent.click(screen.getByRole('button', { name: /stop generating/i }))
      expect(onStopStreaming).toHaveBeenCalled()
    })

    it('shows Speaking button when generating but no onStopStreaming', () => {
      const props = createDefaultProps({
        isGenerating: true,
        isCurrentTurn: true,
        queuePosition: 0,
        // No onStopStreaming, no turnStatus
      })
      render(<ParticipantCard {...props} />)

      expect(screen.getByRole('button', { name: /speaking\.\.\./i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /stop generating/i })).not.toBeInTheDocument()
    })

    it('does not show stop button when turnStatus is not generating', () => {
      const onStopStreaming = jest.fn()
      const props = createDefaultProps({
        turnStatus: 'next',
        onStopStreaming,
        isGenerating: false,
      })
      render(<ParticipantCard {...props} />)

      expect(screen.queryByRole('button', { name: /stop generating/i })).not.toBeInTheDocument()
    })
  })

  describe('Status dropdown', () => {
    it('shows status dropdown when onStatusChange provided', () => {
      const props = createDefaultProps({
        onStatusChange: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Participation status for Echo')
      expect(select).toBeInTheDocument()
      expect(select.tagName).toBe('SELECT')
    })

    it('shows status dropdown when only onActiveChange provided (legacy fallback)', () => {
      const props = createDefaultProps({
        onActiveChange: jest.fn(),
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Participation status for Echo')
      expect(select).toBeInTheDocument()
    })

    it('shows active status when participant status is active', () => {
      const props = createDefaultProps({
        onStatusChange: jest.fn(),
        participant: createCharacterParticipant({ status: 'active' }),
      })
      render(<ParticipantCard {...props} />) as HTMLSelectElement

      const select = screen.getByLabelText('Participation status for Echo') as HTMLSelectElement
      expect(select.value).toBe('active')
    })

    it('shows silent status when participant status is silent', () => {
      const props = createDefaultProps({
        onStatusChange: jest.fn(),
        participant: createCharacterParticipant({ status: 'silent', isActive: true }),
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Participation status for Echo') as HTMLSelectElement
      expect(select.value).toBe('silent')
    })

    it('calls onStatusChange when dropdown value changes', () => {
      const onStatusChange = jest.fn()
      const props = createDefaultProps({
        onStatusChange,
        participant: createCharacterParticipant({ status: 'active' }),
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Participation status for Echo')
      fireEvent.change(select, { target: { value: 'silent' } })

      expect(onStatusChange).toHaveBeenCalledWith('participant-char-1', 'silent')
    })

    it('calls onStatusChange with absent when selecting absent', () => {
      const onStatusChange = jest.fn()
      const props = createDefaultProps({
        onStatusChange,
        participant: createCharacterParticipant({ status: 'active' }),
      })
      render(<ParticipantCard {...props} />)

      const select = screen.getByLabelText('Participation status for Echo')
      fireEvent.change(select, { target: { value: 'absent' } })

      expect(onStatusChange).toHaveBeenCalledWith('participant-char-1', 'absent')
    })

    it('does not show status dropdown when neither onStatusChange nor onActiveChange provided', () => {
      const props = createDefaultProps()
      render(<ParticipantCard {...props} />)

      expect(screen.queryByLabelText(/participation status/i)).not.toBeInTheDocument()
    })
  })

  describe('Inactive card styling', () => {
    it('applies inactive class when turnStatus is inactive', () => {
      const props = createDefaultProps({
        turnStatus: 'inactive',
        turnPosition: null,
      })
      const { container } = render(<ParticipantCard {...props} />)

      const card = container.querySelector('.qt-participant-card-inactive')
      expect(card).toBeInTheDocument()
    })

    it('does not apply inactive class when turnStatus is not inactive', () => {
      const props = createDefaultProps({
        turnStatus: 'eligible',
        turnPosition: 3,
      })
      const { container } = render(<ParticipantCard {...props} />)

      expect(container.querySelector('.qt-participant-card-inactive')).not.toBeInTheDocument()
    })
  })
})
