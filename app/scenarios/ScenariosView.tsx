'use client'

/**
 * General Scenarios Page
 *
 * Top-level CRUD for the instance-wide `Scenarios/` folder inside the
 * "Quilltap General" mount. These scenarios are offered alongside project
 * and character scenarios in every non-help New Chat dialog, with or
 * without a project.
 *
 * Mirrors the project ScenariosCard, but at page scope rather than card
 * scope, and fed by `useGeneralScenarios` instead of `useProjectScenarios`.
 *
 * @module app/scenarios/page
 */

import { ScenariosIcon } from '@/components/scenarios/ScenariosIcon'
import { ScenariosManager } from '@/components/scenarios/ScenariosManager'
import { useGeneralScenarios } from './hooks/useGeneralScenarios'

export function ScenariosView() {
  const mutator = useGeneralScenarios()

  return (
    <div className="qt-page-container min-h-screen text-foreground">
      <div>
        <div className="mb-6 flex items-start gap-3">
          <ScenariosIcon className="w-8 h-8 qt-text-primary mt-1" />
          <div>
            <h1 className="qt-heading-1">General Scenarios</h1>
            <p className="qt-text-secondary qt-body mt-2 max-w-2xl">
              Starting scenes you&apos;d like Quilltap to remember for every conversation, no
              matter the project or company kept. They live in the &ldquo;Quilltap
              General&rdquo; document store and are offered alongside any project-specific
              and character-specific scenarios when a new chat begins. When a project sets
              its own default, that one takes precedence; otherwise the general default
              you mark below will be pre-selected.
            </p>
          </div>
        </div>

        <div className="qt-card qt-bg-card qt-border rounded-lg p-6">
          <ScenariosManager
            mutator={mutator}
            scopeLabel="general"
            emptyMessage="No general scenarios yet. Compose one and it'll appear in every New Chat dialog from now on."
          />
        </div>
      </div>
    </div>
  )
}
