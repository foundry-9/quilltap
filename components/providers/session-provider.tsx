"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { QueryProvider } from "@/lib/query/QueryProvider";
import { RealtimeProvider } from "./realtime-provider";
import { TagStyleProvider } from "./tag-style-provider";
import { QuickHideProvider } from "./quick-hide-provider";

import { ContentWidthProvider } from "./content-width-provider";
import { AvatarDisplayProvider } from "./avatar-display-provider";
import { ThemeProvider } from "./theme-provider";

// ============================================================================
// SESSION TYPES
// ============================================================================

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

export interface Session {
  user: SessionUser;
  expires: string;
}

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export interface SessionContextValue {
  data: Session | null;
  status: SessionStatus;
  update: () => Promise<Session | null>;
}

// ============================================================================
// SESSION CONTEXT
// ============================================================================

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/**
 * Hook to access session data
 * Similar API to next-auth/react useSession
 */
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}

// ============================================================================
// SESSION PROVIDER
// ============================================================================

interface CustomSessionProviderProps {
  children: ReactNode;
  refetchInterval?: number; // seconds
  refetchOnWindowFocus?: boolean;
}

function CustomSessionProvider({
  children,
  refetchInterval = 5 * 60, // 5 minutes default
  refetchOnWindowFocus = false,
}: CustomSessionProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [serverNotReady, setServerNotReady] = useState(false);

  const fetchSession = useCallback(async (): Promise<Session | null> => {
    try {
      // In single-user mode, session endpoint always returns the user
      const response = await fetch("/api/v1/session", {
        credentials: "include",
      });

      if (!response.ok) {
        // Any 5xx (server-side) puts us on the fast-retry path. 503 was the
        // original signal (pepper vault setup needed); 500/502/504/etc. also
        // happen during the startup window when subsystems aren't ready —
        // we want the same 5-second retry loop in all those cases so the UI
        // recovers as soon as the server is healthy, instead of waiting out
        // the 5-minute refetchInterval.
        if (response.status >= 500 && response.status < 600) {
          setSession(null);
          setStatus("loading");
          setServerNotReady(true);
          return null;
        }
        // Other errors - log and retry on the slow interval
        console.error("Failed to fetch session, will retry");
        setStatus("loading");
        return null;
      }
      setServerNotReady(false);

      const data = await response.json();

      if (data.user) {
        const newSession: Session = {
          user: data.user,
          expires: data.expires,
        };
        setSession(newSession);
        setStatus("authenticated");
        return newSession;
      } else {
        setSession(null);
        setStatus("unauthenticated");
        return null;
      }
    } catch (error) {
      console.error("Failed to fetch session:", error);
      setSession(null);
      setStatus("unauthenticated");
      return null;
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session provider uses a bespoke 503-retry loop; not a simple fetch
    fetchSession();
  }, [fetchSession]);

  // Refetch on interval
  useEffect(() => {
    if (refetchInterval > 0) {
      const intervalId = setInterval(() => {
        fetchSession();
      }, refetchInterval * 1000);

      return () => clearInterval(intervalId);
    }
  }, [refetchInterval, fetchSession]);

  // When server returned 503 (setup needed), retry more frequently
  // so the session resolves quickly after setup completes
  useEffect(() => {
    if (!serverNotReady) return;

    const retryId = setInterval(() => {
      fetchSession();
    }, 5000); // retry every 5 seconds

    return () => clearInterval(retryId);
  }, [serverNotReady, fetchSession]);

  // Refetch on window focus
  useEffect(() => {
    if (!refetchOnWindowFocus) return;

    const handleFocus = () => {
      fetchSession();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refetchOnWindowFocus, fetchSession]);

  const value: SessionContextValue = {
    data: session,
    status,
    update: fetchSession,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

// ============================================================================
// PROVIDERS WRAPPER
// ============================================================================

export function Providers({ children }: { children: React.ReactNode }) {
  // All client server-state runs through TanStack Query (the SWR -> TanStack
  // Query migration is complete; see
  // docs/developer/features/tanstack-query-migration.md).
  return (
    <QueryProvider>
      {/* Inside QueryProvider: it needs the QueryClient to invalidate against. */}
      <RealtimeProvider />
      <CustomSessionProvider
        refetchInterval={5 * 60}
        refetchOnWindowFocus={false}
      >
        <ThemeProvider>
          <TagStyleProvider>
            <QuickHideProvider>
                <ContentWidthProvider>
                  <AvatarDisplayProvider>
                    {children}
                  </AvatarDisplayProvider>
                </ContentWidthProvider>
            </QuickHideProvider>
          </TagStyleProvider>
        </ThemeProvider>
      </CustomSessionProvider>
    </QueryProvider>
  );
}
