# Changelog

All notable changes to `@quilltap/theme-storybook` will be documented in this file.

## [1.0.63] - 2026-08-25

### Added
- The rest of the `qt-*` utility families the app actually ships, so a theme can be previewed against what it will really meet: the missing opacity steps for `qt-bg-muted` (20–80), `qt-bg-card` (50–90), `qt-bg-primary`, `qt-bg-destructive`, `qt-bg-success`, `qt-bg-warning`, `qt-bg-info` and `qt-bg-secondary`; `qt-border-default`, `qt-border-primary`, `qt-border-destructive`, `qt-border-warning` and `qt-border-success` at their used opacities; `qt-text-secondary/50–80` and the status colours at `/80`; and the surface colours `qt-bg-default`, `qt-bg-input`, `qt-bg-secondary`, `qt-border-accent`, `qt-border-primary-foreground`.
- 34 state forms of those utilities — `hover:`, `focus:`, `disabled:`, `placeholder:`, `file:` and one named `group-hover/thumb:`. In the app every one of these is hand-written and escaped, because Tailwind generates no variants for a class declared inside `@layer utilities`; they are mirrored here so a theme author previewing hover states sees what the app actually ships rather than a resting state that never moves.

### Notes
- The typography-sizing classes (`qt-text-small`, `qt-text-xs`, `qt-text-label`, `qt-text-label-xs`, `qt-text-large`, `qt-text-lead`, `qt-text-section`) live in the app's `@layer components` sheet and have never been mirrored here. Still outstanding; the color-carrying `qt-text-*` utilities are complete.

## [1.0.62] - 2026-08-25

### Added
- `qt-text-on-primary`, `qt-text-on-success`, and `qt-text-on-destructive`: the rest of the on-a-filled-surface foreground family that `qt-text-on-accent` started, each mapping to the theme's matching `*Foreground` token. Plus the hand-written hover partners `hover:qt-text-on-accent/-primary/-success/-destructive`, for controls that sit quiet at rest and take a filled background on hover. Mirrors the app-side definitions.
- `Surfaces` story: a "Foregrounds on filled surfaces" section previewing all four fills with their foregrounds, and a hover row for the hover partners. It also spells out the naming trap — the classes are `-on-<fill>`, never `-<fill>-foreground`, which is the Tailwind spelling and no `qt-` class at all.

## [1.0.44] - 2026-06-14

### Added
- Roleplay-template style classes: the four high-contrast chips `qt-roleplay-1..4` (with `--qt-roleplay-1..4-bg/fg` tokens themes override), the semantic chips `qt-roleplay-danger/warning/success/info/muted/code`, and the add-on flourish classes (`qt-rp-bold`, `qt-rp-italic`, `qt-rp-reverse`, `qt-rp-underline`, `qt-rp-underline-double`, `qt-rp-border`, `qt-rp-border-dashed`, `qt-rp-font-{sans,serif,mono,display,script}`). Mirrors the app-side definitions.
- `Chat` story: a "Roleplay-Template Styles" section previewing the four chips, the semantic set, and a row of add-on combinations so theme authors can see them across themes.

## [1.0.43] - 2026-06-11

### Added
- `.qt-hover-accent` utility class: a hoverable accent surface for list rows, menu items, and option cards. On hover it paints the accent background and forces the accent foreground onto the row **and every descendant** (via `:hover :where(*)`), so composite rows stay legible even when a theme maps `accent` to a bold colour and the children carry their own colour. Mirrors the app-side definition.
- `Surfaces` story: documents the accent-surface contract for theme authors — filled accent surfaces paired with `qt-text-on-accent`, hover rows via `qt-hover-accent`, and quiet selected/panel surfaces (`qt-bg-primary/10` / `qt-bg-muted`) that deliberately avoid the bold accent. Exported from `@quilltap/theme-storybook/stories`.

## [1.0.41] - 2026-06-10

