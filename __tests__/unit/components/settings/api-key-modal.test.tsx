/**
 * Unit tests for ApiKeyModal dynamic provider loading
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import ApiKeyModal from '@/components/settings/api-keys/ApiKeyModal'

// Mock global fetch
const mockFetch = jest.fn()
global.fetch = mockFetch

describe('ApiKeyModal dynamic provider loading', () => {
  const mockOnClose = jest.fn()
  const mockOnSuccess = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shows loading state while fetching providers', async () => {
    // Create a promise that never resolves to keep loading state
    mockFetch.mockImplementation(() => new Promise(() => {}))

    render(
      <ApiKeyModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    )

    // Should show loading text
    expect(screen.getByText('Loading providers...')).toBeInTheDocument()

    // Provider select should be disabled
    const providerSelect = screen.getByLabelText('Provider *')
    expect(providerSelect).toBeDisabled()
  })

  it('populates provider dropdown from API response', async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          providers: [
            {
              name: 'OPENAI',
              displayName: 'OpenAI',
              configRequirements: { requiresApiKey: true },
            },
            {
              name: 'ANTHROPIC',
              displayName: 'Anthropic',
              configRequirements: { requiresApiKey: true },
            },
            {
              name: 'OLLAMA',
              displayName: 'Ollama',
              configRequirements: { requiresApiKey: false }, // Should be filtered out
            },
            {
              name: 'EXTERNAL_PLUGIN',
              displayName: 'External Plugin Provider',
              configRequirements: { requiresApiKey: true },
            },
          ],
        }),
    })

    render(
      <ApiKeyModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    )

    // Wait for providers to load
    await waitFor(() => {
      expect(screen.queryByText('Loading providers...')).not.toBeInTheDocument()
    })

    // Should have the "Select a provider" placeholder
    expect(screen.getByText('Select a provider')).toBeInTheDocument()

    // Should include providers with requiresApiKey: true (sorted alphabetically by label)
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('External Plugin Provider')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()

    // Should NOT include providers with requiresApiKey: false
    expect(screen.queryByText('Ollama')).not.toBeInTheDocument()

    // Provider select should be enabled
    const providerSelect = screen.getByLabelText('Provider *')
    expect(providerSelect).not.toBeDisabled()
  })

  // Bug 81: the list is filtered on whether a provider *may* hold a key, not
  // whether it demands one. OpenAI-Compatible requires none (a local llama.cpp
  // has nowhere to put one) and accepts one (a hosted endpoint demands a bearer
  // token); the stricter reading left no way to create such a key at all.
  it('offers a provider that accepts an API key without requiring one', async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          providers: [
            {
              name: 'OPENAI_COMPATIBLE',
              displayName: 'OpenAI-Compatible',
              configRequirements: { requiresApiKey: false, acceptsApiKey: true },
            },
            {
              name: 'OLLAMA',
              displayName: 'Ollama',
              configRequirements: { requiresApiKey: false, acceptsApiKey: false },
            },
          ],
        }),
    })

    render(
      <ApiKeyModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    )

    await waitFor(() => {
      expect(screen.queryByText('Loading providers...')).not.toBeInTheDocument()
    })

    expect(screen.getByText('OpenAI-Compatible')).toBeInTheDocument()
    expect(screen.queryByText('Ollama')).not.toBeInTheDocument()
  })

  it('handles fetch error gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    render(
      <ApiKeyModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    )

    // Wait for error to be handled
    await waitFor(() => {
      expect(screen.queryByText('Loading providers...')).not.toBeInTheDocument()
    })

    // Should show empty dropdown with just placeholder
    expect(screen.getByText('Select a provider')).toBeInTheDocument()

    // Provider select should be enabled (not stuck in loading)
    const providerSelect = screen.getByLabelText('Provider *')
    expect(providerSelect).not.toBeDisabled()
  })

  it('disables submit button while loading providers', async () => {
    // Create a promise that never resolves to keep loading state
    mockFetch.mockImplementation(() => new Promise(() => {}))

    render(
      <ApiKeyModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    )

    // Submit button should be disabled
    const submitButton = screen.getByRole('button', { name: /Create API Key/i })
    expect(submitButton).toBeDisabled()
  })

  it('fetches from the correct API endpoint', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ providers: [] }),
    })

    render(
      <ApiKeyModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    )

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/providers')
    })
  })
})
