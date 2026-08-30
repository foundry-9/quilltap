/**
 * Inputs Story Component
 *
 * Displays all input variants and states for theme development.
 */

import React from 'react';

export const Inputs: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Inputs</h2>

      {/* Text Inputs */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Text Inputs
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '24rem' }}>
          <div>
            <label className="qt-label">Default</label>
            <input className="qt-input" type="text" placeholder="Enter text..." />
          </div>
          <div>
            <label className="qt-label">With Hint</label>
            <input className="qt-input" type="text" placeholder="Enter email..." />
            <span className="qt-hint">We&apos;ll never share your email.</span>
          </div>
          <div>
            <label className="qt-label">With Value</label>
            <input className="qt-input" type="text" defaultValue="Sample text" />
          </div>
          <div>
            <label className="qt-label">Disabled</label>
            <input className="qt-input" type="text" placeholder="Disabled input" disabled />
          </div>
          <div>
            <label className="qt-label">With Error</label>
            <input className="qt-input qt-input-error" type="text" placeholder="Invalid input" />
            <span className="qt-hint" style={{ color: 'var(--color-destructive)' }}>This field is required.</span>
          </div>
        </div>
      </section>

      {/* Textarea */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Textarea
        </h3>
        <div style={{ maxWidth: '24rem' }}>
          <label className="qt-label">Message</label>
          <textarea
            className="qt-input qt-textarea"
            placeholder="Enter your message..."
            style={{ minHeight: '6rem' }}
          />
        </div>
      </section>

      {/* Select */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Select
        </h3>
        <div style={{ maxWidth: '24rem' }}>
          <label className="qt-label">Choose an option</label>
          <select className="qt-input qt-select">
            <option value="">Select an option...</option>
            <option value="1">Option 1</option>
            <option value="2">Option 2</option>
            <option value="3">Option 3</option>
          </select>
        </div>
      </section>

      {/* Checkboxes & Radios */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Checkboxes & Radios
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '24rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" id="check1" className="qt-checkbox" />
            <label htmlFor="check1" style={{ margin: 0 }}>Checkbox option</label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" id="check2" className="qt-checkbox" defaultChecked />
            <label htmlFor="check2" style={{ margin: 0 }}>Checked checkbox</label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" id="check3" className="qt-checkbox" disabled />
            <label htmlFor="check3" style={{ margin: 0, color: 'var(--color-muted-foreground)' }}>Disabled checkbox</label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input type="radio" name="radio" id="radio1" className="qt-radio" />
            <label htmlFor="radio1" style={{ margin: 0 }}>Radio option 1</label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="radio" name="radio" id="radio2" className="qt-radio" defaultChecked />
            <label htmlFor="radio2" style={{ margin: 0 }}>Radio option 2</label>
          </div>
        </div>
      </section>

      {/* Range sliders */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Range Sliders
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '24rem' }}>
          <div>
            <label className="qt-label" htmlFor="range1">Temperature</label>
            <input type="range" id="range1" className="qt-range" style={{ width: '100%' }} min={0} max={100} defaultValue={65} />
          </div>
          <div>
            <label className="qt-label" htmlFor="range2" style={{ color: 'var(--color-muted-foreground)' }}>Disabled slider</label>
            <input type="range" id="range2" className="qt-range" style={{ width: '100%' }} min={0} max={100} defaultValue={35} disabled />
          </div>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)', marginTop: '0.75rem', maxWidth: '32rem' }}>
          Sliders render natively; <code>--qt-range-accent</code> colours both the filled
          portion of the track and the thumb. Overriding <code>.qt-range</code> with
          <code> appearance: none</code> gives a theme full control of the track, but drops
          the filled bar in Chrome and Safari.
        </p>
      </section>

      {/* Links */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Links
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <a href="#" className="qt-link">Default link</a>
          </div>
          <div>
            <a href="#" className="qt-link-subtle">Subtle link</a>
          </div>
        </div>
      </section>

      {/* Form Example */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Form Example
        </h3>
        <div className="qt-card" style={{ maxWidth: '24rem' }}>
          <div className="qt-card-header">
            <h4 className="qt-card-title">Contact Form</h4>
            <p className="qt-card-description">Fill out the form below.</p>
          </div>
          <div className="qt-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label className="qt-label">Name</label>
              <input className="qt-input" type="text" placeholder="Your name" />
            </div>
            <div>
              <label className="qt-label">Email</label>
              <input className="qt-input" type="email" placeholder="you@example.com" />
            </div>
            <div>
              <label className="qt-label">Message</label>
              <textarea className="qt-input qt-textarea" placeholder="Your message..." style={{ minHeight: '5rem' }} />
            </div>
          </div>
          <div className="qt-card-footer">
            <button className="qt-button qt-button-ghost">Cancel</button>
            <button className="qt-button qt-button-primary">Send</button>
          </div>
        </div>
      </section>
    </div>
  );
};
