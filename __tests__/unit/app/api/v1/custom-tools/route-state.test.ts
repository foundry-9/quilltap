/**
 * Workbench route — the `state` body field on preview/audit.
 *
 * Confirms the route accepts an optional mock `state` object and threads it
 * into the run so `$state` references resolve against it (with fallback when a
 * path is absent). Auth middleware and the action dispatch are stubbed; the
 * real definition schema and execution core run.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler:
    (handler: (req: any, ctx: any) => Promise<any>) =>
    async (req: any) => handler(req, { user: { id: 'user-1' }, repos: {} }),
  withCollectionActionDispatch:
    (handlers: Record<string, (req: any, ctx: any) => Promise<any>>) =>
    async (req: any, ctx: any) => {
      const action = new URL(req.url).searchParams.get('action') ?? '';
      return handlers[action](req, ctx);
    },
}));

import { POST } from '@/app/api/v1/custom-tools/route';

function req(action: string, body: unknown) {
  return {
    url: `http://localhost/api/v1/custom-tools?action=${action}`,
    json: async () => body,
  } as never;
}

// A definition whose sole non-catch-all outcome fires only when the value (a
// fixed 5) clears a $state-supplied difficulty.
const definition = {
  name: 'gate',
  description: 'x',
  roll: { min: 5, max: 5 },
  outcomes: [
    { when: { gte: { $state: 'game.difficulty', fallback: 10 } }, message: 'passed', state: 'success' },
    { when: true, message: 'fallback', state: 'info' },
  ],
};

describe('POST ?action=preview with a state body field', () => {
  it('resolves $state against the supplied mock state', async () => {
    const res = await POST(req('preview', { definition, state: { game: { difficulty: 3 } } }));
    const body = await res.json();
    expect(body.message).toBe('passed');
  });

  it('falls back when no state is supplied', async () => {
    const res = await POST(req('preview', { definition }));
    const body = await res.json();
    expect(body.message).toBe('fallback');
  });
});

describe('POST ?action=audit with a state body field', () => {
  it('threads mock state into every draw', async () => {
    const res = await POST(req('audit', { definition, state: { game: { difficulty: 1 } } }));
    const body = await res.json();
    // outcome 0 is the pass row; with difficulty 1 every fixed-5 draw clears it.
    expect(body.outcomes[0].hits).toBe(body.runs);
  });
});
