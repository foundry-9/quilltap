'use client'

import { ENTITY_TYPE_LABELS } from '../types'
import type { ExportEntityType } from '@/lib/export/types'

interface ExportTypeStepProps {
  entityType: ExportEntityType | null
  onEntityTypeChange: (type: ExportEntityType) => void
}

/**
 * Entity types offered in the picker.
 *
 * This list must stay exhaustive over `ExportEntityType`. Every member the
 * writer supports belongs here — three types were once silently missing from
 * this array with no note saying why, and the result was a set of exports
 * nobody could reach from the UI. If a type is ever deliberately withheld,
 * leave it out *with a comment right here* explaining the reason.
 */
const EXPORTABLE_TYPES: ExportEntityType[] = [
  'characters',
  'chats',
  'roleplay-templates',
  'prompt-templates',
  'connection-profiles',
  'image-profiles',
  'embedding-profiles',
  'tags',
  'projects',
  'groups',
  'document-stores',
  'files',
  'provider-models',
  'plugin-configs',
  'instance-settings',
]

/**
 * Step 1: Select the type of data to export
 */
export function ExportTypeStep({
  entityType,
  onEntityTypeChange,
}: ExportTypeStepProps) {
  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-secondary">
        Select the type of data you want to export.
      </p>
      <div className="space-y-2">
        {EXPORTABLE_TYPES.map((type) => (
          <label
            key={type}
            className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors ${
              entityType === type
                ? 'qt-border-primary qt-bg-primary/10'
                : 'qt-border-default bg-background hover:qt-border-primary/50'
            }`}
          >
            <input
              type="radio"
              name="entity-type"
              value={type}
              checked={entityType === type}
              onChange={() => onEntityTypeChange(type)}
              className="w-4 h-4"
            />
            <span className="ml-3 font-medium text-foreground">
              {ENTITY_TYPE_LABELS[type]}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
