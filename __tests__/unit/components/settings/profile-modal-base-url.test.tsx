/**
 * Bug 73 — a base URL picked up from one provider must not follow the profile
 * onto a provider that neither shows nor takes one.
 *
 * The modal is driven through the real gesture (provider dropdown) with the
 * real `useProfileForm` hook underneath, and `fetchJson` captured, so the
 * assertions are on the bytes that actually leave the form.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ProfileModal } from '@/components/settings/connection-profiles/ProfileModal'
import { useProfileForm } from '@/components/settings/connection-profiles/hooks/useProfileForm'
import type { ProviderConfig } from '@/components/settings/connection-profiles/types'

jest.mock('@/lib/fetch-helpers', () => ({
  fetchJson: jest.fn(),
}))

jest.mock('@/components/tags/tag-editor', () => ({
  TagEditor: () => null,
}))

const PROVIDERS: ProviderConfig[] = [
  {
    name: 'OPENAI',
    displayName: 'OpenAI',
    configRequirements: { requiresApiKey: true, requiresBaseUrl: false },
    capabilities: { chat: true, toolUse: true },
  },
  {
    name: 'OLLAMA',
    displayName: 'Ollama',
    configRequirements: {
      requiresApiKey: false,
      requiresBaseUrl: true,
      baseUrlDefault: 'http://localhost:11434',
    },
    capabilities: { chat: true, toolUse: true },
  },
  {
    name: 'OPENAI_COMPATIBLE',
    displayName: 'OpenAI Compatible',
    configRequirements: {
      requiresApiKey: false,
      requiresBaseUrl: true,
      baseUrlDefault: 'http://localhost:8080/v1',
    },
    capabilities: { chat: true, toolUse: false },
  },
] as unknown as ProviderConfig[]

const API_KEYS = [
  { id: 'key-openai', label: 'OpenAI key', provider: 'OPENAI', isActive: true },
] as any[]

/** The tab's own wiring of the hook into the modal, minus the list around it. */
function Harness() {
  const {
    form,
    saveOp,
    connectOp,
    fetchModelsOp,
    testMessageOp,
    autoConfigureOp,
    getProviderRequirements,
    resetForm,
    handleConnect,
    handleFetchModels,
    handleTestMessage,
    handleAutoConfigure,
    handleSubmit,
  } = useProfileForm(PROVIDERS)

  return (
    <ProfileModal
      isOpen
      onClose={() => {}}
      onSuccess={() => {}}
      profile={null}
      apiKeys={API_KEYS}
      providers={PROVIDERS}
      takenNames={new Set()}
      form={{
        formData: form.formData,
        setField: form.setField,
        handleChange: form.handleChange,
        resetForm,
      }}
      operations={{
        saveLoading: saveOp.loading,
        connectLoading: connectOp.loading,
        connectError: connectOp.error,
        fetchModelsLoading: fetchModelsOp.loading,
        testMessageLoading: testMessageOp.loading,
        autoConfigureLoading: autoConfigureOp.loading,
        handleConnect,
        handleFetchModels,
        handleTestMessage,
        handleAutoConfigure,
        handleSubmit,
        getProviderRequirements,
      }}
    />
  )
}

/** Parsed bodies of every captured POST/PUT to `url`, in order. */
function bodiesFor(mock: jest.Mock, url: string): any[] {
  return mock.mock.calls
    .filter((call) => String(call[0]).startsWith(url))
    .map((call) => JSON.parse(String((call[1] as any)?.body ?? '{}')))
}

describe('ProfileModal base URL (Bug 73)', () => {
  let fetchJsonMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    const { fetchJson } = require('@/lib/fetch-helpers')
    fetchJsonMock = fetchJson
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/models') {
        return { ok: true, data: { models: [], modelsWithInfo: [] } }
      }
      return { ok: true, data: { message: 'ok', id: 'profile-1' } }
    })
  })

  it('fills the base URL for Ollama and hides it again on OpenAI', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OLLAMA')
    expect((screen.getByLabelText('Base URL *') as HTMLInputElement).value).toBe(
      'http://localhost:11434'
    )

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI')
    expect(screen.queryByLabelText('Base URL *')).not.toBeInTheDocument()
  })

  it('does not send the stale base URL when connecting on the new provider', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OLLAMA')
    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI')
    await user.selectOptions(screen.getByLabelText('API Key *'), 'key-openai')

    await user.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(
        bodiesFor(fetchJsonMock, '/api/v1/connection-profiles?action=test-connection')
      ).toHaveLength(1)
    })
    const [body] = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles?action=test-connection')
    expect(body.provider).toBe('OPENAI')
    expect(body.baseUrl).toBeUndefined()
  })

  it('saves the profile with an empty base URL, so the row cannot be written broken', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OLLAMA')
    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI')
    await user.selectOptions(screen.getByLabelText('API Key *'), 'key-openai')
    await user.type(screen.getByLabelText('Name *'), 'Hosted')
    await user.type(screen.getByLabelText('Model *'), 'gpt-4')

    await user.click(screen.getByRole('button', { name: 'Create Profile' }))

    await waitFor(() => {
      expect(bodiesFor(fetchJsonMock, '/api/v1/connection-profiles')).not.toHaveLength(0)
    })
    const saved = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles').at(-1)
    expect(saved.provider).toBe('OPENAI')
    expect(saved.baseUrl).toBe('')
  })

  it('still sends the base URL on a provider that takes one', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OLLAMA')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(
        bodiesFor(fetchJsonMock, '/api/v1/connection-profiles?action=test-connection')
      ).toHaveLength(1)
    })
    const [body] = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles?action=test-connection')
    expect(body.baseUrl).toBe('http://localhost:11434')
  })

  it('leaves a stored base URL alone when the provider list has not loaded', async () => {
    const user = userEvent.setup()
    // The tab renders the modal before /api/providers answers, and the fetch
    // can fail outright. An unknown provider is not evidence that it takes no
    // base URL, so an existing Ollama profile must not be cleared by a save.
    function EmptyProvidersHarness() {
      const hook = useProfileForm([])
      React.useEffect(() => {
        hook.form.setField('provider', 'OLLAMA')
        hook.form.setField('baseUrl', 'http://localhost:11434')
        hook.form.setField('name', 'Local')
        hook.form.setField('modelName', 'qwen3')
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return (
        <button type="button" onClick={() => hook.handleSubmit('profile-1')}>
          Save
        </button>
      )
    }
    render(<EmptyProvidersHarness />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodiesFor(fetchJsonMock, '/api/v1/connection-profiles')).not.toHaveLength(0)
    })
    const saved = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles').at(-1)
    expect(saved.baseUrl).toBe('http://localhost:11434')
  })

  it('does not swap a typed endpoint for ollama’s default on the way back', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI_COMPATIBLE')
    const baseUrl = screen.getByLabelText('Base URL *') as HTMLInputElement
    await user.clear(baseUrl)
    await user.type(baseUrl, 'http://box.local:9090/v1')

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OLLAMA')
    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI_COMPATIBLE')

    expect((screen.getByLabelText('Base URL *') as HTMLInputElement).value).toBe(
      'http://box.local:9090/v1'
    )
  })
})
