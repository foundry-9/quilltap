/**
 * Workspace-tabs feature flag.
 *
 * The flag is evaluated once at module load, which is the whole subtlety: it
 * is baked in at import time, and only the exact string `'0'` opts out. A
 * looser check (`!process.env.X`, or truthiness) would silently disable the
 * workspace for anyone who set the variable to `'false'` or left it empty —
 * and since this gates the post-login landing surface, that is the difference
 * between the app opening where users expect and not.
 */

const ENV_KEY = 'NEXT_PUBLIC_WORKSPACE_TABS'

/** Load a fresh copy of the module with the env var set to `value`. */
function loadWithEnv(value: string | undefined) {
  const previous = process.env[ENV_KEY]
  if (value === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = value
  }

  let mod!: typeof import('@/lib/config/feature-flags')
  jest.isolateModules(() => {
    mod = require('@/lib/config/feature-flags')
  })

  if (previous === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = previous
  }
  return mod
}

describe('WORKSPACE_TABS_ENABLED', () => {
  it('is on when the variable is unset — the workspace is the default surface', () => {
    const mod = loadWithEnv(undefined)

    expect(mod.WORKSPACE_TABS_ENABLED).toBe(true)
    expect(mod.isWorkspaceTabsEnabled()).toBe(true)
  })

  it("is off only for the exact opt-out string '0'", () => {
    const mod = loadWithEnv('0')

    expect(mod.WORKSPACE_TABS_ENABLED).toBe(false)
    expect(mod.isWorkspaceTabsEnabled()).toBe(false)
  })

  it.each(['1', 'true', 'false', 'off', 'no', '', ' 0 '])(
    'stays on for %p, which is not the documented opt-out',
    (value) => {
      // Notably 'false' and '' keep the workspace ON. Anyone meaning to opt out
      // must write '0'; that is the contract the module's docs state.
      expect(loadWithEnv(value).isWorkspaceTabsEnabled()).toBe(true)
    }
  )

  it('exposes the constant and the accessor in agreement', () => {
    const on = loadWithEnv(undefined)
    expect(on.isWorkspaceTabsEnabled()).toBe(on.WORKSPACE_TABS_ENABLED)

    const off = loadWithEnv('0')
    expect(off.isWorkspaceTabsEnabled()).toBe(off.WORKSPACE_TABS_ENABLED)
  })
})
