'use client'

import { LoadingSpinner } from '../components/LoadingSpinner'
import { ENTITY_TYPE_LABELS } from '../types'
import { toExportEntityType } from '../utils'
import { formatDateTime } from '@/lib/format-time'

interface EntityPreview {
  id: string
  name?: string
  title?: string
  exists: boolean
  /** Short note from the server, e.g. which plugin secrets were withheld. */
  detail?: string
}

interface ImportPreview {
  manifest: {
    exportType: string
    createdAt: string
    appVersion: string
  }
  entities: Record<string, EntityPreview[]>
}

interface ImportPreviewStepProps {
  loading: boolean
  preview: ImportPreview | null
  selectedEntityIds: Record<string, string[]>
  onToggleSelection: (entityKey: string, entityId: string) => void
}

/**
 * Step 2: Preview the import file contents and select entities
 */
export function ImportPreviewStep({
  loading,
  preview,
  selectedEntityIds,
  onToggleSelection,
}: ImportPreviewStepProps) {
  // Get entity keys from preview (camelCase from API)
  const getEntityKeysInPreview = (): string[] => {
    if (!preview) return []
    const entities = preview.entities || {}
    return Object.keys(entities).filter(
      (key) => key !== 'memories' && (entities as Record<string, unknown>)[key],
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner />
      </div>
    )
  }

  if (!preview) {
    return null
  }

  return (
    <div className="space-y-4">
      {/* Manifest Info */}
      <div className="p-4 qt-bg-muted/50 rounded-lg space-y-2">
        <div>
          <p className="qt-text-small qt-text-secondary">Export Type</p>
          <p className="font-medium text-foreground">
            {preview.manifest.exportType}
          </p>
        </div>
        <div>
          <p className="qt-text-small qt-text-secondary">Created</p>
          <p className="font-medium text-foreground">
            {formatDateTime(preview.manifest.createdAt)}
          </p>
        </div>
        <div>
          <p className="qt-text-small qt-text-secondary">App Version</p>
          <p className="font-medium text-foreground">
            {preview.manifest.appVersion}
          </p>
        </div>
      </div>

      {/* Entity Lists */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {getEntityKeysInPreview().map((entityKey) => {
          const entities = (preview.entities || {})[entityKey] || []
          if (!entities || entities.length === 0) return null

          const selectedCount = (selectedEntityIds[entityKey] || []).length
          const displayType = toExportEntityType(entityKey)

          return (
            <div
              key={entityKey}
              className="p-4 border qt-border-default rounded-lg space-y-2"
            >
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-foreground">
                  {ENTITY_TYPE_LABELS[displayType]}
                </h4>
                <span className="qt-text-small qt-text-secondary">
                  {selectedCount} of {entities.length}
                </span>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {entities.map((entity) => (
                  <label
                    key={entity.id}
                    className="flex items-center gap-2 p-2 hover:qt-bg-muted/50 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={(selectedEntityIds[entityKey] || []).includes(entity.id)}
                      onChange={() => onToggleSelection(entityKey, entity.id)}
                      className="w-4 h-4"
                    />
                    <span className="text-foreground flex-1">
                      {entity.name || entity.title}
                      {entity.detail && (
                        <span className="block qt-text-small qt-text-secondary">
                          {entity.detail}
                        </span>
                      )}
                    </span>
                    {entity.exists && (
                      <span className="text-xs qt-bg-warning/10 qt-text-warning px-2 py-1 rounded">
                        Exists
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
