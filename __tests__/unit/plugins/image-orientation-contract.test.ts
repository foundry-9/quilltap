/**
 * @jest-environment node
 *
 * Contract test for built-in image-provider plugins: every provider must
 * advertise an orientation mapping with BOTH portrait and landscape present, so
 * the host resolver can always offer those choices (see
 * docs/developer/features/image-orientation-gating.md).
 *
 * This loads the built plugin bundles (each qtap-plugin-<name> index.js) and
 * inspects their real getImageGenerationModels() / getImageProviderConstraints()
 * output — so it fails if a future plugin ships image generation but forgets a
 * direction, or drops orientationSupport entirely. Node environment because we
 * require the CJS bundles directly.
 */

import path from 'node:path'
import type {
  ImageOrientationSupport,
  OrientationStrategy,
} from '@quilltap/plugin-types'

type AnyPlugin = {
  getImageGenerationModels?: () => Array<{ id: string; orientationSupport?: ImageOrientationSupport }>
  getImageProviderConstraints?: () => { orientationSupport?: ImageOrientationSupport }
}

function loadPlugin(name: string): AnyPlugin {
  const bundle = require(path.join(process.cwd(), 'plugins', 'dist', name, 'index.js'))
  const exported = bundle.default ?? bundle.plugin ?? bundle
  return (exported.default ?? exported) as AnyPlugin
}

const VALID_STRATEGIES: OrientationStrategy[] = ['size', 'aspectRatio', 'prompt']

function assertSupport(label: string, support: ImageOrientationSupport | undefined) {
  if (!support) {
    throw new Error(`${label}: missing orientationSupport`)
  }
  expect(VALID_STRATEGIES).toContain(support.strategy)
  // portrait and landscape MUST be present (square is optional). They may be an
  // empty mapping (provider supports only square, e.g. dall-e-2), which the host
  // resolver degrades to a prompt hint — but the keys must exist.
  expect(support.portrait).toBeDefined()
  expect(support.landscape).toBeDefined()
}

describe('image-provider plugins advertise orientation support', () => {
  it.each([
    'qtap-plugin-openai',
    'qtap-plugin-google',
    'qtap-plugin-openrouter',
  ])('%s: every image model declares portrait + landscape', (name) => {
    const plugin = loadPlugin(name)
    expect(typeof plugin.getImageGenerationModels).toBe('function')
    const models = plugin.getImageGenerationModels!()
    expect(models.length).toBeGreaterThan(0)
    for (const m of models) {
      assertSupport(`${name}/${m.id}`, m.orientationSupport)
    }
  })

  it.each([
    'qtap-plugin-grok',
    'qtap-plugin-z-ai',
    'qtap-plugin-nanogpt',
  ])('%s: provider-level constraints declare portrait + landscape', (name) => {
    const plugin = loadPlugin(name)
    expect(typeof plugin.getImageProviderConstraints).toBe('function')
    const constraints = plugin.getImageProviderConstraints!()
    assertSupport(name, constraints.orientationSupport)
  })

  it('openai gpt-image and dall-e-3 map portrait to their own distinct sizes', () => {
    const plugin = loadPlugin('qtap-plugin-openai')
    const models = plugin.getImageGenerationModels!()
    const gpt = models.find(m => m.id === 'gpt-image-1')
    const dalle3 = models.find(m => m.id === 'dall-e-3')
    expect(gpt?.orientationSupport?.portrait.size).toBe('1024x1536')
    expect(dalle3?.orientationSupport?.portrait.size).toBe('1024x1792')
  })
})
