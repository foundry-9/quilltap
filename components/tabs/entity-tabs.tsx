'use client'

import { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export interface Tab {
  id: string
  label: string
  icon?: React.ReactNode
}

interface EntityTabsProps {
  tabs: Tab[]
  defaultTab?: string
  persistToUrl?: boolean
  children: (activeTab: string) => React.ReactNode
}

export function EntityTabs({ tabs, defaultTab, persistToUrl = true, children }: EntityTabsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const tabFromUrl = searchParams.get('tab')
  const fallbackTab = defaultTab || tabs[0]?.id

  // When persistToUrl is true, derive activeTab from URL; otherwise use local state
  const urlTab = tabFromUrl && tabs.some(t => t.id === tabFromUrl) ? tabFromUrl : fallbackTab
  const [localTab, setLocalTab] = useState(fallbackTab)

  const activeTab = persistToUrl ? urlTab : localTab

  const handleTabChange = (tabId: string) => {
    if (persistToUrl) {
      const params = new URLSearchParams(searchParams.toString())
      if (tabId === fallbackTab) {
        params.delete('tab')
      } else {
        params.set('tab', tabId)
      }
      const newUrl = params.toString() ? `${pathname}?${params}` : pathname
      router.replace(newUrl, { scroll: false })
    } else {
      setLocalTab(tabId)
    }
  }

  return (
    <div>
      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-slate-700 mb-6">
        <nav className="flex gap-1 -mb-px overflow-x-auto" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap
                border-b-2 transition-colors
                ${activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-slate-600'
                }
              `}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {children(activeTab)}
      </div>
    </div>
  )
}
