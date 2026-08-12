/**
 * Tests for CustomToolRunDialog — the composer's custom-tool modal.
 *
 * Covers the two-phase flow (pick a tool → fill its form → go back), the
 * memory that survives a close (values, privacy, and which tool you were on),
 * and the reference panel that names what the chosen tool quotes. Also guards
 * the failure the derived selection exists to absorb: a remembered tool that
 * has since left the roster must drop back to the picker rather than strand
 * the dialog on a tool nobody can deal.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import React from 'react'
import CustomToolRunDialog, { type CustomTool } from '@/components/chat/CustomToolRunDialog'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@/components/providers/workspace-provider', () => ({
  useWorkspaceOptional: () => null,
}))

const UNLOCK: CustomTool = {
  name: 'unlock',
  title: 'Force the Lock',
  description: 'Attempt to pick the lock.',
  parameters: {
    bonus: { type: 'number', default: 0, description: 'Skill bonus added to the roll.', min: -5, max: 5 },
  },
  references: {
    value: true,
    roll: true,
    dice: true,
    llm: false,
    params: ['bonus'],
    metadata: ['hasAnsibleAccess'],
    state: ['player.health'],
  },
  defaultVisibility: 'public',
  sourceTier: 'project',
  asCharacterId: 'char-1',
  definitionPath: 'Tools/unlock.tool.json',
  mountPointId: 'mount-1',
  mountName: 'Kepler Notes',
}

const WHEEL: CustomTool = {
  name: 'wheel',
  title: 'Spin the Wheel',
  description: 'Let the wheel decide.',
  parameters: {
    wish: { type: 'string', default: 'Something interesting.', description: 'What you would like of it.' },
  },
  references: { value: false, roll: false, dice: false, llm: true, params: [], metadata: [], state: [] },
  defaultVisibility: 'whisper',
  sourceTier: 'general',
  asCharacterId: 'char-1',
  definitionPath: 'Tools/wheel.tool.json',
  mountPointId: 'mount-1',
  mountName: 'Kepler Notes',
}

let rosterTools: CustomTool[] = []
let runBodies: unknown[] = []

function routeFetch() {
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.includes('action=run')) {
        runBodies.push(JSON.parse(String(init?.body)))
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ messages: [] }) } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ tools: rosterTools, errors: [] }),
      } as Response)
    })
}

function renderDialog(props: Partial<React.ComponentProps<typeof CustomToolRunDialog>> = {}) {
  const onClose = jest.fn()
  const view = renderWithQuery(
    <CustomToolRunDialog isOpen chatId="chat-1" onClose={onClose} {...props} />,
  )
  return { ...view, onClose }
}

beforeEach(() => {
  rosterTools = [UNLOCK, WHEEL]
  runBodies = []
  routeFetch()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('CustomToolRunDialog — choosing a tool', () => {
  it('lists the roster first, then swaps in the chosen tool’s form', async () => {
    renderDialog()

    const entry = await screen.findByText('Force the Lock')
    expect(screen.getByText('Spin the Wheel')).toBeTruthy()

    fireEvent.click(entry)

    // The picker is gone; the form has taken the body.
    await waitFor(() => expect(screen.queryByText('Spin the Wheel')).toBeNull())
    expect(screen.getByLabelText(/bonus/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run Force the Lock' })).toBeTruthy()
  })

  it('goes back to the roster from the form', async () => {
    renderDialog()

    fireEvent.click(await screen.findByText('Force the Lock'))
    fireEvent.click(await screen.findByRole('button', { name: /choose another tool/i }))

    expect(await screen.findByText('Spin the Wheel')).toBeTruthy()
  })

  it('drops back to the picker when the remembered tool leaves the roster', async () => {
    const { queryClient } = renderDialog()

    fireEvent.click(await screen.findByText('Force the Lock'))
    expect(screen.getByRole('button', { name: 'Run Force the Lock' })).toBeTruthy()

    rosterTools = [WHEEL]
    await queryClient.invalidateQueries()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Run Force the Lock' })).toBeNull())
    expect(screen.getByText('Spin the Wheel')).toBeTruthy()
  })
})

describe('CustomToolRunDialog — what it remembers', () => {
  it('keeps the tool, its values, and its privacy toggle across a close', async () => {
    const { rerender, onClose } = renderDialog()

    fireEvent.click(await screen.findByText('Force the Lock'))
    fireEvent.change(screen.getByLabelText(/bonus/i), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /roll privately/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()

    rerender(<CustomToolRunDialog isOpen={false} chatId="chat-1" onClose={onClose} />)
    rerender(<CustomToolRunDialog isOpen chatId="chat-1" onClose={onClose} />)

    const bonus = (await screen.findByLabelText(/bonus/i)) as HTMLInputElement
    expect(bonus.value).toBe('3')
    expect((screen.getByRole('checkbox', { name: /roll privately/i }) as HTMLInputElement).checked).toBe(true)
  })

  it('seeds the privacy toggle from the definition’s default visibility', async () => {
    renderDialog()

    fireEvent.click(await screen.findByText('Spin the Wheel'))

    expect((screen.getByRole('checkbox', { name: /roll privately/i }) as HTMLInputElement).checked).toBe(true)
  })

  it('sends the coerced values, the privacy flag, and the perspective on run', async () => {
    renderDialog()

    fireEvent.click(await screen.findByText('Force the Lock'))
    fireEvent.change(screen.getByLabelText(/bonus/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Force the Lock' }))

    await waitFor(() => expect(runBodies).toHaveLength(1))
    expect(runBodies[0]).toEqual({
      tool: 'unlock',
      parameters: { bonus: 2 },
      private: false,
      asCharacterId: 'char-1',
    })
  })
})

describe('CustomToolRunDialog — the reference panel', () => {
  it('names the placeholders this particular tool can quote', async () => {
    renderDialog()

    fireEvent.click(await screen.findByText('Force the Lock'))

    expect(screen.getByText('{{value}}')).toBeTruthy()
    expect(screen.getByText('{{roll}}')).toBeTruthy()
    expect(screen.getByText('{{params.bonus}}')).toBeTruthy()
    expect(screen.getByText('{{metadata.hasAnsibleAccess}}')).toBeTruthy()
    expect(screen.getByText('{{state.player.health}}')).toBeTruthy()
    // Dice form, no oracle.
    expect(screen.getByText('{{dice}}')).toBeTruthy()
    expect(screen.queryByText('{{llm}}')).toBeNull()
  })

  it('lists only what the tool actually quotes', async () => {
    renderDialog()

    fireEvent.click(await screen.findByText('Spin the Wheel'))

    // The wheel quotes its oracle and nothing else — not even its own value,
    // and not the `wish` parameter the form above is collecting.
    expect(screen.getByText('{{llm}}')).toBeTruthy()
    expect(screen.queryByText('{{value}}')).toBeNull()
    expect(screen.queryByText('{{roll}}')).toBeNull()
    expect(screen.queryByText('{{dice}}')).toBeNull()
    expect(screen.queryByText('{{params.wish}}')).toBeNull()
    expect(screen.queryByText(/metadata\./)).toBeNull()
  })

  it('omits the panel entirely for a tool that quotes nothing', async () => {
    rosterTools = [
      {
        ...WHEEL,
        references: { value: false, roll: false, dice: false, llm: false, params: [], metadata: [], state: [] },
      },
    ]
    renderDialog()

    fireEvent.click(await screen.findByText('Spin the Wheel'))

    expect(screen.queryByText('What this tool can quote')).toBeNull()
    // The rest of the form is unaffected.
    expect(screen.getByRole('checkbox', { name: /roll privately/i })).toBeTruthy()
  })

  it('gives a string parameter a textarea, and a number parameter a number input', async () => {
    renderDialog()

    fireEvent.click(await screen.findByText('Spin the Wheel'))
    const wish = screen.getByLabelText(/wish/i)
    expect(wish.tagName).toBe('TEXTAREA')

    fireEvent.click(screen.getByRole('button', { name: /choose another tool/i }))
    fireEvent.click(await screen.findByText('Force the Lock'))
    const bonus = screen.getByLabelText(/bonus/i) as HTMLInputElement
    expect(bonus.tagName).toBe('INPUT')
    expect(bonus.type).toBe('number')
  })

  it('says plainly that what the operator types is not templated', async () => {
    renderDialog()

    fireEvent.click(await screen.findByText('Force the Lock'))

    expect(screen.getByText(/sent exactly as written, braces and all/i)).toBeTruthy()
  })
})
