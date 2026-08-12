/**
 * Workspace Story Component
 *
 * The tabbed workspace chrome: the per-pane tab strip (active / inactive /
 * close), the resizable pane divider with its grip, and the split drop-zone.
 *
 * Every accented surface here derives from a single theme hook,
 * `--qt-workspace-accent` (it falls back to `--color-primary`). A theme re-tints
 * the whole workspace by setting that one token at its `[data-theme="…"]` root —
 * e.g. Madman's Box points it at cyan rather than its amber primary. The
 * individual `--qt-workspace-tab-*` / `--qt-workspace-divider-*` /
 * `--qt-tab-drop-zone-*` hooks remain for finer control.
 *
 * @module @quilltap/theme-storybook/stories/components/Workspace
 */

import React, { useState } from 'react';

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3
    style={{
      fontSize: '1.125rem',
      fontWeight: 700,
      marginBottom: '1rem',
      borderBottom: '1px solid var(--color-border)',
      paddingBottom: '0.5rem',
    }}
  >
    {children}
  </h3>
);

const CloseGlyph: React.FC = () => (
  <svg className="qt-tab-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

/** A single workspace tab (extends the base `.qt-tab` with strip affordances). */
const WorkspaceTab: React.FC<{
  label: string;
  active?: boolean;
  closeable?: boolean;
}> = ({ label, active, closeable = true }) => (
  <div
    className={`qt-tab ${active ? 'qt-tab-active' : ''}`}
    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
  >
    <span className="qt-tab-label">{label}</span>
    {closeable && (
      <span className="qt-tab-close" role="button" aria-label={`Close ${label}`}>
        <CloseGlyph />
      </span>
    )}
  </div>
);

export const Workspace: React.FC = () => {
  const [active, setActive] = useState('salon');

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Workspace</h2>
      <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1.5rem', maxWidth: '46rem' }}>
        The tabbed two-pane shell. Set <code>--qt-workspace-accent</code> in your theme to re-tint the
        active tab, the pane divider, and the split drop-zone in one move.
      </p>

      {/* Tab strip */}
      <section style={{ marginBottom: '2rem' }}>
        <SectionHeading>Tab strip — active &amp; inactive</SectionHeading>
        <div className="qt-tab-strip" role="tablist" style={{ borderRadius: '0.5rem 0.5rem 0 0' }}>
          {[
            { id: 'home', label: 'Home' },
            { id: 'salon', label: 'The Salon — Bertie' },
            { id: 'aurora', label: 'Aurora' },
            { id: 'scriptorium', label: 'The Scriptorium' },
          ].map((t) => (
            <div key={t.id} onClick={() => setActive(t.id)}>
              <WorkspaceTab label={t.label} active={active === t.id} closeable={t.id !== 'home'} />
            </div>
          ))}
        </div>
      </section>

      {/* Pane divider */}
      <section style={{ marginBottom: '2rem' }}>
        <SectionHeading>Pane divider</SectionHeading>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '0.75rem' }}>
          Resizable split between the two panes. Hover (or focus) to see the accent.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 8px 1fr',
            height: '120px',
            border: '1px solid var(--color-border)',
            borderRadius: '0.5rem',
            overflow: 'hidden',
          }}
        >
          <div className="qt-panel" style={{ display: 'grid', placeItems: 'center' }}>
            Left pane
          </div>
          <div className="qt-workspace-divider" tabIndex={0} role="separator" aria-label="Resize panes">
            <div className="qt-workspace-divider-grip" />
          </div>
          <div className="qt-panel" style={{ display: 'grid', placeItems: 'center' }}>
            Right pane
          </div>
        </div>
      </section>

      {/* Split drop-zone */}
      <section>
        <SectionHeading>Split drop-zone</SectionHeading>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '0.75rem' }}>
          Shown while a tab is dragged toward a pane edge to create the split.
        </p>
        <div
          style={{
            position: 'relative',
            height: '120px',
            border: '1px solid var(--color-border)',
            borderRadius: '0.5rem',
            overflow: 'hidden',
          }}
        >
          <div className="qt-panel" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            Pane
          </div>
          <div className="qt-tab-drop-zone">
            <span className="qt-tab-drop-zone-hint">Drop to split</span>
          </div>
        </div>
      </section>
    </div>
  );
};
