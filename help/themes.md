---
url: /settings?tab=appearance&section=appearance
---

# Themes

> **[Open this page in Quilltap](/settings?tab=appearance&section=appearance)**

Themes control the overall look and feel of Quilltap, including colors, fonts, and visual styling. You can switch between the built-in default theme and custom themes installed as plugins or `.qtap-theme` bundles, and customize your preferred color mode (light, dark, or system).

## What Are Themes?

A theme is a complete visual design for Quilltap that includes:

- **Color scheme** — Primary, secondary, accent, and background colors for light and dark modes
- **Typography** — Font families used for headings and body text
- **Component styles** — Visual appearance of buttons, cards, inputs, and other UI elements
- **Icon overrides** — Custom glyphs replacing any of the application's standard icons (`.qtap-theme` bundles only)
- **Dark mode support** — Some themes provide separate styling for light and dark modes

Quilltap comes with a built-in default theme and can be extended with custom themes installed as plugins or uploaded as `.qtap-theme` bundles.

## Available Themes

### Default Theme

Quilltap includes a carefully designed default theme featuring:

- A clean, professional color palette
- Excellent readability in both light and dark modes
- Consistent component styling
- Optimized for creative work and long writing sessions

The default theme is always available and serves as a fallback if no other theme is selected.

### Plugin Themes

Additional themes can be installed as plugins to provide alternative visual styles:

- Custom color palettes and design languages
- Specialized fonts and typography
- Themed components
- Additional customization options

Check your installed plugins to see available themes.

### Theme Bundles (.qtap-theme)

Theme bundles are a simpler way to distribute and install themes. A `.qtap-theme` file is a zip archive containing:

- **theme.json** — Theme manifest with metadata and design tokens
- **CSS files** — Optional style overrides
- **Font files** — Custom fonts (.woff2, .ttf, etc.)
- **Image assets** — Preview images and other assets

Theme bundles require no build tools, npm packages, or JavaScript code -- they are purely declarative, containing only static assets and configuration.

#### Installing a Theme Bundle

1. Open **Settings** from the sidebar
2. Go to the **Appearance** tab
3. Click the **Install Theme** button
4. Select a `.qtap-theme` file from your computer
5. The theme appears in your theme list immediately

#### Uninstalling a Theme Bundle

Bundle themes can be uninstalled from the Appearance settings:

1. Find the bundle theme in your theme list (marked with a "Bundle" badge)
2. Click its **Preview** button to open the preview window
3. Click the trash icon to uninstall
4. The theme is removed from your system

Note: Plugin themes and the built-in default theme cannot be uninstalled from this interface.

#### Exporting a Theme

Any installed theme (including plugin themes and the default) can be exported as a `.qtap-theme` bundle:

1. Find the theme in your theme list
2. Click its **Preview** button to open the preview window
3. Click the download/export icon
4. Save the `.qtap-theme` file to your computer
5. Share it with others or use it as a starting point for a new theme

## Color Modes

In addition to choosing a theme, you can select your preferred **color mode**:

### Light Mode

- Bright background with dark text
- Better for well-lit environments
- Reduces eye strain in daylight
- Use when you prefer a clean, bright interface

### Dark Mode

- Dark background with light text
- Better for low-light environments
- Reduces blue light exposure
- Use when you prefer a darker interface for evening work

### System Mode

- Automatically matches your operating system preference
- Switches when your OS switches between light and dark
- No manual switching needed
- Recommended for most users

## Changing Your Theme

### Quick Theme Switcher

The theme quick-switcher is a convenient way to change themes from the sidebar:

1. Look at the **sidebar footer** (bottom left of the screen)
2. Find the **palette icon** (paintbrush/colors)
3. Click to open the theme menu
4. Select a theme from the list
5. Your theme changes instantly

The quick-switcher only appears if you've enabled it in Settings (see below).

### Through Settings

You can also change themes in the Appearance settings:

1. Open **Settings** from the sidebar
2. Go to the **Appearance** tab
3. In the **Theme Selection** section, choose your preferred theme
4. See a preview of the selected theme
5. Changes apply immediately

### Through the Menu

When the quick-switcher is enabled:

1. Click the palette icon in the sidebar footer
2. See all available themes with color previews
3. Click any theme to switch
4. See color mode options below the themes
5. Click to change light/dark/system preference

## Theme Quick-Switcher Feature

The theme quick-switcher is an optional sidebar button that gives you instant access to theme and color mode selection.

### Enabling the Quick-Switcher

1. Open **Settings** from the sidebar
2. Go to the **Appearance** tab
3. Find the **Show theme selector in navigation** toggle
4. Turn it **ON**
5. The palette icon appears in the sidebar footer

### Disabling the Quick-Switcher

