import {
  publishCreationProgress,
  subscribeCreationProgress,
  finishCreationProgress,
  failCreationProgress,
  createCreationProgressEmitter,
  __resetCreationProgressForTests,
  type CreationProgressEvent,
} from '../creation-progress'

describe('creation-progress bus', () => {
  afterEach(() => {
    __resetCreationProgressForTests()
  })

  it('delivers live events to a subscriber', () => {
    const received: CreationProgressEvent[] = []
    const { unsubscribe } = subscribeCreationProgress('chan-live', (e) => received.push(e))
    publishCreationProgress('chan-live', { kind: 'status', message: 'hi', ts: 1 })
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ kind: 'status', message: 'hi' })
    unsubscribe()
  })

  it('replays buffered events to a late subscriber (no early events lost)', () => {
    publishCreationProgress('chan-late', { kind: 'status', message: 'first', ts: 1 })
    publishCreationProgress('chan-late', { kind: 'log', message: 'second', ts: 2 })
    const { replay } = subscribeCreationProgress('chan-late', () => {})
    expect(replay.map((e) => e.kind)).toEqual(['status', 'log'])
  })

  it('includes the terminal done in replay so a late subscriber resolves immediately', () => {
    publishCreationProgress('chan-fin', { kind: 'status', message: 'x', ts: 1 })
    finishCreationProgress('chan-fin')
    const { replay } = subscribeCreationProgress('chan-fin', () => {})
    expect(replay[replay.length - 1].kind).toBe('done')
  })

  it('ignores events published after a terminal event', () => {
    const received: CreationProgressEvent[] = []
    subscribeCreationProgress('chan-terminal', (e) => received.push(e))
    finishCreationProgress('chan-terminal')
    publishCreationProgress('chan-terminal', { kind: 'status', message: 'late', ts: 9 })
    expect(received.map((e) => e.kind)).toEqual(['done'])
  })

  it('failCreationProgress emits a single terminal error', () => {
    const received: CreationProgressEvent[] = []
    subscribeCreationProgress('chan-err', (e) => received.push(e))
    failCreationProgress('chan-err', 'boom')
    failCreationProgress('chan-err', 'again') // idempotent — already finished
    expect(received).toEqual([{ kind: 'error', message: 'boom', ts: expect.any(Number) }])
  })

  it('cleans up a finished channel after the TTL so a much-later subscribe starts empty', () => {
    jest.useFakeTimers()
    try {
      publishCreationProgress('chan-ttl', { kind: 'status', message: 'x', ts: 1 })
      finishCreationProgress('chan-ttl')
      jest.advanceTimersByTime(61_000)
      const { replay } = subscribeCreationProgress('chan-ttl', () => {})
      expect(replay).toEqual([])
    } finally {
      jest.useRealTimers()
    }
  })

  it('is a no-op when the emitter has no id (creation still works with no channel)', () => {
    const emitter = createCreationProgressEmitter(undefined)
    expect(() => {
      emitter.status('nope')
      emitter.wardrobeStart('c1', 'Nemo')
      emitter.wardrobeResult('c1', 'Nemo', { top: [], bottom: [], footwear: [], accessories: [] })
      emitter.finish()
    }).not.toThrow()
    // Nothing was created — a fresh subscribe replays nothing.
    const { replay } = subscribeCreationProgress('unrelated-id', () => {})
    expect(replay).toEqual([])
  })

  it('emitter helpers publish through to subscribers in order', () => {
    const received: CreationProgressEvent[] = []
    subscribeCreationProgress('chan-emitter', (e) => received.push(e))
    const emitter = createCreationProgressEmitter('chan-emitter')
    emitter.wardrobeStart('c1', 'Jeeves')
    emitter.wardrobeResult('c1', 'Jeeves', { top: [], bottom: [], footwear: [], accessories: [] })
    emitter.finish()
    expect(received.map((e) => e.kind)).toEqual(['wardrobe-start', 'wardrobe-result', 'done'])
  })
})
