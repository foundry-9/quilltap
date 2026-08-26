/**
 * Regression coverage for bug 83 — a V8 Sparkplug GC race (nodejs/node#62393)
 * killed a jest worker with SIGSEGV roughly one run in five, failing an
 * arbitrary innocent suite. The workaround is `--no-sparkplug`, armed two ways:
 * the npm scripts launch jest under it, and `jest.global-setup.js` appends it
 * to `process.execArgv` before any worker forks so ad-hoc invocations
 * (`npx jest`, `--watch`, a single-file `-u` run) are covered too.
 *
 * The bug is invisible to an ordinary assertion — it is a crash, not a wrong
 * value — so this test guards the mechanism instead: if the flag ever stops
 * reaching the process a suite actually runs in, this goes red rather than the
 * segfaults quietly coming back and being re-run away.
 */

describe('the V8 Sparkplug segfault guard', () => {
  it('is armed in the process this suite runs in', () => {
    expect(process.execArgv).toContain('--no-sparkplug')
  })

  it('is armed exactly once, so repeated globalSetup runs cannot pile the flag up', () => {
    const occurrences = process.execArgv.filter(arg => arg === '--no-sparkplug').length
    expect(occurrences).toBe(1)
  })
})
