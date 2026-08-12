/**
 * Operation progress bus.
 *
 * The behaviours worth pinning are the ones the UI depends on: a late
 * subscriber must replay everything (the card can be collapsed and reopened
 * mid-run), terminal events must stay terminal, and channels must be isolated
 * from one another now that chat creation and The Almanack share one bus.
 */

import {
  createOperationProgressEmitter,
  failOperationProgress,
  finishOperationProgress,
  publishOperationProgress,
  subscribeOperationProgress,
  __resetOperationProgressForTests,
  type CoreProgressEvent,
} from '@/lib/progress/operation-progress'

describe('operation progress bus', () => {
  beforeEach(() => {
    __resetOperationProgressForTests()
  })

  afterAll(() => {
    __resetOperationProgressForTests()
  })

  it('replays the whole backlog to a subscriber that connects late', () => {
    publishOperationProgress('run-1', { kind: 'status', message: 'first', ts: 1 })
    publishOperationProgress('run-1', {
      kind: 'phase',
      key: 'premises',
      index: 1,
      total: 7,
      label: 'Taking the measure of the premises…',
      ts: 2,
    })

    const seen: CoreProgressEvent[] = []
    const { replay } = subscribeOperationProgress<CoreProgressEvent>('run-1', e => seen.push(e))

    expect(replay).toHaveLength(2)
    expect(replay[1]).toMatchObject({ kind: 'phase', key: 'premises', index: 1 })
    // The backlog is the replay array, not the live listener.
    expect(seen).toHaveLength(0)
  })

  it('fans live events out to subscribers', () => {
    const seen: CoreProgressEvent[] = []
    subscribeOperationProgress<CoreProgressEvent>('run-2', e => seen.push(e))

    publishOperationProgress('run-2', { kind: 'status', message: 'working', ts: 1 })

    expect(seen).toEqual([{ kind: 'status', message: 'working', ts: 1 }])
  })

  it('replays a terminal event to a subscriber that arrives after the run finished', () => {
    publishOperationProgress('run-3', { kind: 'status', message: 'working', ts: 1 })
    finishOperationProgress('run-3')

    const { replay } = subscribeOperationProgress<CoreProgressEvent>('run-3', () => {})

    expect(replay.map(e => e.kind)).toEqual(['status', 'done'])
  })

  it('ignores everything published after a terminal event', () => {
    finishOperationProgress('run-4')
    publishOperationProgress('run-4', { kind: 'status', message: 'too late', ts: 9 })
    failOperationProgress('run-4', 'also too late')

    const { replay } = subscribeOperationProgress<CoreProgressEvent>('run-4', () => {})

    expect(replay.map(e => e.kind)).toEqual(['done'])
  })

  it('keeps channels isolated', () => {
    const a: CoreProgressEvent[] = []
    const b: CoreProgressEvent[] = []
    subscribeOperationProgress<CoreProgressEvent>('run-a', e => a.push(e))
    subscribeOperationProgress<CoreProgressEvent>('run-b', e => b.push(e))

    publishOperationProgress('run-a', { kind: 'status', message: 'for a', ts: 1 })

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(0)
  })

  it('stops delivering after unsubscribe', () => {
    const seen: CoreProgressEvent[] = []
    const { unsubscribe } = subscribeOperationProgress<CoreProgressEvent>('run-5', e => seen.push(e))

    publishOperationProgress('run-5', { kind: 'status', message: 'one', ts: 1 })
    unsubscribe()
    publishOperationProgress('run-5', { kind: 'status', message: 'two', ts: 2 })

    expect(seen).toHaveLength(1)
  })

  describe('emitter', () => {
    it('is entirely inert without an id, so untracked callers never branch', () => {
      const emitter = createOperationProgressEmitter(null)

      // The contract is that none of this throws and nothing is recorded.
      emitter.status('ignored')
      emitter.phase('premises', 1, 7, 'Taking the measure of the premises…')
      emitter.finish()

      const { replay } = subscribeOperationProgress<CoreProgressEvent>('', () => {})
      expect(replay).toHaveLength(0)
    })

    it('publishes phase events with a 1-based index', () => {
      const emitter = createOperationProgressEmitter('run-6')
      emitter.phase('ledgers', 3, 7, 'Auditing the ledgers…')

      const { replay } = subscribeOperationProgress<CoreProgressEvent>('run-6', () => {})
      expect(replay[0]).toMatchObject({
        kind: 'phase',
        key: 'ledgers',
        index: 3,
        total: 7,
        label: 'Auditing the ledgers…',
      })
    })

    it('carries feature-specific event shapes on the same channel', () => {
      const emitter = createOperationProgressEmitter('run-7')
      emitter.publish({ kind: 'wardrobe-start', characterId: 'c1', ts: 1 })

      const { replay } = subscribeOperationProgress('run-7', () => {})
      expect(replay[0]).toMatchObject({ kind: 'wardrobe-start', characterId: 'c1' })
    })
  })
})
