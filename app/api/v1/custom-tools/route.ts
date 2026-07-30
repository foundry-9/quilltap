/**
 * `/api/v1/custom-tools` — Pascal's Workbench collection resource.
 *
 * - `GET`                       — the library: every definition in every
 *                                 enabled store, valid or broken, with
 *                                 attachment badges.
 * - `GET  ?action=destinations` — the save-target list, grouped by what each
 *                                 store is attached to.
 * - `POST ?action=preview`      — dry-run a definition through the one true
 *                                 execution core. Posts nothing, writes
 *                                 nothing.
 * - `POST ?action=audit`        — deal ten thousand hands and report where
 *                                 they landed.
 *
 * File content I/O is deliberately NOT here: reads, writes, and deletes go
 * through the existing mount-points file routes, so the Workbench adds no
 * second write path into stores.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createContextHandler, withCollectionActionDispatch, type RequestContext } from '@/lib/api/middleware';
import { badRequest, errorResponse, notFound, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import {
  MAX_LLM_OUTPUT_CEILING,
  MAX_LLM_OUTPUT_LENGTH,
  QtapCustomToolSchema,
  formatDefinitionIssues,
  type QtapCustomTool,
} from '@/lib/pascal/custom-tool.types';
import {
  CustomToolRunError,
  executeCustomTool,
  simulateOutcomes,
  type LlmInvoker,
  type LlmSubject,
} from '@/lib/pascal/custom-tools';
import { evaluateToolGate, hasToolGate } from '@/lib/pascal/tool-gate';
import { buildCustomToolLlmInvoker } from '@/lib/pascal/llm-consult';
import { buildCustomToolLibrary, listCustomToolDestinations } from '@/lib/pascal/workbench';
import { CharacterVaultUnavailableError } from '@/lib/database/repositories/vault-overlay/schema';

const HANDLER = 'api.v1.custom-tools';

/** Draws per audit. Roll + match only (no template rendering), so this is cheap. */
const AUDIT_RUNS = 10_000;

// ---------------------------------------------------------------------------
// GET — library and destinations
// ---------------------------------------------------------------------------

async function handleLibrary(): Promise<NextResponse> {
  const library = await buildCustomToolLibrary();
  return successResponse(library);
}

async function handleDestinations(): Promise<NextResponse> {
  const destinations = await listCustomToolDestinations();
  return successResponse(destinations);
}

// ---------------------------------------------------------------------------
// POST — preview and audit
// ---------------------------------------------------------------------------

/**
 * The bench's fact sheet: a hand-typed metadata object, or a pointer at a
 * character whose real sheet the server hydrates. The `{ characterId }` branch
 * must come first in the union — that exact shape would also satisfy the
 * catch-all record.
 */
const MetadataInputSchema = z.union([
  z.strictObject({ characterId: z.string().min(1) }),
  z.record(z.string(), z.unknown()),
]);

/**
 * The bench's oracle: a pretend answer, a pretend failure, or — preview only —
 * a live consult through the real cheap-LLM machinery. When a definition
 * declares an `llm` block and the bench supplies nothing, the consult fails
 * soft and the run shows the author's `errorMessage` path, which is the one
 * path every such table must survive anyway.
 */
const LlmSimulationSchema = z.union([
  // The ceiling, not the default: the definition's own maxOutput governs what
  // the core keeps, and the bench must be able to script anything a tool could.
  z.strictObject({ output: z.string().min(1).max(MAX_LLM_OUTPUT_CEILING) }),
  z.strictObject({ fail: z.literal(true) }),
]);

const PreviewBodySchema = z.object({
  definition: z.unknown(),
  params: z.record(z.string(), z.unknown()).nullish(),
  private: z.boolean().optional(),
  metadata: MetadataInputSchema.nullish(),
  /** Mock merged state for `$state` refs and `{{state.path}}`. Default {}. */
  state: z.record(z.string(), z.unknown()).nullish(),
  llm: z.union([z.strictObject({ live: z.literal(true) }), LlmSimulationSchema]).nullish(),
});

const AuditBodySchema = z.object({
  definition: z.unknown(),
  params: z.record(z.string(), z.unknown()).nullish(),
  metadata: MetadataInputSchema.nullish(),
  /** Mock merged state for `$state` refs, held fixed across every draw. Default {}. */
  state: z.record(z.string(), z.unknown()).nullish(),
  // No `live` here: an audit is ten thousand hands, and the point of the bench
  // is that it never spends ten thousand LLM calls. The simulated answer is
  // held fixed across every draw.
  llm: LlmSimulationSchema.nullish(),
});

/** A parsed body, or the error response that should be returned instead. */
type Parsed<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

async function parseBody<T>(req: NextRequest, schema: z.ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: badRequest('Request body must be JSON') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: badRequest('Invalid request body', parsed.error.issues) };
  }
  return { ok: true, value: parsed.data };
}

/** Validate a raw definition, or produce the 400 the author reads. */
function parseDefinition(raw: unknown): Parsed<QtapCustomTool> {
  const parsed = QtapCustomToolSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: badRequest(formatDefinitionIssues(parsed.error)) };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Resolve the fact sheet. A plain object passes through verbatim; the
 * `{ characterId }` form hydrates that character and uses their real
 * `metadata.json` — the honest "what would happen if they rolled this".
 */
