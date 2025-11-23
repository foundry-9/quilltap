"use client";

import Link from "next/link";
import Image from "next/image";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useDebugOptional } from "@/components/providers/debug-provider";
import { useChatContext } from "@/components/providers/chat-context";
import { TagDropdown } from "@/components/tags/tag-dropdown";

interface DashboardNavProps {
  user: {
    name?: string | null;
    email?: string;
    image?: string | null;
  };
}

export default function DashboardNav({ user }: DashboardNavProps) {
  const debug = useDebugOptional();
  const pathname = usePathname();
  const chat = useChatContext();
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);

  // Check if we're in a chat conversation
  const isInChat = pathname?.match(/^\/chats\/[^/]+$/);

  return (
    <nav className="border-b border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="text-xl font-bold text-gray-900 dark:text-white">
              Quilltap
            </Link>
            <div className="hidden space-x-4 md:flex">
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800"
              >
                Dashboard
              </Link>
              <Link
                href="/characters"
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800"
              >
                Characters
              </Link>
              <Link
                href="/personas"
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800"
              >
                Personas
              </Link>
              <Link
                href="/chats"
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800"
              >
                Chats
              </Link>
              <Link
                href="/settings"
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800"
              >
                Settings
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Chat controls - only show when in a chat */}
            {isInChat && chat.chatId && (
              <>
                <TagDropdown
                  tags={chat.tags}
                  isOpen={tagDropdownOpen}
                  onToggle={() => setTagDropdownOpen(!tagDropdownOpen)}
                  onTagRemove={chat.onTagRemove}
                  onTagAdd={chat.onTagAdd}
                  loading={chat.tagsLoading}
                />
                <a
                  href={`/api/chats/${chat.chatId}/export`}
                  download
                  className="px-3 py-2 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 dark:bg-slate-600 dark:hover:bg-slate-500 transition-colors"
                >
                  Export Chat
                </a>
              </>
            )}

            {/* Debug toggle button */}
            {debug && (
              <button
                onClick={debug.toggleDebugMode}
                className={`p-2 rounded-md transition-colors ${
                  debug.isDebugMode
                    ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                    : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800'
                }`}
                title={debug.isDebugMode ? 'Disable debug mode' : 'Enable debug mode'}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                  />
                </svg>
              </button>
            )}
            <div className="hidden text-right md:block">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{user.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{user.email}</p>
            </div>
            {user.image && (
              <Image
                src={user.image}
                alt={user.name || "User"}
                width={32}
                height={32}
                className="h-8 w-8 rounded-full"
              />
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
