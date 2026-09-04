/**
 * `parseLLMJsonObject` — the object-extracting front door for LLM verdicts
 * that arrive wrapped in prose and/or code fences.
 */

import { parseLLMJsonObject, stripCodeFences } from '@/lib/llm/llm-json'

describe('parseLLMJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(parseLLMJsonObject<{ consistent: boolean }>('{"consistent": true}')).toEqual({ consistent: true })
  })

  it('strips a fence at the start of the response', () => {
    expect(parseLLMJsonObject('```json\n{"revise": false}\n```')).toEqual({ revise: false })
  })

  it('strips a fence that appears after leading prose (stripCodeFences alone cannot)', () => {
    const text = 'Here is my verdict:\n```json\n{"consistent": false, "discrepancies": "wrong date"}\n```\nDone.'
    expect(stripCodeFences(text)).toBe(text.trim())
    expect(parseLLMJsonObject(text)).toEqual({ consistent: false, discrepancies: 'wrong date' })
  })

  it('slices the outer braces out of unfenced prose', () => {
    expect(parseLLMJsonObject('Sure! {"revise": true, "reply": "fixed"} — hope that helps'))
      .toEqual({ revise: true, reply: 'fixed' })
  })

  it('keeps nested braces intact', () => {
    expect(parseLLMJsonObject('{"a": {"b": 1}, "c": [{"d": 2}]}')).toEqual({ a: { b: 1 }, c: [{ d: 2 }] })
  })

  it('throws on a response with no JSON in it', () => {
    expect(() => parseLLMJsonObject('I cannot answer that.')).toThrow()
  })
})
