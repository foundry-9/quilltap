/**
 * Canonical Quilltap icon registry — the single source of truth.
 *
 * Every entry here simultaneously:
 *   1. extends the {@link IconName} union (via `keyof typeof ICON_REGISTRY`),
 *   2. declares the bundled default asset + render mode, and
 *   3. is the contract a `.qtap-theme` bundle targets when overriding an icon.
 *
 * Default monochrome icons live at `/images/icons/<name>.svg` and render as a
 * CSS `mask-image` tinted by `currentColor` (so they inherit the theme
 * foreground exactly like the old inline `stroke="currentColor"` SVGs did).
 * The lone `image`-mode default is `brand` — the full-colour quill at
 * `/quill.svg`, painted as a `background-image` with no tint.
 *
 * Theme bundles may replace any of these by name via the manifest `icons` map
 * (see `QtapThemeManifestSchema` in `lib/themes/types.ts`). An SVG override
 * keeps `currentColor` tinting (mask mode); a WebP override is pre-coloured
 * (image mode). The override format is resolved by extension at injection time
 * (see `generateIconOverridesCSS` in `lib/themes/utils.ts`).
 *
 * IMPORTANT: the icon NAME is a permanent public contract. Renaming an icon
 * after themes ship overrides for it is a breaking change. Add freely; rename
 * with care. When you add an entry, also drop the matching default asset into
 * `public/images/icons/` and regenerate the default CSS:
 *   `npm run generate:icon-css`
 *
 * @module components/ui/icons/icon-registry
 */

/** How an icon's glyph is painted. */
export type IconMode = 'mask' | 'image';

export interface IconDefinition {
  /** Public URL of the bundled default asset (served statically from /public). */
  defaultFile: string;
  /**
   * Default render mode.
   *   - `mask`  — monochrome SVG masked + tinted with `currentColor`.
   *   - `image` — full-colour asset painted as a background-image (no tint).
   */
  defaultMode: IconMode;
  /** Optional default accessible label. Most icons sit beside text and are decorative. */
  ariaLabel?: string;
}

/**
 * The canonical icon set. Keys are kebab-case and double as the theme-override
 * contract. `as const satisfies` keeps the literal keys for the {@link IconName}
 * union while type-checking each value against {@link IconDefinition}.
 *
 * NOTE: this is the full deduped catalogue from the signed-off name contract in
 * `docs/developer/ICON_INVENTORY.md` (the old→new consolidation mapping lives
 * there). A handful of names intentionally share a default glyph but stay
 * distinct (`file`/`files`, `user`/`profile`) so a theme can diverge the two
 * surfaces later. Add freely; rename with care (the name is a public contract).
 */
