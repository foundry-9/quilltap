import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the terminal read tool's input.
 */
export const terminalReadToolInputSchema = z.object({
  sessionId: z
    .string()
    .describe('Terminal session id (UUID). Get this from terminal_list.'),
  lines: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(2000)
      .describe('Maximum number of lines to return from the tail of the scrollback when start/end are not provided. Default 200. Ignored when start or end is set.')
  )
    .default(200)
    .optional(),
  start: llmNumber(
    z
      .number()
      .int()
      .describe('Optional 0-indexed inclusive start line. Negative values mean (last line number) - abs(value). Defaults to 0 when end is provided alone.')
  )
    .optional(),
  end: llmNumber(
    z
      .number()
      .int()
      .describe('Optional 0-indexed inclusive end line. Negative values mean (last line number) - abs(value). Defaults to the last line number when start is provided alone.')
  )
    .optional(),
  raw: z
    .boolean()
    .default(false)
    .describe('When true, the response also includes a rawScrollback field with ANSI escape codes preserved. The default scrollback field is always cleaned.')
    .optional(),
});

export type TerminalReadInput = z.infer<typeof terminalReadToolInputSchema>;

export const terminalReadToolDefinition = {
  type: 'function',
  function: {
    name: 'terminal_read',
    description: 'Read scrollback from a terminal session in this chat. By default the output is cleaned of ANSI escape codes and the last 200 lines are returned. Use start/end to read a specific line window (0-indexed, inclusive; negative values count back from the last line — e.g. start=-50 means "50 lines before the last"). Set raw=true to additionally include the unstripped output. The terminal is operator-controlled — this tool only reads; it cannot write. Use terminal_list first to discover live session ids.',
    parameters: zodToOpenAISchema(terminalReadToolInputSchema),
  },
};

export function validateTerminalReadInput(input: unknown): TerminalReadInput | null {
  const parsed = terminalReadToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export interface TerminalReadOutput {
  sessionId: string;
  shell: string;
  cwd: string;
  status: 'live' | 'exited';
  exitCode: number | null;
  lines: number;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
  scrollback: string;
  rawScrollback?: string;
}
