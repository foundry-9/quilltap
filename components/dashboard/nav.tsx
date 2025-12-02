"use client";

import Link from "next/link";
import Image from "next/image";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useDebugOptional } from "@/components/providers/debug-provider";
import { useChatContext } from "@/components/providers/chat-context";
import { useQuickHide } from "@/components/providers/quick-hide-provider";
import { TagDropdown } from "@/components/tags/tag-dropdown";
import { TagBadge } from "@/components/tags/tag-badge";
import { routeSupportsDebug } from "@/lib/navigation/route-flags";

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
  const { quickHideTags, hiddenTagIds, toggleTag } = useQuickHide();

  // Check if we're in a chat conversation
  const isInChat = pathname?.match(/^\/chats\/[^/]+$/);
  const supportsDebugToggle = routeSupportsDebug(pathname);

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
            {debug && supportsDebugToggle && (
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
                  viewBox="0 -0.5 17 17"
                  fill="currentColor"
                >
                  <path
                    d="M15.732,2.509 L13.495,0.274 C13.064,-0.159 12.346,-0.141 11.892,0.312 C11.848,0.356 11.817,0.411 11.8,0.471 C11.241,2.706 11.253,3.487 11.346,3.794 L5.081,10.059 L3.162,8.142 L0.872,10.432 C0.123,11.18 -0.503,13.91 0.795,15.207 C2.092,16.504 4.819,15.875 5.566,15.128 L7.86,12.836 L5.981,10.958 L12.265,4.675 C12.607,4.752 13.423,4.732 15.535,4.205 C15.595,4.188 15.65,4.158 15.694,4.114 C16.147,3.661 16.163,2.941 15.732,2.509 L15.732,2.509 Z M15.15,3.459 C14.047,3.77 12.765,4.046 12.481,3.992 L12.046,3.557 C11.984,3.291 12.262,1.996 12.576,0.886 C12.757,0.752 12.989,0.748 13.129,0.888 L15.147,2.906 C15.285,3.045 15.281,3.277 15.15,3.459 L15.15,3.459 Z"
                  />
                </svg>
              </button>
            )}
            <div className="hidden text-right md:block">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{user.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{user.email}</p>
            </div>
            {quickHideTags.length > 0 && (
              <div className="flex max-w-xs flex-wrap items-center justify-end gap-2">
                {quickHideTags.map(tag => {
                  const isActive = hiddenTagIds.has(tag.id)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      aria-pressed={isActive}
                      className={`rounded-full border px-1 py-0.5 transition-all ${
                        isActive
                          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-400 dark:border-blue-400 dark:bg-blue-900/40 dark:ring-blue-500'
                          : 'border-gray-300 bg-white hover:border-blue-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-blue-400'
                      }`}
                      title={isActive ? 'Show items with this tag' : 'Hide items with this tag'}
                    >
                      <TagBadge tag={tag} size="sm" className="pointer-events-none" />
                    </button>
                  )
                })}
              </div>
            )}
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
