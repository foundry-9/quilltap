import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the terminal list tool's input.
 */
export const terminalListToolInputSchema = z.object({});

export type TerminalListInput = z.infer<typeof terminalListToolInputSchema>;

export const terminalListToolDefinition = {
  type: 'function',
  function: {
    name: 'terminal_list',
    description: 'List all terminal sessions in this chat (live and exited). Returns a brief summary per session including id, shell, cwd, and status.',
    parameters: zodToOpenAISchema(terminalListToolInputSchema),
  },
};

export function validateTerminalListInput(input: unknown): TerminalListInput | null {
  const parsed = terminalListToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export interface TerminalListOutput {
  sessions: Array<{
    sessionId: string;
    label: string | null;
    shell: string;
    cwd: string;
    startedAt: string;
    status: 'live' | 'exited';
    exitCode: number | null;
  }>;
}
