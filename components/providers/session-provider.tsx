"use client";

import { SessionProvider } from "next-auth/react";
import { DebugProvider } from "./debug-provider";
import { TagStyleProvider } from "./tag-style-provider";
import { QuickHideProvider } from "./quick-hide-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      refetchInterval={5 * 60}
      refetchOnWindowFocus={false}
    >
      <DebugProvider>
        <TagStyleProvider>
          <QuickHideProvider>
            {children}
          </QuickHideProvider>
        </TagStyleProvider>
      </DebugProvider>
    </SessionProvider>
  );
}
