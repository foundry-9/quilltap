'use client'

import { useState, useEffect } from 'react'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'
import ErrorAlert from '@/components/ui/ErrorAlert'
import { showSuccessToast } from '@/lib/toast'
import type { ProfileAssociation } from './types'
import { providerAcceptsApiKey, type ApiKeyConfigRequirements } from '@/lib/llm/api-key-support'

interface ApiKeyResponse {
  id: string
  provider: string
  label: string
  isActive: boolean
  lastUsed: string | null
  createdAt: string
  updatedAt: string
  keyPreview?: string
  associations?: ProfileAssociation[]
}

interface ApiKeyFormData {
  label: string
  provider: string
  apiKey: string
}

interface ApiKeyModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface ProviderOption {
  value: string
  label: string
}

export function ApiKeyModal({ isOpen, onClose, onSuccess }: ApiKeyModalProps) {
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)

  const form = useFormState<ApiKeyFormData>({
    label: '',
    provider: '',
    apiKey: '',
  })

  // Fetch providers that can hold an API key
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await fetch('/api/v1/providers')
        const data = await response.json()

        interface ProviderData {
          name: string
          displayName: string
          configRequirements?: ApiKeyConfigRequirements
        }

        // Offered on "may this provider hold a key?", not "must it?" — the two
        // answers differ for OpenAI-Compatible, whose hosted endpoints need a
        // bearer token its local ones have no use for, and asking the stricter
        // question left no way to create such a key at all (Bug 81).
        const apiKeyProviders = (data.providers as ProviderData[])
          .filter((p) => providerAcceptsApiKey(p.configRequirements))
          .map((p) => ({
            value: p.name,
            label: p.displayName,
          }))
          .sort((a, b) => a.label.localeCompare(b.label))

        setProviders(apiKeyProviders)
      } catch (err) {
        console.error('Failed to fetch providers for API key modal', { error: err })
        // Fallback to empty - user will see an empty dropdown
      } finally {
        setProvidersLoading(false)
      }
    }
    fetchProviders()
  }, [])

  const createKey = useAsyncOperation<ApiKeyResponse>()

  const handleSubmit = async () => {
    const result = await createKey.execute(async () => {
      const response = await fetchJson<{ apiKey: ApiKeyResponse }>('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form.formData),
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to create API key')
      }

      return response.data!.apiKey
    })

    if (result) {
      // Show toasts for any auto-associations
      if (result.associations && result.associations.length > 0) {
        result.associations.forEach((assoc) => {
          showSuccessToast(
            `${assoc.profileName} linked to API key "${result.label}"`,
            4000
          )
        })
      }

      form.resetForm()
      onSuccess()
      onClose()
    }
  }

  const handleClose = () => {
    form.resetForm()
    createKey.clearError()
    onClose()
  }

  const isValid =
    !providersLoading &&
    form.formData.label.trim() &&
    form.formData.provider &&
    form.formData.apiKey.trim()

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add New API Key"
      footer={
        <FormActions
          onCancel={handleClose}
          onSubmit={handleSubmit}
          submitLabel={createKey.loading ? 'Creating...' : 'Create API Key'}
          isLoading={createKey.loading}
          isDisabled={!isValid}
        />
      }
    >
      {createKey.error && (
        <ErrorAlert message={createKey.error} className="mb-4" />
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="label" className="block qt-text-label mb-2">
            Label *
          </label>
          <input
            type="text"
            id="label"
            name="label"
            value={form.formData.label}
            onChange={form.handleChange}
            placeholder="e.g., My OpenAI Key"
            className="qt-input"
            autoFocus
          />
          <p className="qt-text-xs mt-1">A friendly name to identify this key</p>
        </div>

        <div>
          <label htmlFor="provider" className="block qt-text-label mb-2">
            Provider *
          </label>
          <select
            id="provider"
            name="provider"
            value={form.formData.provider}
            onChange={form.handleChange}
            className="qt-select"
            disabled={providersLoading}
          >
            {providersLoading ? (
              <option value="">Loading providers...</option>
            ) : (
              <>
                <option value="">Select a provider</option>
                {providers.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        <div>
          <label htmlFor="apiKey" className="block qt-text-label mb-2">
            API Key *
          </label>
          <input
            type="password"
            id="apiKey"
            name="apiKey"
            value={form.formData.apiKey}
            onChange={form.handleChange}
            placeholder="Your API key (will be encrypted)"
            className="qt-input"
          />
          <p className="qt-text-xs mt-1">Your key is encrypted and never exposed</p>
        </div>
      </div>
    </BaseModal>
  )
}

export default ApiKeyModal
