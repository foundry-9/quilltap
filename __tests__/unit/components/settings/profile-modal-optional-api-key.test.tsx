/**
 * Bug 81 — a provider may take an api key without demanding one.
 *
 * `requiresApiKey` was answering two questions at once: "must this profile have
 * a key?" and "may it have one?". For OpenAI-Compatible the honest answers are
 * no and yes — the same provider serves an unauthenticated llama.cpp on
 * localhost and a hosted endpoint behind a bearer token — and the single flag
 * had to read `false`, which removed the key field from the form entirely.
 *
 * Driven like its Bug 76 twin: the real modal over the real `useProfileForm`,
 * real dropdown gestures, `fetchJson` captured, so the assertions are on the
 * bytes that leave the form.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ProfileModal } from '@/components/settings/connection-profiles/ProfileModal'
import { useProfileForm } from '@/components/settings/connection-profiles/hooks/useProfileForm'
import type { ApiKey, ProviderConfig } from '@/components/settings/connection-profiles/types'

jest.mock('@/lib/fetch-helpers', () => ({
  fetchJson: jest.fn(),
}))

jest.mock('@/components/tags/tag-editor', () => ({
  TagEditor: () => null,
}))

const PROVIDERS: ProviderConfig[] = [
  {
    name: 'ANTHROPIC',
    displayName: 'Anthropic',
    configRequirements: { requiresApiKey: true, requiresBaseUrl: false },
    capabilities: { chat: true, toolUse: true },
  },
  {
    name: 'OPENAI_COMPATIBLE',
    displayName: 'OpenAI-Compatible',
    configRequirements: {
      requiresApiKey: false,
      acceptsApiKey: true,
      requiresBaseUrl: true,
      baseUrlDefault: 'http://localhost:8080/v1',
    },
    capabilities: { chat: true, toolUse: false },
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
] as unknown as ProviderConfig[]

const API_KEYS: ApiKey[] = [
  { id: 'key-anthropic', label: 'Anthropic key', provider: 'ANTHROPIC', isActive: true },
  { id: 'key-oac', label: 'Together key', provider: 'OPENAI_COMPATIBLE', isActive: true },
] as unknown as ApiKey[]

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
  } = useProfileForm(PROVIDERS, API_KEYS)

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

describe('ProfileModal optional api key (Bug 81)', () => {
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

  it('renders the key field unstarred for a provider that accepts but does not require one', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI_COMPATIBLE')

    expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    expect(screen.queryByLabelText('API Key *')).not.toBeInTheDocument()
  })

  it('still hides the field for a provider that accepts no key at all', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OLLAMA')

    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('API Key *')).not.toBeInTheDocument()
  })

  it('sends the attached key to a hosted OpenAI-compatible endpoint', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI_COMPATIBLE')
    await user.selectOptions(screen.getByLabelText('API Key'), 'key-oac')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(
        bodiesFor(fetchJsonMock, '/api/v1/connection-profiles?action=test-connection')
      ).toHaveLength(1)
    })
    const [body] = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles?action=test-connection')
    expect(body.provider).toBe('OPENAI_COMPATIBLE')
    expect(body.apiKeyId).toBe('key-oac')
  })

  it('saves without a key, because the field is optional rather than merely present', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI_COMPATIBLE')
    await user.type(screen.getByLabelText('Name *'), 'Local llama.cpp')
    await user.type(screen.getByLabelText('Model *'), 'qwen3.5-9b-q6')
    await user.click(screen.getByRole('button', { name: 'Create Profile' }))

    await waitFor(() => {
      expect(bodiesFor(fetchJsonMock, '/api/v1/connection-profiles')).not.toHaveLength(0)
    })
    const saved = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles').at(-1)
    expect(saved.provider).toBe('OPENAI_COMPATIBLE')
    expect(saved.apiKeyId).toBeNull()
    expect(screen.queryByText(/API Key is required for this provider/)).not.toBeInTheDocument()
  })

  it('does not carry an OpenAI-compatible key onto a provider that takes none', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI_COMPATIBLE')
    await user.selectOptions(screen.getByLabelText('API Key'), 'key-oac')
    await user.selectOptions(screen.getByLabelText('Provider *'), 'OLLAMA')

    await user.type(screen.getByLabelText('Name *'), 'Local')
    await user.type(screen.getByLabelText('Model *'), 'qwen3')
    await user.click(screen.getByRole('button', { name: 'Create Profile' }))

    await waitFor(() => {
      expect(bodiesFor(fetchJsonMock, '/api/v1/connection-profiles')).not.toHaveLength(0)
    })
    const saved = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles').at(-1)
    expect(saved.provider).toBe('OLLAMA')
    expect(saved.apiKeyId).toBeNull()
  })
})
