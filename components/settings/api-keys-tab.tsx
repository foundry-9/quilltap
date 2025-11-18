'use client'

import { useState, useEffect } from 'react'

interface ApiKey {
  id: string
  provider: string
  label: string
  isActive: boolean
  lastUsed: string | null
  createdAt: string
  updatedAt: string
  keyPreview: string
}

export default function ApiKeysTab() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formLoading, setFormLoading] = useState(false)
  const [formData, setFormData] = useState({
    label: '',
    provider: 'OPENAI',
    apiKey: '',
  })
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<{ [key: string]: string }>({})

  useEffect(() => {
    fetchApiKeys()
  }, [])

  const fetchApiKeys = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/keys')
      if (!res.ok) throw new Error('Failed to fetch API keys')
      const data = await res.json()
      setApiKeys(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create API key')
      }

      setFormData({ label: '', provider: 'OPENAI', apiKey: '' })
      setShowForm(false)
      await fetchApiKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setFormLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this API key?')) return

    try {
      const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete API key')
      await fetchApiKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  const handleTest = async (id: string) => {
    setTestingKeyId(id)
    setTestResults({})

    try {
      const res = await fetch(`/api/keys/${id}/test`, { method: 'POST' })
      const data = await res.json()

      if (res.ok) {
        setTestResults({ [id]: '✓ Key is valid' })
      } else {
        setTestResults({ [id]: `✗ ${data.error || 'Key is invalid'}` })
      }
    } catch (err) {
      setTestResults({ [id]: 'Connection failed' })
    } finally {
      setTestingKeyId(null)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  if (loading) {
    return <div className="text-center py-8">Loading API keys...</div>
  }

  return (
    <div>
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* API Keys List */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Your API Keys</h2>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800"
            >
              + Add API Key
            </button>
          )}
        </div>

        {apiKeys.length === 0 ? (
          <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-6 text-center text-gray-600 dark:text-gray-400">
            <p>No API keys yet. Add one to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {apiKeys.map(key => (
              <div
                key={key.id}
                className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 flex items-center justify-between bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium dark:text-white">{key.label}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {key.provider} • {key.keyPreview}
                      </p>
                      {key.lastUsed && (
                        <p className="text-xs text-gray-500 dark:text-gray-500">
                          Last used: {new Date(key.lastUsed).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  {testResults[key.id] && (
                    <p className={`text-sm mt-2 ${testResults[key.id].startsWith('✓') ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {testResults[key.id]}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleTest(key.id)}
                    disabled={testingKeyId === key.id}
                    className="px-3 py-1 text-sm bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-slate-600 disabled:bg-gray-100 dark:disabled:bg-slate-700"
                  >
                    {testingKeyId === key.id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    onClick={() => handleDelete(key.id)}
                    className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded hover:bg-red-200 dark:hover:bg-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add API Key Form */}
      {showForm && (
        <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Add New API Key</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="label" className="block text-sm font-medium mb-2">
                Label *
              </label>
              <input
                type="text"
                id="label"
                name="label"
                value={formData.label}
                onChange={handleChange}
                placeholder="e.g., My OpenAI Key"
                required
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">A friendly name to identify this key</p>
            </div>

            <div>
              <label htmlFor="provider" className="block text-sm font-medium mb-2">
                Provider *
              </label>
              <select
                id="provider"
                name="provider"
                value={formData.provider}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              >
                <option value="OPENAI">OpenAI</option>
                <option value="ANTHROPIC">Anthropic</option>
                <option value="OLLAMA">Ollama</option>
                <option value="OPENROUTER">OpenRouter</option>
                <option value="OPENAI_COMPATIBLE">OpenAI Compatible</option>
              </select>
            </div>

            <div>
              <label htmlFor="apiKey" className="block text-sm font-medium mb-2">
                API Key *
              </label>
              <input
                type="password"
                id="apiKey"
                name="apiKey"
                value={formData.apiKey}
                onChange={handleChange}
                placeholder="Your API key (will be encrypted)"
                required
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Your key is encrypted and never exposed</p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={formLoading}
                className="px-6 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600"
              >
                {formLoading ? 'Creating...' : 'Create API Key'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-6 py-2 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
