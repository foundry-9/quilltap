'use client'

/**
 * CustomToolsView — Pascal's Workbench surface.
 *
 * The landing state is the library (every definition in every enabled store);
 * drilling into a definition renders the builder IN PLACE, per the workspace
 * keep-alive rule — never a route navigation from inside a tab. The optional
 * tab payload seeds the initial drill-down for deep-links and the per-definition
 * tabs other surfaces open.
 */

import { useState } from 'react'
import type { CustomToolsTabPayload } from '@/lib/workspace/types'
import { WorkbenchLibrary } from '@/components/custom-tools/WorkbenchLibrary'
import { WorkbenchEditor } from '@/components/custom-tools/WorkbenchEditor'

/** What the surface is showing. */
type WorkbenchMode =
  | { view: 'library' }
  | { view: 'edit'; mountPointId: string; path: string }
  | { view: 'create'; mountPointId?: string; template?: string }

function initialMode(payload: CustomToolsTabPayload | undefined): WorkbenchMode {
  if (payload?.create) return { view: 'create', mountPointId: payload.mountPointId }
  if (payload?.mountPointId && payload?.path) {
    return { view: 'edit', mountPointId: payload.mountPointId, path: payload.path }
  }
  return { view: 'library' }
}

export function CustomToolsView({ payload }: Readonly<{ payload?: CustomToolsTabPayload }>) {
  const [mode, setMode] = useState<WorkbenchMode>(() => initialMode(payload))

  if (mode.view === 'library') {
    return (
      <WorkbenchLibrary
        onOpen={(mountPointId, path) => setMode({ view: 'edit', mountPointId, path })}
        onCreate={(mountPointId) => setMode({ view: 'create', mountPointId })}
        onDuplicate={(template) => setMode({ view: 'create', template })}
      />
    )
  }

  if (mode.view === 'edit') {
    return (
      <WorkbenchEditor
        key={`edit:${mode.mountPointId}:${mode.path}`}
        source={{ mountPointId: mode.mountPointId, path: mode.path }}
        onBack={() => setMode({ view: 'library' })}
        onOpenOther={(mountPointId, path) => setMode({ view: 'edit', mountPointId, path })}
      />
    )
  }

  return (
    <WorkbenchEditor
      key="create"
      create={{ mountPointId: mode.mountPointId, template: mode.template }}
      onBack={() => setMode({ view: 'library' })}
      onOpenOther={(mountPointId, path) => setMode({ view: 'edit', mountPointId, path })}
    />
  )
}

export default CustomToolsView
