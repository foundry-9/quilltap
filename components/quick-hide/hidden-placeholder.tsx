import React from 'react'

interface HiddenPlaceholderProps {
  label?: string
}

export function HiddenPlaceholder({ label }: HiddenPlaceholderProps) {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-gray-300 bg-white/80 px-6 py-8 text-center dark:border-slate-700 dark:bg-slate-900/50">
        <svg
          className="h-12 w-12 text-gray-400 dark:text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.98 8.223a10.477 10.477 0 00-1.99 3.777 10.477 10.477 0 0018.02 3.777m-16.03-7.554A10.45 10.45 0 0112 6.75c2.92 0 5.573 1.182 7.52 3.097m-16.53-1.624L3 3m18 18l-2.01-2.01"
          />
        </svg>
        <div>
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">Hidden</p>
          {label && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {label}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
