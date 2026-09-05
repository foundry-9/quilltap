/**
 * Bug 76 — an api key chosen for one provider must not follow the profile onto
 * a provider that neither shows it nor can use it.
 *
 * The twin of `profile-modal-base-url.test.tsx` (Bug 73), and driven the same
 * way: the real modal over the real `useProfileForm`, the real provider
 * dropdown gesture, and `fetchJson` captured — so the assertions are on the
 * bytes that actually leave the form.
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
] as unknown as ProviderConfig[]

const API_KEYS: ApiKey[] = [
  { id: 'key-anthropic', label: 'Anthropic key', provider: 'ANTHROPIC', isActive: true },
  { id: 'key-openai', label: 'OpenAI key', provider: 'OPENAI', isActive: true },
]

/** The tab's own wiring of the hook into the modal, minus the list around it. */
function Harness({
  apiKeys = API_KEYS,
  providers = PROVIDERS,
}: {
  apiKeys?: ApiKey[]
  providers?: ProviderConfig[]
}) {
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
  } = useProfileForm(providers, apiKeys)

  return (
    <ProfileModal
      isOpen
      onClose={() => {}}
      onSuccess={() => {}}
      profile={null}
      apiKeys={apiKeys}
      providers={providers}
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

describe('ProfileModal api key (Bug 76)', () => {
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

  it('saves no api key after ANTHROPIC → OLLAMA, where the select is not even rendered', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'ANTHROPIC')
    await user.selectOptions(screen.getByLabelText('API Key *'), 'key-anthropic')

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OLLAMA')
    expect(screen.queryByLabelText('API Key *')).not.toBeInTheDocument()

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

  it('sends no api key on a hosted → hosted switch, where the select reads blank', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'ANTHROPIC')
    await user.selectOptions(screen.getByLabelText('API Key *'), 'key-anthropic')

    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI')
    // The stored id is not among OpenAI's options, so the control shows blank.
    expect((screen.getByLabelText('API Key *') as HTMLSelectElement).value).toBe('')

    await user.click(screen.getByRole('button', { name: 'Connect' }))

    // Nothing reaches the wire: the blank control is taken at its word, and the
    // form says so rather than probing OpenAI with an Anthropic key.
    await waitFor(() => {
      expect(screen.getByText(/API Key is required for this provider/)).toBeInTheDocument()
    })
    expect(
      bodiesFor(fetchJsonMock, '/api/v1/connection-profiles?action=test-connection')
    ).toHaveLength(0)
  })

  it('clears the column on save after a hosted → hosted switch', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'ANTHROPIC')
    await user.selectOptions(screen.getByLabelText('API Key *'), 'key-anthropic')
    await user.selectOptions(screen.getByLabelText('Provider *'), 'OPENAI')

    await user.type(screen.getByLabelText('Name *'), 'Hosted')
    await user.type(screen.getByLabelText('Model *'), 'gpt-4')
    await user.click(screen.getByRole('button', { name: 'Create Profile' }))

    await waitFor(() => {
      expect(bodiesFor(fetchJsonMock, '/api/v1/connection-profiles')).not.toHaveLength(0)
    })
    const saved = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles').at(-1)
    expect(saved.provider).toBe('OPENAI')
    expect(saved.apiKeyId).toBeNull()
  })

  it('still sends the key the user picked for the provider that takes it', async () => {
    const user = userEvent.setup()
    render(<Harness />)

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
    expect(body.apiKeyId).toBe('key-openai')
  })

  it('restores the remembered key when the provider is switched back', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Provider *'), 'ANTHROPIC')
    await user.selectOptions(screen.getByLabelText('API Key *'), 'key-anthropic')
    await user.selectOptions(screen.getByLabelText('Provider *'), 'OLLAMA')
    await user.selectOptions(screen.getByLabelText('Provider *'), 'ANTHROPIC')

    // `handleProviderChange` never clears the field — the value is inert while
    // it cannot be shown, not destroyed.
    expect((screen.getByLabelText('API Key *') as HTMLSelectElement).value).toBe('key-anthropic')

    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => {
      expect(
        bodiesFor(fetchJsonMock, '/api/v1/connection-profiles?action=test-connection')
      ).toHaveLength(1)
    })
    const [body] = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles?action=test-connection')
    expect(body.apiKeyId).toBe('key-anthropic')
  })

  it('leaves a stored key alone when neither list has loaded', async () => {
    const user = userEvent.setup()
    // The tab renders the modal before /api/providers and the key list answer,
    // and either fetch can fail outright. Absence is not evidence — an existing
    // profile must not be cleared of its key by an ordinary save.
    function EmptyListsHarness() {
      const hook = useProfileForm([], [])
      React.useEffect(() => {
        hook.form.setField('provider', 'ANTHROPIC')
        hook.form.setField('apiKeyId', 'key-anthropic')
        hook.form.setField('name', 'Hosted')
        hook.form.setField('modelName', 'claude-sonnet-4-5-20250929')
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return (
        <button type="button" onClick={() => hook.handleSubmit('profile-1')}>
          Save
        </button>
      )
    }
    render(<EmptyListsHarness />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodiesFor(fetchJsonMock, '/api/v1/connection-profiles')).not.toHaveLength(0)
    })
    const saved = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles').at(-1)
    expect(saved.apiKeyId).toBe('key-anthropic')
  })

  it('heals a row already written with a mismatched key on its next ordinary save', async () => {
    const user = userEvent.setup()
    // Written before this fix, or by import: the row is on OLLAMA and still
    // carries an Anthropic key. The PUT gates on `apiKeyId !== undefined`, so
    // the save must send `null` rather than omitting the field, or the row
    // stays broken and refused forever.
    function PoisonedRowHarness() {
      const hook = useProfileForm(PROVIDERS, API_KEYS)
      React.useEffect(() => {
        hook.form.setField('provider', 'OLLAMA')
        hook.form.setField('apiKeyId', 'key-anthropic')
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
    render(<PoisonedRowHarness />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(bodiesFor(fetchJsonMock, '/api/v1/connection-profiles/profile-1')).not.toHaveLength(0)
    })
    const saved = bodiesFor(fetchJsonMock, '/api/v1/connection-profiles/profile-1').at(-1)
    expect('apiKeyId' in saved).toBe(true)
    expect(saved.apiKeyId).toBeNull()
  })
})
