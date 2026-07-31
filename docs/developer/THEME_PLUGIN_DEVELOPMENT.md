# Quilltap Theme Plugin Development Guide

> **Deprecated:** npm-based theme plugins are deprecated as of Quilltap 3.3. The recommended way to create and distribute themes is the **`.qtap-theme` bundle format** — declarative zip archives containing JSON tokens, CSS, fonts, and images with no build tools required.
>
> To create a new theme using the bundle format:
>
> ```bash
> npx create-quilltap-theme my-theme
> ```
>
> This scaffolds a bundle directory with `theme.json`, `tokens.json`, `styles.css`, and a `fonts/` folder. Edit, zip, and install — no npm, esbuild, or TypeScript needed.
>
> Manage themes via CLI: `npx quilltap themes list|install|uninstall|validate|export|create|search|update`
>
> Browse and install themes from registries in **Settings > Appearance > Browse Themes**.
>
> The guide below is preserved for maintaining existing npm plugin themes.

---

## Bundle Format: Custom Icon Overrides

Theme bundles may replace any of the application's 85 built-in icons by declaring an `icons` map in `theme.json`. Each entry maps a canonical icon name to a bundle-relative asset path (`.svg` or `.webp`):

```json
{
  "icons": {
    "brand":    "icons/brand.webp",
    "settings": "icons/settings.svg",
    "wardrobe": "icons/wardrobe.svg",
    "help":     "icons/help.svg"
  }
}
```

Place assets in an `icons/` directory inside the bundle. `create-quilltap-theme` scaffolds this folder with a commented example. The CLI validator (`npx quilltap themes validate`) checks the map on install.

**Asset modes:**

| Format | Mode | Behaviour |
|--------|------|-----------|
| `.svg` | Mask | Tinted by `currentColor` — inherits hover/active/disabled colours from surrounding CSS |
| `.webp` / other | Image | Full-colour as authored — no tinting; use for baked-palette artwork |

The `brand` icon follows the same extension rule as every other icon: an `.svg` override is masked and tinted; ship the brand mark as `.webp` if it should keep its own colours.

**The `thinking` icon is animated.** It is the quill that rocks while a reply is awaited, while tokens stream, and while a tool call is outstanding — and it is a *separate* name from `brand` precisely so replacing the brand mark doesn't set that mark rocking in the Salon. Overriding the glyph is ordinary; the **motion** is a second, independent hook — the `.qt-thinking-indicator` class in `_chat.css`, whose defaults a theme's CSS can retune:

```css
/* a gentler, slower sweep */
.qt-thinking-indicator {
  --qt-thinking-duration: 2s;
  --qt-thinking-angle-rest: -20deg;
  --qt-thinking-angle-lean: 0deg;
}
```

Re-declaring `animation` on that class outright replaces the rock with whatever the theme prefers (a pulse, a dip, a fade). Honour `prefers-reduced-motion` in any replacement — the default does.

**If you override the glyph, check `--qt-thinking-origin`.** The default is `12.5% 87.5%` — the nib's position in the default glyph, (3,21) of its 24×24 viewBox — so the quill pivots on the point that would be touching the page and the feather swings above it, rather than orbiting its own centre. That origin is a property of *the artwork*, not of the animation: a replacement glyph whose nib sits elsewhere (or that has no nib at all) needs its own value, or the pivot lands on empty space and the whole icon wheels around it.

The default glyph is also drawn on the diagonal, nib to the lower left, which is why the *rest* angle is the negative one — an upright replacement wants both angle variables adjusted. And because a quill is longer than its box is tall, the tip paints slightly outside the element at the upright extreme (~8px on the 48px indicator); nothing clips it, so don't wrap the indicator in an `overflow: hidden` container.

**Canonical icon names:** the complete name list (85 as of 2026-07) is in [`docs/developer/ICON_INVENTORY.md`](./ICON_INVENTORY.md). The authoring reference (grouped catalogue + override recipe) is in `@quilltap/theme-storybook`'s **Icons** story; `create-quilltap-theme` includes it in the scaffolded Storybook. Source of truth for the implemented set: `components/ui/icons/icon-registry.ts` — `IconName` is derived from it.

**CSS mechanics (informational):** the override rules are emitted by `generateIconOverridesCSS` in `lib/themes/utils.ts` and appended by the theme-style-injector into the same unlayered `<style id="quilltap-theme-variables">` block as the token variables. Unlayered rules beat the `@layer components` defaults in `_icons.css` by cascade source order — no new serving route, no additional network requests.

**Authoring notes:**

- Author `.svg` overrides at 24×24 logical pixels. For `.webp`, 2× (48×48 minimum) is recommended for retina display.
- Unrecognised icon names are ignored at runtime. The validator warns on names that fail the kebab-case pattern.
- The `icons` field is also supported in the deprecated npm plugin manifest format (under `themeConfig.icons`) for parity, but the bundle format is the recommended path for new themes.

---

This guide walks you through creating a Quilltap theme plugin from scratch, from an empty directory to publishing on npm.

## Quick Start

Use the scaffolding tool to create a new theme plugin in seconds:

```bash
npm init quilltap-theme my-theme --plugin
```

This creates a complete, ready-to-customize theme plugin. See [create-quilltap-theme](../packages/create-quilltap-theme/README.md) for more options.

If you prefer to set up manually or want to understand all the pieces, continue reading below.

---

## Table of Contents

