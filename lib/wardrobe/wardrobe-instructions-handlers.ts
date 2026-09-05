/**
 * Shared route-handler helpers for the `?action=instructions` GET/POST pair
 * that every wardrobe tier's collection route exposes (general, character,
 * group, project).
 *
 * Kept separate from `wardrobe-instructions.ts` (which owns the file I/O) so
 * these helpers call `readWardrobeInstructionsFile` /
 * `writeWardrobeInstructionsFile` through that module's public surface —
 * tests that mock `@/lib/wardrobe/wardrobe-instructions` keep intercepting
 * the reads and writes these handlers perform.
 *
 * Mount resolution, tier-specific edge cases (archived-character 409s,
 * cleared-is-a-no-op short circuits for tiers whose mount may not exist yet)
 * and every log line stay at the call sites; the optional `log` callbacks
 * fire at exactly the point the routes' inline logging used to.
 *
 * @module wardrobe/wardrobe-instructions-handlers
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { successResponse } from '@/lib/api/responses';
import {
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions';

/**
 * Request body for the `?action=instructions` POST shared by every wardrobe
 * tier's route. `null` (or blank) clears the file.
 */
export const wardrobeInstructionsBodySchema = z.object({
  instructions: z.string().nullable(),
});

/** Parsed instructions POST body plus the derived "clearing?" flag. */
export interface WardrobeInstructionsWriteBody {
  instructions: string | null;
  /** True when the request clears the instructions (null or blank). */
  cleared: boolean;
}

/**
 * Parse an `?action=instructions` POST body. Throws the same ZodError the
 * routes' inline `instructionsBodySchema.parse(...)` used to throw.
 */
export async function parseWardrobeInstructionsBody(
  req: Request,
): Promise<WardrobeInstructionsWriteBody> {
  const { instructions } = wardrobeInstructionsBodySchema.parse(await req.json());
  const cleared = !instructions || instructions.trim().length === 0;
  return { instructions, cleared };
}

/**
 * Shared GET `?action=instructions` tail: read the tier's own file (null
 * mount reads as null) and answer `{ instructions }`. The optional `log`
 * callback fires after the read so each route keeps its own log line.
 */
export async function handleReadWardrobeInstructions(
  mountPointId: string | null,
  log?: (info: { present: boolean }) => void,
): Promise<NextResponse> {
  const instructions = mountPointId ? await readWardrobeInstructionsFile(mountPointId) : null;
  log?.({ present: instructions !== null });
  return successResponse({ instructions });
}

/**
 * Shared POST `?action=instructions` tail: write (or clear) the tier's file
 * and answer `{ instructions }` with the trimmed content (null when cleared).
 * The optional `log` callback fires after the write so each route keeps its
 * own log line.
 */
export async function handleWriteWardrobeInstructions(
  mountPointId: string,
  body: WardrobeInstructionsWriteBody,
  log?: (info: { cleared: boolean }) => void,
): Promise<NextResponse> {
  await writeWardrobeInstructionsFile(mountPointId, body.instructions);
  log?.({ cleared: body.cleared });
  return successResponse({ instructions: body.cleared ? null : body.instructions!.trim() });
}
