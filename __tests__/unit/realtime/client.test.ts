/**
 * Unit tests for the client-side realtime hub.
 *
 * The socket is stubbed: what's under test is the lifecycle around it —
 * one connection shared by every subscriber, reconnect with backoff, and the
 * on-open catch-up that makes a missed event harmless.
 */

import {
  __resetRealtimeClientForTests,
  getRealtimeStatus,
  subscribeRealtime,
} from '@/lib/realtime/client';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  /** Test helper: complete the handshake. */
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test helper: deliver a server frame. */
  deliver(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** Test helper: drop the connection from the server side. */
  drop() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const originalWebSocket = global.WebSocket;

describe('realtime client', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeWebSocket.instances = [];
    (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    __resetRealtimeClientForTests();
  });

  afterEach(() => {
    __resetRealtimeClientForTests();
    (global as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
    jest.useRealTimers();
  });

  function latest(): FakeWebSocket {
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!socket) throw new Error('no socket was opened');
    return socket;
  }

  it('opens one socket for many subscribers', () => {
    subscribeRealtime({ onEvent: jest.fn() });
    subscribeRealtime({ onEvent: jest.fn() });
    subscribeRealtime({ onEvent: jest.fn() });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(latest().url).toContain('/api/v1/system/realtime/stream');
  });

  it('reports connected once the handshake completes', () => {
    subscribeRealtime({ onEvent: jest.fn() });
    expect(getRealtimeStatus()).toBe('connecting');
    latest().open();
    expect(getRealtimeStatus()).toBe('connected');
  });

  it('fans a valid event out to every subscriber', () => {
    const a = jest.fn();
    const b = jest.fn();
    subscribeRealtime({ onEvent: a });
    subscribeRealtime({ onEvent: b });
    latest().open();

    latest().deliver({ v: 1, topic: 'jobs', at: 1 });

    expect(a).toHaveBeenCalledWith({ v: 1, topic: 'jobs', at: 1 });
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed frame instead of tearing the socket down', () => {
    const onEvent = jest.fn();
    subscribeRealtime({ onEvent });
    latest().open();

    latest().deliver({ topic: 'jobs' }); // no version, no timestamp
    latest().onmessage?.({ data: 'not json at all' });

    expect(onEvent).not.toHaveBeenCalled();
    expect(getRealtimeStatus()).toBe('connected');
  });

  it('fires onOpen for the catch-up sweep, on first connect and on reconnect', () => {
    const onOpen = jest.fn();
    subscribeRealtime({ onEvent: jest.fn(), onOpen });
    latest().open();
    expect(onOpen).toHaveBeenCalledTimes(1);

    latest().drop();
    jest.advanceTimersByTime(31_000);
    latest().open();
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('reconnects after a drop', () => {
    subscribeRealtime({ onEvent: jest.fn() });
    latest().open();
    expect(FakeWebSocket.instances).toHaveLength(1);

    latest().drop();
    expect(getRealtimeStatus()).toBe('idle');

    jest.advanceTimersByTime(31_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('sends a keepalive ping on the interval', () => {
    subscribeRealtime({ onEvent: jest.fn() });
    const socket = latest();
    socket.open();

    jest.advanceTimersByTime(30_000);
    expect(socket.sent).toEqual([JSON.stringify({ type: 'ping' })]);
  });

  it('closes the socket when the last subscriber leaves', () => {
    const first = subscribeRealtime({ onEvent: jest.fn() });
    const second = subscribeRealtime({ onEvent: jest.fn() });
    const socket = latest();
    socket.open();

    first();
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);

    second();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(getRealtimeStatus()).toBe('idle');
  });

  it('does not reconnect once every subscriber has gone', () => {
    const unsubscribe = subscribeRealtime({ onEvent: jest.fn() });
    latest().open();
    unsubscribe();

    const count = FakeWebSocket.instances.length;
    jest.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances).toHaveLength(count);
  });
});
