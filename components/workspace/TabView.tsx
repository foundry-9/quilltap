'use client'

/**
 * TabView — renders the surface for a workspace tab by its `kind`.
 *
 * Lazy-mount, then keep alive: a tab's view does not mount until the tab is
 * first activated; once mounted it is never unmounted by a tab switch (the host
 * hides inactive tabs with CSS). This is what lets a streaming Salon survive
 * tab switches without touching its SSE hooks. See
 * `docs/developer/features/tabbed-workspace.md`.
 *
 * @module components/workspace/TabView
 */

import { useState } from 'react'
import type {
  WorkspaceTab,
  SalonTabPayload,
  SettingsTabPayload,
} from '@/lib/workspace/types'
import { HomeViewContainer } from '@/components/homepage/HomeViewContainer'
import { SalonView } from '@/app/salon/[id]/SalonView'
import { SalonListView } from '@/app/salon/SalonListView'
import { AuroraView } from '@/app/aurora/AuroraView'
import { ProsperoView } from '@/app/prospero/ProsperoView'
import { ScriptoriumView } from '@/app/scriptorium/ScriptoriumView'
import { SettingsView } from '@/app/settings/SettingsView'
import { FilesView } from '@/app/files/FilesView'
import { PhotosView } from '@/app/photos/PhotosView'
import { ScenariosView } from '@/app/scenarios/ScenariosView'
import { TerminalView, DocumentView } from '@/components/workspace/TerminalDocumentViews'
import { WorkspaceTabProvider } from '@/components/workspace/workspace-tab-context'
import { TabToolbarProvider } from '@/components/workspace/tab-toolbar'
import { BrahmaConsoleView } from '@/components/brahma-console/BrahmaConsoleView'
import { WardrobeView } from '@/components/wardrobe/wardrobe-control-dialog'
import { ProfileView } from '@/app/profile/ProfileView'
import { AboutView } from '@/app/about/AboutView'
import { GenerateImageView } from '@/app/generate-image/GenerateImageView'
import { StandaloneDocumentView } from '@/components/workspace/StandaloneDocumentView'
import { NewCharacterView } from '@/app/aurora/new/NewCharacterView'
import { CharacterEditView } from '@/app/aurora/[id]/edit/CharacterEditView'
import { CharacterDetailView } from '@/app/aurora/[id]/view/CharacterDetailView'
import { useCloseSelfTab } from '@/components/workspace/useCloseSelfTab'
import { SettingsWizardView } from '@/app/settings/wizard/SettingsWizardView'
import { CustomToolsView } from '@/app/custom-tools/CustomToolsView'
import type {
  ProsperoTabPayload,
  ScriptoriumTabPayload,
  AuroraTabPayload,
  TerminalTabPayload,
  DocumentTabPayload,
  DocumentStandaloneTabPayload,
  WardrobeTabPayload,
  CharacterEditTabPayload,
  CharacterViewTabPayload,
  CustomToolsTabPayload,
} from '@/lib/workspace/types'

/**
 * The read-only character detail as a workspace tab. Its "back" action closes
 * the tab (returning focus to the kept-alive tab it was opened from) rather than
 * navigating, keeping the workspace mounted.
 */
function CharacterViewTab({ characterId, initialTab }: { characterId: string; initialTab?: string }) {
  const closeSelf = useCloseSelfTab()
  return (
    <CharacterDetailView
      characterId={characterId}
      initialTab={initialTab}
      onBack={() => { closeSelf() }}
    />
  )
}

function renderView(tab: WorkspaceTab) {
  switch (tab.kind) {
    case 'home':
      return <HomeViewContainer />
    case 'salon':
      return <SalonView chatId={(tab.payload as SalonTabPayload).chatId} />
    case 'salon-list':
      return <SalonListView />
    case 'aurora':
      return <AuroraView initialGroupId={(tab.payload as AuroraTabPayload | undefined)?.groupId} />
    case 'prospero':
      return <ProsperoView initialProjectId={(tab.payload as ProsperoTabPayload | undefined)?.projectId} />
    case 'scriptorium':
      return <ScriptoriumView initialStoreId={(tab.payload as ScriptoriumTabPayload | undefined)?.storeId} />
    case 'settings': {
      const payload = (tab.payload as SettingsTabPayload | undefined) ?? {}
      return <SettingsView tab={payload.tab} section={payload.section} />
    }
    case 'files':
      return <FilesView />
    case 'photos':
      return <PhotosView />
    case 'scenarios':
      return <ScenariosView />
    case 'terminal':
      return <TerminalView chatId={(tab.payload as TerminalTabPayload).chatId} />
    case 'document': {
      const payload = tab.payload as DocumentTabPayload
      return <DocumentView chatId={payload.chatId} chatDocumentId={payload.chatDocumentId} />
    }
    case 'brahma':
      return <BrahmaConsoleView />
    case 'wardrobe':
      return <WardrobeView characterId={(tab.payload as WardrobeTabPayload | undefined)?.characterId} />
    case 'profile':
      return <ProfileView />
    case 'about':
      return <AboutView />
    case 'generate-image':
      return <GenerateImageView />
    case 'document-standalone':
      return <StandaloneDocumentView payload={tab.payload as DocumentStandaloneTabPayload} />
    case 'character-new':
      return <NewCharacterView />
    case 'character-edit': {
      const payload = tab.payload as CharacterEditTabPayload
      return <CharacterEditView characterId={payload.characterId} initialTab={payload.tab} />
    }
    case 'character-view': {
      const payload = tab.payload as CharacterViewTabPayload
      return <CharacterViewTab characterId={payload.characterId} initialTab={payload.tab} />
    }
    case 'settings-wizard':
      return <SettingsWizardView />
    case 'custom-tools':
      return <CustomToolsView payload={tab.payload as CustomToolsTabPayload | undefined} />
    default:
      return null
  }
}

export function TabView({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  // Latch: mount on first activation, never unmount thereafter. Adjusting state
  // during render is React's sanctioned pattern for deriving from a prop
  // without an effect (re-renders immediately, nothing is committed in between).
  const [everActive, setEverActive] = useState(active)
  if (active && !everActive) {
    setEverActive(true)
  }

  if (!everActive) return null
  return (
    <WorkspaceTabProvider tabId={tab.id}>
      <TabToolbarProvider tabId={tab.id}>{renderView(tab)}</TabToolbarProvider>
    </WorkspaceTabProvider>
  )
}