1. Open **Settings** → **Appearance**
2. Find the **Show theme selector in navigation** toggle
3. Turn it **OFF**
4. The palette icon disappears from the sidebar

### Using the Quick-Switcher

When enabled:

1. **Locate the icon** — Look for the palette (paintbrush/colors) icon in the sidebar footer
2. **Click to open** — Click the icon to open the theme menu
3. **Select a theme** — Click any theme name to switch instantly
4. **See colors** — Each theme shows color swatches for preview
5. **Change color mode** — Below themes, toggle between Light, Dark, and System modes
6. **Close menu** — Click elsewhere or press Escape to close

### Theme Quick-Switcher Features

- **Color previews** — See the theme's primary colors before switching
- **Font preview** — Theme names display in the theme's heading font
- **Current theme indicator** — The active theme shows a checkmark
- **Color mode options** — Quick access to light/dark/system modes
- **Instant switching** — Changes apply immediately
- **Mobile friendly** — Works on all screen sizes
- **Collapsible sidebar** — Icon-only view in collapsed sidebar mode

## Understanding Your Theme

### Color Scheme

Each theme includes colors for:

- **Background** — The main background color for pages and components
- **Foreground** — Text and primary content color
- **Primary** — Accent color for important UI elements, buttons, links, and the filled portion of sliders
- **Secondary** — Additional accent color for supporting elements
- **Accent** — Highlight color for special elements
- **Muted** — Subtle colors for borders, dividers, and less important content
- **Destructive** — Warning/danger color for actions like delete
- **Success, Warning, Info** — Semantic colors for feedback messages

### Light and Dark Mode Support

Themes provide colors for both modes:

- **Light mode colors** — Optimized for bright backgrounds
- **Dark mode colors** — Optimized for dark backgrounds

When you switch your color mode, the same theme's colors for that mode apply automatically.

### Typography

Themes specify:

- **Heading font** — For titles and section headers
- **Body font** — For regular text and content
- **Monospace font** — For code and technical text

Custom fonts are loaded automatically when you select a theme.

## Managing Themes in Settings

### Appearance Settings

The **Appearance** tab in Settings gives you full control:

- **Theme Selection** — Choose from default and installed plugin themes
- **Theme Preview** — See how each theme looks
- **Color Mode** — Light, Dark, or System preference
- **Quick-Switcher Toggle** — Enable/disable the sidebar quick-switcher

### Theme Details

For each theme, you can see:

- **Theme name** — The display name of the theme
- **Description** — What makes this theme unique
- **Color preview** — Sample colors in the theme's palette
- **Dark mode support** — Whether the theme supports dark mode
- **Active indicator** — Shows which theme is currently active

### Previewing a Theme

Every theme on the shelf wears a small **Preview** button, and pressing it throws open a full-page viewing window — a proper showroom rather than a keyhole. Within, you will find:

- **A banner in the theme's own livery** — the theme's background color, with the lettering automatically set to whichever shade (ivory or ink) reads most legibly against it. No more squinting at pale text on a brilliant ground.
- **A Light / Dark switch** — flip between the two to see how the theme comports itself in either light. (Themes that keep no evening wardrobe show only the Light setting.)
- **A live sampler** — genuine headings, buttons, inputs, badges, and a card, all dressed in the theme's colors and fonts, so you may judge the cut before committing.
- **A gallery of the theme's bundled images** — any preview image and the backdrops it hangs in Quilltap's principal halls, arranged alphabetically over a faint checkerboard so transparent artwork reads clearly. A theme that bundles no imagery simply says so.
- **A sheet of the theme's re-cut icons** — should the theme replace any of Quilltap's standard glyphs, each appears here in four guises (ordinary, muted, hovered, and set upon a colored button), with its name printed beneath in plain type for easy copying. A theme that leaves the icons alone says as much.

From the banner you may **Apply** the theme outright, **Export** it as a `.qtap-theme` bundle, or — for bundle themes not presently in use — **Uninstall** it. Close the window by the **×**, the Escape key, or a click upon the surrounding gloom; nothing is committed until you press **Apply**.

## Color Modes Explained

### System Mode (Recommended)

- **What it does** — Follows your computer's light/dark preference
- **When to use** — Most of the time; best for automatic consistency
- **How it works** — Quilltap detects your OS preference and switches automatically
- **Mobile** — Most phones default to light mode during day, dark at night

### Light Mode

- **When to use** — During daytime or in well-lit environments
- **Advantages** — Bright, clear interface; reduced eye strain in daylight
- **Note** — May cause glare on dark screens or in dim lighting

### Dark Mode

- **When to use** — At night or in low-light environments
- **Advantages** — Reduced blue light; comfortable for evening use
- **Note** — Some users prefer it all the time for comfort

## Custom Themes

### Installing Theme Plugins (Deprecated)

