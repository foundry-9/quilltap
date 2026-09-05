/**
 * The Concierge mark and the chat card that wears it.
 *
 * The mark reads the derived four-state, never the raw danger label, so what
 * matters here is that Monitored draws nothing, that the other three each get
 * their own tone, and that the words come from the one presentation table —
 * the same words the Salon header's pill and the sidebar's helper text use.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { ConciergeMark, ConciergeTooltipBody } from '@/components/chat/ConciergeMark'
import { ChatCard, type ChatCardData } from '@/components/chat/ChatCard'
import { describeConciergeState } from '@/lib/services/dangerous-content/concierge-state-presentation'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'

jest.mock('next/link', () => {
  return function MockLink({ children, href, className, onClick }: any) {
    return <a href={href} className={className} onClick={onClick}>{children}</a>
  }
})

jest.mock('@/components/workspace/useWorkspaceNavigate', () => ({
  useWorkspaceNavigate: () => jest.fn(),
}))

jest.mock('@/hooks/usePersonaDisplayName', () => ({
  useUserCharacterDisplayName: () => ({ formatCharacterName: (name: string) => name }),
}))

jest.mock('@/components/ui/AvatarStack', () => {
  return function MockAvatarStack() {
    return <div data-testid="avatar-stack" />
  }
})

jest.mock('@/components/tags/tag-display', () => ({
  TagDisplay: () => null,
}))

function chatCard(overrides: Partial<ChatCardData> = {}): ChatCardData {
  return {
    id: 'chat-1',
    title: 'A Conversation',
    messageCount: 12,
    participants: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    conciergeState: 'monitored',
    dangerCategories: [],
    ...overrides,
  }
}

describe('ConciergeMark', () => {
  it('renders nothing for Monitored — the default wears no mark', () => {
    const { container } = render(<ConciergeMark conciergeState="monitored" />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['flagged', 'Concierge: Flagged', ''],
    ['vouched', 'Concierge: Vouched Safe', 'qt-concierge-mark-muted'],
    ['uncensored', 'Concierge: Uncensored', 'qt-concierge-mark-info'],
  ] as const)('marks %s with an asterisk labelled "%s"', (state, label, modifier) => {
    render(<ConciergeMark conciergeState={state} />)

    const mark = screen.getByLabelText(label)
    expect(mark).toHaveTextContent('*')
    expect(mark).toHaveClass('qt-concierge-mark')
    // Danger is the base rule; only the two operator states add a modifier.
    expect(mark.className).toBe(['qt-concierge-mark', modifier].filter(Boolean).join(' '))
  })

  it('appends the caller\'s classes without losing the tone', () => {
    render(<ConciergeMark conciergeState="uncensored" className="text-sm flex-shrink-0" />)

    const mark = screen.getByLabelText('Concierge: Uncensored')
    expect(mark).toHaveClass('qt-concierge-mark', 'qt-concierge-mark-info', 'text-sm', 'flex-shrink-0')
  })

  it('carries no native title — the drawn tooltip would double up on it', () => {
    render(<ConciergeMark conciergeState="flagged" />)
    expect(screen.getByLabelText('Concierge: Flagged')).not.toHaveAttribute('title')
  })

  describe('the tooltip', () => {
    beforeEach(() => { jest.useFakeTimers() })
    afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers() })

    function hover(element: HTMLElement) {
      fireEvent.pointerEnter(element)
      act(() => { jest.advanceTimersByTime(250) })
    }

    it.each(['flagged', 'vouched', 'uncensored'] as ConciergeState[])(
      'speaks the presentation table\'s words for %s',
      (state) => {
        const { title, detail, hint } = describeConciergeState(state)
        render(<ConciergeMark conciergeState={state} />)

        hover(screen.getByLabelText(`Concierge: ${title}`))

        const bubble = screen.getByRole('tooltip', { hidden: true })
        expect(bubble).toHaveTextContent(title)
        expect(bubble).toHaveTextContent(detail)
        expect(bubble).toHaveTextContent(hint)
      }
    )

    it('lists the classifier\'s categories on a Flagged chat', () => {
      render(<ConciergeMark conciergeState="flagged" dangerCategories={['NSFW', 'Violence']} />)

      hover(screen.getByLabelText('Concierge: Flagged'))

      const bubble = screen.getByRole('tooltip', { hidden: true })
      expect(bubble).toHaveTextContent('Categories')
      expect(bubble).toHaveTextContent('NSFW, Violence')
    })

    it('omits the categories line on the operator states', () => {
      render(<ConciergeMark conciergeState="vouched" dangerCategories={['NSFW']} />)

      hover(screen.getByLabelText('Concierge: Vouched Safe'))

      expect(screen.getByRole('tooltip', { hidden: true })).not.toHaveTextContent('Categories')
    })
  })
})

describe('ConciergeTooltipBody', () => {
  it('renders title, detail and hint, and drops an absent categories line', () => {
    render(<ConciergeTooltipBody {...describeConciergeState('uncensored')} />)

    expect(screen.getByText('Uncensored')).toBeInTheDocument()
    expect(screen.getByText(/opened the uncensored door yourself/)).toBeInTheDocument()
    expect(screen.getByText("Change it from the Salon sidebar's Chat section.")).toBeInTheDocument()
    expect(screen.queryByText('Categories')).not.toBeInTheDocument()
  })
})

describe('ChatCard — the Concierge mark', () => {
  it('draws no mark for a Monitored chat', () => {
    const { container } = render(<ChatCard chat={chatCard({ conciergeState: 'monitored' })} />)
    expect(container.querySelector('.qt-concierge-mark')).toBeNull()
  })

  it('draws no mark when the payload carries no state at all', () => {
    const { container } = render(<ChatCard chat={chatCard({ conciergeState: undefined })} />)
    expect(container.querySelector('.qt-concierge-mark')).toBeNull()
  })

  it.each([
    ['flagged', 'Concierge: Flagged', ''],
    ['vouched', 'Concierge: Vouched Safe', 'qt-concierge-mark-muted'],
    ['uncensored', 'Concierge: Uncensored', 'qt-concierge-mark-info'],
  ] as const)('marks a %s chat', (conciergeState, label, modifier) => {
    const { container } = render(<ChatCard chat={chatCard({ conciergeState })} />)

    const mark = screen.getByLabelText(label)
    expect(mark).toHaveTextContent('*')
    expect(mark).toHaveClass('qt-concierge-mark')
    if (modifier) {
      expect(mark).toHaveClass(modifier)
    } else {
      expect(container.querySelector('.qt-concierge-mark-muted')).toBeNull()
      expect(container.querySelector('.qt-concierge-mark-info')).toBeNull()
    }
  })
})