### Changed
- `Icons` story: the catalogue now lists the new `tag` icon (80 names), and the `brand` note reflects the app-side rule change — an `.svg` brand override is tinted like any other icon; ship `.webp` to keep its own colors.

## [1.0.40] - 2026-06-09

### Added
- `Icons` story: a reference for theme authors listing every override-able Quilltap icon name (grouped by category) plus the override recipe — the `theme.json` `icons` map and the `.svg` (theme-tinted) vs `.webp` (full-color) modes. Exported from `@quilltap/theme-storybook/stories`.

## [1.0.38] - 2026-06-04

### Added
- `.qt-checkbox` and `.qt-radio` component classes (previously referenced by the Inputs story but undefined here, so they rendered as bare native controls). Token-driven via new `--qt-checkbox-*` / `--qt-radio-*` variables; `accent-color` recolors the native fill/check.
- `--qt-select-arrow` variable holding the full `url()` data URI for the `<select>` chevron; `.qt-select` now references it so themes can swap the glyph wholesale.

### Changed
- `.qt-button-success` now uses the token-driven button base (`--qt-button-radius`/padding/font) and gains the standard disabled handling, matching the other variants instead of hardcoding `0.5rem 1rem` / `font-weight: 600`.

## [1.0.35] - 2026-05-17

### Added
- Terminal component classes: `qt-terminal-surface`, `qt-terminal-embed`, `qt-terminal-embed-header`, `qt-terminal-embed-footer`, `qt-terminal-popout-page`, `qt-terminal-popout-header`, `qt-terminal-popout-link`, `qt-terminal-popout-title`, `qt-terminal-popout-separator`, `qt-terminal-closed-badge`
- Terminal CSS variables: `--qt-terminal-bg`, `--qt-terminal-fg`, `--qt-terminal-cursor`, `--qt-terminal-selection`, `--qt-terminal-ansi-*` (16 colors), `--qt-terminal-chrome-bg`, `--qt-terminal-chrome-border`, `--qt-terminal-chrome-fg`, `--qt-terminal-chrome-muted-fg`, `--qt-terminal-closed-badge-*`, `--qt-terminal-embed-*` — themes can override these to retint the terminal stack end-to-end
- Solid status background utilities: `qt-bg-success`, `qt-bg-warning`, `qt-bg-info`, `qt-bg-destructive`, `qt-bg-accent`, `qt-bg-muted-foreground`
- Additional opacity variants: `qt-bg-success/40`, `qt-bg-success/60`, `qt-bg-destructive/60`, `qt-bg-muted-foreground/30`, `qt-bg-muted-foreground/60`, `qt-border-success/20`, `qt-border-success/40`, `hover:qt-bg-muted-foreground/60`
- Foreground utility for accent-coloured surfaces: `qt-text-on-accent`
- Terminal story preview under `stories/components/Terminal`

### Fixed
- `qt-bg-primary` now correctly maps to `var(--color-primary)` (was incorrectly pointing at `--color-background`)
- `qt-bg-secondary` now correctly maps to `var(--color-secondary)` (was incorrectly pointing at `--color-muted`)

## [1.0.21] - 2026-02-20

### Added
- Overlay utility classes: `qt-bg-overlay`, `qt-bg-overlay-medium`, `qt-bg-overlay-light`, `qt-bg-overlay-none`, `qt-bg-overlay-caption`
- Overlay button utility classes: `qt-bg-overlay-btn`, `hover:qt-bg-overlay-btn`
- Overlay text utilities: `qt-text-overlay`, `qt-text-overlay-muted`
- Spinner utility classes: `qt-spinner`, `qt-spinner-lg` (themed loading spinners)
- Favorite color utility: `qt-text-favorite` (themed amber star color)
- Toggle knob utility: `qt-bg-toggle-knob` (themed toggle switch circle)
- Warning box utilities: `qt-warning-box`, `qt-warning-box-text` (themed warning container)
- Prose dark mode utility: `qt-prose-auto` (handles dark mode prose automatically via `.dark` selector)
- CSS custom properties for all new utilities: `--qt-overlay-*`, `--qt-spinner-*`, `--qt-favorite-color`, `--qt-toggle-knob-bg`, `--qt-warning-box-*`