0. [Quick Start](#quick-start)
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Project Setup](#project-setup)
4. [Required Files](#required-files)
5. [Design Tokens](#design-tokens)
6. [CSS Component Overrides](#css-component-overrides)
7. [Subsystem Overrides](#subsystem-overrides)
8. [Custom Fonts](#custom-fonts)
9. [Storybook Development](#storybook-development)
10. [Building Your Plugin](#building-your-plugin)
11. [Testing Your Theme](#testing-your-theme)
12. [Publishing to npm](#publishing-to-npm)
13. [Complete Example](#complete-example)

---

## Overview

Quilltap themes use a three-tier architecture:

1. **Tier 1 - Design Tokens**: Core variables (colors, fonts, spacing) defined in `tokens.json`
2. **Tier 2 - Component Tokens**: Semantic component variables (button, card, input styles) derived from design tokens
3. **Tier 3 - Component Overrides**: Full CSS customization in `styles.css` for advanced effects

Most themes only need Tier 1 (tokens.json). Tier 3 (styles.css) is optional but allows for custom animations, gradients, and effects.

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** 18 or higher
- **npm** 8 or higher
- An npm account (for publishing)
- Basic knowledge of CSS custom properties and JSON

Install these development tools globally (optional but helpful):

```bash
npm install -g typescript esbuild
```

---

## Project Setup

### Step 1: Create Your Project Directory

Theme plugin names must follow the pattern `qtap-plugin-theme-<name>`. Choose a unique, descriptive name.

```bash
mkdir qtap-plugin-theme-sunset
cd qtap-plugin-theme-sunset
```

### Step 2: Initialize npm Package

```bash
npm init -y
```

### Step 3: Install Dependencies

```bash
# Required for building
npm install --save-dev typescript esbuild

# Quilltap packages for types and utilities
npm install --save-dev @quilltap/plugin-types @quilltap/plugin-utils

# For Storybook development (recommended)
npm install --save-dev @quilltap/theme-storybook storybook @storybook/react @storybook/react-vite
```

### Step 4: Configure package.json

Edit your `package.json`:

```json
{
  "name": "qtap-plugin-theme-sunset",
  "version": "1.0.0",
  "description": "A warm sunset-inspired theme for Quilltap",
  "main": "index.js",
  "types": "index.d.ts",
  "files": [
    "index.js",
    "index.d.ts",
    "manifest.json",
    "tokens.json",
    "styles.css",
    "fonts/",
    "*.png"
  ],
  "scripts": {
    "build": "node esbuild.config.mjs",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  },
  "keywords": [
    "quilltap",
    "quilltap-plugin",
    "quilltap-theme",
    "theme",
    "sunset",
    "warm"
  ],
  "author": "Your Name <you@example.com>",
  "license": "MIT",
  "peerDependencies": {
    "@quilltap/plugin-utils": ">=1.0.0"
  },
  "devDependencies": {
    "@quilltap/plugin-types": "^1.0.0",
    "@quilltap/plugin-utils": "^1.0.0",
    "@quilltap/theme-storybook": "^1.0.0",
    "@storybook/react": "^10.1.11",
    "@storybook/react-vite": "^10.1.11",
    "esbuild": "^0.20.0",
    "storybook": "^10.1.11",
    "typescript": "^5.0.0"
  }
}
```

### Step 5: Create TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": ".",
    "rootDir": "."
  },
  "include": ["index.ts"],
  "exclude": ["node_modules"]
}
```

### Step 6: Create Build Configuration

Create `esbuild.config.mjs`:

```javascript
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',  // CRITICAL: Must be 'cjs' or 'esm', NOT 'iife'
  outfile: 'index.js',
  external: ['@quilltap/plugin-utils'],
  sourcemap: false,
  minify: false,
});

console.log('Build complete: index.js');
```

> **⚠️ CRITICAL: Module Format**
>
> The `format` option **must** be `'cjs'` (CommonJS) or `'esm'` (ES Modules).
>
> **Do NOT use `format: 'iife'`** - this wraps your code in an Immediately Invoked Function Expression that doesn't export anything at the module level. Quilltap uses Node.js `require()` to load plugins, and IIFE-bundled code will appear as an empty object with no exports.
>
> If your plugin isn't loading correctly, check your build output - it should have `module.exports` or `exports` statements, not be wrapped in `(() => { ... })()`.

---

## Required Files

Your theme plugin needs these files at minimum:

```
qtap-plugin-theme-sunset/
├── package.json          # npm package configuration
├── manifest.json         # Quilltap plugin manifest (REQUIRED)
├── index.ts              # Entry point (REQUIRED)
├── tokens.json           # Design tokens (REQUIRED)
├── tsconfig.json         # TypeScript configuration
├── esbuild.config.mjs    # Build configuration
├── styles.css            # Component CSS overrides (optional)
├── fonts/                # Custom font files (optional)
│   └── MyFont.woff2
├── preview.png           # Theme preview image (optional)
└── README.md             # Documentation
```

---

## Plugin Manifest

Create `manifest.json` - this tells Quilltap about your theme:

```json
{
  "name": "qtap-plugin-theme-sunset",
  "title": "Sunset",
  "description": "A warm sunset-inspired theme with orange and pink gradients",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com",
    "url": "https://yourwebsite.com"
  },
  "license": "MIT",
  "main": "index.js",
  "compatibility": {
    "quilltapVersion": ">=2.2.0"
  },
  "capabilities": ["THEME"],
  "category": "THEME",
  "themeConfig": {
    "tokensPath": "tokens.json",
    "stylesPath": "styles.css",
    "supportsDarkMode": true,
    "previewImage": "preview.png",
    "tags": ["warm", "sunset", "orange", "gradient"],
    "fonts": [
      {
        "family": "Nunito",
        "src": "fonts/Nunito-Variable.woff2",
        "weight": "400 700",
        "style": "normal",
        "display": "swap"
      }
    ]
  }
}
```

### Manifest Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Must match pattern `qtap-plugin-theme-<name>` |
| `title` | Yes | Human-readable theme name (shown in UI) |
| `description` | Yes | Brief description of the theme |
| `version` | Yes | Semantic version (e.g., "1.0.0") |
| `author` | Yes | Author name or object with name/email/url |
| `main` | Yes | Entry point file (typically "index.js") |
| `compatibility` | Yes | Minimum Quilltap version |
| `capabilities` | Yes | Must include "THEME" |
| `category` | Yes | Must be "THEME" |
| `themeConfig.tokensPath` | Yes | Path to tokens.json |
| `themeConfig.supportsDarkMode` | Yes | Whether theme has dark mode tokens |
| `themeConfig.stylesPath` | No | Path to CSS overrides file |
| `themeConfig.previewImage` | No | Path to preview image |
| `themeConfig.tags` | No | Keywords for search/filtering |
| `themeConfig.fonts` | No | Custom font definitions |

---

## Design Tokens

Create `tokens.json` with your theme's design system. Both light and dark color palettes are required.

### Complete tokens.json Example

```json
{
  "colors": {
    "light": {
      "background": "hsl(30 60% 97%)",
      "foreground": "hsl(20 30% 15%)",
      "primary": "hsl(25 90% 55%)",
      "primaryForeground": "hsl(0 0% 100%)",
      "secondary": "hsl(330 70% 60%)",
      "secondaryForeground": "hsl(0 0% 100%)",
      "muted": "hsl(30 30% 92%)",
      "mutedForeground": "hsl(20 20% 45%)",
      "accent": "hsl(45 100% 60%)",
      "accentForeground": "hsl(20 30% 15%)",
      "destructive": "hsl(0 70% 55%)",
      "destructiveForeground": "hsl(0 0% 100%)",
      "card": "hsl(30 50% 99%)",
      "cardForeground": "hsl(20 30% 15%)",
      "popover": "hsl(30 50% 99%)",
      "popoverForeground": "hsl(20 30% 15%)",
      "border": "hsl(30 30% 85%)",
      "input": "hsl(30 30% 85%)",
      "ring": "hsl(25 90% 55%)",
      "success": "hsl(140 60% 45%)",
      "successForeground": "hsl(0 0% 100%)",
      "warning": "hsl(45 100% 50%)",
      "warningForeground": "hsl(20 30% 15%)",
      "info": "hsl(200 80% 55%)",
      "infoForeground": "hsl(0 0% 100%)",
      "chatUser": "hsl(25 80% 92%)",
      "chatUserForeground": "hsl(20 30% 15%)"
    },
    "dark": {
      "background": "hsl(20 30% 8%)",
      "foreground": "hsl(30 30% 92%)",
      "primary": "hsl(25 85% 60%)",
      "primaryForeground": "hsl(20 30% 10%)",
      "secondary": "hsl(330 60% 55%)",
      "secondaryForeground": "hsl(0 0% 100%)",
      "muted": "hsl(20 20% 18%)",
      "mutedForeground": "hsl(30 20% 60%)",
      "accent": "hsl(45 90% 55%)",
      "accentForeground": "hsl(20 30% 10%)",
      "destructive": "hsl(0 65% 50%)",
      "destructiveForeground": "hsl(0 0% 100%)",
      "card": "hsl(20 25% 12%)",
      "cardForeground": "hsl(30 30% 92%)",
      "popover": "hsl(20 25% 12%)",
      "popoverForeground": "hsl(30 30% 92%)",
      "border": "hsl(20 20% 22%)",
      "input": "hsl(20 20% 22%)",
      "ring": "hsl(25 85% 60%)",
      "success": "hsl(140 50% 45%)",
      "successForeground": "hsl(0 0% 100%)",
      "warning": "hsl(45 90% 55%)",
      "warningForeground": "hsl(20 30% 10%)",
      "info": "hsl(200 70% 55%)",
      "infoForeground": "hsl(0 0% 100%)",
      "chatUser": "hsl(25 60% 20%)",
      "chatUserForeground": "hsl(30 30% 92%)"
    }
  },
  "typography": {
    "fontSans": "\"Nunito\", \"Inter\", system-ui, sans-serif",
    "fontSerif": "\"Georgia\", \"Times New Roman\", serif",
    "fontMono": "\"Fira Code\", \"Consolas\", monospace",
    "fontSizeXs": "0.75rem",
    "fontSizeSm": "0.875rem",
    "fontSizeBase": "1rem",
    "fontSizeLg": "1.125rem",
    "fontSizeXl": "1.25rem",
    "fontSize2xl": "1.5rem",
    "fontSize3xl": "1.875rem",
    "fontSize4xl": "2.25rem",
    "lineHeightTight": "1.25",
    "lineHeightNormal": "1.5",
    "lineHeightRelaxed": "1.75",
    "fontWeightNormal": "400",
    "fontWeightMedium": "500",
    "fontWeightSemibold": "600",
    "fontWeightBold": "700",
    "letterSpacingTight": "-0.025em",
    "letterSpacingNormal": "0",
    "letterSpacingWide": "0.05em"
  },
  "spacing": {
    "radiusSm": "0.375rem",
    "radiusMd": "0.5rem",
    "radiusLg": "0.75rem",
    "radiusXl": "1rem",
    "radiusFull": "9999px",
    "spacing1": "0.25rem",
    "spacing2": "0.5rem",
    "spacing3": "0.75rem",
    "spacing4": "1rem",
    "spacing5": "1.25rem",
    "spacing6": "1.5rem",
    "spacing8": "2rem",
    "spacing10": "2.5rem",
    "spacing12": "3rem",
    "spacing16": "4rem"
  },
  "effects": {
    "shadowSm": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    "shadowMd": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    "shadowLg": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    "shadowXl": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
    "transitionFast": "150ms",
    "transitionNormal": "200ms",
    "transitionSlow": "300ms",
    "transitionEasing": "cubic-bezier(0.4, 0, 0.2, 1)",
    "focusRingWidth": "2px",
    "focusRingOffset": "2px"
  }
}
```

### Required Color Properties

These color tokens are **required** for both light and dark modes:

| Token | Description |
|-------|-------------|
| `background` | Page/app background |
| `foreground` | Primary text color |
| `primary` | Primary action color (buttons, links) |
| `primaryForeground` | Text on primary color |
| `secondary` | Secondary action color |
| `secondaryForeground` | Text on secondary color |
| `muted` | Muted/subtle backgrounds |
| `mutedForeground` | Text on muted backgrounds |
| `accent` | Accent/highlight color |
| `accentForeground` | Text on accent color |
| `destructive` | Danger/delete actions |
| `destructiveForeground` | Text on destructive color |
| `card` | Card/panel backgrounds |
| `cardForeground` | Text in cards |
| `popover` | Dropdown/popover backgrounds |
| `popoverForeground` | Text in popovers |
| `border` | Border color |
| `input` | Input field borders |
| `ring` | Focus ring color |

### Optional Color Properties

| Token | Description |
|-------|-------------|
| `success` | Success state color |
| `successForeground` | Text on success color |
| `warning` | Warning state color |
| `warningForeground` | Text on warning color |
| `info` | Info state color |
| `infoForeground` | Text on info color |
| `chatUser` | User chat bubble background |
| `chatUserForeground` | Text in user chat bubbles |

---

## Entry Point

Create `index.ts` - this is the JavaScript entry point for your plugin:

```typescript
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-theme-sunset');

/**
 * Initialize the theme plugin.
 * Called when the plugin is loaded.
 */
export function initialize(): void {
  logger.debug('Sunset theme plugin loaded', { version: '1.0.0' });
}

/**
 * Plugin metadata.
 * Must match the manifest.json values.
 */
export const metadata = {
  name: 'qtap-plugin-theme-sunset',
  version: '1.0.0',
  type: 'THEME',
} as const;

export default { initialize, metadata };
```

---

## CSS Component Overrides

For advanced customization, create `styles.css` with component overrides. This uses the `[data-theme="<themeId>"]` selector.

### styles.css Example

```css
/*
 * Sunset Theme - Component Overrides
 * Theme ID: sunset (derived from qtap-plugin-theme-sunset)
 */

[data-theme="sunset"] {
  /* Custom component variables */
  --qt-button-radius: 0.5rem;
  --qt-button-shadow: 0 2px 4px rgba(255, 100, 50, 0.2);

  --qt-card-radius: 0.75rem;
  --qt-card-shadow: 0 4px 12px rgba(255, 100, 50, 0.1);

  --qt-input-radius: 0.5rem;
}

/* Primary button with gradient */
[data-theme="sunset"] .qt-button-primary {
  background: linear-gradient(135deg,
    var(--theme-primary) 0%,
    var(--theme-secondary) 100%
  );
  border: none;
  transition: transform var(--theme-transition-normal) var(--theme-transition-easing),
              box-shadow var(--theme-transition-normal) var(--theme-transition-easing);
}

[data-theme="sunset"] .qt-button-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(255, 100, 50, 0.3);
}

/* Card with subtle glow effect */
[data-theme="sunset"] .qt-card {
  border: 1px solid var(--theme-border);
  box-shadow: 0 4px 12px rgba(255, 100, 50, 0.08);
}

[data-theme="sunset"] .qt-card-interactive:hover {
  box-shadow: 0 8px 24px rgba(255, 100, 50, 0.15);
  transform: translateY(-2px);
}

/* Chat bubbles with warm styling */
[data-theme="sunset"] .qt-chat-bubble-user {
  background: linear-gradient(135deg,
    var(--theme-chat-user) 0%,
    hsl(35 70% 90%) 100%
  );
  border-radius: 1rem 1rem 0.25rem 1rem;
}

[data-theme="sunset"] .qt-chat-bubble-assistant {
  border-radius: 1rem 1rem 1rem 0.25rem;
}

/* Input focus states */
[data-theme="sunset"] .qt-input:focus,
[data-theme="sunset"] .qt-textarea:focus,
[data-theme="sunset"] .qt-select:focus {
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 3px rgba(255, 100, 50, 0.2);
}

/* Dark mode specific overrides */
[data-theme="sunset"].dark .qt-card {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

[data-theme="sunset"].dark .qt-button-primary:hover {
  box-shadow: 0 4px 12px rgba(255, 130, 80, 0.4);
}
```

### Available Component Classes

| Class | Description |
|-------|-------------|
| `.qt-button`, `.qt-button-primary`, `.qt-button-secondary`, `.qt-button-ghost`, `.qt-button-destructive` | Button variants |
| `.qt-button-sm`, `.qt-button-lg`, `.qt-button-icon` | Button sizes |
| `.qt-card`, `.qt-card-header`, `.qt-card-body`, `.qt-card-footer` | Card components |
| `.qt-card-interactive`, `.qt-entity-card`, `.qt-panel` | Card variants |
| `.qt-input`, `.qt-textarea`, `.qt-select` | Form inputs |
| `.qt-badge`, `.qt-badge-primary`, `.qt-badge-secondary`, `.qt-badge-outline` | Badges |
| `.qt-avatar`, `.qt-avatar-sm`, `.qt-avatar-lg`, `.qt-avatar-xl` | Avatars |
| `.qt-dialog`, `.qt-dialog-header`, `.qt-dialog-content`, `.qt-dialog-footer` | Dialogs |
| `.qt-chat-message`, `.qt-chat-bubble`, `.qt-chat-bubble-user`, `.qt-chat-bubble-assistant` | Chat UI |
| `.qt-tabs`, `.qt-tab`, `.qt-tab-active` | Tab navigation |

### Component Variable Reference

Override these variables for consistent component styling:

```css
/* Buttons */
--qt-button-radius
--qt-button-padding-y
--qt-button-padding-x
--qt-button-font-size
--qt-button-font-weight
--qt-button-primary-bg
--qt-button-primary-fg
--qt-button-primary-border
--qt-button-shadow

/* Cards */
--qt-card-radius
--qt-card-padding
--qt-card-shadow
--qt-card-border-width
--qt-card-border-color

/* Inputs */
--qt-input-radius
--qt-input-padding-y
--qt-input-padding-x
--qt-input-bg
--qt-input-fg
--qt-input-border
--qt-input-placeholder
--qt-input-focus-ring
--qt-select-arrow        /* full url() data URI for the <select> chevron */

/* Checkboxes & radios (accent-color is the fill/check hook) */
--qt-checkbox-size
--qt-checkbox-radius
--qt-checkbox-border
--qt-checkbox-accent
--qt-checkbox-focus-ring
--qt-radio-size
--qt-radio-border
--qt-radio-accent
--qt-radio-focus-ring

/* Badges */
--qt-badge-radius
--qt-badge-padding-y
--qt-badge-padding-x
--qt-badge-font-size
--qt-badge-font-weight

/* Terminal (The Ariel terminal pane).
   Terminals keep a "terminal" identity regardless of the surrounding theme's
   light/dark mode, so a parchment theme can still render a dark terminal. */
--qt-terminal-bg
--qt-terminal-fg
--qt-terminal-cursor
--qt-terminal-selection
--qt-terminal-ansi-black         /* ...and red/green/yellow/blue/magenta/cyan/white */
--qt-terminal-ansi-bright-black  /* ...and the seven matching bright- variants */

/* Terminal, optional. Leave unset and xterm derives each from
   --qt-terminal-bg / --qt-terminal-fg (slider colors default to the
   foreground at 20/40/50% opacity). Set one only to override that. */
--qt-terminal-cursor-accent      /* text under a block cursor */
--qt-terminal-selection-fg       /* text inside a selection */
--qt-terminal-selection-inactive /* selection while the pane is unfocused */
--qt-terminal-scrollbar          /* scrollbar slider */
--qt-terminal-scrollbar-hover    /* scrollbar slider, hovered */
--qt-terminal-scrollbar-active   /* scrollbar slider, dragged */
```

---

## Subsystem Overrides

Themes can rename, re-describe, and replace images for any of the 9 Foundry subsystem pages. This is useful for themes that want plainer labels (e.g., "Image Generation" instead of "The Lantern") or custom artwork.

### In index.ts (Module-Based Themes)

Add the `subsystems` property to your `ThemePlugin` export:

```typescript
import type { ThemePlugin } from '@quilltap/plugin-types';

export const plugin: ThemePlugin = {
  metadata: { /* ... */ },
  tokens: { /* ... */ },

  subsystems: {
    lantern: {
      name: 'Image Generation',
      description: 'Image profiles and story background settings',
      thumbnail: 'images/my-lantern-thumb.jpg',   // relative to plugin root
      backgroundImage: 'images/my-lantern-bg.png', // relative to plugin root
    },
    foundry: {
      name: 'Settings',
    },
  },
};
```

### In manifest.json (File-Based Themes)

Add the `subsystems` field inside `themeConfig`:

```json
{
  "themeConfig": {
    "tokensPath": "tokens.json",
    "supportsDarkMode": true,
    "subsystems": {
      "lantern": {
        "name": "Image Generation"
      },
      "salon": {
        "name": "Chat Settings"
      }
    }
  }
}
```

### Subsystem IDs

| ID | Default Name |
|----|-------------|
| `foundry` | The Foundry |
| `aurora` | Aurora |
| `forge` | The Forge |
| `salon` | The Salon |
| `commonplace-book` | The Commonplace Book |
| `prospero` | Prospero |
| `concierge` | The Concierge |
| `calliope` | Calliope |
| `lantern` | The Lantern |
| `pascal` | Pascal the Croupier |
| `saquel` | Saquel Ytzama the Keeper of Secrets |

### Override Fields

| Field | Description |
|-------|-------------|
| `name` | Display name shown in headings, breadcrumbs, and sidebar |
| `description` | Short description shown below the heading |
| `thumbnail` | Image on the Foundry hub card (URL, data URI, or relative path) |
| `backgroundImage` | Full-page background on the subsystem page (URL, data URI, or relative path) |

Relative image paths are automatically resolved to the theme's asset route (`/api/themes/assets/<pluginName>/<path>`). Include the image files in your plugin's `package.json` `files` array.

### CSS Card Customization

The Foundry hub cards also support CSS customization via the existing `cssOverrides` mechanism (Tier 3). Target these classes:

- `.qt-foundry-card` --- the card container
- `.qt-foundry-card-image` --- the thumbnail image area
- `.qt-foundry-card-content` --- the text content area

```css
[data-theme="mytheme"] .qt-foundry-card {
  border-radius: 1rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

[data-theme="mytheme"] .qt-foundry-card-image {
  filter: sepia(0.3);
}
```

---

## Custom Fonts

To include custom fonts in your theme:

### Step 1: Add Font Files

Create a `fonts/` directory and add your font files (WOFF2 recommended):

```
fonts/
├── Nunito-Variable.woff2
└── FiraCode-Regular.woff2
```

### Step 2: Configure in Manifest

Add font definitions to `manifest.json`:

```json
{
  "themeConfig": {
    "fonts": [
      {
        "family": "Nunito",
        "src": "fonts/Nunito-Variable.woff2",
        "weight": "400 700",
        "style": "normal",
        "display": "swap"
      },
      {
        "family": "Fira Code",
        "src": "fonts/FiraCode-Regular.woff2",
        "weight": "400",
        "style": "normal",
        "display": "swap"
      }
    ]
  }
}
```

### Step 3: Reference in Tokens

Use your font family in `tokens.json`:

```json
{
  "typography": {
    "fontSans": "\"Nunito\", \"Inter\", system-ui, sans-serif",
    "fontMono": "\"Fira Code\", \"Consolas\", monospace"
  }
}
```

### Font Definition Properties

| Property | Required | Description |
|----------|----------|-------------|
| `family` | Yes | Font family name |
| `src` | Yes | Path to font file (relative to plugin root) |
| `weight` | No | Font weight or range (e.g., "400", "400 700") |
| `style` | No | Font style ("normal" or "italic") |
| `display` | No | Font-display strategy ("swap" recommended) |

---

## Storybook Development

Use Storybook to preview and develop your theme with live reloading.

### Step 1: Create Storybook Configuration

Create `.storybook/main.ts`:

```typescript
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
};

export default config;
```

Create `.storybook/preview.ts`:

```typescript
import type { Preview } from '@storybook/react';
import { defaultPreview } from '@quilltap/theme-storybook';

// Import base styles
import '@quilltap/theme-storybook/css/quilltap-defaults.css';
import '@quilltap/theme-storybook/css/qt-components.css';

// Import your theme styles
import '../styles.css';

// Create custom preview that includes your theme
const preview: Preview = {
  ...defaultPreview,
  globalTypes: {
    ...defaultPreview.globalTypes,
    theme: {
      description: 'Theme',
      defaultValue: 'sunset',
      toolbar: {
        title: 'Theme',
        items: [
          { value: 'default', title: 'Quilltap Default' },
          { value: 'sunset', title: 'Sunset' },
        ],
        dynamicTitle: true,
      },
    },
  },
};

export default preview;
```

### Step 2: Create Theme Provider Decorator

Create `.storybook/ThemeProvider.tsx`:

```tsx
import React, { useEffect } from 'react';
import type { Decorator } from '@storybook/react';
import tokens from '../tokens.json';

// Convert tokens to CSS variables
function tokensToCSSVariables(tokens: any, mode: 'light' | 'dark'): string {
  const vars: string[] = [];
  const colors = tokens.colors[mode];

  // Color tokens
  for (const [key, value] of Object.entries(colors)) {
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    vars.push(`--theme-${cssKey}: ${value};`);
  }

  // Typography tokens
  if (tokens.typography) {
    for (const [key, value] of Object.entries(tokens.typography)) {
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      vars.push(`--theme-${cssKey}: ${value};`);
    }
  }

  // Spacing tokens
  if (tokens.spacing) {
    for (const [key, value] of Object.entries(tokens.spacing)) {
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      vars.push(`--theme-${cssKey}: ${value};`);
    }
  }

  // Effects tokens
  if (tokens.effects) {
    for (const [key, value] of Object.entries(tokens.effects)) {
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      vars.push(`--theme-${cssKey}: ${value};`);
    }
  }

  return vars.join('\n');
}

export const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme || 'default';
  const colorMode = context.globals.colorMode || 'light';
  const isDark = colorMode === 'dark';

  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'sunset') {
      root.setAttribute('data-theme', 'sunset');

      // Inject CSS variables
      let styleEl = document.getElementById('sunset-theme-vars');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'sunset-theme-vars';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `:root { ${tokensToCSSVariables(tokens, isDark ? 'dark' : 'light')} }`;
    } else {
      root.removeAttribute('data-theme');
    }

    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme, colorMode]);

  return (
    <div
      data-theme={theme === 'sunset' ? 'sunset' : undefined}
      className={isDark ? 'dark' : ''}
      style={{
        backgroundColor: 'var(--theme-background)',
        color: 'var(--theme-foreground)',
        padding: '2rem',
        minHeight: '100vh',
      }}
    >
      <Story />
    </div>
  );
};
```

Update `.storybook/preview.ts` to use the decorator:

```typescript
import { withTheme } from './ThemeProvider';

const preview: Preview = {
  // ... other config
  decorators: [withTheme],
};
```

### Step 3: Create Stories

Create `stories/` directory with stories for each component type:

Create `stories/Components.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import {
  ColorPalette,
  Typography,
  Spacing,
  Buttons,
  Cards,
  Inputs,
  Badges,
  Chat,
} from '@quilltap/theme-storybook/stories';

// Color Palette
export const Colors: StoryObj = {
  render: () => <ColorPalette />,
};

// Typography
export const Fonts: StoryObj = {
  render: () => <Typography />,
};

// Spacing & Effects
export const SpacingEffects: StoryObj = {
  render: () => <Spacing />,
};

// Buttons
export const ButtonComponents: StoryObj = {
  render: () => <Buttons />,
};

// Cards
export const CardComponents: StoryObj = {
  render: () => <Cards />,
};

// Inputs
export const InputComponents: StoryObj = {
  render: () => <Inputs />,
};

// Badges
export const BadgeComponents: StoryObj = {
  render: () => <Badges />,
};

// Chat UI
export const ChatComponents: StoryObj = {
  render: () => <Chat />,
};

const meta: Meta = {
  title: 'Sunset Theme',
};

export default meta;
```

### Step 4: Run Storybook

```bash
npm run storybook
```

This opens Storybook at http://localhost:6006 where you can:
- Toggle between your theme and the default
- Switch between light and dark modes
- Preview all component styles
- Make changes and see live updates

---

## Building Your Plugin

### Build for Distribution

```bash
npm run build
```

This compiles `index.ts` to `index.js`.

### Verify Build Output

Your plugin directory should contain:

```
qtap-plugin-theme-sunset/
├── index.js              # Compiled entry point (generated)
├── index.ts              # Source entry point
├── manifest.json         # Plugin manifest
├── tokens.json           # Design tokens
├── styles.css            # CSS overrides
├── package.json          # npm configuration
├── fonts/                # Custom fonts (if any)
│   └── Nunito-Variable.woff2
├── preview.png           # Preview image (if any)
└── README.md             # Documentation
```

---

## Testing Your Theme

### Test Locally in Quilltap

1. In your Quilltap installation, create a symlink:

```bash
cd /path/to/quilltap/plugins/installed
ln -s /path/to/qtap-plugin-theme-sunset qtap-plugin-theme-sunset
```

2. Restart Quilltap

3. Go to Settings > Appearance and select your theme

### Verify Token Coverage

Check that all required color tokens are present:

```bash
node -e "
const tokens = require('./tokens.json');
const required = [
  'background', 'foreground', 'primary', 'primaryForeground',
  'secondary', 'secondaryForeground', 'muted', 'mutedForeground',
  'accent', 'accentForeground', 'destructive', 'destructiveForeground',
  'card', 'cardForeground', 'popover', 'popoverForeground',
  'border', 'input', 'ring'
];
const missing = {
  light: required.filter(k => !tokens.colors.light[k]),
  dark: required.filter(k => !tokens.colors.dark[k])
};
if (missing.light.length || missing.dark.length) {
  console.log('Missing tokens:', missing);
  process.exit(1);
}
console.log('All required tokens present!');
"
```

### Validate Manifest

```bash
node -e "
const manifest = require('./manifest.json');
const required = ['name', 'title', 'version', 'main', 'capabilities', 'themeConfig'];
const missing = required.filter(k => !manifest[k]);
if (missing.length) {
  console.error('Missing manifest fields:', missing);
  process.exit(1);
}
if (!manifest.name.startsWith('qtap-plugin-theme-')) {
  console.error('Name must start with qtap-plugin-theme-');
  process.exit(1);
}
if (!manifest.capabilities.includes('THEME')) {
  console.error('capabilities must include THEME');
  process.exit(1);
}
console.log('Manifest valid!');
"
```

---

## Publishing to npm

### Step 1: Prepare for Publishing

1. Update `README.md` with:
   - Theme description and screenshots
   - Installation instructions
   - Color palette preview
   - License information

2. Add a preview image (`preview.png`) showing your theme

3. Verify `package.json` has correct metadata:
   - `name` matches manifest name
   - `version` matches manifest version
   - `files` array includes all necessary files
   - `keywords` includes "quilltap", "quilltap-plugin", "quilltap-theme"

### Step 2: Test Package Contents

```bash
# Preview what will be published
npm pack --dry-run

# Create a tarball to inspect
npm pack
tar -tzf qtap-plugin-theme-sunset-1.0.0.tgz
```

### Step 3: Login to npm

```bash
npm login
```

### Step 4: Publish

```bash
# For first publish
npm publish --access public

# For updates
npm version patch  # or minor, major
npm publish
```

### Step 5: Verify Publication

```bash
npm info qtap-plugin-theme-sunset
```

Users can now install your theme:

```bash
# In Quilltap Settings > Plugins, search for your theme
# Or via CLI:
npm install qtap-plugin-theme-sunset
```

---

## Complete Example

Here's a minimal but complete theme plugin structure:

### Directory Structure

```
qtap-plugin-theme-minimal/
├── package.json
├── manifest.json
├── index.ts
├── tokens.json
├── esbuild.config.mjs
├── tsconfig.json
└── README.md
```

### package.json

```json
{
  "name": "qtap-plugin-theme-minimal",
  "version": "1.0.0",
  "description": "A minimal example Quilltap theme",
  "main": "index.js",
  "files": ["index.js", "manifest.json", "tokens.json"],
  "scripts": {
    "build": "node esbuild.config.mjs"
  },
  "keywords": ["quilltap", "quilltap-plugin", "quilltap-theme"],
  "author": "Your Name",
  "license": "MIT",
  "peerDependencies": {
    "@quilltap/plugin-utils": ">=1.0.0"
  },
  "devDependencies": {
    "@quilltap/plugin-types": "^1.0.0",
    "@quilltap/plugin-utils": "^1.0.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.0.0"
  }
}
```

### manifest.json

```json
{
  "name": "qtap-plugin-theme-minimal",
  "title": "Minimal",
  "description": "A minimal example theme",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.js",
  "compatibility": { "quilltapVersion": ">=2.2.0" },
  "capabilities": ["THEME"],
  "category": "THEME",
  "themeConfig": {
    "tokensPath": "tokens.json",
    "supportsDarkMode": true
  }
}
```

### index.ts

```typescript
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-theme-minimal');

export function initialize(): void {
  logger.debug('Minimal theme loaded');
}

export const metadata = {
  name: 'qtap-plugin-theme-minimal',
  version: '1.0.0',
  type: 'THEME',
} as const;

export default { initialize, metadata };
```

### tokens.json

```json
{
  "colors": {
    "light": {
      "background": "hsl(0 0% 100%)",
      "foreground": "hsl(0 0% 10%)",
      "primary": "hsl(220 90% 50%)",
      "primaryForeground": "hsl(0 0% 100%)",
      "secondary": "hsl(220 20% 50%)",
      "secondaryForeground": "hsl(0 0% 100%)",
      "muted": "hsl(0 0% 95%)",
      "mutedForeground": "hsl(0 0% 45%)",
      "accent": "hsl(220 90% 95%)",
      "accentForeground": "hsl(220 90% 50%)",
      "destructive": "hsl(0 70% 50%)",
      "destructiveForeground": "hsl(0 0% 100%)",
      "card": "hsl(0 0% 100%)",
      "cardForeground": "hsl(0 0% 10%)",
      "popover": "hsl(0 0% 100%)",
      "popoverForeground": "hsl(0 0% 10%)",
      "border": "hsl(0 0% 90%)",
      "input": "hsl(0 0% 90%)",
      "ring": "hsl(220 90% 50%)"
    },
    "dark": {
      "background": "hsl(0 0% 8%)",
      "foreground": "hsl(0 0% 95%)",
      "primary": "hsl(220 80% 60%)",
      "primaryForeground": "hsl(0 0% 10%)",
      "secondary": "hsl(220 15% 45%)",
      "secondaryForeground": "hsl(0 0% 95%)",
      "muted": "hsl(0 0% 15%)",
      "mutedForeground": "hsl(0 0% 60%)",
      "accent": "hsl(220 50% 20%)",
      "accentForeground": "hsl(220 80% 60%)",
      "destructive": "hsl(0 60% 45%)",
      "destructiveForeground": "hsl(0 0% 95%)",
      "card": "hsl(0 0% 12%)",
      "cardForeground": "hsl(0 0% 95%)",
      "popover": "hsl(0 0% 12%)",
      "popoverForeground": "hsl(0 0% 95%)",
      "border": "hsl(0 0% 20%)",
      "input": "hsl(0 0% 20%)",
      "ring": "hsl(220 80% 60%)"
    }
  }
}
```

### Build and Test

```bash
npm install
npm run build
# Creates index.js - your theme is ready!
```

---

## Troubleshooting

### Theme Not Appearing

1. Check manifest.json has `"capabilities": ["THEME"]`
2. Verify `main` field points to `index.js`
3. Ensure `themeConfig.tokensPath` points to valid JSON file
4. Check Quilltap logs for loading errors

### CSS Overrides Not Working

1. Verify selector uses correct theme ID: `[data-theme="yourthemeid"]`
2. Theme ID is derived from name: `qtap-plugin-theme-sunset` → `sunset`
3. Check that `themeConfig.stylesPath` is set in manifest
4. Ensure CSS file is included in `package.json` `files` array

### Fonts Not Loading

1. Verify font files exist at paths specified in manifest
2. Check font paths are relative to plugin root
3. Ensure fonts are included in `package.json` `files` array
4. Check browser console for 404 errors on font URLs

### Colors Look Wrong

1. Use HSL format for consistency: `hsl(220 90% 50%)`
2. Ensure both light and dark palettes are complete
3. Check for typos in color token names
4. Verify colors have sufficient contrast

---

## Resources

- [Quilltap Plugin Manifest Reference](./PLUGIN_MANIFEST.md)
- [@quilltap/plugin-types Package](../packages/plugin-types/README.md)
- [@quilltap/theme-storybook Package](../packages/theme-storybook/README.md)
- [HSL Color Picker](https://hslpicker.com/)
- [Contrast Checker](https://webaim.org/resources/contrastchecker/)
