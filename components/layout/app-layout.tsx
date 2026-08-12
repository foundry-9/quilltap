'use client'

/**
 * App Layout
 *
 * Root layout wrapper with left sidebar and header.
 * Used for authenticated pages.
 *
 * @module components/layout/app-layout
 */

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from '@/components/providers/session-provider'
import { SidebarProvider } from '@/components/providers/sidebar-provider'
import { PageToolbarProvider } from '@/components/providers/page-toolbar-provider'
import { HelpChatProvider } from '@/components/providers/help-chat-provider'
import { HelpChatDialog } from '@/components/help-chat/HelpChatDialog'
import { BrahmaConsoleProvider } from '@/components/providers/brahma-console-provider'
import { BrahmaConsoleDialog } from '@/components/brahma-console/BrahmaConsoleDialog'
import { QtapLinkProvider } from '@/components/providers/qtap-link-provider'
import { WardrobeDialogProvider } from '@/components/providers/wardrobe-dialog-provider'
import { WardrobeControlDialog } from '@/components/wardrobe/wardrobe-control-dialog'
import { LeftSidebar } from './left-sidebar'
import { PageToolbar } from './page-toolbar'
import FooterWrapper from '@/components/footer-wrapper'
import { StartupProgress, useStartupPhase } from '@/components/loading/StartupProgress'
import { useDictionaryFeed } from '@/lib/spellcheck/useDictionaryFeed'
import { WorkspaceProviders } from '@/components/workspace/WorkspaceProviders'
import { isWorkspaceTabsEnabled } from '@/lib/config/feature-flags'

interface AppLayoutProps {
  children: React.ReactNode
}

/**
 * Inner layout component that uses sidebar context
 */
function AppLayoutInner({ children }: AppLayoutProps) {
  const pathname = usePathname()
  const { data: session, status } = useSession()
  const { phase: startupPhase, settled: startupSettled, everSettling } = useStartupPhase()

  // Don't render layout on auth, setup, or unlock pages
  const isAuthPage = pathname?.startsWith('/auth')
  const isSetupPage = pathname?.startsWith('/setup')
  const isUnlockPage = pathname === '/unlock'

  // The app is displayable once we've polled and the background backfills have
  // settled — or startup failed (errors surface in-app, not via this gate).
  // We hold past `complete` because the server starts serving before the vault
  // backfill / mount rescan finish, and server-rendered pages read empty data
  // in that window (the home dashboard then looks like total data loss).
  const startupResolved =
    startupPhase != null && (startupSettled || startupPhase === 'failed')

  // If the gate actually had to hold during settling, the page underneath was
  // server-rendered with the empty/partial data available mid-settle. A soft
  // router.refresh() does NOT reliably re-run those server components, but a
  // full document reload does (it's exactly what a manual reload does). So once
  // settled we reload once, keeping the progress screen up across it so the
  // empty render never flashes. One-shot: the reloaded page sees `settled`
  // already true (never held), so it neither holds nor reloads again.
  const reloadingAfterSettle =
    everSettling && startupResolved && startupPhase !== 'failed'
  const reloadStartedRef = useRef(false)
  useEffect(() => {
    if (reloadingAfterSettle && !reloadStartedRef.current) {
      reloadStartedRef.current = true
      window.location.reload()
    }
  }, [reloadingAfterSettle])

  // Setup and unlock pages bypass session check entirely (pepper may not be resolved yet)
  if (isSetupPage || isUnlockPage) {
    return (
      <div className="flex flex-col h-screen bg-background text-foreground">
        <main className="flex-1 min-h-0 overflow-auto">
          {children}
        </main>
      </div>
    )
  }

  // Show the startup-progress screen while the session resolves, while the
  // server hasn't settled its background work yet, OR while the post-settle
  // reload is in flight (so the empty mid-settle render never flashes).
  const startupNotResolved = startupPhase != null && !startupResolved
  if (status === 'loading' || startupNotResolved || reloadingAfterSettle) {
    return <StartupProgress />
  }

  // Don't show sidebar/header for auth pages or unauthenticated users
  if (isAuthPage || !session) {
    return (
      <div className="flex flex-col h-screen bg-background text-foreground">
        <main className="flex-1 min-h-0 overflow-auto">
          {children}
        </main>
      </div>
    )
  }

  // Rail + content. When the tabbed workspace is enabled, the workspace store
  // and registries live HERE (in the root layout, which never unmounts across
  // navigation) so the shared left rail and the content both read one store and
  // in-app navigation is pure openTab with full keep-alive.
  const railAndContent = (
    <div className="qt-app-layout">
      <LeftSidebar />
      <div className="qt-app-main">
        <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <PageToolbar />
          <div className="flex-1 min-h-0 overflow-y-auto">
            {children}
          </div>
        </main>
        <FooterWrapper />
      </div>
    </div>
  )

  return (
    <HelpChatProvider>
      <BrahmaConsoleProvider>
        <WardrobeDialogProvider>
          <DictionaryFeedMount />
          {isWorkspaceTabsEnabled() ? (
            <WorkspaceProviders>
              <QtapLinkProvider>{railAndContent}</QtapLinkProvider>
            </WorkspaceProviders>
          ) : (
            <QtapLinkProvider>{railAndContent}</QtapLinkProvider>
          )}
          <HelpChatDialog />
          <BrahmaConsoleDialog />
          <WardrobeControlDialog />
        </WardrobeDialogProvider>
      </BrahmaConsoleProvider>
    </HelpChatProvider>
  )
}

/**
 * Renderless component that feeds Aurora character names into the Electron
 * shell's custom spellchecker dictionary. Mounts only inside the authenticated
 * branch so the `/api/v1/characters` SWR call doesn't fire on auth pages.
 */
function DictionaryFeedMount() {
  useDictionaryFeed()
  return null
}

/**
 * App Layout component with providers
 */
export function AppLayout({ children }: AppLayoutProps) {
  return (
    <SidebarProvider>
      <PageToolbarProvider>
        <AppLayoutInner>{children}</AppLayoutInner>
      </PageToolbarProvider>
    </SidebarProvider>
  )
}
