/**
 * Icons Story Component
 *
 * A reference for theme authors: the catalogue of override-able Quilltap icon
 * names, plus the recipe for replacing them from a `.qtap-theme` bundle.
 *
 * This is a lightweight reference — it documents the icon-name contract and the
 * override mechanism rather than live-rendering every glyph (which would require
 * bundling the app's default SVG set into this package). The grouped name list
 * below mirrors the app's icon registry (`components/ui/icons/icon-registry.ts`);
 * keep it in sync when icons are added or renamed.
 */

import React from 'react';

interface IconGroup {
  category: string;
  names: string[];
}

const ICON_GROUPS: IconGroup[] = [
  {
    category: 'General UI',
    names: [
      'close', 'pencil', 'refresh', 'check', 'check-circle', 'chat', 'info', 'trash',
      'copy', 'plus', 'minus', 'search', 'download', 'upload', 'cloud-upload', 'external-link',
      'link', 'send', 'paperclip', 'eye', 'eye-off', 'star', 'bookmark', 'tag', 'expand', 'compress',
    ],
  },
  {
    category: 'Navigation arrows',
    names: [
      'chevron-down', 'chevron-right', 'chevron-left',
      'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down', 'sort',
    ],
  },
  {
    category: 'Status & alerts',
    names: ['alert-triangle', 'alert-circle', 'shield', 'ban', 'clock', 'calendar'],
  },
  {
    category: 'Media',
    names: ['image', 'camera', 'play', 'pause', 'stop', 'zoom-in', 'zoom-out'],
  },
  {
    category: 'Content & sidebar navigation',
    names: [
      'projects', 'files', 'file', 'file-plus', 'folder', 'folder-plus', 'book',
      'characters', 'scriptorium', 'photos', 'scenarios',
    ],
  },
  {
    category: 'People',
    names: ['profile', 'user', 'user-plus', 'users', 'megaphone', 'dice'],
  },
  {
    category: 'System & tooling',
    names: ['sparkles', 'wand', 'thinking', 'wrench', 'code', 'cpu', 'database', 'layers', 'zap', 'swap', 'log-out'],
  },
  {
    category: 'Appearance & system',
    names: ['settings', 'themes', 'wardrobe', 'help', 'sun', 'moon', 'monitor'],
  },
  {
    category: 'Brand',
    names: ['brand'],
  },
];

const sectionHeading: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 700,
  marginBottom: '1rem',
  borderBottom: '1px solid var(--color-border)',
  paddingBottom: '0.5rem',
};

const chip: React.CSSProperties = {
  fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)',
  fontSize: '0.8125rem',
  padding: '0.25rem 0.6rem',
  borderRadius: 'var(--radius-md, 0.375rem)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-muted)',
  color: 'var(--color-foreground)',
};

const codeBlock: React.CSSProperties = {
  fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)',
  fontSize: '0.8125rem',
  background: 'var(--color-muted)',
  color: 'var(--color-foreground)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md, 0.375rem)',
  padding: '1rem',
  overflowX: 'auto',
  lineHeight: 1.6,
};

export const Icons: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Icons</h2>
      <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '2rem', maxWidth: '46rem' }}>
        Quilltap renders its UI icons through a central registry, so a theme can replace any of
        them. The default icons are monochrome and follow the current text color; a theme overrides
        an icon by mapping its name to a bundled asset.
      </p>

      {/* How overrides work */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h3 style={sectionHeading}>Overriding an icon</h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem', maxWidth: '46rem' }}>
          Drop replacement assets into your bundle&apos;s <code>icons/</code> folder and add an{' '}
          <code>icons</code> map to <code>theme.json</code>, keyed by the built-in icon name:
        </p>
        <pre style={codeBlock}>{`{
  "icons": {
    "settings": "icons/settings.svg",
    "brand": "icons/brand.webp"
  }
}`}</pre>
        <ul style={{ color: 'var(--color-muted-foreground)', marginTop: '1rem', maxWidth: '46rem', lineHeight: 1.7 }}>
          <li>
            <strong style={{ color: 'var(--color-foreground)' }}>.svg overrides</strong> are tinted by
            the current text color, exactly like the built-in icons — best for monochrome glyphs that
            should follow the theme.
          </li>
          <li>
            <strong style={{ color: 'var(--color-foreground)' }}>.webp overrides</strong> are drawn in
            full color — best for textured or multi-color marks.
          </li>
          <li>
            The <code>brand</code> mark follows the same rule: an <code>.svg</code> override is
            tinted like any other icon, so ship it as <code>.webp</code> if it should keep its own
            colors.
          </li>
          <li>
            Names must match the built-in names below; unknown names are ignored. Run{' '}
            <code>quilltap themes validate</code> to catch typos and bad asset paths.
          </li>
        </ul>
      </section>

      {/* Override-able names */}
      <section>
        <h3 style={sectionHeading}>Override-able icon names</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {ICON_GROUPS.map((group) => (
            <div key={group.category}>
              <p style={{ fontWeight: 600, marginBottom: '0.6rem', fontSize: '0.9375rem' }}>
                {group.category}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {group.names.map((name) => (
                  <code key={name} style={chip}>{name}</code>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