> **Note:** npm-based theme plugins are deprecated. We recommend using `.qtap-theme` bundles instead — they require no build tools or npm packages.

Custom themes were historically distributed as npm packages. Existing plugin themes still work, but new themes should use the bundle format. Plugin themes are marked with a "(deprecated)" badge in the theme selector.

### Installing Theme Bundles

The simplest way to install a custom theme:

1. Obtain a `.qtap-theme` file
2. Open **Settings** > **Appearance**
3. Click **Install Theme** and select the file
4. The theme is instantly available

### Creating Your Own Theme

The recommended way to create a theme is the `.qtap-theme` bundle format:

```bash
npx create-quilltap-theme my-theme
```

This scaffolds a directory with `theme.json`, `tokens.json`, `styles.css`, and a `fonts/` folder — no build tools, no npm packages, no TypeScript. Just edit JSON and CSS, then zip and install.

For the legacy npm plugin format (deprecated), use:

```bash
npx create-quilltap-theme my-theme --plugin
```

See the **Theme Plugin Development Guide** for details on the plugin format.

### Custom Icons

Beyond the customary palette and typography, `.qtap-theme` bundles may declare their own icon artwork — replacing any of the application's eighty standard glyphs with designs of the author's own devising. When the theme is active, the substitution is instantaneous and entirely silent: no reload, no ceremony, simply a different glyph appearing in the expected place.

For a demonstration of the form taken to its logical conclusion, activate the bundled **Madman's Box** theme: every last glyph in the house has been re-cut to its specifications — brass clockwork, sharp corners, and not a rounded cap in sight.

#### Declaring Icon Overrides

In your `theme.json`, add an `icons` record mapping each icon's name to a bundle-relative asset path:

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

Names must correspond to entries in Quilltap's canonical icon list — the complete catalogue appears in the **Icons** story of `@quilltap/theme-storybook`, which the `create-quilltap-theme` scaffold includes in its Storybook setup automatically. Icons not declared in the map are left at their defaults; the entire list need not be addressed, only those whose default glyph the theme wishes to improve upon.

#### Two Modes of Replacement

The file format governs how the replacement is rendered:

- **`.svg` files** are painted in *mask mode*: the glyph is tinted by the surrounding text colour (`currentColor`). Ideal for clean monochrome line drawings that should harmonise with the theme's foreground, active, or muted states — the icon responds to hover and disabled colouring exactly as a stock glyph would. Passing splendidly in polite society, one might say.
- **`.webp` files** (and other non-SVG formats) are displayed in *image mode*: the artwork is shown exactly as authored, colours unchanged by the interface. Well-suited to icons that carry their own palette — a brass-inlaid quill, a hand-lettered monogram, or an illustration that must retain its specific hue regardless of what the surrounding typography is doing.

The `brand` icon obeys the same rule as the rest of the company: an `.svg` brand mark is tinted along with everything else, while a `.webp` brand mark keeps its own colours. Should your masthead insist upon arriving in full regalia — gilt, enamel, and all — supply it as `.webp`; supply it as `.svg` and it will dress to match the room.

#### Validating Icon Overrides

The `npx quilltap themes validate` command checks the `icons` block as part of its inspection — it confirms that asset paths end in `.svg` or `.webp`, contain no suspicious traversal sequences, and that the values are non-empty. Icon names that fail the kebab-case convention receive a warning rather than an error, given that future Quilltap releases may extend the canonical list.

### Page Backgrounds

Each of Quilltap's principal halls keeps a faint backdrop behind its furniture — Aurora has its portrait gallery, the Salon its parlour, the Scriptorium its stacks, and so on, with the Settings page changing its scene to suit whichever tab is presently in hand. Like the icons, these backdrops are yours to redress. A theme may hang its own painting in any of these rooms, or strip the walls bare entirely, and the swap is as silent and immediate as the rest.

#### Declaring Background Overrides

In your `theme.json`, add a `subsystems` record. Each key names a Quilltap subsystem; each value supplies a `backgroundImage` pointing at a bundle-relative asset:

```json
{
  "subsystems": {
    "aurora":           { "backgroundImage": "textures/aurora-bg.webp" },
    "prospero":         { "backgroundImage": "textures/prospero-bg.webp" },
    "salon":            { "backgroundImage": "textures/salon-bg.webp" },
    "commonplace-book": { "backgroundImage": "textures/commonplace-book-bg.webp" },
    "scriptorium":      { "backgroundImage": "textures/scriptorium-bg.webp" },
    "lantern":          { "backgroundImage": "textures/lantern-bg.webp" }
  }
}
```

The subsystem keys are Quilltap's own — `aurora` (Characters), `prospero` (Projects), `salon` (Chats), `commonplace-book` (Files; note the hyphen), `scriptorium` (Document Stores), and `lantern` (Photos), among others. Only the rooms you name are re-papered; any subsystem left unmentioned keeps the house default, so a theme need address only those backdrops it wishes to improve upon.

