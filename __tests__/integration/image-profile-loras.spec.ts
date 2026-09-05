/**
 * Image-profile LoRA persistence and per-model options.
 *
 * Exercised through the real HTTP API rather than by driving the profile
 * modal: the form's model picker is populated from a live provider fetch, and
 * the e2e environment provisions no NanoGPT key, so a UI-driven beat would be
 * asserting against an empty picker. Everything the feature actually promises
 * — the canonical shape survives a round trip, a malformed list is refused
 * before anything is written, and the cap the editor shows is the cap the
 * server resolved — lives on this side of the wire, so this is where it is
 * checked. No image is ever generated.
 *
 * Every case uses the `request` fixture and none uses `page`, so this file runs
 * without a browser binary at all — worth keeping that way, since a spec that
 * only ever speaks JSON has no business launching Chromium to do it.
 */

import { test, expect } from '@playwright/test'

const PROVIDER = 'NANOGPT'
/** Four-adapter family (indexed dialect). */
const FOUR_LORA_MODEL = 'flux-2-dev-lora'
/** Single-adapter family (fal's url dialect). */
const ONE_LORA_MODEL = 'flux-lora'
/** A model with no LoRA story at all. */
const NO_LORA_MODEL = 'hidream'

test.describe('Image profile LoRAs', () => {
  test.describe.configure({ mode: 'serial' })

  const profileName = `LoRA Profile ${Date.now()}`
  let profileId: string

  test.afterAll(async ({ request }) => {
    if (profileId) {
      await request.delete(`/api/v1/image-profiles/${profileId}`)
    }
  })

  test('setup: the app is reachable', async ({ request }) => {
    const health = await request.get('/api/health')
    expect(health.ok()).toBeTruthy()
  })

  test('resolves LoRA support per model, and withholds it from models without any', async ({
    request,
  }) => {
    const four = await request.get(
      `/api/v1/image-profiles?action=options-schema&provider=${PROVIDER}&model=${encodeURIComponent(FOUR_LORA_MODEL)}`,
    )
    expect(four.ok()).toBeTruthy()
    const fourBody = await four.json()
    expect(fourBody.loraSupport?.maxLoras).toBe(4)
    // The schema is the plugin's, rendered by the shared panel.
    expect(fourBody.optionsSchema?.groups?.length).toBeGreaterThan(0)

    const one = await request.get(
      `/api/v1/image-profiles?action=options-schema&provider=${PROVIDER}&model=${encodeURIComponent(ONE_LORA_MODEL)}`,
    )
    const oneBody = await one.json()
    expect(oneBody.loraSupport?.maxLoras).toBe(1)

    const none = await request.get(
      `/api/v1/image-profiles?action=options-schema&provider=${PROVIDER}&model=${encodeURIComponent(NO_LORA_MODEL)}`,
    )
    const noneBody = await none.json()
    // null, not a zero-cap object: the editor reads this as "offer nothing".
    expect(noneBody.loraSupport).toBeNull()
  })

  test('refuses a malformed LoRA list before anything is written', async ({ request }) => {
    const response = await request.post('/api/v1/image-profiles', {
      data: {
        name: `${profileName} (rejected)`,
        provider: PROVIDER,
        modelName: FOUR_LORA_MODEL,
        parameters: { loras: [{ source: '' }] },
      },
    })
    expect(response.status()).toBe(400)

    // Nothing was stored under that name.
    const list = await request.get('/api/v1/image-profiles')
    const { profiles } = await list.json()
    expect(
      profiles.some((p: { name: string }) => p.name === `${profileName} (rejected)`),
    ).toBe(false)
  })

  test('persists two adapters in the canonical shape', async ({ request }) => {
    const response = await request.post('/api/v1/image-profiles', {
      data: {
        name: profileName,
        provider: PROVIDER,
        modelName: FOUR_LORA_MODEL,
        parameters: {
          size: '1024x1024',
          loras: [
            { source: 'owner/first-style', scale: 0.8, triggerPhrase: 'ohwx' },
            { source: 'https://example.test/second.safetensors', scale: 1.2 },
          ],
        },
      },
    })
    expect(response.ok()).toBeTruthy()
    profileId = (await response.json()).id

    const reloaded = await request.get(`/api/v1/image-profiles/${profileId}`)
    const profile = await reloaded.json()
    expect(profile.parameters.loras).toEqual([
      { source: 'owner/first-style', scale: 0.8, triggerPhrase: 'ohwx' },
      { source: 'https://example.test/second.safetensors', scale: 1.2 },
    ])
    // The host-owned keys keep their existing storage names alongside.
    expect(profile.parameters.size).toBe('1024x1024')
  })

  test('keeps over-cap adapters on the profile when the model is narrowed', async ({
    request,
  }) => {
    // Point the same profile at a one-adapter model. Both rows must survive
    // the write: the editor flags the extra rather than deleting it, so
    // switching back loses nothing. Capping is a request-time concern.
    const update = await request.put(`/api/v1/image-profiles/${profileId}`, {
      data: { modelName: ONE_LORA_MODEL },
    })
    expect(update.ok()).toBeTruthy()

    const reloaded = await request.get(`/api/v1/image-profiles/${profileId}`)
    const profile = await reloaded.json()
    expect(profile.modelName).toBe(ONE_LORA_MODEL)
    expect(profile.parameters.loras).toHaveLength(2)
  })
})
