/**
 * @jest-environment node
 *
 * Tests for the chat-creation progress SSE side-channel
 * (GET /api/v1/chats/creation-progress?id=<progressId>).
 *
 * Runs in the `node` environment: the route builds a `ReadableStream`, which
 * jsdom does not provide.
 *
 * The REAL in-memory progress bus runs (it is a plain EventEmitter map, no DB),
 * so this exercises the route end-to-end: backlog replay, live relay, terminal
 * close, and teardown on client abort. Only the SSE response wrapper and the
 * enqueue/close helpers are stubbed — importing the real ones would drag the
 * whole streaming service in.
 */

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler:
    (handler: (req: any, ctx: any) => Promise<any>) =>
    async (req: any) =>
      handler(req, { user: { id: 'user-1' }, repos: {} }),
}));

// Hand the stream straight back so the test can read it without Response plumbing.
jest.mock('@/lib/services/chat-message/request-helpers', () => ({
  sseStreamResponse: jest.fn((stream: ReadableStream<Uint8Array>) => ({ status: 200, stream })),
}));

// Same semantics as the real helpers: swallow writes to a closed controller.
jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  safeEnqueue: jest.fn((controller: any, data: Uint8Array) => {
    try {
      controller.enqueue(data);
      return true;
    } catch {
      return false;
    }
  }),
  safeClose: jest.fn((controller: any) => {
    try {
      controller.close();
    } catch {
      /* already closed */
    }
  }),
}));

import { GET } from '@/app/api/v1/chats/creation-progress/route';
import {
  publishCreationProgress,
  finishCreationProgress,
  failCreationProgress,
  __resetCreationProgressForTests,
  type CreationProgressEvent,
} from '@/lib/chat/creation-progress';

/** The route's `sseStreamResponse` stub returns the stream on the response. */
type StreamResponse = { status: number; stream: ReadableStream<Uint8Array> };

function req(id?: string, signal?: AbortSignal) {
  const url = new URL('http://localhost/api/v1/chats/creation-progress');
  if (id !== undefined) url.searchParams.set('id', id);
  return {
    nextUrl: url,
    signal: signal ?? new AbortController().signal,
  } as never;
}

/**
 * Drain a stream that is expected to close on its own, returning the parsed
 * `data:` frames. Comment lines (keep-alives) are ignored.
 */
async function drain(stream: ReadableStream<Uint8Array>): Promise<CreationProgressEvent[]> {
  return parseFrames(await drainRaw(stream));
}

/** As {@link drain}, but returns the undecoded SSE text including comment lines. */
async function drainRaw(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value);
  }
  return buffered;
}

/** Read whatever is currently queued without waiting for the stream to close. */
async function readAvailable(
  stream: ReadableStream<Uint8Array>,
  frameCount: number
): Promise<CreationProgressEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let seen = 0;
  while (seen < frameCount) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value);
    seen = parseFrames(buffered).length;
  }
  reader.releaseLock();
  return parseFrames(buffered);
}

function parseFrames(raw: string): CreationProgressEvent[] {
  return raw
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
}

const TS = 1_700_000_000_000;

function status(message: string): CreationProgressEvent {
  return { kind: 'status', message, ts: TS };
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetCreationProgressForTests();
});

afterEach(() => {
  __resetCreationProgressForTests();
});

