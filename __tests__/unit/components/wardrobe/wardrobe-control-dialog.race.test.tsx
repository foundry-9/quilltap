/**
 * Bug 61 regression — the Wardrobe dialog's Live tab against a slow outfit read.
 *
 * The item list paints from its own request; the worn snapshot arrives after a
 * three-round-trip chain. A Wear click in between used to be overwritten by the
 * first seed and then reported as saved. These tests drive that exact window by
 * holding the `?action=outfit` response open across the click.
 */

import { WardrobeControlDialog } from '@/components/wardrobe/wardrobe-control-dialog'
import { WardrobeDialogProvider, useWardrobeDialog } from '@/components/providers/wardrobe-dialog-provider'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import React, { useEffect } from 'react'
import { showConfirmation } from '@/lib/alert'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))
jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn(),
}))
// The composer is stubbed down to what it paints, so the staged slots can be
// read straight out of the DOM.
jest.mock('@/components/wardrobe/outfit-composer', () => ({
  OutfitComposer: ({ slots }: { slots: Record<string, string[]> }) => (
    <div data-testid="live-slots">{JSON.stringify(slots)}</div>
  ),
}))
jest.mock('@/components/wardrobe/wardrobe-item-editor', () => ({
  WardrobeItemEditor: () => null,
}))
jest.mock('@/components/wardrobe/import-from-image-modal', () => ({
  ImportFromImageModal: () => null,
}))
jest.mock('@/components/wardrobe/WardrobeTransferDialog', () => ({
  WardrobeTransferDialog: () => null,
}))

const mockShowConfirmation = showConfirmation as jest.MockedFunction<typeof showConfirmation>

const CHAT_ID = 'chat-1'
const CHARACTER_ID = 'alice'

const ITEMS = [
  {
    id: 'shirt',
    title: 'Linen Shirt',
    types: ['top'],
    isDefault: false,
    componentItemIds: [],
    replace: false,
    characterId: CHARACTER_ID,
  },
  {
    id: 'hat',
    title: 'Straw Hat',
    types: ['accessories'],
    isDefault: false,
    componentItemIds: [],
    replace: false,
    characterId: CHARACTER_ID,
  },
]

/** The worn snapshot the outfit read eventually publishes. */
const WORN = { top: ['shirt'], bottom: [], footwear: [], accessories: [], hair: [] }

/** Resolver for the held-open `?action=outfit` response. */
let releaseOutfit: (() => void) | null = null
/** Bodies of every `?action=equip` POST the dialog fired. */
let equipCalls: Array<Record<string, unknown>> = []

/** Minimal Response stand-in — `fetchJson` reads ok/status/text(). */
const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

function routeFetch(deferOutfit: boolean): void {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('action=outfit')) {
      if (deferOutfit) {
        await new Promise<void>((resolve) => {
          releaseOutfit = resolve
        })
      }
      return jsonResponse({ equippedOutfit: { [CHARACTER_ID]: WORN } })
    }
    if (url.includes('action=equip')) {
      equipCalls.push(JSON.parse(String(init?.body ?? '{}')))
      return jsonResponse({ equippedSlots: WORN })
    }
    if (url.endsWith('/api/v1/characters')) {
      return jsonResponse({ characters: [{ id: CHARACTER_ID, name: 'Alice' }] })
    }
    if (url.includes('/wardrobe')) {
      // Both the dialog's own list and useOutfit's per-character fetch; the
      // shared-archetype call answers empty so the merge stays deterministic.
      return jsonResponse({ wardrobeItems: url.endsWith('/api/v1/wardrobe') ? [] : ITEMS })
    }
    if (url.includes('/api/v1/image-profiles')) {
      return jsonResponse({ profiles: [] })
    }
    if (url.includes(`/api/v1/chats/${CHAT_ID}`)) {
      return jsonResponse({ chat: { id: CHAT_ID, projectId: null } })
    }
    return jsonResponse({})
  }) as unknown as typeof fetch
}

/** Opens the dialog on mount with chat context, as the Salon does. */
function Opener(): null {
  const dialog = useWardrobeDialog()
  useEffect(() => {
    dialog.open({ characterId: CHARACTER_ID, chatId: CHAT_ID })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once
  }, [])
  return null
}

function renderDialog(): void {
  render(
    <WardrobeDialogProvider>
      <Opener />
      <WardrobeControlDialog />
    </WardrobeDialogProvider>,
  )
}

/** The Wear button on a given item's row (both rows carry one). */
async function findWearButton(itemTitle: string): Promise<HTMLElement> {
  const label = await screen.findByTitle(itemTitle)
  const row = label.closest('.qt-card-interactive')
  if (!row) throw new Error(`no row for ${itemTitle}`)
  return within(row as HTMLElement).getByRole('button', { name: /Wear/ })
}

const stagedSlots = (): Record<string, string[]> =>
  JSON.parse(screen.getByTestId('live-slots').textContent ?? '{}')

beforeEach(() => {
  equipCalls = []
  releaseOutfit = null
  mockShowConfirmation.mockReset()
})

describe('WardrobeControlDialog — staging before the worn snapshot arrives', () => {
  it('replays a Wear clicked mid-flight onto the snapshot and commits it once', async () => {
    routeFetch(true)
    renderDialog()

    // The item list paints from its own request, well before the outfit read.
    const wear = await findWearButton('Straw Hat')
    await waitFor(() => expect(releaseOutfit).not.toBeNull())
    fireEvent.click(wear)

    // Painted against the empty fallback — there is nothing else to paint yet.
    await waitFor(() => expect(stagedSlots().accessories).toEqual(['hat']))

    // Now the snapshot lands. Pre-fix this seed discarded the click.
    releaseOutfit?.()
    await waitFor(() => expect(stagedSlots().top).toEqual(['shirt']))
    expect(stagedSlots().accessories).toEqual(['hat'])

    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    await waitFor(() => expect(equipCalls).toHaveLength(1))
    expect(equipCalls[0]).toMatchObject({
      characterId: CHARACTER_ID,
      mode: 'set_all',
      slots: { top: ['shirt'], bottom: [], footwear: [], accessories: ['hat'], hair: [] },
    })
  })

  it('sends nothing when the snapshot arrives first and nothing is staged', async () => {
    routeFetch(false)
    renderDialog()

    await findWearButton('Straw Hat')
    await waitFor(() => expect(stagedSlots().top).toEqual(['shirt']))

    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    await waitFor(() => expect(screen.queryByTestId('live-slots')).toBeNull())
    expect(equipCalls).toHaveLength(0)
  })

  it('asks before discarding an edit whose snapshot never arrived, instead of closing as if saved', async () => {
    routeFetch(true)
    renderDialog()

    const wear = await findWearButton('Straw Hat')
    fireEvent.click(wear)
    await waitFor(() => expect(stagedSlots().accessories).toEqual(['hat']))

    // Declining keeps the dialog open with the edit intact — the outfit read
    // may still land, and then Done saves normally.
    mockShowConfirmation.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    await waitFor(() => expect(mockShowConfirmation).toHaveBeenCalledTimes(1))
    expect(String(mockShowConfirmation.mock.calls[0][0])).toContain('Alice')
    expect(equipCalls).toHaveLength(0)
    expect(screen.getByTestId('live-slots')).toBeInTheDocument()

    // Confirming closes, having said plainly that the change is going.
    mockShowConfirmation.mockResolvedValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    await waitFor(() => expect(screen.queryByTestId('live-slots')).toBeNull())
    expect(equipCalls).toHaveLength(0)
  })
})
