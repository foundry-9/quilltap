'use client'

/**
 * Delete Project Dialog
 *
 * Confirmation dialog for deleting a project.
 */

interface DeleteProjectDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

export function DeleteProjectDialog({ open, onClose, onConfirm }: DeleteProjectDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border qt-border-default qt-bg-card p-6 shadow-2xl">
        <h3 className="mb-4 qt-heading-4 text-foreground">Delete Project</h3>
        <p className="mb-4 qt-text-small">
          Are you sure you want to delete this project? Chats and files will be disassociated but not deleted.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm qt-text-primary qt-shadow-sm hover:qt-bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="inline-flex items-center rounded-lg bg-destructive px-4 py-2 text-sm font-semibold qt-text-on-destructive shadow hover:qt-bg-destructive/90"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
