/**
 * Bug 98 regression — POST /api/v1/projects must accept `null` for its
 * blank-able fields.
 *
 * Both create dialogs (Prospero's CreateProjectDialog and the homepage
 * QuickActionsRow) send `description || null` when the field is left empty.
 * A bare `.optional()` rejects null, turning every blank-description create
 * into a silent 400 — the schema must stay `.nullable().optional()`, the
 * same shape updateProjectSchema already has.
 */

import { describe, it, expect } from '@jest/globals';
import { createProjectSchema } from '@/app/api/v1/projects/schemas';

describe('createProjectSchema (bug 98)', () => {
  it('accepts null description — what the dialogs send for a blank field', () => {
    const result = createProjectSchema.safeParse({ name: 'Test', description: null });
    expect(result.success).toBe(true);
  });

  it('accepts null for every blank-able field', () => {
    const result = createProjectSchema.safeParse({
      name: 'Test',
      description: null,
      instructions: null,
      color: null,
      icon: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an omitted description', () => {
    expect(createProjectSchema.safeParse({ name: 'Test' }).success).toBe(true);
  });

  it('accepts a string description', () => {
    const result = createProjectSchema.safeParse({ name: 'Test', description: 'A project' });
    expect(result.success).toBe(true);
  });

  it('still refuses a missing or empty name', () => {
    expect(createProjectSchema.safeParse({ description: null }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: '', description: null }).success).toBe(false);
  });
});
