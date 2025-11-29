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
      <div className="mb-6">
        <nav className="flex flex-wrap gap-1" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2.5 text-sm font-medium
                rounded-t-lg border border-b-0 transition-colors min-w-fit
                ${activeTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-gray-200 dark:border-slate-700 relative after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-[1px] after:bg-white dark:after:bg-slate-800'
                  : 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                }
              `}
            >
              <span className="flex-shrink-0">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="border-b border-gray-200 dark:border-slate-700"></div>
      </div>

      {/* Tab Content */}
      <div>
        {children(activeTab)}
      </div>
    </div>
  )
}