export const ICON_REGISTRY = {
  // --- shared general-purpose UI ---
  'close':         { defaultFile: '/images/icons/close.svg',         defaultMode: 'mask' },
  'pencil':        { defaultFile: '/images/icons/pencil.svg',        defaultMode: 'mask' },
  'refresh':       { defaultFile: '/images/icons/refresh.svg',       defaultMode: 'mask' },
  'check':         { defaultFile: '/images/icons/check.svg',         defaultMode: 'mask' },
  'check-circle':  { defaultFile: '/images/icons/check-circle.svg',  defaultMode: 'mask' },
  'chat':          { defaultFile: '/images/icons/chat.svg',          defaultMode: 'mask' },
  'info':          { defaultFile: '/images/icons/info.svg',          defaultMode: 'mask' },
  'trash':         { defaultFile: '/images/icons/trash.svg',         defaultMode: 'mask' },
  'copy':          { defaultFile: '/images/icons/copy.svg',          defaultMode: 'mask' },
  'plus':          { defaultFile: '/images/icons/plus.svg',          defaultMode: 'mask' },
  'minus':         { defaultFile: '/images/icons/minus.svg',         defaultMode: 'mask' },
  'search':        { defaultFile: '/images/icons/search.svg',        defaultMode: 'mask' },
  'download':      { defaultFile: '/images/icons/download.svg',      defaultMode: 'mask' },
  'upload':        { defaultFile: '/images/icons/upload.svg',        defaultMode: 'mask' },
  'cloud-upload':  { defaultFile: '/images/icons/cloud-upload.svg',  defaultMode: 'mask' },
  'external-link': { defaultFile: '/images/icons/external-link.svg', defaultMode: 'mask' },
  'link':          { defaultFile: '/images/icons/link.svg',          defaultMode: 'mask' },
  'send':          { defaultFile: '/images/icons/send.svg',          defaultMode: 'mask' },
  'paperclip':     { defaultFile: '/images/icons/paperclip.svg',     defaultMode: 'mask' },
  'eye':           { defaultFile: '/images/icons/eye.svg',           defaultMode: 'mask' },
  'eye-off':       { defaultFile: '/images/icons/eye-off.svg',       defaultMode: 'mask' },
  'star':          { defaultFile: '/images/icons/star.svg',          defaultMode: 'mask' },
  'bookmark':      { defaultFile: '/images/icons/bookmark.svg',      defaultMode: 'mask' },
  'tag':           { defaultFile: '/images/icons/tag.svg',           defaultMode: 'mask' },
  'expand':        { defaultFile: '/images/icons/expand.svg',        defaultMode: 'mask' },
  'compress':      { defaultFile: '/images/icons/compress.svg',      defaultMode: 'mask' },

  // --- navigation: chevrons & arrows ---
  'chevron-down':  { defaultFile: '/images/icons/chevron-down.svg',  defaultMode: 'mask' },
  'chevron-right': { defaultFile: '/images/icons/chevron-right.svg', defaultMode: 'mask' },
  'chevron-left':  { defaultFile: '/images/icons/chevron-left.svg',  defaultMode: 'mask' },
  'arrow-left':    { defaultFile: '/images/icons/arrow-left.svg',    defaultMode: 'mask' },
  'arrow-right':   { defaultFile: '/images/icons/arrow-right.svg',   defaultMode: 'mask' },
  'arrow-up':      { defaultFile: '/images/icons/arrow-up.svg',      defaultMode: 'mask' },
  'arrow-down':    { defaultFile: '/images/icons/arrow-down.svg',    defaultMode: 'mask' },
  'sort':          { defaultFile: '/images/icons/sort.svg',          defaultMode: 'mask' },

  // --- status & feedback ---
  'alert-triangle':{ defaultFile: '/images/icons/alert-triangle.svg',defaultMode: 'mask' },
  'alert-circle':  { defaultFile: '/images/icons/alert-circle.svg',  defaultMode: 'mask' },
  'shield':        { defaultFile: '/images/icons/shield.svg',        defaultMode: 'mask' },
  'ban':           { defaultFile: '/images/icons/ban.svg',           defaultMode: 'mask' },
  'clock':         { defaultFile: '/images/icons/clock.svg',         defaultMode: 'mask' },
  'calendar':      { defaultFile: '/images/icons/calendar.svg',      defaultMode: 'mask' },

  // --- media & gallery ---
  'image':         { defaultFile: '/images/icons/image.svg',         defaultMode: 'mask' },
  'camera':        { defaultFile: '/images/icons/camera.svg',        defaultMode: 'mask' },
  'play':          { defaultFile: '/images/icons/play.svg',          defaultMode: 'mask' },
  'pause':         { defaultFile: '/images/icons/pause.svg',         defaultMode: 'mask' },
  'stop':          { defaultFile: '/images/icons/stop.svg',          defaultMode: 'mask' },
  'zoom-in':       { defaultFile: '/images/icons/zoom-in.svg',       defaultMode: 'mask' },
  'zoom-out':      { defaultFile: '/images/icons/zoom-out.svg',      defaultMode: 'mask' },

  // --- left-sidebar primary navigation ---
  'projects':      { defaultFile: '/images/icons/projects.svg',      defaultMode: 'mask' },
  'files':         { defaultFile: '/images/icons/files.svg',         defaultMode: 'mask' },
  'file':          { defaultFile: '/images/icons/file.svg',          defaultMode: 'mask' },
  'file-plus':     { defaultFile: '/images/icons/file-plus.svg',     defaultMode: 'mask' },
  'folder':        { defaultFile: '/images/icons/folder.svg',        defaultMode: 'mask' },
  'folder-plus':   { defaultFile: '/images/icons/folder-plus.svg',   defaultMode: 'mask' },
  'book':          { defaultFile: '/images/icons/book.svg',          defaultMode: 'mask' },
  'characters':    { defaultFile: '/images/icons/characters.svg',    defaultMode: 'mask' },
  'scriptorium':   { defaultFile: '/images/icons/scriptorium.svg',   defaultMode: 'mask' },
  'photos':        { defaultFile: '/images/icons/photos.svg',        defaultMode: 'mask' },
  'scenarios':     { defaultFile: '/images/icons/scenarios.svg',     defaultMode: 'mask' },

  // --- people & domain actors ---
  'profile':       { defaultFile: '/images/icons/profile.svg',       defaultMode: 'mask' },
  'user':          { defaultFile: '/images/icons/user.svg',          defaultMode: 'mask' },
  'user-plus':     { defaultFile: '/images/icons/user-plus.svg',     defaultMode: 'mask' },
  'users':         { defaultFile: '/images/icons/users.svg',         defaultMode: 'mask' },
  'megaphone':     { defaultFile: '/images/icons/megaphone.svg',     defaultMode: 'mask' },
  'mail':          { defaultFile: '/images/icons/mail.svg',          defaultMode: 'mask' },
  'dice':          { defaultFile: '/images/icons/dice.svg',          defaultMode: 'mask' },
  'sparkles':      { defaultFile: '/images/icons/sparkles.svg',      defaultMode: 'mask' },
  'wand':          { defaultFile: '/images/icons/wand.svg',          defaultMode: 'mask' },
  // The rocking quill shown while a reply is awaited or streaming. The MOTION
  // is a separate theme hook (`.qt-thinking-indicator` in _chat.css) so a theme
  // can change the glyph and the animation independently.
  'thinking':      { defaultFile: '/images/icons/thinking.svg',      defaultMode: 'mask', ariaLabel: 'Writing' },

  // --- system & tooling ---
  'wrench':        { defaultFile: '/images/icons/wrench.svg',        defaultMode: 'mask' },
  'code':          { defaultFile: '/images/icons/code.svg',          defaultMode: 'mask' },
  'cpu':           { defaultFile: '/images/icons/cpu.svg',           defaultMode: 'mask' },
  'database':      { defaultFile: '/images/icons/database.svg',      defaultMode: 'mask' },
  'layers':        { defaultFile: '/images/icons/layers.svg',        defaultMode: 'mask' },
  'zap':           { defaultFile: '/images/icons/zap.svg',           defaultMode: 'mask' },
  'swap':          { defaultFile: '/images/icons/swap.svg',          defaultMode: 'mask' },
  'log-out':       { defaultFile: '/images/icons/log-out.svg',       defaultMode: 'mask' },

  // --- appearance & domain nav ---
  'settings':      { defaultFile: '/images/icons/settings.svg',      defaultMode: 'mask' },
  'themes':        { defaultFile: '/images/icons/themes.svg',        defaultMode: 'mask' },
  'wardrobe':      { defaultFile: '/images/icons/wardrobe.svg',      defaultMode: 'mask' },
  'help':          { defaultFile: '/images/icons/help.svg',          defaultMode: 'mask' },
  'brahma-console': { defaultFile: '/images/icons/brahma-console.svg', defaultMode: 'mask' },
  'sun':           { defaultFile: '/images/icons/sun.svg',           defaultMode: 'mask' },
  'moon':          { defaultFile: '/images/icons/moon.svg',          defaultMode: 'mask' },
  'monitor':       { defaultFile: '/images/icons/monitor.svg',       defaultMode: 'mask' },

  // --- brand mark (special: full-colour, image mode, still overridable) ---
  'brand':         { defaultFile: '/quill.svg', defaultMode: 'image', ariaLabel: 'Quilltap' },
} as const satisfies Record<string, IconDefinition>;

/** Union of every canonical icon name — derived from {@link ICON_REGISTRY}. */
export type IconName = keyof typeof ICON_REGISTRY;

/** Type guard: is `name` a known canonical icon? */
export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICON_REGISTRY, name);
}
