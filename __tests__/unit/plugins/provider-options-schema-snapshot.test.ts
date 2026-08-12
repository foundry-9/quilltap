/**
 * Provider options schema — snapshot test
 *
 * Captures the connection-profile options schema each LLM plugin returns
 * from `getProviderOptionsSchema()`. Any drift between the plugin code and
 * the host's expectations will surface here, forcing a deliberate review
 * before the change ships.
 *
 * If a snapshot diff is intentional (e.g., a new option field, a tightened
 * enum), update with `npx jest -u __tests__/unit/plugins/provider-options-schema-snapshot.test.ts`.
 */

// The OpenRouter plugin bundles the OpenRouter SDK, which references
// `ReadableStream` at module-load time. jsdom doesn't expose one, so we
// pull Node's WHATWG implementation in before any plugin require. ES-style
// `import` would be hoisted above this shim, so we use require below.
import { ReadableStream as NodeReadableStream } from 'node:stream/web'
if (typeof (globalThis as { ReadableStream?: unknown }).ReadableStream === 'undefined') {
  ;(globalThis as { ReadableStream: unknown }).ReadableStream = NodeReadableStream
}

const { plugin: anthropicPlugin } = require('../../../plugins/dist/qtap-plugin-anthropic/index.js')
const { plugin: openaiPlugin } = require('../../../plugins/dist/qtap-plugin-openai/index.js')
const { plugin: openrouterPlugin } = require('../../../plugins/dist/qtap-plugin-openrouter/index.js')
const { plugin: deepseekPlugin } = require('../../../plugins/dist/qtap-plugin-deepseek/index.js')
const { plugin: zaiPlugin } = require('../../../plugins/dist/qtap-plugin-z-ai/index.js')

describe('Provider options schemas', () => {
  it('Anthropic exposes an options schema', () => {
    expect(anthropicPlugin.getProviderOptionsSchema?.()).toMatchSnapshot()
  })

  it('OpenAI exposes an options schema', () => {
    expect(openaiPlugin.getProviderOptionsSchema?.()).toMatchSnapshot()
  })

  it('OpenRouter exposes an options schema', () => {
    expect(openrouterPlugin.getProviderOptionsSchema?.()).toMatchSnapshot()
  })

  it('DeepSeek exposes an options schema', () => {
    expect(deepseekPlugin.getProviderOptionsSchema?.()).toMatchSnapshot()
  })

  it('Z.AI exposes an options schema', () => {
    expect(zaiPlugin.getProviderOptionsSchema?.()).toMatchSnapshot()
  })
})
