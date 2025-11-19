'use client'

import Link from 'next/link'
import { TagDisplay } from '@/components/tags/tag-display'

interface RecentChat {
  id: string
  title: string
  updatedAt: string | Date
  character: {
    name: string
  }
  persona?: {
    id: string
    name: string
    title?: string | null
  } | null
  tags: Array<{
    tag: {
      id: string
      name: string
    }
  }>
}

interface RecentChatsSectionProps {
  chats: RecentChat[]
}

export function RecentChatsSection({ chats }: RecentChatsSectionProps) {
  return (
    <div className="mt-8">
      <h3 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
        Recent Chats
      </h3>
      {chats.length > 0 ? (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {chats.map((chat) => (
            <Link
              key={chat.id}
              href={`/chats/${chat.id}`}
              className="block rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm dark:shadow-lg hover:border-blue-500 dark:hover:border-blue-500 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-grow">
                  <h4 className="font-semibold text-gray-900 dark:text-white">
                    {chat.title}
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    with {chat.character.name}
                    {chat.persona && ` as ${chat.persona.name}${chat.persona.title ? ` - ${chat.persona.title}` : ''}`}
                  </p>
                  {chat.tags.length > 0 && (
                    <div className="mt-2">
                      <TagDisplay tags={chat.tags.map(ct => ct.tag)} />
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap ml-4">
                  {new Date(chat.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 text-center shadow-sm dark:shadow-lg">
          <p className="text-gray-600 dark:text-gray-400">
            No chats yet. Create a character and start your first conversation!
          </p>
        </div>
      )}
    </div>
  )
}
