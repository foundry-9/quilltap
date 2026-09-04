/**
 * Instance-Setting Route Handlers
 *
 * The GET/PUT pair every instance-wide JSON setting route exposes
 * (`/api/v1/settings/brahma-console`, `data-retention`, `taboo`, …):
 *
 *   GET → read the setting → 200 with the value
 *   PUT → merge the body over the stored value → validate → store → 200 with
 *         what was stored
 *
 * PUT merges rather than replaces, so a partial body (`{}` in particular)
 * never wipes a field back to its schema default. Validation failures answer
 * 400 without writing; anything thrown answers 500 with a per-setting
 * message. Response shapes and log/error strings are derived from `label` so
 * the three routes stay byte-for-byte what they were when each was
 * hand-written.
 */

import type { NextRequest } from 'next/server';
import type { z } from 'zod';
import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, serverError, validationError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

export interface InstanceSettingHandlerConfig<T extends object> {
  /**
   * Kebab-case setting name as it appears in error strings
   * (`Failed to fetch <label> settings`). Capitalised for the info/debug
   * lines (`<Label> settings updated (instance-wide)`).
   */
  label: string;
  /** Typed reader from `@/lib/instance-settings`. */
  get: () => Promise<T>;
  /**
   * Typed writer. When it resolves to the stored value (the way
   * `setTabooSettings` does after normalising) that value is echoed back;
   * otherwise the validated payload is.
   */
  set: (value: T) => Promise<T | void>;
  /** The setting's Zod schema — the PUT contract is `schema.safeParse({...current, ...body})`. */
  schema: z.ZodType<T>;
  /** Fields worth logging alongside a read or a successful update. */
  logSummary: (settings: T) => Record<string, unknown>;
}

function capitalise(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Build the `{ GET, PUT }` pair for one instance-wide JSON setting. Route
 * files export the result directly:
 *
 * ```ts
 * export const { GET, PUT } = createInstanceSettingHandlers({ ... });
 * ```
 */
export function createInstanceSettingHandlers<T extends object>(
  config: InstanceSettingHandlerConfig<T>,
) {
  const { label, get, set, schema, logSummary } = config;
  const Label = capitalise(label);

  const GET = createContextHandler(async () => {
    try {
      const settings = await get();
      logger.debug(`[Settings v1] ${Label} settings fetched`, logSummary(settings));
      return successResponse(settings);
    } catch (error) {
      logger.error(
        `[Settings v1] Error fetching ${label} settings`,
        {},
        error instanceof Error ? error : undefined,
      );
      return serverError(`Failed to fetch ${label} settings`);
    }
  });

  const PUT = createContextHandler(async (req: NextRequest) => {
    try {
      const body = await req.json();
      const current = await get();
      const parsed = schema.safeParse({ ...current, ...body });
      if (!parsed.success) {
        return validationError(parsed.error);
      }

      const saved = (await set(parsed.data)) ?? parsed.data;
      logger.info(`[Settings v1] ${Label} settings updated (instance-wide)`, logSummary(saved));
      return successResponse(saved);
    } catch (error) {
      logger.error(
        `[Settings v1] Error updating ${label} settings`,
        {},
        error instanceof Error ? error : undefined,
      );
      return serverError(`Failed to update ${label} settings`);
    }
  });

  return { GET, PUT };
}