## [1.0.20] - 2026-02-09

### Added
- `qt-shadow-lg` utility class for elevated surfaces (dropdowns, modals)
- `hover:qt-bg-primary/10` hover background utility class

## [1.0.18] - 2026-02-08

### Changed
- Updated default theme tokens to Professional Neutral design
  - Color palette shifted from hue 220 to 225 (cooler, more corporate)
  - System font stack throughout (dropped Inter/EB Garamond references)
  - Fixed border radii (0.25/0.375/0.5rem) instead of calc-based values
  - Updated sidebar and header dimensions to match new compact defaults (3.5rem)
  - All light and dark mode colors updated to new low-saturation palette

## [1.0.17] - 2026-02-02

### Added
- Status color utility classes with opacity variants:
  - Background: `qt-bg-success/10`, `qt-bg-warning/10`, `qt-bg-info/10`, `qt-bg-destructive/10` (also /5 and /20)
  - Text: `qt-text-success`, `qt-text-warning`, `qt-text-info`, `qt-text-destructive`
  - Border: `qt-border-success`, `qt-border-warning`, `qt-border-info`, `qt-border-destructive`
  - Border with opacity: `qt-border-success/30`, `qt-border-warning/30`, `qt-border-info/30`, `qt-border-destructive/30`
  - Hover backgrounds: `hover:qt-bg-success/10`, `hover:qt-bg-warning/10`, `hover:qt-bg-info/10`, `hover:qt-bg-destructive/10`
- `qt-bg-muted` utility class

## [1.0.16] - 2026-01-30

### Added
- `.qt-dialog-wide` class for dialogs that match page container width (uses `--qt-page-max-width` variable)

## [1.0.15] - 2026-01-29

### Added
- `.qt-button-warning` class for cautionary action buttons (uses `--qt-button-warning-*` variables)

## [1.0.14] - 2026-01-25

### Added
- Project badge CSS variables: `--qt-badge-project-bg`, `--qt-badge-project-fg` (teal color)
- Dark mode overrides for project badge with improved contrast

## [1.0.13] - 2026-01-23

### Added
- Alert CSS variables: `--qt-alert-success-*`, `--qt-alert-warning-*`, `--qt-alert-error-*`, `--qt-alert-info-*` for fully themeable alerts
- Entity badge CSS variables: `--qt-badge-character-*`, `--qt-badge-persona-*`, `--qt-badge-chat-*`, `--qt-badge-tag-*`, `--qt-badge-memory-*`
- Status badge CSS variables: `--qt-badge-enabled-*`, `--qt-badge-disabled-*`, `--qt-badge-related-*`, `--qt-badge-manual-*`, `--qt-badge-auto-*`
- Plugin source badge CSS variables: `--qt-badge-source-included-*`, `--qt-badge-source-npm-*`, `--qt-badge-source-git-*`, `--qt-badge-source-manual-*`
- Capability badge CSS variables: `--qt-badge-capability-*`
- Warning button CSS variables: `--qt-button-warning-*`
- Dark mode overrides for all new badge and alert variables with improved contrast

## [1.0.12] - 2026-01-23

### Added
- Filter chip classes (`qt-filter-chip`, `qt-filter-chip-active`) for themeable search filter toggles
- CSS variables: `--qt-filter-chip-radius`, `--qt-filter-chip-padding-x`, `--qt-filter-chip-padding-y`, `--qt-filter-chip-font-size`, `--qt-filter-chip-font-weight`, `--qt-filter-chip-transition`
- Active state variables: `--qt-filter-chip-active-bg`, `--qt-filter-chip-active-fg`, `--qt-filter-chip-active-border`
- Inactive state variables: `--qt-filter-chip-inactive-bg`, `--qt-filter-chip-inactive-fg`, `--qt-filter-chip-inactive-border`, `--qt-filter-chip-inactive-hover-bg`

