/**
 * Regression coverage for bug 77 — the Salon's tool-execution notice pinned
 * itself above the composer and could never be dismissed.
 *
 * The banner was cleared only from the send path's `onDone`, so a turn that
 * finished by any other route — a chain's intermediate done, continue mode, an
 * error, an autonomous turn — left "Successfully generated 1 image!" occupying
 * composer space for the rest of the session with no affordance to remove it.
 * The fix moves ownership of the notice's lifetime into the status itself.
 */

import { renderHook, act } from '@testing-library/react'
import {
  useToolExecutionStatus,
  TOOL_STATUS_DISMISS_MS,
} from '@/app/salon/[id]/hooks/useToolExecutionStatus'

const pending = { tool: 'generate_image', status: 'pending' as const, message: 'Generating image...' }
const settled = { tool: 'generate_image', status: 'success' as const, message: 'Successfully generated 1 image!' }
const failed = { tool: 'generate_image', status: 'error' as const, message: 'Image generation failed' }

describe('useToolExecutionStatus', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('starts with no notice', () => {
    const { result } = renderHook(() => useToolExecutionStatus())
    expect(result.current.toolExecutionStatus).toBeNull()
  })

  it('keeps a pending notice up indefinitely — the tool has not answered yet', () => {
    const { result } = renderHook(() => useToolExecutionStatus())

    act(() => result.current.publishToolExecutionStatus(pending))
    act(() => { jest.advanceTimersByTime(TOOL_STATUS_DISMISS_MS * 10) })

    expect(result.current.toolExecutionStatus).toEqual(pending)
  })

  it('self-expires a settled notice — the bug: it used to stay up forever', () => {
    const { result } = renderHook(() => useToolExecutionStatus())

    act(() => result.current.publishToolExecutionStatus(settled))
    expect(result.current.toolExecutionStatus).toEqual(settled)

    act(() => { jest.advanceTimersByTime(TOOL_STATUS_DISMISS_MS - 1) })
    expect(result.current.toolExecutionStatus).toEqual(settled)

    act(() => { jest.advanceTimersByTime(1) })
    expect(result.current.toolExecutionStatus).toBeNull()
  })

  it('self-expires an error notice too, not just a success', () => {
    const { result } = renderHook(() => useToolExecutionStatus())

    act(() => result.current.publishToolExecutionStatus(failed))
    act(() => { jest.advanceTimersByTime(TOOL_STATUS_DISMISS_MS) })

    expect(result.current.toolExecutionStatus).toBeNull()
  })

  it('restarts the countdown on each publish rather than letting an old timer clear a new notice', () => {
    const { result } = renderHook(() => useToolExecutionStatus())

    act(() => result.current.publishToolExecutionStatus(settled))
    act(() => { jest.advanceTimersByTime(TOOL_STATUS_DISMISS_MS - 100) })

    // A second tool settles just before the first notice would have expired.
    act(() => result.current.publishToolExecutionStatus(failed))
    act(() => { jest.advanceTimersByTime(200) })

    // The superseded timer must not have taken the new notice down with it.
    expect(result.current.toolExecutionStatus).toEqual(failed)

    act(() => { jest.advanceTimersByTime(TOOL_STATUS_DISMISS_MS) })
    expect(result.current.toolExecutionStatus).toBeNull()
  })

  it('cancels a running countdown when a pending notice supersedes a settled one', () => {
    const { result } = renderHook(() => useToolExecutionStatus())

    act(() => result.current.publishToolExecutionStatus(settled))
    act(() => result.current.publishToolExecutionStatus(pending))
    act(() => { jest.advanceTimersByTime(TOOL_STATUS_DISMISS_MS * 2) })

    expect(result.current.toolExecutionStatus).toEqual(pending)
  })

  it('dismisses immediately on request — the ✕ button and Stop', () => {
    const { result } = renderHook(() => useToolExecutionStatus())

    act(() => result.current.publishToolExecutionStatus(settled))
    act(() => result.current.dismissToolExecutionStatus())

    expect(result.current.toolExecutionStatus).toBeNull()
  })

  it('leaves nothing behind after a dismiss — no orphaned timer to fire later', () => {
    const { result } = renderHook(() => useToolExecutionStatus())

    act(() => result.current.publishToolExecutionStatus(settled))
    act(() => result.current.dismissToolExecutionStatus())
    act(() => result.current.publishToolExecutionStatus(pending))
    act(() => { jest.advanceTimersByTime(TOOL_STATUS_DISMISS_MS * 2) })

    expect(result.current.toolExecutionStatus).toEqual(pending)
  })

  describe('the turn boundary', () => {
    it('drops a still-pending notice whose result never arrived', () => {
      const { result } = renderHook(() => useToolExecutionStatus())

      act(() => result.current.publishToolExecutionStatus(pending))
      act(() => result.current.clearPendingToolExecutionStatus())

      expect(result.current.toolExecutionStatus).toBeNull()
    })

    it('leaves a settled notice to its own countdown rather than cutting it short', () => {
      const { result } = renderHook(() => useToolExecutionStatus())

      act(() => result.current.publishToolExecutionStatus(settled))
      act(() => result.current.clearPendingToolExecutionStatus())

      expect(result.current.toolExecutionStatus).toEqual(settled)

      act(() => { jest.advanceTimersByTime(TOOL_STATUS_DISMISS_MS) })
      expect(result.current.toolExecutionStatus).toBeNull()
    })

    it('is a no-op when there is no notice at all', () => {
      const { result } = renderHook(() => useToolExecutionStatus())

      act(() => result.current.clearPendingToolExecutionStatus())
      expect(result.current.toolExecutionStatus).toBeNull()
    })
  })

  it('clears its timer on unmount so no state is set after teardown', () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
    const { result, unmount } = renderHook(() => useToolExecutionStatus())

    act(() => result.current.publishToolExecutionStatus(settled))
    clearTimeoutSpy.mockClear()
    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })
})
