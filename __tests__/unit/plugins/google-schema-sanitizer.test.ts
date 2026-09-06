/**
 * Google function-declaration schema sanitizer.
 *
 * Bug 125 regression: Google's function-calling API is an OpenAPI subset that
 * refuses `additionalProperties` anywhere inside a declaration. The top-level
 * one never reaches the wire (the declaration builder forwards `properties` +
 * `required` only), but the one Zod emits on an array's `items` object — the
 * wardrobe tools' `operations` — survived the recursive sanitizer and 400'd
 * every tool-enabled turn whose slate carried them. The pin feeds the real
 * wardrobe schemas through the sanitizer and holds the strip list against them.
 */
import {
  UNSUPPORTED_SCHEMA_FIELDS,
  sanitizeSchemaForGoogle,
} from '@/plugins/dist/qtap-plugin-google/provider'
import { wardrobeWearToolInputSchema } from '@/lib/tools/wardrobe-wear-tool'
import { wardrobeTakeOffToolInputSchema } from '@/lib/tools/wardrobe-take-off-tool'
import { zodToOpenAISchema } from '@/lib/tools/zod-to-openai-schema'

/** Every key that appears anywhere in a nested schema. */
function collectKeys(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) collectKeys(child, out)
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out.add(key)
      collectKeys(value, out)
    }
  }
  return out
}

describe('sanitizeSchemaForGoogle', () => {
  it('lists additionalProperties among the fields it strips', () => {
    expect(UNSUPPORTED_SCHEMA_FIELDS).toContain('additionalProperties')
  })

  it.each([
    ['wardrobe_wear', wardrobeWearToolInputSchema],
    ['wardrobe_take_off', wardrobeTakeOffToolInputSchema],
  ])('strips the additionalProperties nested under %s operations.items', (_name, zodSchema) => {
    const parameters = zodToOpenAISchema(zodSchema) as {
      properties: { operations: { items: Record<string, unknown> } }
    }
    // The premise: the converter really does put one on the item object.
    expect(parameters.properties.operations.items).toHaveProperty('additionalProperties', false)

    // What the declaration builder forwards (provider.ts wraps `properties` only).
    const sanitized = sanitizeSchemaForGoogle(parameters.properties)

    expect(collectKeys(sanitized).has('additionalProperties')).toBe(false)
    // The rest of the item schema is intact.
    const items = sanitized.operations.items as Record<string, unknown>
    expect(items.type).toBe('OBJECT')
    expect(Object.keys(items.properties as object)).toEqual(
      Object.keys(parameters.properties.operations.items.properties as object),
    )
  })

  it('strips every listed field at any depth and leaves the rest', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        list: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            default: {},
            properties: { id: { type: 'string', const: 'x', description: 'kept' } },
            required: ['id'],
          },
        },
      },
    }
    const sanitized = sanitizeSchemaForGoogle(schema)
    const keys = collectKeys(sanitized)
    for (const field of UNSUPPORTED_SCHEMA_FIELDS) expect(keys.has(field)).toBe(false)
    expect(sanitized.properties.list.items.properties.id.description).toBe('kept')
    expect(sanitized.properties.list.items.required).toEqual(['id'])
  })
})