Bundle-relative paths (`textures/…`) resolve to the theme's own assets exactly as icon paths do; a fully-rooted `/path`, an `http(s)://` URL, or a `data:` URI is honoured as written. The art is painted at a polite low opacity behind the page's contents, so a sympathetic, unhurried image serves best.

#### Suppressing a Background

To leave a particular room's walls bare — no backdrop at all — set the value to the sentinel `"none"`:

```json
"subsystems": {
  "salon": { "backgroundImage": "none" }
}
```

Quilltap then renders that page with no story background whatsoever, rather than falling through to the stock image.

For a worked example, activate the bundled **Madman's Box** theme, which dresses its principal halls in walnut and brass to match the rest of its furnishings.

### Managing Themes via CLI

The `quilltap themes` CLI provides commands for managing theme bundles from the terminal:

```bash
# List all installed themes (default, plugins, bundles)
npx quilltap themes list

# Validate a .qtap-theme file before installing
npx quilltap themes validate my-theme.qtap-theme

# Install a .qtap-theme bundle
npx quilltap themes install my-theme.qtap-theme

# Install from a URL
npx quilltap themes install https://example.com/my-theme.qtap-theme

# Uninstall a bundle theme
npx quilltap themes uninstall my-theme

# Export any theme as a .qtap-theme file
npx quilltap themes export earl-grey --output ./my-export.qtap-theme

# Scaffold a new theme (delegates to create-quilltap-theme)
npx quilltap themes create sunset
```

The `validate` command checks bundle structure, file types, size limits, and manifest schema without installing. Use it to verify your bundle before distributing it.

### Theme Registries

Theme registries are remote indexes of themes that you can browse, search, and install from. Think of them as curated theme catalogs.

#### Browsing Themes in the UI

1. Open **Settings** > **Appearance**
2. Scroll down to the **Browse Themes** section
3. Search for themes by name, tag, or description
4. Click **Install** on any theme to download and install it
5. Verified themes show a checkmark badge (signature verified against the registry's public key)

#### Managing Registries via CLI

```bash
# List configured registries
npx quilltap themes registry list

# Add a registry source
npx quilltap themes registry add https://example.com/registry.json --name "My Registry"

# Add a registry with signature verification
npx quilltap themes registry add https://example.com/registry.json --key ed25519:BASE64KEY

# Remove a registry
npx quilltap themes registry remove "My Registry"

# Refresh all registry indexes
npx quilltap themes registry refresh

# Search for themes across registries
npx quilltap themes search "dark modern"

# Check for theme updates
npx quilltap themes update

# Update a specific theme
npx quilltap themes update my-theme
```

#### For Registry Operators

If you host your own theme registry, the CLI provides tools for signing:

```bash
# Generate an Ed25519 keypair
npx quilltap themes registry keygen --output ./keys

# Sign a registry directory
npx quilltap themes registry sign ./my-registry --key ed25519:PRIVATE_KEY
```

Registry indexes are JSON files listing available themes with download URLs, SHA-256 hashes, and optional Ed25519 signatures for integrity verification.

## Tips for Theme Selection

1. **Try different themes** — Spend time with each to find your favorite
2. **Consider color mode** — Choose light for daytime, dark for evening, system for automatic
3. **Test readability** — Make sure text is easy to read in your preferred theme
4. **Match your workflow** — Some themes may feel better for different types of work
5. **Use quick-switcher** — Enable it if you like switching themes frequently
6. **Adjust sidebar width** — Combined with theme changes, this can transform your interface

## Theme Persistence

Your theme choices are saved automatically:

- **Theme preference** — Your selected theme is remembered
- **Color mode preference** — Light/dark/system choice is saved
- **Quick-switcher setting** — Whether it's enabled is remembered
- **Cross-device** — Preferences sync across devices when logged in

Every time you log in, Quilltap remembers your theme selections.

## Troubleshooting Themes

### Theme Not Appearing

- Ensure the theme plugin is installed
- Try refreshing the browser
- Check that the plugin is enabled in your system
- Look in Settings → Plugins to verify installation

### Colors Look Wrong

- Check your color mode (light/dark/system)
- Verify you've selected the theme you want
- Try switching to system mode
- Check if a browser extension is interfering

### Fonts Look Different

- Custom fonts take a moment to load
- If fonts don't appear, the fallback font is used
- Refresh if needed
- Check your browser's font rendering settings

### Theme Doesn't Save

- Check your internet connection
- Verify you're logged in
- Try switching themes again
- Check the browser console for errors

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=appearance&section=appearance")`

Themes are a powerful way to personalize Quilltap and make it work for your creative style and environment!
