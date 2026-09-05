# Changelog

All notable changes to this package will be documented in this file.

## [2.0.19] - 2026-08-30

### Added
- Bundle `styles.css` template: commented `--qt-range-accent` / `--qt-range-focus-ring` scaffold for the new `.qt-range` slider class, with a note on what overriding `.qt-range` with `appearance: none` costs.
- Theme-development doc template: the two range tokens in the overridable-variable reference.

## [2.0.13] - 2026-06-14

### Added
- Bundle `styles.css` template: commented `--qt-roleplay-1..4-bg/fg` scaffold so theme authors can dress the four high-contrast roleplay-template chips in their own hues. The semantic chips (`qt-roleplay-danger/warning/success/info/muted/code`) follow the theme's `--color-*` tokens and need no overrides.

## [2.0.12] - 2026-06-10

### Changed
- Bundle README template: the `brand` note reflects the app-side rule change — an `.svg` brand override is tinted like any other icon; ship `.webp` to keep its own colors.

## [2.0.11] - 2026-06-09

### Added
- Scaffolded bundles now include an `icons/` folder (with a commented example) for icon overrides, mirroring `fonts/`. The bundle README documents the optional `icons` manifest map and the `.svg` (theme-tinted) vs `.webp` (full-color) override modes.
- The scaffolded Storybook stories now include the `Icons` reference story from `@quilltap/theme-storybook`.

## [2.0.10] - 2026-06-04

### Added
- Component variable reference and bundle `styles.css` template now document the newly tokenized controls: `--qt-select-arrow` (full `url()` chevron), `--qt-checkbox-*`, and `--qt-radio-*`, plus the previously-omitted `--qt-input-bg/fg/placeholder/focus-ring`. Scaffolded themes now learn that checkboxes, radios, and the select chevron are overridable.

## [2.0.0] - 2026-03-06

### Changed

- Default output format is now `.qtap-theme` bundle (declarative directory with `theme.json`, `tokens.json`, `styles.css`, and `fonts/`)
- Legacy npm plugin format available via `--plugin` flag
- Bundle format requires no build tools, npm packages, or TypeScript

### Added

- Bundle directory templates (`theme.json.template`, `styles.css.template`, `README.md.template`)
- `--plugin` flag for legacy npm plugin scaffolding

## [1.0.4] - 2026-01-01

### Added

- Document avatar CSS variables (`--qt-avatar-name-fg`, `--qt-avatar-title-fg`) in styles.css template

## [1.0.3] - 2025-12-31

### Added

- Document left sidebar CSS variables in styles.css template
- Document app header CSS variables in styles.css template

## [1.0.2] - 2025-12-31

### Fixed

- Add missing `@storybook/addon-essentials` to devDependencies in scaffolded projects

## [1.0.1] - 2025-12-31

### Added

- Include complete theme development guide (`docs/THEME_PLUGIN_DEVELOPMENT.md`) in every scaffolded theme
- Updated help output to show docs folder in project structure
- Added local documentation reference in post-scaffold instructions

## [1.0.0] - 2025-12-31

### Added

- Initial release
- Interactive CLI for scaffolding Quilltap theme plugins
- Template generation for:
  - package.json with correct dependencies
  - manifest.json with theme configuration
  - tokens.json with full color palette (light/dark)
  - index.ts entry point
  - styles.css for component overrides (optional)
  - Storybook setup (optional)
- Support for `--yes` flag to skip prompts
- Color-coded terminal output
- Customizable primary color
