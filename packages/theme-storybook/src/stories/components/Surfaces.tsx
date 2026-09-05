/**
 * Surfaces Story Component
 *
 * Demonstrates the accent-surface contract for theme authors. The app uses
 * `accent` as a quiet hover/selected/surface tint, but a theme is free to map
 * `accent` to a bold colour (e.g. Madman's Box amber). These patterns stay
 * legible either way, because they pair the accent background with the theme's
 * own `accentForeground`, or use the quiet `muted` / faint-`primary` surfaces.
 */

import React from 'react';

const sectionHeading: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 700,
  marginBottom: '1rem',
  borderBottom: '1px solid var(--color-border)',
  paddingBottom: '0.5rem',
};

const note: React.CSSProperties = {
  color: 'var(--color-muted-foreground)',
  marginBottom: '1rem',
  fontSize: '0.875rem',
};

export const Surfaces: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Story-local: the app pairs the hover foregrounds with Tailwind's
          hover:bg-* fills, which don't exist here. Demo fills only — these are
          not qt-* utilities and must not be copied into an app or a theme. */}
      <style>{`
        .surfaces-demo-fill-primary:hover { background-color: var(--color-primary); }
        .surfaces-demo-fill-success:hover { background-color: var(--color-success); }
        .surfaces-demo-fill-destructive:hover { background-color: var(--color-destructive); }
      `}</style>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Surfaces</h2>
      <p style={{ ...note, maxWidth: '44rem' }}>
        How accent-coloured surfaces stay legible no matter how bold a theme makes
        its <code>accent</code> token. Filled surfaces pair the background with{' '}
        <code>qt-text-on-accent</code>; hover rows use <code>qt-hover-accent</code>;
        quiet selected/panel surfaces lean on <code>muted</code> and faint{' '}
        <code>primary</code> instead of the accent.
      </p>

      {/* Filled accent surfaces */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={sectionHeading}>Filled accent surfaces</h3>
        <p style={note}>
          A solid <code>qt-bg-accent</code> fill <strong>must</strong> be paired with{' '}
          <code>qt-text-on-accent</code> (the theme&apos;s <code>accentForeground</code>).
          A fill without it falls back to the page foreground and washes out on bold accents.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <span className="qt-bg-accent qt-text-on-accent" style={{ padding: '0.125rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem' }}>
            keyword
          </span>
          <span className="qt-bg-accent qt-text-on-accent" style={{ padding: '0.125rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem' }}>
            another keyword
          </span>
          <kbd className="qt-bg-accent qt-text-on-accent" style={{ padding: '0.125rem 0.375rem', borderRadius: '0.25rem', fontSize: '0.75rem' }}>
            ↵
          </kbd>
        </div>
      </section>

      {/* Foregrounds on filled surfaces */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={sectionHeading}>Foregrounds on filled surfaces — the <code>qt-text-on-*</code> family</h3>
        <p style={note}>
          The same contract, extended to every filled surface the app paints:{' '}
          <code>qt-text-on-accent</code>, <code>qt-text-on-primary</code>,{' '}
          <code>qt-text-on-success</code>, and <code>qt-text-on-destructive</code>, each
          mapping to the theme&apos;s matching <code>*Foreground</code> token. Note the
          naming — <code>-on-<em>fill</em></code>, never <code>-<em>fill</em>-foreground</code>,
          which is the Tailwind spelling and is not a <code>qt-</code> class at all.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <span className="qt-bg-accent qt-text-on-accent" style={{ padding: '0.25rem 0.625rem', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600 }}>
            on accent
          </span>
          <span className="qt-bg-primary qt-text-on-primary" style={{ padding: '0.25rem 0.625rem', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600 }}>
            on primary
          </span>
          <span className="qt-bg-success qt-text-on-success" style={{ padding: '0.25rem 0.625rem', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600 }}>
            on success
          </span>
          <span className="qt-bg-destructive qt-text-on-destructive" style={{ padding: '0.25rem 0.625rem', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600 }}>
            on destructive
          </span>
        </div>
        <p style={{ ...note, marginTop: '1rem' }}>
          Each has a hover partner for controls that stay quiet at rest and take the fill
          on hover. Tailwind generates no variants for these classes, so the hover forms
          are written out by hand — reach for one that was never written and it is simply
          inert. Hover the buttons below.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <button className="qt-bg-card qt-text-secondary surfaces-demo-fill-primary hover:qt-text-on-primary" style={{ padding: '0.25rem 0.625rem', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, border: '1px solid var(--color-border)', cursor: 'pointer' }}>
            hover:qt-text-on-primary
          </button>
          <button className="qt-bg-card qt-text-secondary surfaces-demo-fill-success hover:qt-text-on-success" style={{ padding: '0.25rem 0.625rem', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, border: '1px solid var(--color-border)', cursor: 'pointer' }}>
            hover:qt-text-on-success
          </button>
          <button className="qt-bg-card qt-text-secondary surfaces-demo-fill-destructive hover:qt-text-on-destructive" style={{ padding: '0.25rem 0.625rem', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, border: '1px solid var(--color-border)', cursor: 'pointer' }}>
            hover:qt-text-on-destructive
          </button>
        </div>
      </section>

      {/* Hover-highlight rows */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={sectionHeading}>Hover-highlight rows — <code>qt-hover-accent</code></h3>
        <p style={note}>
          For list rows, menu items, and option cards. On hover it paints the accent
          background and forces the accent foreground onto the row <em>and every
          descendant</em> — so children that carry their own colour (the title and the
          muted subtitle below) flip too, instead of washing out (or, when their colour
          matches the accent, vanishing). Hover the rows to see it.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxWidth: '24rem', border: '1px solid var(--color-border)', borderRadius: '0.5rem', padding: '0.375rem' }}>
          <div className="qt-hover-accent" style={{ display: 'flex', flexDirection: 'column', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', cursor: 'pointer' }}>
            <span className="qt-text-primary">Compose a reply</span>
            <span className="qt-text-secondary" style={{ fontSize: '0.8125rem' }}>Draft a response in this thread</span>
          </div>
          <div className="qt-hover-accent" style={{ display: 'flex', flexDirection: 'column', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', cursor: 'pointer' }}>
            <span className="qt-text-primary">Mark as resolved</span>
            <span className="qt-text-secondary" style={{ fontSize: '0.8125rem' }}>Close and archive this item</span>
          </div>
          <div className="qt-hover-accent" style={{ display: 'flex', flexDirection: 'column', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', cursor: 'pointer' }}>
            <span className="qt-text-primary">Delete</span>
            <span className="qt-text-secondary" style={{ fontSize: '0.8125rem' }}>Remove permanently</span>
          </div>
        </div>
      </section>

      {/* Quiet selected / panel surfaces */}
      <section>
        <h3 style={sectionHeading}>Quiet selected &amp; panel surfaces</h3>
        <p style={note}>
          Persistent surfaces (selected cards, informational panels) deliberately avoid
          the bold accent. Selected states use a faint <code>qt-bg-primary/10</code> tint;
          informational panels use the neutral <code>qt-bg-muted</code> surface.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <div className="qt-bg-primary/10" style={{ padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-primary)', maxWidth: '16rem' }}>
            <div className="qt-text-primary" style={{ fontWeight: 600 }}>Selected option</div>
            <div className="qt-text-secondary" style={{ fontSize: '0.8125rem' }}>Faint primary tint marks the choice.</div>
          </div>
          <div className="qt-bg-muted" style={{ padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', maxWidth: '16rem' }}>
            <div style={{ fontWeight: 600 }}>Informational panel</div>
            <div className="qt-text-secondary" style={{ fontSize: '0.8125rem' }}>Neutral muted surface, never the accent.</div>
          </div>
        </div>
      </section>
    </div>
  );
};
