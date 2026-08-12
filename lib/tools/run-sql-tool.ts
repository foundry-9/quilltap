/**
 * @fileoverview Tool definition for the Brahma Console's read-only SQL access
 * (`run_sql`). Lets the console query any of the three Quilltap databases
 * (main / llm-logs / mount-index) and read rows back as JSON. The tool is
 * **read-only**: writes and schema changes are rejected at the handler layer
 * (see `lib/tools/handlers/run-sql-handler.ts`). Offered on the Brahma Console
 * surface only.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * `validateRunSqlInput` is a one-line `safeParse(...).success` delegate. Do not
 * hand-write the JSON Schema.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the run_sql tool's input.
 */
export const runSqlToolInputSchema = z.object({
  sql: z
    .string()
    .min(1)
    .describe(
      'A single read-only SQL query (SELECT or WITH … SELECT). One statement only. ' +
      'Read-only PRAGMAs like PRAGMA table_info(<table>) are allowed for schema inspection. ' +
      'Writes (INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/REINDEX/VACUUM, mutating PRAGMAs) are ' +
      'rejected — this tool cannot change data.'
    ),
  database: z
    .enum(['main', 'llm-logs', 'mount-index'])
    .default('main')
    .describe(
      'Which Quilltap database to query. "main" (quilltap.db): characters, chats, ' +
      'chat_messages, memories, connection_profiles, projects, groups, settings. ' +
      '"llm-logs" (quilltap-llm-logs.db): the llm_logs table (full request/response JSON, ' +
      'token usage, cost, duration). "mount-index" (quilltap-mount-index.db): document stores ' +
      'and ALL character/project/group vault content. Databases are physically separate — ' +
      'you cannot JOIN across them in one query.'
    )
    .optional(),
  max_rows: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(1000)
      .describe('Maximum rows to return (hard-capped at 1000). Use aggregates for large sets rather than dumping rows.')
  )
    .default(200)
    .optional(),
});

/**
 * Input parameters for the run_sql tool.
 */
export type RunSqlInput = z.infer<typeof runSqlToolInputSchema>;

/**
 * Validates input for the run_sql tool.
 */
export function validateRunSqlInput(input: unknown): RunSqlInput | null {
  const parsed = runSqlToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const runSqlToolDefinition = {
  type: 'function',
  function: {
    name: 'run_sql',
    description:
      'Run a single read-only SQL query against one of the three Quilltap databases ' +
      '(main, llm-logs, or mount-index) and read the rows back as JSON. Use it to answer ' +
      "questions about the operator's characters, memories, documents, conversations, model " +
      'usage, and costs by translating those questions into queries. Read-only at the tool ' +
      'layer: writes and schema changes are rejected before they run, so query freely. The ' +
      'databases are physically separate — pick one per call; you cannot JOIN across them.',
    parameters: zodToOpenAISchema(runSqlToolInputSchema),
  },
};

/**
 * Successful result envelope for a run_sql query. BLOB columns (embeddings,
 * blob data) are NOT inlined — they come back as a `<blob: N bytes>`
 * placeholder string (see the handler's `sanitizeRow`).
 */
export interface RunSqlOutput {
  database: 'main' | 'llm-logs' | 'mount-index';
  /** Column names, in order. */
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** Rows returned (after the max_rows cap). */
  rowCount: number;
  /** True if the result hit max_rows and was truncated. */
  truncated: boolean;
}
