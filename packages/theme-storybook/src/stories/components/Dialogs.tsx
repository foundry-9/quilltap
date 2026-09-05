/**
 * Dialogs Story Component
 *
 * Displays dialog/modal variants for theme development.
 */

import React, { useState } from 'react';

export const Dialogs: React.FC = () => {
  const [basicOpen, setBasicOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Dialogs & Modals</h2>

      {/* Dialog Triggers */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Dialog Examples
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Click the buttons below to open different dialog types.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <button className="qt-button qt-button-secondary" onClick={() => setBasicOpen(true)}>
            Basic Dialog
          </button>
          <button className="qt-button qt-button-destructive" onClick={() => setConfirmOpen(true)}>
            Confirmation Dialog
          </button>
          <button className="qt-button qt-button-primary" onClick={() => setFormOpen(true)}>
            Form Dialog
          </button>
        </div>
      </section>

      {/* Basic Dialog */}
      {basicOpen && (
        <div className="qt-dialog-overlay" onClick={() => setBasicOpen(false)}>
          <div className="qt-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="qt-dialog-header">
              <h3 className="qt-dialog-title">Basic Dialog</h3>
              <p className="qt-dialog-description">This is a basic dialog with some content. Dialogs are used to show important information or gather user input.</p>
              <button className="qt-button-icon" onClick={() => setBasicOpen(false)} aria-label="Close">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="qt-dialog-body">
              <p>Dialog content area with additional details and information.</p>
            </div>
            <div className="qt-dialog-footer">
              <button className="qt-button qt-button-primary" onClick={() => setBasicOpen(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmOpen && (
        <div className="qt-dialog-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="qt-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="qt-dialog-header">
              <h3 className="qt-dialog-title">Delete Item?</h3>
              <p className="qt-dialog-description">Are you sure you want to delete this item? This action cannot be undone.</p>
              <button className="qt-button-icon" onClick={() => setConfirmOpen(false)} aria-label="Close">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="qt-dialog-body">
              <p>This will remove the item from your collection permanently.</p>
            </div>
            <div className="qt-dialog-footer">
              <button className="qt-button qt-button-ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button className="qt-button qt-button-destructive" onClick={() => setConfirmOpen(false)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form Dialog */}
      {formOpen && (
        <div className="qt-dialog-overlay" onClick={() => setFormOpen(false)}>
          <div className="qt-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '28rem' }}>
            <div className="qt-dialog-header">
              <h3 className="qt-dialog-title">Create New Item</h3>
              <p className="qt-dialog-description">Fill in the details below to create a new item.</p>
              <button className="qt-button-icon" onClick={() => setFormOpen(false)} aria-label="Close">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="qt-dialog-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
                    Name
                  </label>
                  <input className="qt-input" type="text" placeholder="Enter name..." />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
                    Description
                  </label>
                  <textarea className="qt-input qt-textarea" placeholder="Enter description..." style={{ minHeight: '5rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
                    Category
                  </label>
                  <select className="qt-input qt-select">
                    <option value="">Select category...</option>
                    <option value="1">Category 1</option>
                    <option value="2">Category 2</option>
                    <option value="3">Category 3</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="qt-dialog-footer">
              <button className="qt-button qt-button-ghost" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button className="qt-button qt-button-primary" onClick={() => setFormOpen(false)}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Static Dialog Preview */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Dialog Structure (Static Preview)
        </h3>
        <div style={{ backgroundColor: 'var(--color-muted)', padding: '2rem', borderRadius: 'var(--radius-lg)' }}>
          <div className="qt-dialog" style={{ position: 'relative', transform: 'none', margin: '0 auto' }}>
            <div className="qt-dialog-header">
              <h3 className="qt-dialog-title">Dialog Title</h3>
              <p className="qt-dialog-description">This is a dialog with a title and description.</p>
              <button className="qt-button-icon" aria-label="Close">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="qt-dialog-body">
              <p>Dialog content area. This can contain text, forms, or any other content.</p>
            </div>
            <div className="qt-dialog-footer">
              <button className="qt-button qt-button-ghost">Secondary Action</button>
              <button className="qt-button qt-button-primary">Primary Action</button>
            </div>
          </div>
        </div>
      </section>

      {/* Dialog Sizes */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Dialog Sizes
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-muted-foreground)' }}>Small (max-width: 24rem)</span>
            <div style={{ backgroundColor: 'var(--color-muted)', padding: '1rem', borderRadius: 'var(--radius-lg)', marginTop: '0.5rem' }}>
              <div className="qt-dialog" style={{ position: 'relative', transform: 'none', margin: 0, maxWidth: '24rem' }}>
                <div className="qt-dialog-header">
                  <h3 className="qt-dialog-title">Small Dialog</h3>
                </div>
                <div className="qt-dialog-body">
                  <p>Compact dialog for simple confirmations.</p>
                </div>
              </div>
            </div>
          </div>
          <div>
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-muted-foreground)' }}>Large (max-width: 42rem)</span>
            <div style={{ backgroundColor: 'var(--color-muted)', padding: '1rem', borderRadius: 'var(--radius-lg)', marginTop: '0.5rem' }}>
              <div className="qt-dialog qt-dialog-wide" style={{ position: 'relative', transform: 'none', margin: 0, maxWidth: '42rem' }}>
                <div className="qt-dialog-header">
                  <h3 className="qt-dialog-title">Large Dialog</h3>
                </div>
                <div className="qt-dialog-body">
                  <p>Larger dialog for complex forms or detailed content that needs more space.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Popover */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Popover
        </h3>
        <div style={{ position: 'relative', display: 'inline-block', marginTop: '2rem' }}>
          <button className="qt-button qt-button-secondary">Hover for popover</button>
          <div className="qt-popover" style={{ position: 'absolute', left: 0, top: '100%', marginTop: '0.5rem', display: 'block' }}>
            <div style={{ padding: '0.75rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Popover Title</p>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>This is popover content that provides additional context.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Dropdown Menu */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Dropdown Menu
        </h3>
        <div className="qt-dropdown" style={{ display: 'inline-block', position: 'relative' }}>
          <div className="qt-dropdown-item">Profile</div>
          <div className="qt-dropdown-item">Settings</div>
          <div className="qt-dropdown-separator" />
          <div className="qt-dropdown-item" style={{ color: 'var(--color-destructive)' }}>Sign Out</div>
        </div>
      </section>

      {/* Tooltip */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Tooltip
        </h3>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4rem', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', display: 'inline-block', marginTop: '2rem' }}>
            <button className="qt-button qt-button-secondary">Hover me</button>
            <div className="qt-tooltip" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '100%', marginBottom: '0.5rem', display: 'block' }}>
              Helpful tooltip text
            </div>
          </div>

          {/* Structured (pinned) tooltip — a heading, labelled sections, a hint */}
          <div style={{ position: 'relative', display: 'inline-block', marginTop: '14rem' }}>
            <button className="qt-button qt-button-secondary">Pinned, with detail</button>
            <div
              className="qt-tooltip"
              data-interactive="true"
              data-pinned="true"
              style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '100%', marginBottom: '0.5rem', display: 'block', width: '20rem' }}
            >
              <div className="qt-tooltip-body">
                <p className="qt-tooltip-title">Amended</p>
                <p>On reflection the author corrected this reply to match the record.</p>
                <div className="qt-tooltip-section">
                  <p className="qt-tooltip-section-label">What looked off</p>
                  <p className="qt-tooltip-quote">The ledger excerpt returned by the document read shows a metric column.</p>
                </div>
                <p className="qt-tooltip-hint">Click the badge to pin this note; Esc dismisses it.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
