/**
 * Unit tests for the realtime provider — the seam where a socket hint becomes
 * a TanStack invalidation.
 */

import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery';
import { RealtimeProvider } from '@/components/providers/realtime-provider';
import { queryKeys } from '@/lib/query/keys';
import { subscribeRealtime, type RealtimeSubscriber } from '@/lib/realtime/client';
import { ALL_REALTIME_PREFIXES } from '@/lib/realtime/topic-map';

jest.mock('@/lib/realtime/client', () => ({
  subscribeRealtime: jest.fn(),
}));

const mockSubscribe = subscribeRealtime as jest.MockedFunction<typeof subscribeRealtime>;

function mountProvider() {
  let subscriber: RealtimeSubscriber | undefined;
  const unsubscribe = jest.fn();
  mockSubscribe.mockImplementation((s) => {
    subscriber = s;
    return unsubscribe;
  });

  const { queryClient, unmount } = renderWithQuery(<RealtimeProvider />);
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  if (!subscriber) throw new Error('provider did not subscribe');
  return { subscriber, invalidate, unmount, unsubscribe };
}

describe('RealtimeProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates the mapped keys for a known topic', () => {
    const { subscriber, invalidate } = mountProvider();

    subscriber.onEvent({ v: 1, topic: 'chats', id: 'chat-1', at: 1 });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.chats.detail('chat-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.chats.state('chat-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.chats.background('chat-1') });
  });

  it('invalidates nothing for a topic this build has never heard of', () => {
    const { subscriber, invalidate } = mountProvider();

    subscriber.onEvent({ v: 1, topic: 'somethingNewer', at: 1 });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('sweeps every prefix on connect, so a missed event is harmless', () => {
    const { subscriber, invalidate } = mountProvider();

    subscriber.onOpen?.();

    expect(invalidate).toHaveBeenCalledTimes(ALL_REALTIME_PREFIXES.length);
    for (const queryKey of ALL_REALTIME_PREFIXES) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('unsubscribes on unmount', () => {
    const { unmount, unsubscribe } = mountProvider();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
