'use client';

import { createContext, useContext, ReactNode } from 'react';
import type { Tag } from '@/components/tags/tag-editor';

interface ChatContextType {
  chatId: string | null;
  chatTitle: string | null;
  tags: Tag[];
  tagsLoading: boolean;
  tagsFetched: boolean;
  onTagAdd: (tagName: string) => Promise<void>;
  onTagRemove: (tagId: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ChatContextType;
}) {
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    return {
      chatId: null,
      chatTitle: null,
      tags: [],
      tagsLoading: false,
      tagsFetched: true,
      onTagAdd: async () => {},
      onTagRemove: async () => {},
    };
  }
  return context;
}
