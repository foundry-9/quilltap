/**
 * Unit tests for the realtime invalidation bus.
 *
 * The contract worth pinning down is the coalescing: a storm of publishes for
 * the same topic must reach a client as one event, and distinct topics (or
 * distinct ids under one topic) must not be collapsed into each other.
 */

import {
  __resetRealtimeBusForTests,
  attachRealtimeSocket,
  publishRealtime,
  realtimeListenerCount,
} from '@/lib/realtime/bus';

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

interface FakeSocket {
  sent: string[];
  send: (frame: string) => void;
}

function fakeSocket(onSend?: () => void): FakeSocket {
  const sent: string[] = [];
  return {
    sent,
    send(frame: string) {
      onSend?.();
      sent.push(frame);
    },
  };
}

function frames(socket: FakeSocket): Array<{ v: number; topic: string; id?: string; at: number }> {
  return socket.sent.map((frame) => JSON.parse(frame));
}

describe('realtime bus', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetRealtimeBusForTests();
  });

  afterEach(() => {
    __resetRealtimeBusForTests();
    jest.useRealTimers();
  });

  it('delivers a published event to attached sockets on the trailing edge', () => {
    const socket = fakeSocket();
    attachRealtimeSocket(socket as never);

    publishRealtime('jobs');
    expect(socket.sent).toHaveLength(0);

    jest.advanceTimersByTime(250);
    expect(frames(socket)).toEqual([
      expect.objectContaining({ v: 1, topic: 'jobs' }),
    ]);
  });

  it('coalesces a storm of publishes for one topic into a single event', () => {
    const socket = fakeSocket();
    attachRealtimeSocket(socket as never);

    for (let i = 0; i < 500; i++) publishRealtime('jobs');
    jest.advanceTimersByTime(250);

    expect(socket.sent).toHaveLength(1);
  });

  it('keeps distinct topics and distinct ids separate', () => {
    const socket = fakeSocket();
    attachRealtimeSocket(socket as never);

    publishRealtime('jobs');
    publishRealtime('chats', 'chat-a');
    publishRealtime('chats', 'chat-b');
    publishRealtime('chats', 'chat-a');
    jest.advanceTimersByTime(250);

    const delivered = frames(socket);
    expect(delivered).toHaveLength(3);
    expect(delivered.map((e) => `${e.topic}:${e.id ?? ''}`).sort()).toEqual([
      'chats:chat-a',
      'chats:chat-b',
      'jobs:',
    ]);
  });

  it('starts a fresh window after a flush', () => {
    const socket = fakeSocket();
    attachRealtimeSocket(socket as never);

    publishRealtime('jobs');
    jest.advanceTimersByTime(250);
    publishRealtime('jobs');
    jest.advanceTimersByTime(250);

    expect(socket.sent).toHaveLength(2);
  });

  it('fans out to every attached socket', () => {
    const a = fakeSocket();
    const b = fakeSocket();
    attachRealtimeSocket(a as never);
    attachRealtimeSocket(b as never);
    expect(realtimeListenerCount()).toBe(2);

    publishRealtime('autonomousRooms');
    jest.advanceTimersByTime(250);

    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it('drops a socket whose send throws without stalling the others', () => {
    const broken = fakeSocket(() => {
      throw new Error('socket is gone');
    });
    const healthy = fakeSocket();
    attachRealtimeSocket(broken as never);
    attachRealtimeSocket(healthy as never);

    publishRealtime('jobs');
    jest.advanceTimersByTime(250);

    expect(healthy.sent).toHaveLength(1);
    expect(realtimeListenerCount()).toBe(1);
  });

  it('stops delivering to a detached socket', () => {
    const socket = fakeSocket();
    const detach = attachRealtimeSocket(socket as never);
    detach();
    // Detaching twice must not corrupt the count.
    detach();
    expect(realtimeListenerCount()).toBe(0);

    publishRealtime('jobs');
    jest.advanceTimersByTime(250);

    expect(socket.sent).toHaveLength(0);
  });
});
