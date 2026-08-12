'use client'

/**
 * WorkspaceProviders — the workspace store + registries, mounted once.
 *
 * When the tabbed workspace is enabled these live in `AppLayout` (the root
 * layout, which never unmounts across navigation), so the shared left rail and
 * the page content both read the same store and in-app navigation is pure
 * `openTab` with full keep-alive — no route change, no remount.
 *
 * {@link EnsureWorkspaceProviders} is idempotent: if a WorkspaceProvider is
 * already above it (the enabled, app-level case) it renders children as-is;
 * otherwise it provides its own (so the dev-only `/workspace` route works even
 * when the flag is off). This prevents two nested stores with divergent state.
 *
 * @module components/workspace/WorkspaceProviders
 */

import type { ReactNode } from 'react'
import {
  WorkspaceProvider,
  useWorkspaceOptional,
} from '@/components/providers/workspace-provider'
import { TabToolbarRegistryProvider, WorkspaceToolbarBridge } from '@/components/workspace/tab-toolbar'
import { WorkspacePortalRegistryProvider } from '@/components/workspace/workspace-tab-context'
import { WorkspaceBackdropProvider } from '@/components/workspace/workspace-backdrop'
import { WorkspaceLinkInterceptor } from '@/components/workspace/WorkspaceLinkInterceptor'
import { NewChatProvider } from '@/components/providers/new-chat-provider'
import { CreationProgressProvider } from '@/components/providers/creation-progress-provider'

export function WorkspaceProviders({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <TabToolbarRegistryProvider>
        <WorkspacePortalRegistryProvider>
          <WorkspaceBackdropProvider>
            {/* NewChatProvider is inside WorkspaceProvider so its modal's
                useWorkspaceNavigate opens a tab in place; the interceptor (a
                child) opens it for /salon/new links. CreationProgressProvider
                wraps it so the "Green Room" status dialog outlives the
                NewChatModal closing at create time. */}
            <CreationProgressProvider>
              <NewChatProvider>
                {/* Keep every in-app link keep-alive-safe while in the workspace. */}
                <WorkspaceLinkInterceptor />
                {/* Surface the focused tab's contextual toolbar into the global
                    header (mounted above the tab tree, so it targets the global
                    page toolbar, not a per-tab one). */}
                <WorkspaceToolbarBridge />
                {children}
              </NewChatProvider>
            </CreationProgressProvider>
          </WorkspaceBackdropProvider>
        </WorkspacePortalRegistryProvider>
      </TabToolbarRegistryProvider>
    </WorkspaceProvider>
  )
}

export function EnsureWorkspaceProviders({ children }: { children: ReactNode }) {
  const existing = useWorkspaceOptional()
  if (existing) return <>{children}</>
  return <WorkspaceProviders>{children}</WorkspaceProviders>
}