describe('GET /api/v1/chats/creation-progress', () => {
  it('400s without a progress id', async () => {
    const res = await GET(req());

    expect(res.status).toBe(400);
    await expect((res as never as { json: () => Promise<unknown> }).json()).resolves.toEqual({
      error: 'Missing progress id',
    });
  });

  it('400s on an empty progress id', async () => {
    const res = await GET(req(''));

    expect(res.status).toBe(400);
  });

  it('replays the backlog to a subscriber that connects late', async () => {
    publishCreationProgress('p1', status('Warming the boiler'));
    publishCreationProgress('p1', status('Rousing the staff'));
    finishCreationProgress('p1');

    const res = (await GET(req('p1'))) as never as StreamResponse;
    const events = await drain(res.stream);

    expect(events.map((e) => e.kind)).toEqual(['status', 'status', 'done']);
    expect((events[0] as { message: string }).message).toBe('Warming the boiler');
  });

  it('closes the stream immediately when the backlog already ends in done', async () => {
    finishCreationProgress('p2');

    const res = (await GET(req('p2'))) as never as StreamResponse;

    // drain() only returns once the stream closes on its own.
    const events = await drain(res.stream);
    expect(events).toEqual([{ kind: 'done', ts: expect.any(Number) }]);
  });

  it('closes the stream when the backlog ends in error', async () => {
    failCreationProgress('p3', 'The boiler burst');

    const res = (await GET(req('p3'))) as never as StreamResponse;
    const events = await drain(res.stream);

    expect(events).toEqual([
      { kind: 'error', message: 'The boiler burst', ts: expect.any(Number) },
    ]);
  });

  it('relays events published after the subscriber attaches', async () => {
    const res = (await GET(req('p4'))) as never as StreamResponse;

    publishCreationProgress('p4', status('Laying the table'));
    finishCreationProgress('p4');

    const events = await drain(res.stream);
    expect(events.map((e) => e.kind)).toEqual(['status', 'done']);
  });

  it('stops relaying once the client aborts', async () => {
    const controller = new AbortController();
    const res = (await GET(req('p5', controller.signal))) as never as StreamResponse;

    publishCreationProgress('p5', status('Still going'));
    const before = await readAvailable(res.stream, 1);
    expect(before).toHaveLength(1);

    controller.abort();
    // The subscription is torn down, so this never reaches the stream — and the
    // stream is already closed, so draining it terminates.
    publishCreationProgress('p5', status('Unheard'));

    const all = await drain(res.stream);
    expect(all.map((e) => (e as { message?: string }).message)).not.toContain('Unheard');
  });

  it('sends a keep-alive comment while the flow is still running', async () => {
    jest.useFakeTimers();
    try {
      const aborter = new AbortController();
      const res = (await GET(req('p9', aborter.signal))) as never as StreamResponse;

      jest.advanceTimersByTime(15_000);

      const reader = res.stream.getReader();
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toBe(': keep-alive\n\n');
      reader.releaseLock();
      aborter.abort();
    } finally {
      jest.useRealTimers();
    }
  });

  it('arms no keep-alive when the backlog already closed the stream', async () => {
    jest.useFakeTimers();
    try {
      finishCreationProgress('p10');
      const res = (await GET(req('p10'))) as never as StreamResponse;

      // The stream closed during replay, so the keep-alive was never armed —
      // advancing well past the interval adds no further frames.
      jest.advanceTimersByTime(60_000);

      const raw = await drainRaw(res.stream);
      expect(raw).not.toContain('keep-alive');
      expect(parseFrames(raw).map((e) => e.kind)).toEqual(['done']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('tears the subscription down when the consumer cancels the stream', async () => {
    const res = (await GET(req('p6'))) as never as StreamResponse;

    await res.stream.cancel();

    // With no listeners left, a later publish must not throw.
    expect(() => publishCreationProgress('p6', status('Nobody home'))).not.toThrow();
  });

  it('keeps separate progress ids isolated', async () => {
    publishCreationProgress('p7', status('For seven'));
    finishCreationProgress('p7');
    publishCreationProgress('p8', status('For eight'));
    finishCreationProgress('p8');

    const seven = await drain(((await GET(req('p7'))) as never as StreamResponse).stream);
    const eight = await drain(((await GET(req('p8'))) as never as StreamResponse).stream);

    expect((seven[0] as { message: string }).message).toBe('For seven');
    expect((eight[0] as { message: string }).message).toBe('For eight');
  });
});