## [1.0.11] - 2026-01-23

### Added
- Search highlight class (`qt-highlight`) for consistent search result text highlighting
- CSS variables: `--qt-highlight-bg`, `--qt-highlight-fg`, `--qt-highlight-radius`, `--qt-highlight-padding-x`, `--qt-highlight-font-weight`

## [1.0.10] - 2026-01-16

### Added
- Collapsed navigation classes (`qt-collapsed-nav`, `qt-collapsed-nav-button`) for sidebar quick-access buttons when collapsed

## [1.0.9] - 2026-01-10

### Changed
- Status badges (`qt-badge-success`, `qt-badge-warning`, `qt-badge-destructive`) now use `--qt-status-*` tokens for consistent theming
- Badges use solid backgrounds with contrasting foreground colors for better readability in dark mode

### Added
- Status token CSS variables: `--qt-status-success-*`, `--qt-status-warning-*`, `--qt-status-info-*`, `--qt-status-danger-*`
- `qt-badge-info` class using info status tokens

## [1.0.5] - 2026-01-06

### Added
- File preview component classes (`qt-file-preview-scroll`, `qt-file-preview-panel`, `qt-file-preview-code`)
- File preview state classes (`qt-file-preview-loading`, `qt-file-preview-loading-text`, `qt-file-preview-empty`, `qt-file-preview-empty-icon`)
- Wikilink classes (`qt-wikilink`, `qt-wikilink-broken`) for internal document links
- CSS variables: `--qt-file-preview-max-height`, `--qt-file-preview-min-height`, `--qt-file-preview-panel-bg`
- CSS variables: `--qt-code-bg`, `--qt-code-fg`, `--qt-code-font`
- FilePreview story component showcasing all file preview styles

## [1.0.4] - 2026-01-01

### Added
- Avatar label classes (`qt-avatar-labels`, `qt-avatar-name`, `qt-avatar-title`)
- CSS variables: `--qt-avatar-name-fg`, `--qt-avatar-title-fg` for theming avatar text
- Themes can now customize avatar name/title colors (useful for backgrounds with images)

## [1.0.3] - 2026-01-01

### Added
- Success button variant (`qt-button-success`) as standalone class with full styling
- CSS variables: `--qt-button-success-bg`, `--qt-button-success-fg`, `--qt-button-success-hover-bg`
- Dark foreground text for proper contrast on bright green background

## [1.0.2] - 2025-12-31

### Changed
- Sidebar navigation icons and labels now use standard foreground color

## [1.0.1] - 2025-12-31

### Added
- Left sidebar CSS variables (`--qt-left-sidebar-*`) for theme customization
- App header CSS variables (`--qt-app-header-*`) for theme customization
- Left sidebar component classes (`.qt-left-sidebar-*`)
- App layout component classes (`.qt-app-layout`, `.qt-app-main`, `.qt-app-header-*`)
- Mobile-responsive hamburger menu class (`.qt-hamburger`)

## [1.0.0] - 2025-12-31

### Added
- Initial release of `@quilltap/theme-storybook`
- Storybook preset for theme development
- Default Quilltap theme tokens CSS (`quilltap-defaults.css`)
- Complete qt-* component classes CSS (`qt-components.css`)
- ThemeDecorator for applying themes in Storybook
- Default preview configuration with theme/color mode toggles
- Comprehensive story components:
  - `ColorPalette` - Theme color token visualization
  - `Typography` - Font families, headings, text styles
  - `Spacing` - Border radius, spacing scale, shadows
  - `Buttons` - All button variants and states
  - `Cards` - Card variants, entity cards, panels
  - `Inputs` - Text inputs, textareas, selects, forms
  - `Badges` - Badge variants including provider badges
  - `Avatars` - Avatar sizes, shapes, status indicators
  - `Dialogs` - Modal/dialog variants with interactions
  - `Tabs` - Tab navigation patterns
  - `Chat` - Chat messages, input, typing indicator
  - `ThemeComparison` - Side-by-side theme comparison
