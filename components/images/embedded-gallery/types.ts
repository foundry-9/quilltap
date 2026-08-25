/**
 * Types and interfaces for the embedded photo gallery (Aurora character gallery).
 *
 * Post-Phase-3 the gallery is sourced from a character's vault `photos/`
 * folder (plus legacy `images/avatar.webp` + `images/history/`). The `id`
 * field is a `doc_mount_file_links.id`; `filepath` is the mount-blob URL
 * the UI can drop straight into `<img src>`.
 */

export interface GalleryImage {
  /** doc_mount_file_links.id — the canonical id for set-as-avatar, delete, etc. */
  id: string
  filename: string
  /** mount-blob URL the UI uses as `<img src>`. */
  filepath: string
  /** Optional explicit URL override; rarely set. */
  url?: string
  mimeType: string | null
  size: number
  width?: number
  height?: number
  createdAt: string
  caption: string | null
  /**
   * Free-form retrieval tags parsed out of the kept-image frontmatter
   * (the same `tags: [...]` field `keep_image` writes). These are
   * informational only — they no longer drive gallery membership.
   */
  tags: string[]
}

// EntityType is now only 'character' — personas have been migrated to
// characters with controlledBy: 'user'. The shape is kept so callers can
// stay generic if a future entity type joins.
export type EntityType = 'character'

export interface EmbeddedPhotoGalleryProps {
  entityType: EntityType
  entityId: string
  entityName: string
  /** Current `defaultImageId` — vault link id. Used to render the Avatar badge. */
  currentAvatarId?: string
  onAvatarChange?: (imageId: string | null) => void
  onRefresh?: () => void
}

export interface GalleryImageProps {
  image: GalleryImage
  index: number
  isAvatar: boolean
  isUpdating: boolean
  isDeletingImage: boolean
  isConfirmingDelete: boolean
  isMissingImage: boolean
  thumbnailSize: number
  onImageClick: (index: number) => void
  onImageError: () => void
  onSetAvatar: (e: React.MouseEvent) => void
  onDownloadImage: (e: React.MouseEvent) => void
  onDeleteImage: (e: React.MouseEvent) => void
  entityName: string
}
