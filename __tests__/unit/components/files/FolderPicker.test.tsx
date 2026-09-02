/**
 * Tests for the folder dropdown in Move to Project (`components/files/FolderPicker`).
 *
 * Bug 113: the derived folder list was mirrored into component state behind an
 * "only if empty" guard. Root is seeded unconditionally, before any data is
 * consulted, so the still-loading first render produced a one-entry list that
 * satisfied the guard — the mirror was filled with the loading state and sealed
 * against every update that followed, including a change of destination. What's
 * worth pinning is therefore not the rendering but the *re-derivation*: folders
 * must appear once the queries settle, and must change when `projectId` does.
 */

import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import FolderPicker from '@/components/files/FolderPicker'

interface Stub {
  files?: Array<{ folderPath?: string }>
  folders?: Array<{ id: string; path: string; name: string }>
}

/** Stub both endpoints the picker reads, keyed by the project in the URL. */
function stubRoutes(byProject: Record<string, Stub>) {
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url

      const projectMatch = /\/projects\/([^/]+)\/files/.exec(url) ?? /projectId=([^&]+)/.exec(url)
      const key = projectMatch ? projectMatch[1] : 'general'
      const stub = byProject[key] ?? {}

      if (url.includes('/files/folders')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ folders: stub.folders ?? [] }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ files: stub.files ?? [] }),
      } as Response)
    })
}

/** Option labels, trimmed, with the trailing " (N files)" count stripped. */
const optionLabels = () =>
  Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) =>
    (o.textContent ?? '').trim().replace(/ \(\d+ files\)$/, '')
  )

describe('FolderPicker', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('lists the project folders once the queries settle (bug 113)', async () => {
    stubRoutes({
      estate: {
        files: [{ folderPath: '/Gary/' }],
        folders: [
          { id: 'f1', path: '/Gary/', name: 'Gary' },
          { id: 'f2', path: '/character-avatars/', name: 'character-avatars' },
        ],
      },
    })

    renderWithQuery(
      <FolderPicker value="/" onChange={jest.fn()} projectId="estate" />
    )

    await waitFor(() => {
      expect(optionLabels()).toEqual(
        expect.arrayContaining(['└ Gary', '└ character-avatars'])
      )
    })
    // The bug's exact signature: Root, alone, forever.
    expect(optionLabels()).not.toEqual(['/ (Root)'])
  })

  it('re-derives when the destination project changes (bug 113)', async () => {
    stubRoutes({
      estate: { folders: [{ id: 'f1', path: '/Gary/', name: 'Gary' }] },
      plans: { folders: [{ id: 'f2', path: '/Scenarios/', name: 'Scenarios' }] },
    })

    const { rerender } = renderWithQuery(
      <FolderPicker value="/" onChange={jest.fn()} projectId="estate" />
    )
    await waitFor(() => expect(optionLabels()).toContain('└ Gary'))

    rerender(<FolderPicker value="/" onChange={jest.fn()} projectId="plans" />)

    await waitFor(() => expect(optionLabels()).toContain('└ Scenarios'))
    expect(optionLabels()).not.toContain('└ Gary')
  })

  it('offers Root alone for a project that genuinely has no folders', async () => {
    stubRoutes({ empty: { files: [], folders: [] } })

    renderWithQuery(
      <FolderPicker value="/" onChange={jest.fn()} projectId="empty" />
    )

    await waitFor(() => expect(optionLabels()).toEqual(['/ (Root)']))
  })

  it('indents a nested folder beneath its parent', async () => {
    stubRoutes({
      plans: {
        folders: [
          { id: 'f1', path: '/Foundry-9/', name: 'Foundry-9' },
          { id: 'f2', path: '/Foundry-9/Quilltap/', name: 'Quilltap' },
        ],
      },
    })

    renderWithQuery(
      <FolderPicker value="/" onChange={jest.fn()} projectId="plans" />
    )

    await waitFor(() => expect(optionLabels()).toContain('└ Foundry-9'))
    const nested = Array.from(
      screen.getByRole('combobox').querySelectorAll('option')
    ).find((o) => (o.textContent ?? '').includes('Quilltap'))
    // Non-breaking spaces, because an <option> collapses ordinary ones.
    expect(nested?.textContent).toContain('  └ Quilltap')
  })
})
