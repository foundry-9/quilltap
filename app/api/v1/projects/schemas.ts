/**
 * Projects API v1 - Collection Zod Schemas
 *
 * Validation schemas for the projects collection route.
 */

import { z } from 'zod';

// Nullable-optional fields mirror updateProjectSchema ([id]/schemas.ts): the
// create dialogs send `description || null` for a blank field, so `null` must
// validate here too (bug 98) — the handler already coerces falsy to null.
export const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(10000).nullable().optional(),
  allowAnyCharacter: z.boolean().optional().prefault(false),
  characterRoster: z.array(z.uuid()).optional().prefault([]),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
});
