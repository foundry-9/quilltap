/**
 * Unit tests for the shared clock.
 *
 * Two properties carry the whole design: every component on a given
 * granularity shares ONE timer, and ticks land on wall-clock boundaries so
 * readouts flip together rather than drifting apart by mount order.
 */

import { renderHook, act } from '@testing-library/react';

import { DAY_GRANULARITY_MS, useNow, __resetNowTickersForTests } from '@/hooks/useNow';

describe('useNow', () => {
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    __resetNowTickersForTests();
    jest.useFakeTimers();
    // A round minute boundary, so "next boundary" arithmetic is easy to read.
    jest.setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
    setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    __resetNowTickersForTests();
    jest.useRealTimers();
  });

  it('returns the current time', () => {
    const { result } = renderHook(() => useNow(60_000));
    expect(result.current).toBe(Date.parse('2026-08-26T12:00:00.000Z'));
  });

  it('does not change between ticks', () => {
    const { result } = renderHook(() => useNow(60_000));
    const first = result.current;
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe(first);
  });

  it('advances on the granularity boundary', () => {
    const { result } = renderHook(() => useNow(60_000));
    act(() => {
      jest.advanceTimersByTime(60_001);
    });
    expect(result.current).toBe(Date.parse('2026-08-26T12:01:00.001Z'));
  });

  it('aligns the first tick to the boundary, not to mount time', () => {
    jest.setSystemTime(new Date('2026-08-26T12:00:40.000Z'));
    const { result } = renderHook(() => useNow(60_000));
    const mounted = result.current;

    // 19 s later is still inside the same minute.
    act(() => {
      jest.advanceTimersByTime(19_000);
    });
    expect(result.current).toBe(mounted);

    // Crossing 12:01:00 fires it — 20 s after mount, not 60.
    act(() => {
      jest.advanceTimersByTime(1_001);
    });
    expect(result.current).toBeGreaterThan(mounted);
  });

  it('shares one timer across every subscriber of a granularity', () => {
    const before = setTimeoutSpy.mock.calls.length;
    const a = renderHook(() => useNow(60_000));
    const b = renderHook(() => useNow(60_000));
    const c = renderHook(() => useNow(60_000));

    // One scheduling call for the shared ticker, not one per hook.
    expect(setTimeoutSpy.mock.calls.length - before).toBe(1);
    expect(jest.getTimerCount()).toBe(1);

    act(() => {
      jest.advanceTimersByTime(60_001);
    });
    expect(a.result.current).toBe(b.result.current);
    expect(b.result.current).toBe(c.result.current);
  });

  it('stops ticking once the last subscriber unmounts', () => {
    const { unmount } = renderHook(() => useNow(60_000));
    unmount();
    const after = setTimeoutSpy.mock.calls.length;
    act(() => {
      jest.advanceTimersByTime(180_000);
    });
    expect(setTimeoutSpy.mock.calls.length).toBe(after);
  });

  it('keeps separate granularities on separate timers', () => {
    const seconds = renderHook(() => useNow(1_000));
    const minutes = renderHook(() => useNow(60_000));
    const secondsStart = seconds.result.current;
    const minutesStart = minutes.result.current;

    act(() => {
      jest.advanceTimersByTime(1_001);
    });
    expect(seconds.result.current).toBeGreaterThan(secondsStart);
    expect(minutes.result.current).toBe(minutesStart);
  });

  it('ticks day granularity at local midnight', () => {
    const { result } = renderHook(() => useNow(DAY_GRANULARITY_MS));
    const start = result.current;

    // The suite pins TZ=UTC, so local midnight is 24 h after 12:00Z minus 12 h.
    act(() => {
      jest.advanceTimersByTime(11 * 3_600_000);
    });
    expect(result.current).toBe(start);

    act(() => {
      jest.advanceTimersByTime(3_600_000 + 10);
    });
    expect(result.current).toBeGreaterThan(start);
  });

  it('does not subscribe at all when disabled', () => {
    const before = setTimeoutSpy.mock.calls.length;
    const { result } = renderHook(() => useNow(1_000, false));
    expect(setTimeoutSpy.mock.calls.length).toBe(before);

    const frozen = result.current;
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(frozen);
  });
});
