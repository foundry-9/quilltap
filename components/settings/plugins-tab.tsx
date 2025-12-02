'use client'

import { useState, useEffect } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

type PluginSource = 'included' | 'npm' | 'git' | 'manual'

interface Plugin {
  name: string
  title: string
  version: string
  enabled: boolean
  capabilities: string[]
  path: string
  source: PluginSource
}

interface PluginStats {
  total: number
  enabled: number
  disabled: number
  errors: number
  initialized: boolean
}

const getSourceBadge = (source: PluginSource) => {
  switch (source) {
    case 'included':
      return {
        label: 'Included',
        className: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
      }
    case 'npm':
      return {
        label: 'NPM',
        className: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
      }
    case 'git':
      return {
        label: 'Git',
        className: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
      }
    case 'manual':
      return {
        label: 'Manual',
        className: 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300',
      }
  }
}

export default function PluginsTab() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [stats, setStats] = useState<PluginStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<Set<string>>(new Set())

  const fetchPlugins = async () => {
    try {
      const res = await fetch('/api/plugins')
      if (!res.ok) throw new Error('Failed to fetch plugins')
      const data = await res.json()
      setPlugins(data.plugins || [])
      setStats(data.stats || null)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to load plugins')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlugins()
  }, [])

  const handleTogglePlugin = async (pluginName: string, currentEnabled: boolean) => {
    setToggling(prev => new Set(prev).add(pluginName))
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(pluginName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentEnabled }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update plugin')
      }

      // Update local state
      setPlugins(prev =>
        prev.map(p =>
          p.name === pluginName ? { ...p, enabled: !currentEnabled } : p
        )
      )

      // Update stats
      if (stats) {
        setStats({
          ...stats,
          enabled: stats.enabled + (currentEnabled ? -1 : 1),
          disabled: stats.disabled + (currentEnabled ? 1 : -1),
        })
      }

      showSuccessToast(
        !currentEnabled ? 'Plugin enabled successfully' : 'Plugin disabled successfully'
      )
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update plugin')
    } finally {
      setToggling(prev => {
        const next = new Set(prev)
        next.delete(pluginName)
        return next
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading plugins...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Header */}
      {stats && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Plugins</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Enabled</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.enabled}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Disabled</p>
              <p className="text-2xl font-bold text-gray-500 dark:text-gray-500">{stats.disabled}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Errors</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.errors}</p>
            </div>
          </div>
        </div>
      )}

      {/* Description */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Plugin Management
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Manage installed plugins and their status. Enable or disable plugins to control which
          features are available in Quilltap.
        </p>
      </div>

      {/* Plugin List */}
      {plugins.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-8 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
            No Plugins Found
          </h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            No plugins are currently installed. Add plugins to the plugins directory to extend
            Quilltap&apos;s functionality.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {plugins.map((plugin) => {
            const isToggling = toggling.has(plugin.name)
            return (
              <div
                key={plugin.name}
                className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                        {plugin.title}
                      </h3>
                      <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded">
                        v{plugin.version}
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${getSourceBadge(plugin.source).className}`}>
                        {getSourceBadge(plugin.source).label}
                      </span>
                      {plugin.enabled ? (
                        <span className="px-2 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                          Enabled
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-500 rounded">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      {plugin.name}
                    </p>
                    {plugin.capabilities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {plugin.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="px-2 py-0.5 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded"
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Toggle Button */}
                  <button
                    onClick={() => handleTogglePlugin(plugin.name, plugin.enabled)}
                    disabled={isToggling}
                    className={`
                      relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                      transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500
                      focus:ring-offset-2 dark:focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed
                      ${plugin.enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-700'}
                    `}
                    role="switch"
                    aria-checked={plugin.enabled}
                  >
                    <span
                      className={`
                        pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
                        transition duration-200 ease-in-out
                        ${plugin.enabled ? 'translate-x-5' : 'translate-x-0'}
                      `}
                    />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Refresh Note */}
      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h4 className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Note about plugin changes
            </h4>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              Changes to plugin status take effect immediately, but some features may require a page
              refresh or application restart to fully apply.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