async function resolveMetadata(
  ctx: RequestContext,
  metadata: z.infer<typeof MetadataInputSchema> | null | undefined
): Promise<Parsed<Record<string, unknown>>> {
  if (metadata === null || metadata === undefined) return { ok: true, value: {} };

  const isCharacterRef =
    typeof metadata === 'object' &&
    Object.keys(metadata).length === 1 &&
    typeof (metadata as { characterId?: unknown }).characterId === 'string';

  if (!isCharacterRef) return { ok: true, value: metadata as Record<string, unknown> };

  const characterId = (metadata as { characterId: string }).characterId;
  try {
    const character = await ctx.repos.characters.findById(characterId);
    if (!character) return { ok: false, response: notFound('Character') };
    return { ok: true, value: (character.metadata ?? {}) as Record<string, unknown> };
  } catch (error) {
    // A broken vault is surfaced honestly, never papered over with `{}` — the
    // bench would otherwise report metadata rows declining for the wrong reason.
    if (error instanceof CharacterVaultUnavailableError) {
      return { ok: false, response: errorResponse(error.message, 422) };
    }
    throw error;
  }
}

/**
 * The three steps both bench actions open with: parse the body, validate the
 * definition, resolve the fact sheet. Each can bail with the 4xx the author
 * reads, so the caller gets either everything it needs or the response to
 * return instead.
 */
async function parseBenchRequest<T extends { definition: unknown; metadata?: unknown }>(
  req: NextRequest,
  ctx: RequestContext,
  schema: z.ZodType<T>
): Promise<Parsed<{ body: T; definition: QtapCustomTool; metadata: Record<string, unknown> }>> {
  const body = await parseBody(req, schema);
  if (!body.ok) return body;

  const definition = parseDefinition(body.value.definition);
  if (!definition.ok) return definition;

  const metadata = await resolveMetadata(
    ctx,
    body.value.metadata as z.infer<typeof MetadataInputSchema> | null | undefined
  );
  if (!metadata.ok) return metadata;

  return { ok: true, value: { body: body.value, definition: definition.value, metadata: metadata.value } };
}

/**
 * A refused run is the author's table working as written, not a server fault:
 * report it as a 422 they can read, and let anything else throw.
 */
function benchRefusal(error: unknown, action: string, toolName: string): NextResponse {
  if (error instanceof CustomToolRunError) {
    logger.debug(`Workbench ${action} refused`, { context: HANDLER, tool: toolName, reason: error.message });
    return errorResponse(error.message, 422);
  }
  throw error;
}

async function handlePreview(req: NextRequest, ctx: RequestContext): Promise<NextResponse> {
  const parsed = await parseBenchRequest(req, ctx, PreviewBodySchema);
  if (!parsed.ok) return parsed.response;
  const { body, definition, metadata } = parsed.value;

  // Which oracle answers the bench: the real one (live), a scripted one, or a
  // scripted failure. Absent input leaves the seam unwired, so the consult
  // fails soft into the author's errorMessage path.
  let llmInvoke: LlmInvoker | undefined;
  const llmInput = body.llm;
  if (llmInput && 'live' in llmInput) {
    llmInvoke = buildCustomToolLlmInvoker({ userId: ctx.user.id, chatId: null });
  } else if (llmInput && 'output' in llmInput) {
    const output = llmInput.output;
    llmInvoke = async () => ({ ok: true, output, provider: 'bench', model: 'simulated' });
  } else if (llmInput && 'fail' in llmInput) {
    llmInvoke = async () => ({ ok: false, reason: 'a simulated failure, as the bench requested' });
  }

  try {
    const result = await executeCustomTool(definition, body.params ?? undefined, {
      private: body.private,
      metadata,
      state: body.state ?? {},
      ...(llmInvoke ? { llmInvoke } : {}),
    });
    // The bench always deals — a gate decides whether a character is OFFERED a
    // tool, not whether the author may test one they are holding. The verdict
    // rides along so the bench can say "and this character would never have
    // been dealt it", which a roll alone could never reveal.
    return successResponse({
      ...result,
      ...(hasToolGate(definition) ? { gate: evaluateToolGate(definition, metadata) } : {}),
    });
  } catch (error) {
    return benchRefusal(error, 'preview', definition.name);
  }
}

async function handleAudit(req: NextRequest, ctx: RequestContext): Promise<NextResponse> {
  const parsed = await parseBenchRequest(req, ctx, AuditBodySchema);
  if (!parsed.ok) return parsed.response;
  const { body, definition, metadata } = parsed.value;

  // The fixed consult every draw shares. A definition with an `llm` block and
  // no scripted answer audits its failure path — the honest default, since
  // that is the path a live table must always survive.
  let llm: LlmSubject | undefined;
  if (definition.llm) {
    const llmInput = body.llm;
    // Trimmed and capped exactly as a live run would keep it, so the audit
    // tests the answer the table would actually see.
    const maxOutput = definition.llm.maxOutput ?? MAX_LLM_OUTPUT_LENGTH;
    llm =
      llmInput && 'output' in llmInput
        ? { ok: true, output: llmInput.output.trim().slice(0, maxOutput).trim() }
        : { ok: false, output: definition.llm.errorMessage };
  }

  try {
    const result = simulateOutcomes(
      definition,
      body.params ?? undefined,
      AUDIT_RUNS,
      metadata,
      llm,
      body.state ?? {}
    );
    return successResponse(result);
  } catch (error) {
    return benchRefusal(error, 'audit', definition.name);
  }
}

// ---------------------------------------------------------------------------
// Route wiring
// ---------------------------------------------------------------------------

export const GET = createContextHandler(
  withCollectionActionDispatch({ destinations: handleDestinations }, handleLibrary)
);

export const POST = createContextHandler(
  withCollectionActionDispatch({ preview: handlePreview, audit: handleAudit })
);
